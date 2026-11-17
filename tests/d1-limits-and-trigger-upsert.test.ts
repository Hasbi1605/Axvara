import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { zeroSkVariantsByIds } from "@/lib/sekalipay/sync";
import { zeroVariantsByIds } from "@/lib/warung-rebahan/sync";
import { applyPediaDiff } from "@/lib/pedia/sync";
import { revokeInventoryBatch } from "@/lib/fulfillment/inventory";
import { publishTunvnCatalog } from "@/lib/tunvn/catalog";
import { listGamesProducts } from "@/lib/games/admin";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ email: "admin@fixture.test" })),
}));

const m0054 = fs.readFileSync("drizzle/migrations/0054_qris_gopay_provider.sql", "utf8");
const m0133 = fs.readFileSync("drizzle/migrations/0133_payment_invoice_history_upsert.sql", "utf8");
const schemaSql = fs.readFileSync("drizzle/schema.sql", "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("d1-fixture enforces Cloudflare D1 limits", () => {
  it("allows 100 bound parameters and rejects 101 with too many SQL variables", async () => {
    const fx = createD1Fixture();
    try {
      const q100 = Array.from({ length: 100 }, () => "?").join(",");
      const v100 = Array.from({ length: 100 }, (_, i) => i + 1);
      const ok = await fx.db.prepare(`SELECT 1 AS ok WHERE 1 IN (${q100})`).bind(...v100).first();
      expect(ok).toEqual({ ok: 1 });

      const q101 = Array.from({ length: 101 }, () => "?").join(",");
      const v101 = Array.from({ length: 101 }, (_, i) => i + 1);
      await expect(
        fx.db.prepare(`SELECT 1 AS ok WHERE 1 IN (${q101})`).bind(...v101).first(),
      ).rejects.toThrow(/too many SQL variables/);
    } finally {
      fx.close();
    }
  });

  it("enforces 50-byte UTF-8 LIKE and GLOB pattern limit (bound and literal) without false positives", async () => {
    const fx = createD1Fixture();
    try {
      await expect(fx.db.prepare("SELECT ? LIKE ? AS m").bind("hello", "a".repeat(50)).first()).resolves.toEqual({ m: 0 });
      await expect(fx.db.prepare("SELECT ? LIKE ? AS m").bind("hello", "é".repeat(25)).first()).resolves.toEqual({ m: 0 });
      await expect(fx.db.prepare("SELECT ? LIKE ? AS m").bind("hello", "a".repeat(51)).first()).rejects.toThrow(/LIKE or GLOB pattern too complex/);
      await expect(fx.db.prepare("SELECT ? LIKE ? AS m").bind("hello", "é".repeat(26)).first()).rejects.toThrow(/LIKE or GLOB pattern too complex/);
      await expect(fx.db.prepare("SELECT ? GLOB ? AS m").bind("hello", "a".repeat(51)).first()).rejects.toThrow(/LIKE or GLOB pattern too complex/);
      await expect(fx.db.prepare(`SELECT 'hello' LIKE '${"a".repeat(51)}' AS m`).first()).rejects.toThrow(/LIKE or GLOB pattern too complex/);

      // Non-pattern strings (>50 bytes) or literal '?' inside strings must not trigger false positives.
      await expect(fx.db.prepare("SELECT ? AS txt, 'what?' AS lit").bind("x".repeat(120)).first()).resolves.toEqual({
        txt: "x".repeat(120),
        lit: "what?",
      });
    } finally {
      fx.close();
    }
  });
});

