import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import {
  createProductGroup,
  decideAllGroups,
  listProductGroups,
  mergedGroupCardJoinSql,
  mergedGroupVariantOwnerSql,
  updateProductGroup,
} from "@/lib/product-groups";
import { getProductDetail, listActiveProducts } from "@/lib/catalog";
import { listIndexableProducts } from "@/lib/catalog-index";
import { computeProductLiveStatusMap, computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";
import { readTelegramCatalog } from "@/lib/telegram/catalog-snapshot";
import { loadPromoProducts } from "@/lib/telegram/promo-digest";
import { subscribeRestockAlert } from "@/lib/telegram/restock-alerts";
import { getCatalogRevision } from "@/lib/catalog-cache";
import { validateCheckoutInput } from "@/lib/orders/checkout/validate";

const migration0163 = fs.readFileSync("drizzle/migrations/0163_product_group_merge_variants.sql", "utf8");

let fx: ReturnType<typeof createD1Fixture>;

function seedChatGptGroup(mode: "winner" | "merge_variants" = "merge_variants") {
  fx.sql.exec(`
    INSERT OR IGNORE INTO categories(id, name, slug, sort_order) VALUES (1, 'AI & Chatbot', 'ai-chatbot', 1);
    INSERT INTO products(id, category_id, name, slug, price, stock, is_active, telegram_enabled, storebat_family, aivault_family, tunvn_family, image_url, sold_count, sort_order) VALUES
      (394, 1, 'ChatGPT Plus', 'chatgpt-plus-sb', 103400, 32, 1, 1, 'chatgpt_plus', NULL, NULL, '/r2/products/chatgpt.webp', 10, 1),
      (174, 1, 'ChatGPT Plus', 'chatgpt-plus-av', 128000, 15, 1, 1, NULL, 'chatgpt_plus', NULL, '/r2/products/chatgpt.webp', 7, 1),
      (117, 1, 'ChatGPT Plus', 'chatgpt-tunvn', 95000, 5, 0, 1, NULL, NULL, 'chatgpt', '/r2/products/chatgpt.webp', 3, 1),
      (119, 1, 'ChatGPT Plus Arsip', 'chatgpt-arsip', 90000, 5, 0, 1, NULL, NULL, NULL, '/r2/products/chatgpt.webp', 1, 1),
      (500, 1, 'Canva Pro', 'canva-pro', 25000, 10, 1, 1, NULL, NULL, NULL, '/r2/products/canva.webp', 5, 2);
    UPDATE products SET archived_at='2026-11-20' WHERE id=119;

    INSERT INTO aivault_products(service_id, name, stock, unit_price_usd, pricing_tiers_json, markup_percent, fx_idr_per_usd, axvara_product_id, synced_at)
      VALUES ('service_chatgpt_plus_1m_fw', 'ChatGPT Plus 1M Full Warranty', 15, 5.2, '[]', 20, 16500, 174, datetime('now'));

    INSERT INTO product_variants(id, product_id, sku, label, price, compare_price, stock, min_qty, is_active, sort_order, storebat_product_id, storebat_cost_usd, storebat_fx_idr_per_usd, aivault_service_id, fulfillment_mode) VALUES
      (39401, 394, 'SB-60', 'Plus 1 Bulan (Garansi 24 Jam)', 103400, 150000, 32, 1, 1, 0, 60, 4.2, 16500, NULL, 'manual'),
      (39402, 394, 'SB-78', 'Plus 1 Bulan (Alternatif)', 98000, 140000, 0, 1, 1, 1, 78, 4.0, 16500, NULL, 'manual'),
      (39403, 394, 'SB-143', 'Plus 1 Bulan Nonaktif', 80000, NULL, 9, 1, 0, 2, 143, 3.5, 16500, NULL, 'manual'),
      (17401, 174, 'AV-service_chatgpt_plus_1m_fw', 'Plus 1 Bulan (Full Garansi)', 128000, 200000, 15, 1, 1, 0, NULL, NULL, NULL, 'service_chatgpt_plus_1m_fw', 'manual'),
      (17402, 174, 'AV-service_chatgpt_plus_1m_off', 'Plus 1 Bulan Off', 99000, NULL, 5, 1, 0, 1, NULL, NULL, NULL, 'service_chatgpt_plus_1m', 'manual'),
      (11701, 117, 'TUNVN-86', 'Plus TUNVN Nonaktif Parent', 95000, NULL, 5, 1, 1, 0, NULL, NULL, NULL, NULL, 'manual'),
      (50001, 500, 'CANVA-1', 'Canva 1 Bulan', 25000, NULL, 10, 1, 1, 0, NULL, NULL, NULL, NULL, 'manual');

    INSERT INTO product_groups(id, name, mode, winner_product_id, reason) VALUES
      (37, 'ChatGPT Plus', '${mode}', 394, 'modal/30 hari StoreBat Rp69.300 < AIVault Rp85.800');
    INSERT INTO product_group_members(group_id, product_id, position) VALUES
      (37, 394, 0), (37, 174, 1), (37, 117, 2);
  `);
}

beforeEach(() => {
  clearRateLimitBucketsForTest();
  fx = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "merge-variants-test-secret-0123456789");
  vi.stubEnv("ORDER_ACCESS_SECRET", "merge-variants-order-secret-0123456789");
  vi.stubEnv("STOREBAT_ENABLED", "true");
  vi.stubEnv("STOREBAT_API_KEY", "sb-key");
  vi.stubEnv("AIVAULT_ENABLED", "true");
  vi.stubEnv("AIVAULT_API_KEY", "av-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external network calls in fixture tests"); }));
});