describe("D1 >100 param queries chunked / json_each & error propagation (A1-3 / A4-2)", () => {
  it("zeroSkVariantsByIds zeroes 150 active SK variants cleanly and propagates DB failures to /api/supplier-sync (500)", async () => {
    const fx = createD1Fixture();
    try {
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(10,'SK Prod','sk-prod',10000,150,1)");
      const ids: string[] = [];
      for (let i = 1; i <= 150; i++) {
        const skId = `SKV-${i}`;
        ids.push(skId);
        fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,sk_variant_id) VALUES(?,10,?,?,10000,5,1,?)")
          .run(i, `SKU-SK-${i}`, `Var ${i}`, skId);
        fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_category,sk_price,sk_stock,is_active,axvara_product_id,axvara_variant_id) VALUES(?,'P10','SK Prod',?,'Aplikasi Premium',5000,5,1,10,?)")
          .run(skId, `Var ${i}`, i);
      }

      const db = createDatabaseAccess(fx.db);
      const changed = await zeroSkVariantsByIds(ids, db);
      expect(changed).toBe(150);
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM sk_products WHERE sk_stock=0").get() as { n: number }).n).toBe(150);
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE stock=0").get() as { n: number }).n).toBe(150);

      // Simulate DB error during removal SELECT: must throw and /api/supplier-sync must return 500 even if rows synced > 0.
      fx.control.fail = (q) => q.includes("FROM sk_products s") && q.includes("sk_variant_id IN");
      await expect(zeroSkVariantsByIds(["SKV-1"], db)).rejects.toThrow(/Injected database interruption/);

      vi.stubEnv("SUPPLIER_SYNC_TOKEN", "tok");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_PROXY_URL", "https://wr-proxy.axvara.test");
      vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "t");
      const { POST } = await import("@/app/api/supplier-sync/route");
      const res = await POST(new NextRequest("http://localhost/api/supplier-sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-supplier-sync-token": "tok" },
        body: JSON.stringify({
          supplier: "sk",
          rows: [{
            productId: "P10",
            productName: "SK Prod",
            category: "Aplikasi Premium",
            variant: { id: "SKV-1", name: "Var 1", price: 5000, stock: 7, order_process: "auto", min_order: 1, max_order: 10 },
          }],
          removed_variant_ids: ["SKV-2"],
        }),
      }));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: boolean; errors: string[] };
      expect(body.ok).toBe(false);
      expect(body.errors[0]).toMatch(/Injected database interruption/);
    } finally {
      fx.close();
    }
  });

  it("zeroVariantsByIds zeroes 150 active WR variants cleanly and propagates DB failures to /api/supplier-sync (500)", async () => {
    const fx = createD1Fixture();
    try {
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock,is_active,source,wr_product_id,wr_auto_managed) VALUES(11,'WR Prod','wr-prod',10000,150,1,'warung_rebahan','WRP-1',1)");
      fx.sql.exec("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('WRP-1','WR Prod',11)");
      const ids: string[] = [];
      for (let i = 1; i <= 150; i++) {
        const wrId = `WRV-${i}`;
        ids.push(wrId);
        fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,wr_variant_id,wr_auto_managed) VALUES(?,11,?,?,10000,3,1,?,1)")
          .run(i, `SKU-WR-${i}`, `Var ${i}`, wrId);
        fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,is_active,axvara_variant_id) VALUES(?,'WRP-1',?,5000,3,1,?)")
          .run(wrId, `Var ${i}`, i);
      }

      const db = createDatabaseAccess(fx.db);
      const changed = await zeroVariantsByIds(ids, db);
      expect(changed).toBe(150);
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM wr_variants WHERE wr_stock=0").get() as { n: number }).n).toBe(150);
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE stock=0").get() as { n: number }).n).toBe(150);
      expect((fx.sql.prepare("SELECT stock FROM products WHERE id=11").get() as { stock: number }).stock).toBe(0);

      fx.control.fail = (q) => q.includes("FROM wr_variants w") && q.includes("wr_variant_id IN");
      await expect(zeroVariantsByIds(["WRV-1"], db)).rejects.toThrow(/Injected database interruption/);

      vi.stubEnv("SUPPLIER_SYNC_TOKEN", "tok");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      const { POST } = await import("@/app/api/supplier-sync/route");
      const res = await POST(new NextRequest("http://localhost/api/supplier-sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-supplier-sync-token": "tok" },
        body: JSON.stringify({
          supplier: "wr",
          products: [{
            id: "WRP-1", name: "WR Prod", category: "Productivity", description: "desc",
            variants: [{ id: "WRV-1", name: "Var 1", price: 5000, duration: "30 Hari", type: "Private", warranty: "7 Hari", stock: 4, terms: null, delivery_terms: null }],
          }],
          removed_variant_ids: ["WRV-2"],
        }),
      }));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: boolean; errors: string[] };
      expect(body.ok).toBe(false);
      expect(body.errors[0]).toMatch(/Injected database interruption/);
    } finally {
      fx.close();
    }
  });

  it("applyPediaDiff handles 100 services + 100 removed (200 touched IDs) without hitting D1 100-param limit", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const services = Array.from({ length: 100 }, (_, i) => ({
        service_id: 1000 + i,
        name: `Svc ${1000 + i}`,
        type: "Default",
        category: "IG",
        rate: 10_000,
        min_qty: 100,
        max_qty: 10_000,
        api_refill: 0,
        api_cancel: 0,
        api_dripfeed: 0,
      }));
      const removed = Array.from({ length: 100 }, (_, i) => 2000 + i);
      for (const sid of removed) {
        fx.sql.prepare("INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',?,?,'IG','Default',10000,100,10000,1)")
          .run(sid, `Old ${sid}`);
      }
      fx.sql.exec("INSERT INTO pedia_products(id,slug,name,platform,metric,target_kind,packages_json,step) VALUES(1,'ig-followers','IG Followers','instagram','followers','url','[1000]',100)");
      fx.sql.exec("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,package_prices_json) VALUES(1,1,'std','indosmm',1000,'G2',20,1000,1,'{\"1000\":12000}')");
      fx.sql.exec("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,package_prices_json) VALUES(2,1,'old','indosmm',2000,'G2',20,1000,1,'{\"1000\":12000}')");

      const out = await applyPediaDiff(db, "indosmm", services, removed, "IDR");
      expect(out.upserted).toBe(100);
      expect(out.markedMissing).toBe(100);
      expect(out.tiersRepriced).toBe(1);
      expect(out.tiersAutoDisabled).toEqual([{ tierId: 2, reason: "service_missing" }]);
    } finally {
      fx.close();
    }
  });

  it("revokeInventoryBatch revokes 100 IDs cleanly without exceeding 100 SQL variables", async () => {
    const fx = createD1Fixture();
    try {
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Prod','prod',10000,100)");
      fx.sql.exec("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(10,1,'SKU-1','V1',10000,100,'unique')");
      const ids: number[] = [];
      for (let i = 1; i <= 100; i++) {
        const res = fx.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status) VALUES(1,10,'ct','iv',?,'available')")
          .run(`fp-${i}`);
        ids.push(Number(res.lastInsertRowid));
      }
      const revoked = await revokeInventoryBatch(1, 10, ids);
      expect(revoked).toBe(100);
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='revoked'").get() as { n: number }).n).toBe(100);
    } finally {
      fx.close();
    }
  });

  it("publishTunvnCatalog handles >100 family slugs via json_each(?)", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "test-key-not-real");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      const products = Array.from({ length: 110 }, (_, i) => ({
        id: 500 + i,
        name: `Fallback Product ${i}`,
        price_vnd: 100_000,
        price_usdt: 4.0,
        discount_threshold: 0,
        discount_price_vnd: 0,
        discount_threshold_usdt: 0,
        discount_price_usdt: 0,
        stock: 3,
        description: "desc",
      }));
      vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/buff/check")
        ? { success: true, gross_cost_vnd: 390, sell_price_vnd: 390, sell_price_usdt: 0.05, fundable: true, orders_breakdown: [{ invite_code: "AXVARA", quantity_b: 1, valid: true }] }
        : { success: true, products, usdt_vnd: 25_000 })));

      const result = await publishTunvnCatalog(createDatabaseAccess(fx.db), 18_000, { force: true });
      expect(result).toMatchObject({ ok: true, families: 110 });
    } finally {
      fx.close();
    }
  });
});

describe("A4-7 LIKE >50-byte search queries on admin endpoints & listGamesProducts", () => {
  it("supports >50-byte and multibyte search queries on admin orders, pedia services, SK/WR markup, and games", async () => {
    const fx = createD1Fixture();
    try {
      const longTail = "ChatGPT-Pro-Enterprise-Annual-Subscription-With-Extra-Long-Search-Token-12345";
      expect(Buffer.byteLength(longTail, "utf8")).toBeGreaterThan(70);

      // 1. /api/admin/orders
      await insertTestProduct(fx.sql);
      insertTestOrder(fx.sql, "AXV-20261118-LONG0001", { channel: "web" });
      fx.sql.prepare("UPDATE orders SET customer_name=? WHERE code='AXV-20261118-LONG0001'").run(longTail);
      const { GET: getOrders } = await import("@/app/api/admin/orders/route");
      const ordersRes = await getOrders(new NextRequest(`http://localhost/api/admin/orders?q=${encodeURIComponent(longTail)}`));
      expect(ordersRes.status).toBe(200);
      const ordersBody = (await ordersRes.json()) as { orders: Array<{ code: string }> };
      expect(ordersBody.orders.map((o) => o.code)).toContain("AXV-20261118-LONG0001");

      // 2. /api/admin/pedia/services
      fx.sql.prepare("INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',9001,?,'Social','Default',10000,10,1000,1)")
        .run(`Instagram Followers ${longTail}`);
      const { GET: getPediaServices } = await import("@/app/api/admin/pedia/services/route");
      const pediaRes = await getPediaServices(new NextRequest(`http://localhost/api/admin/pedia/services?q=${encodeURIComponent(longTail)}&platform=${encodeURIComponent("é".repeat(26))}`));
      expect(pediaRes.status).toBe(200);
      const pediaBody = (await pediaRes.json()) as { rows: unknown[] };
      expect(Array.isArray(pediaBody.rows)).toBe(true);

      const pediaResMatch = await getPediaServices(new NextRequest(`http://localhost/api/admin/pedia/services?q=${encodeURIComponent(longTail)}`));
      expect(pediaResMatch.status).toBe(200);
      const pediaMatchBody = (await pediaResMatch.json()) as { rows: Array<{ service_id: number }> };
      expect(pediaMatchBody.rows.map((r) => r.service_id)).toContain(9001);

      // 3. /api/admin/sekalipay/markup
      const q60 = longTail.slice(0, 60);
      fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_category,sk_price,sk_stock,is_active) VALUES('SK-LONG','P-LONG',?,?,'Aplikasi Premium',10000,5,1)")
        .run("SK Parent", q60);
      const { GET: getSkMarkup } = await import("@/app/api/admin/sekalipay/markup/route");
      const skRes = await getSkMarkup(new NextRequest(`http://localhost/api/admin/sekalipay/markup?q=${encodeURIComponent(q60)}`));
      expect(skRes.status).toBe(200);
      const skBody = (await skRes.json()) as { variants: Array<{ sk_variant_id: string }> };
      expect(skBody.variants.map((v) => v.sk_variant_id)).toContain("SK-LONG");

      // 4. /api/admin/warung/markup
      fx.sql.exec("INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('WRP-LONG','WR Parent')");
      fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,is_active) VALUES('WRV-LONG','WRP-LONG',?,10000,5,1)")
        .run(q60);
      const { GET: getWrMarkup } = await import("@/app/api/admin/warung/markup/route");
      const wrRes = await getWrMarkup(new NextRequest(`http://localhost/api/admin/warung/markup?q=${encodeURIComponent(q60)}`));
      expect(wrRes.status).toBe(200);
      const wrBody = (await wrRes.json()) as { variants: Array<{ wr_variant_id: string }> };
      expect(wrBody.variants.map((v) => v.wr_variant_id)).toContain("WRV-LONG");

      // 5. listGamesProducts
      fx.sql.prepare("INSERT INTO games_products(supplier,buyer_sku_code,product_name,game_slug,game_brand,product_type_name,cost,sell_price,enabled) VALUES('sekalipay','ML-LONG',?,'mobile-legends','Mobile Legends','Diamond',10000,11000,1)")
        .run(`ML ${longTail}`);
      const gamesPage = await listGamesProducts(createDatabaseAccess(fx.db), { q: longTail });
      expect(gamesPage.items.map((g) => g.buyer_sku_code)).toContain("ML-LONG");
    } finally {
      fx.close();
    }
  });
});