afterEach(() => {
  fx.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("product_groups mode = merge_variants", () => {
  it("creates, updates, validates mode and bumps catalog_revision_market on mode toggle", async () => {
    fx.sql.exec(`
      INSERT INTO products(id, name, slug, price, stock, is_active) VALUES
        (1, 'Alpha', 'alpha', 10000, 5, 1),
        (2, 'Beta', 'beta', 20000, 5, 1);
      INSERT INTO product_variants(product_id, sku, label, price, stock, is_active, manual_cost) VALUES
        (1, 'A1', 'A1', 10000, 5, 1, 3000),
        (2, 'B1', 'B1', 20000, 5, 1, 6000);
    `);
    const db = createDatabaseAccess(fx.db);
    const created = await createProductGroup({ name: "Grup Uji", productIds: [1, 2], mode: "merge_variants" }, db);
    expect(created.mode).toBe("merge_variants");
    expect(created.winner_product_id).toBe(1);

    const revBefore = await getCatalogRevision("market", db);
    // Switching mode keeps winner_product_id=1, yet MUST bump market revision so caches refresh.
    const updated = await updateProductGroup(created.id, { mode: "winner" }, db);
    expect(updated.mode).toBe("winner");
    expect(updated.winner_product_id).toBe(1);
    const revAfter = await getCatalogRevision("market", db);
    expect(revAfter).not.toBe(revBefore);

    const listed = await listProductGroups(db, created.id);
    expect(listed[0]?.mode).toBe("winner");

    await expect(
      updateProductGroup(created.id, { mode: "invalid" as unknown as "winner" }, db),
    ).rejects.toMatchObject({ code: "invalid_mode", status: 400 });
  });

  it("aggregates active variants from all active non-archived members on storefront card, /api/catalog, listActiveProducts, and index", async () => {
    seedChatGptGroup("merge_variants");

    // 1. /api/products?active=1 shows 1 ChatGPT Plus card with merged aggregates
    const { GET: getProducts } = await import("@/app/api/products/route");
    const prodRes = await getProducts(new NextRequest("https://axvara.tech/api/products?active=1"));
    expect(prodRes.status).toBe(200);
    const prodJson = await prodRes.json() as { products: Record<string, unknown>[] };
    const gptCards = prodJson.products.filter((p) => String(p.name) === "ChatGPT Plus");
    expect(gptCards).toHaveLength(1);
    expect(gptCards[0]).toMatchObject({
      id: "394",
      slug: "chatgpt-plus-sb",
      price: 103400, // cheapest BUYABLE (excludes sold-out 98000 and inactive parent 95000)
      minPrice: 103400,
      maxPrice: 128000, // includes merged AIVault variant 128000
      variantCount: 2, // 39401 + 17401 (buyable; hides sold-out 39402 while buyable variants exist)
      stock: 47, // 32 + 15
      comparePrice: 150000, // compare_price of cheapest buyable (39401)
      soldCount: 20, // group sold_count: 10 + 7 + 3
    });

    // 2. /api/catalog?slug=chatgpt-plus-sb merges variants, buyable-first, preserves real product_id, strips supplier fields
    const { GET: getCatalog } = await import("@/app/api/catalog/route");
    const catRes = await getCatalog(new Request("https://axvara.tech/api/catalog?slug=chatgpt-plus-sb"));
    expect(catRes.status).toBe(200);
    const catJson = await catRes.json() as { product: { id: number; slug: string; merged_variants?: boolean; variants: Record<string, unknown>[] } };
    expect(catJson.product.id).toBe(394);
    expect(catJson.product.merged_variants).toBe(true);
    // Buyable first: 39401 (103.4k, stk 32), 17401 (128k, stk 15), then sold-out 39402 (98k, stk 0)
    expect(catJson.product.variants.map((v) => ({ id: v.id, product_id: v.product_id, price: v.price }))).toEqual([
      { id: 39401, product_id: 394, price: 103400 },
      { id: 17401, product_id: 174, price: 128000 },
      { id: 39402, product_id: 394, price: 98000 },
    ]);
    // Whitelabel: sibling slug & supplier IDs never leak into public variant payload
    for (const v of catJson.product.variants) {
      expect(v).not.toHaveProperty("product_slug");
      expect(v).not.toHaveProperty("aivault_service_id");
      expect(v).not.toHaveProperty("storebat_product_id");
    }

    // 3. listActiveProducts & listIndexableProducts reflect merged buyable range
    const activeList = await listActiveProducts();
    const gptSummary = activeList.find((p) => p.id === 394);
    expect(gptSummary).toMatchObject({ minPrice: 103400, maxPrice: 128000, variantCount: 2, availability: "available" });
    const indexable = await listIndexableProducts(true);
    expect(indexable.filter((r) => String(r.name) === "ChatGPT Plus")).toHaveLength(1);
    expect(indexable.find((r) => String(r.slug) === "chatgpt-plus-sb")?.price).toBe(103400);
  });

  it("preserves exact winner-only isolation when mode = winner", async () => {
    seedChatGptGroup("winner");
    const detail = await getProductDetail("chatgpt-plus-sb");
    expect(detail?.merged_variants).toBeUndefined();
    expect(detail?.variants.map((v) => v.id)).toEqual([39401, 39402]);

    const { GET: getProducts } = await import("@/app/api/products/route");
    const prodJson = await (await getProducts(new NextRequest("https://axvara.tech/api/products?active=1&slug=chatgpt-plus-sb"))).json() as { products: Record<string, unknown>[] };
    expect(prodJson.products[0]).toMatchObject({ variantCount: 1, maxPrice: 103400, stock: 32 });
  });

  it("checkout quote re-anchors merged variant to true owning supplier product and fails closed on foreign/winner-mode/inactive pairs", async () => {
    seedChatGptGroup("merge_variants");
    const { POST: postQuote } = await import("@/app/api/checkout/quote/route");

    // 1. Winner slug + merged AIVault variant -> succeeds, canonical product_id = 174 (AIVault), automatic_delivery!
    const okRes = await postQuote(new NextRequest("https://axvara.tech/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ slug: "chatgpt-plus-sb", variant_id: 17401, qty: 1, expected_price: 128000 }],
      }),
    }));
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json() as {
      subtotal: number;
      quoteToken: string;
      items: { product_id: number; variant_id: number; price: number; queued_delivery?: boolean }[];
    };
    expect(okJson.subtotal).toBe(128000);
    expect(okJson.items).toEqual([
      expect.objectContaining({
        product_id: 174,
        variant_id: 17401,
        price: 128000,
        queued_delivery: false,
      }),
    ]);

    // Signed quote token validates cleanly in validateCheckoutInput when client submits product_id=174
    const validated = await validateCheckoutInput({
      customer_wa: "081234567890",
      customer_email: "buyer@example.com",
      items: [{ product_id: 174, variant_id: 17401, qty: 1 }],
      payment_method: "qris",
      quote_token: okJson.quoteToken,
    });
    expect(validated.kind).toBe("valid");

    // 2. Foreign product variant (Canva 50001) on ChatGPT Plus slug -> MUST fail closed (409)
    const foreignRes = await postQuote(new NextRequest("https://axvara.tech/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ slug: "chatgpt-plus-sb", variant_id: 50001, qty: 1 }] }),
    }));
    expect(foreignRes.status).toBe(409);

    // 3. Inactive group member variant (TUNVN #117 is_active=0) -> MUST fail closed (409)
    const inactiveMemberRes = await postQuote(new NextRequest("https://axvara.tech/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ slug: "chatgpt-plus-sb", variant_id: 11701, qty: 1 }] }),
    }));
    expect(inactiveMemberRes.status).toBe(409);

    // 4. Conflicting explicit product_id -> MUST fail closed (409)
    const conflictingIdRes = await postQuote(new NextRequest("https://axvara.tech/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ product_id: 500, slug: "chatgpt-plus-sb", variant_id: 17401, qty: 1 }] }),
    }));
    expect(conflictingIdRes.status).toBe(409);

    // 5. Same pair when group mode is switched back to 'winner' -> MUST fail closed (409)
    fx.sql.exec("UPDATE product_groups SET mode='winner' WHERE id=37");
    const winnerModeRes = await postQuote(new NextRequest("https://axvara.tech/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ slug: "chatgpt-plus-sb", variant_id: 17401, qty: 1 }] }),
    }));
    expect(winnerModeRes.status).toBe(409);
  });

  it("Telegram catalog, detail, promo digest, and restock alerts aggregate merged Telegram-enabled members only", async () => {
    seedChatGptGroup("merge_variants");
    // Make winner #394 sold out while merged member #174 has stock=15
    fx.sql.exec("UPDATE product_variants SET stock=0 WHERE product_id=394");

    const tgCatalog = await readTelegramCatalog();
    const gpt = tgCatalog.find((p) => p.id === 394);
    expect(gpt).toMatchObject({ price: 128000, stock: 15 });

    const promo = await loadPromoProducts(createDatabaseAccess(fx.db));
    expect(promo.find((p) => p.id === 394)?.price).toBe(128000);

    // Restock alert sees winner #394 as already in_stock because merged member #174 has stock
    const alertWhileMergedInStock = await subscribeRestockAlert("123456", 394, createDatabaseAccess(fx.db));
    expect(alertWhileMergedInStock).toEqual({ ok: false, status: "in_stock" });

    // Disable telegram_enabled on member #174 -> excluded from Telegram merged detail & catalog!
    fx.sql.exec("UPDATE products SET telegram_enabled=0 WHERE id=174");
    const tgDetail = await getProductDetail(394, { telegramOnly: true });
    expect(tgDetail?.variants.map((v) => v.product_id)).toEqual([394, 394]);
    const alertWhenTgDisabled = await subscribeRestockAlert("123456", 394, createDatabaseAccess(fx.db));
    expect(alertWhenTgDisabled).toEqual({ ok: true, status: "subscribed" });
  });

  it("admin live status marks merged supplier variants as live (Gabung di ...) while keeping 1:1 product card count", async () => {
    seedChatGptGroup("merge_variants");
    const db = createDatabaseAccess(fx.db);
    const losers = await loadProductGroupLosers(db.queryAll);

    // Variant level: AIVault #174 buyable variant is LIVE (not hidden_loser)
    expect(computeVariantLiveStatus({
      supplier_active: 1, axvara_product_id: 174, variant_id: 17401, variant_active: 1,
      product_active: 1, product_archived: 0, stock: 15, min_qty: 1,
    }, losers)).toEqual({ status: "live", reason: "Gabung di ChatGPT Plus #394" });

    // Variant level: AIVault #174 out-of-stock variant is hidden_soldout
    expect(computeVariantLiveStatus({
      supplier_active: 1, axvara_product_id: 174, variant_id: 17401, variant_active: 1,
      product_active: 1, product_archived: 0, stock: 0, min_qty: 1,
    }, losers).status).toBe("hidden_soldout");

    // Product card level: winner #394 stays live even if its own stock=0 when merged member #174 has stock
    fx.sql.exec("UPDATE product_variants SET stock=0 WHERE product_id=394");
    const statusMap = await computeProductLiveStatusMap([
      { id: 394, is_active: 1, stock: 0 },
      { id: 174, is_active: 1, stock: 15 },
    ]);
    expect(statusMap.get("394")).toEqual({ status: "live", reason: "Tampil di storefront" });
    expect(statusMap.get("174")).toEqual({ status: "hidden_loser", reason: "Varian digabung di ChatGPT Plus #394" });

    // Switch back to 'winner' mode -> #174 variant returns to hidden_loser
    fx.sql.exec("UPDATE product_groups SET mode='winner' WHERE id=37");
    const winnerLosers = await loadProductGroupLosers(db.queryAll);
    expect(computeVariantLiveStatus({
      supplier_active: 1, axvara_product_id: 174, variant_id: 17401, variant_active: 1,
      product_active: 1, product_archived: 0, stock: 15, min_qty: 1,
    }, winnerLosers)).toEqual({ status: "hidden_loser", reason: "Kalah vs ChatGPT Plus #394" });
  });

  it("migration 0163 and merged SQL run cleanly in real workerd/Miniflare D1", async () => {
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
      script: 'export default { fetch() { return new Response("ok"); } }',
    });
    try {
      const db = await runtime.getD1Database("DB");
      // Build pre-0163 product_groups table (without mode column) and apply 0163 migration
      await db.batch([
        db.prepare(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT -1, is_active INTEGER NOT NULL DEFAULT 1, archived_at TEXT, telegram_enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)`),
        db.prepare(`CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, sku TEXT NOT NULL, label TEXT NOT NULL, price INTEGER NOT NULL, compare_price INTEGER, stock INTEGER NOT NULL DEFAULT -1, min_qty INTEGER NOT NULL DEFAULT 1, fulfillment_mode TEXT NOT NULL DEFAULT 'manual', is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, wr_variant_id TEXT)`),
        db.prepare(`CREATE TABLE product_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, prefer_product_id INTEGER, prefer_margin INTEGER NOT NULL DEFAULT 2000, winner_product_id INTEGER, reason TEXT, decided_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
        db.prepare(`CREATE TABLE product_group_members (group_id INTEGER NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE, product_id INTEGER NOT NULL UNIQUE, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (group_id, product_id))`),
      ]);
      await db.prepare("INSERT INTO product_groups(id, name, winner_product_id) VALUES(37, 'ChatGPT Plus', 394)").run();

      const stmts = migration0163.replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
      await db.batch(stmts.map((sql) => db.prepare(sql)));

      expect(await db.prepare("SELECT mode FROM product_groups WHERE id=37").first()).toEqual({ mode: "winner" });
      await expect(db.prepare("UPDATE product_groups SET mode='bogus' WHERE id=37").run()).rejects.toThrow(/CHECK/);

      await db.batch([
        db.prepare("INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(394,'ChatGPT Plus','chatgpt-plus-sb',103400,32,1),(174,'ChatGPT Plus','chatgpt-plus-av',128000,15,1)"),
        db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active) VALUES(1,394,'SB-60','Plus 24h',103400,32,1),(2,174,'AV-FW','Plus Full Garansi',128000,15,1)"),
        db.prepare("INSERT INTO product_group_members(group_id,product_id,position) VALUES(37,394,0),(37,174,1)"),
        db.prepare("UPDATE product_groups SET mode='merge_variants' WHERE id=37"),
      ]);

      const agg = await db.prepare(
        `SELECT p.id, COUNT(pv.id) AS vc, MIN(pv.price) AS min_p, MAX(pv.price) AS max_p
         FROM products p
         ${mergedGroupCardJoinSql("p", "gmap")}
         INNER JOIN product_variants pv ON pv.product_id=gmap.member_id AND pv.is_active=1
         WHERE p.id=394 GROUP BY p.id`,
      ).first();
      expect(agg).toEqual({ id: 394, vc: 2, min_p: 103400, max_p: 128000 });

      const vars = (await db.prepare(
        `SELECT pv.id, pv.product_id FROM product_variants pv WHERE ${mergedGroupVariantOwnerSql("?", "pv")} AND pv.is_active=1 ORDER BY pv.id ASC`,
      ).bind(394, 394).all()).results;
      expect(vars).toEqual([{ id: 1, product_id: 394 }, { id: 2, product_id: 174 }]);

      await decideAllGroups; // keep import exercised
    } finally {
      await runtime.dispose();
    }
  }, 30_000);
});