describe("A1-1 payment_invoice_history_* trigger safe under outer UPSERT (0133)", () => {
  it("schema.sql and 0133 do not use INSERT OR IGNORE in payment_invoice_history triggers", () => {
    expect(schemaSql).not.toMatch(/INSERT OR IGNORE INTO payment_invoice_history/);
    expect(m0133).not.toMatch(/INSERT OR IGNORE INTO payment_invoice_history/);
    expect(m0133).toMatch(/ON CONFLICT\(provider, order_code, payable_amount\) DO NOTHING/);
  });

  it("reproduces failure on 0054 trigger, then passes UPSERT for dana and gopay after idempotent 0133", () => {
    const fx = createD1Fixture();
    try {
      // Revert triggers to pre-0133 (0054) to reproduce the latent bug.
      const m0054Triggers = m0054.split("-- 3.")[0].replace(/CREATE UNIQUE INDEX[\s\S]*?;\s*/, "");
      fx.sql.exec(m0054Triggers);

      fx.sql.exec("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('ORD-PRE','B','628','[]',10000,'qris','pending','pending')");
      fx.sql.exec("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,expires_at) VALUES('ORD-PRE','dana','live','P1','M1',10000,10223,223,'pending',datetime('now','+1 hour'))");
      expect(() => fx.sql.exec(
        "INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,expires_at) VALUES('ORD-PRE','dana','live','P2','M1',10000,10225,225,'pending',datetime('now','+1 hour')) ON CONFLICT(order_code) DO UPDATE SET payable_amount=excluded.payable_amount",
      )).toThrow(/UNIQUE constraint failed: payment_invoice_history/);

      // Apply migration 0133 twice (idempotency check).
      fx.sql.exec(m0133);
      fx.sql.exec(m0133);

      for (const provider of ["dana", "gopay"] as const) {
        const code = `ORD-${provider.toUpperCase()}`;
        fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES(?,'B','628','[]',10000,'qris','pending','pending')").run(code);
        fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,expires_at) VALUES(?,?,'live',?,'M1',10000,10123,123,'pending',datetime('now','+1 hour'))").run(code, provider, `P1-${provider}`);
        // UPSERT to a NEW amount:
        fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,expires_at) VALUES(?,?,'live',?,'M1',10000,10125,125,'pending',datetime('now','+1 hour')) ON CONFLICT(order_code) DO UPDATE SET payable_amount=excluded.payable_amount, unique_code=excluded.unique_code").run(code, provider, `P2-${provider}`);
        // UPSERT back to the SAME existing amount (10123):
        fx.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,expires_at) VALUES(?,?,'live',?,'M1',10000,10123,123,'pending',datetime('now','+1 hour')) ON CONFLICT(order_code) DO UPDATE SET payable_amount=excluded.payable_amount, unique_code=excluded.unique_code").run(code, provider, `P3-${provider}`);

        const amounts = (fx.sql.prepare("SELECT payable_amount FROM payment_invoice_history WHERE provider=? AND order_code=? ORDER BY payable_amount").all(provider, code) as Array<{ payable_amount: number }>)
          .map((r) => r.payable_amount);
        expect(amounts).toEqual([10123, 10125]);
      }
    } finally {
      fx.close();
    }
  });
});
