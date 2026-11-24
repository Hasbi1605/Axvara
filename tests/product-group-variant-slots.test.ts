import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import {
  decideDirtyGroups,
  listProductGroups,
  notLoserSlotVariantSql,
  removeGroupMember,
  replaceGroupSlots,
} from "@/lib/product-groups";
import { decideSlotFromStats, suggestVariantSlots, type SlotVariantStats, type SuggestableGroupVariant } from "@/lib/product-group-slots";
import { getProductDetail } from "@/lib/catalog";
import { getCatalogRevision } from "@/lib/catalog-cache";
import { computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";
import { readTelegramCatalog } from "@/lib/telegram/catalog-snapshot";
import { loadPromoProducts } from "@/lib/telegram/promo-digest";

const auth = vi.hoisted(() => ({ admin: true as boolean }));
vi.mock("@/lib/auth", async (original) => {
  const actual = await original<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
  };
});

const migration0164 = fs.readFileSync("drizzle/migrations/0164_product_group_variant_slots.sql", "utf8");

const slotMember = (over: Partial<SlotVariantStats>): SlotVariantStats => ({
  variantId: 1,
  productId: 10,
  supplier: "StoreBat",
  label: "Plus 1 Bulan",
  price: 100000,
  stock: 5,
  minQty: 1,
  modal: 70000,
  position: 0,
  isActive: true,
  parentActive: true,
  parentArchived: false,
  newSaleAllowed: true,
  ...over,
});

const suggestable = (over: Partial<SuggestableGroupVariant>): SuggestableGroupVariant => ({
  variant_id: 1,
  product_id: 10,
  supplier: "StoreBat",
  label: "Plus 1 Bulan",
  is_active: true,
  parent_active: true,
  parent_archived: false,
  duration_value: 1,
  duration_unit: "month",
  duration_label: null,
  warranty_type: "none",
  warranty_value: null,
  warranty_unit: null,
  ...over,
});

describe("decideSlotFromStats — pure variant slot rules", () => {
  const group = { preferProductId: null, preferMargin: 2000 };

  it("Manual live beats cheaper supplier; out-of-stock loses to stocked supplier", () => {
    const manualWins = decideSlotFromStats(group, [
      slotMember({ variantId: 1, productId: 1, supplier: "Manual", label: "Manual 1B", stock: 2, modal: 95000 }),
      slotMember({ variantId: 2, productId: 2, supplier: "StoreBat", label: "SB 1B", stock: 99, modal: 50000 }),
    ]);
    expect(manualWins.winnerVariantId).toBe(1);
    expect(manualWins.reason).toContain("Manual live");

    const stockedWins = decideSlotFromStats(group, [
      slotMember({ variantId: 1, productId: 1, supplier: "Manual", stock: 0, modal: 1000 }),
      slotMember({ variantId: 2, productId: 2, supplier: "StoreBat", stock: 0, modal: 50000 }),
      slotMember({ variantId: 3, productId: 3, supplier: "AIVault", stock: 8, modal: 75000 }),
    ]);
    expect(stockedWins.winnerVariantId).toBe(3);
  });

  it("picks lowest modal/30d and respects group prefer/margin; falls back to price when modal unreadable", () => {
    const members = [
      slotMember({ variantId: 10, productId: 100, supplier: "StoreBat", modal: 70000, price: 105000 }),
      slotMember({ variantId: 20, productId: 200, supplier: "AIVault", modal: 68500, price: 102000 }),
    ];
    expect(decideSlotFromStats({ preferProductId: null, preferMargin: 2000 }, members).winnerVariantId).toBe(20);
    expect(decideSlotFromStats({ preferProductId: 100, preferMargin: 2000 }, members).winnerVariantId).toBe(10);
    expect(decideSlotFromStats({ preferProductId: 100, preferMargin: 500 }, members).winnerVariantId).toBe(20);

    const noModal = decideSlotFromStats(group, [
      slotMember({ variantId: 10, supplier: "StoreBat", modal: null, price: 120000 }),
      slotMember({ variantId: 20, supplier: "AIVault", modal: null, price: 99000 }),
    ]);
    expect(noModal.winnerVariantId).toBe(20);
    expect(noModal.reason).toContain("harga AIVault");
  });

  it("all out of stock keeps 1 representative; all inactive returns null", () => {
    const sold = decideSlotFromStats({ preferProductId: 200, preferMargin: 0 }, [
      slotMember({ variantId: 10, productId: 100, supplier: "StoreBat", stock: 0 }),
      slotMember({ variantId: 20, productId: 200, supplier: "AIVault", stock: 0 }),
    ]);
    expect(sold.winnerVariantId).toBe(20);
    expect(sold.reason).toContain("semua habis");

    expect(decideSlotFromStats(group, [
      slotMember({ variantId: 10, isActive: false }),
      slotMember({ variantId: 20, parentArchived: true }),
    ])).toEqual({ winnerVariantId: null, reason: "semua varian nonaktif" });
  });
});

describe("suggestVariantSlots — deterministic cross-supplier matching", () => {
  it("groups ChatGPT Plus standard variants across suppliers while keeping Full Garansi separate", () => {
    const suggested = suggestVariantSlots([
      suggestable({ variant_id: 39401, product_id: 394, supplier: "StoreBat", label: "Plus 1 Bulan (Apple Pay)", warranty_type: "limited", warranty_value: 1, warranty_unit: "day" }),
      suggestable({ variant_id: 39402, product_id: 394, supplier: "StoreBat", label: "Plus 1 Bulan (UPI)", warranty_type: "limited", warranty_value: 1, warranty_unit: "day" }),
      suggestable({ variant_id: 17401, product_id: 174, supplier: "AIVault", label: "Plus 1 Bulan (No Warranty)", warranty_type: "none" }),
      suggestable({ variant_id: 17402, product_id: 174, supplier: "AIVault", label: "Plus 1 Bulan (Full Garansi)", warranty_type: "full", warranty_value: 30, warranty_unit: "day" }),
      suggestable({ variant_id: 11701, product_id: 117, supplier: "TUNVN", label: "Plus 1 Bulan", warranty_type: "none" }),
    ]);
    expect(suggested).toHaveLength(1);
    expect(suggested[0].name).toBe("Plus 1 Bulan");
    expect(suggested[0].variant_ids).toEqual([39401, 39402, 17401, 11701]);
  });

  it("never mixes Sharing vs Private or 1 Bulan vs 12 Bulan", () => {
    const suggested = suggestVariantSlots([
      suggestable({ variant_id: 1, product_id: 10, supplier: "WR", label: "Sharing 1 Bulan", duration_value: 1, duration_unit: "month" }),
      suggestable({ variant_id: 2, product_id: 20, supplier: "SK", label: "Private 1 Bulan", duration_value: 1, duration_unit: "month" }),
      suggestable({ variant_id: 3, product_id: 30, supplier: "StoreBat", label: "Sharing 12 Bulan", duration_value: 12, duration_unit: "month" }),
      suggestable({ variant_id: 4, product_id: 40, supplier: "AIVault", label: "Private 1 Bulan", duration_value: 1, duration_unit: "month" }),
    ]);
    expect(suggested).toEqual([{ name: "Private 1 Bulan", variant_ids: [2, 4] }]);
  });
});

describe("product_group_slots — DB, API, failover, storefront, Telegram, live status, workerd", () => {
  let fx: ReturnType<typeof createD1Fixture>;

  function seed() {
    fx.sql.exec(`
      INSERT OR IGNORE INTO categories(id, name, slug, sort_order) VALUES (1, 'AI & Chatbot', 'ai-chatbot', 1);
      INSERT INTO products(id, category_id, name, slug, price, stock, is_active, telegram_enabled, storebat_family, aivault_family, image_url, sort_order) VALUES
        (394, 1, 'ChatGPT Plus', 'chatgpt-plus-sb', 103400, 32, 1, 1, 'chatgpt_plus', NULL, '/r2/products/chatgpt.webp', 1),
        (174, 1, 'ChatGPT Plus', 'chatgpt-plus-av', 108000, 25, 1, 1, NULL, 'chatgpt_plus', '/r2/products/chatgpt.webp', 1),
        (500, 1, 'Canva Pro', 'canva-pro', 25000, 10, 1, 1, NULL, NULL, '/r2/products/canva.webp', 2);

      INSERT INTO aivault_products(service_id, name, stock, unit_price_usd, pricing_tiers_json, markup_percent, fx_idr_per_usd, axvara_product_id, synced_at) VALUES
        ('svc_gpt_1m', 'ChatGPT Plus 1M', 10, 4.4, '[]', 20, 16500, 174, datetime('now')),
        ('svc_gpt_1m_fw', 'ChatGPT Plus 1M FW', 15, 5.2, '[]', 20, 16500, 174, datetime('now'));

      INSERT INTO product_variants(id, product_id, sku, label, price, stock, min_qty, is_active, sort_order, duration_value, duration_unit, warranty_type, storebat_product_id, storebat_cost_usd, storebat_fx_idr_per_usd, aivault_service_id, fulfillment_mode) VALUES
        (39401, 394, 'SB-60', 'Plus 1 Bulan (Garansi 24 Jam)', 103400, 32, 1, 1, 0, 1, 'month', 'limited', 60, 4.2, 16500, NULL, 'manual'),
        (17401, 174, 'AV-1M', 'Plus 1 Bulan (Standar)', 108000, 10, 1, 1, 0, 1, 'month', 'none', NULL, NULL, NULL, 'svc_gpt_1m', 'manual'),
        (17402, 174, 'AV-FW', 'Plus 1 Bulan (Full Garansi)', 128000, 15, 1, 1, 1, 1, 'month', 'full', NULL, NULL, NULL, 'svc_gpt_1m_fw', 'manual'),
        (50001, 500, 'CANVA-1', 'Canva 1 Bulan', 25000, 10, 1, 1, 0, 1, 'month', 'none', NULL, NULL, NULL, NULL, 'manual');

      INSERT INTO product_groups(id, name, mode, winner_product_id, reason) VALUES
        (37, 'ChatGPT Plus', 'merge_variants', 394, 'modal/30 hari StoreBat Rp69.300 < AIVault Rp72.600');
      INSERT INTO product_group_members(group_id, product_id, position) VALUES (37, 394, 0), (37, 174, 1);
    `);
  }

  beforeEach(() => {
    auth.admin = true;
    clearRateLimitBucketsForTest();
    fx = createD1Fixture();
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external fetch"); }));
  });

  afterEach(() => {
    fx.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hides slot loser on web, Telegram, promo, and admin live status; auto-fails over on stockout and switches back on restock", async () => {
    seed();
    const db = createDatabaseAccess(fx.db);

    // Assign SB-60 & AV-1M into slot "Plus 1 Bulan" via admin PUT /slots API; AV-FW remains standalone!
    const { PUT } = await import("@/app/api/admin/product-groups/[id]/slots/route");
    const putRes = await PUT(
      new NextRequest("http://localhost/api/admin/product-groups/37/slots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: [{ name: "Plus 1 Bulan", variant_ids: [39401, 17401] }] }),
      }),
      { params: Promise.resolve({ id: "37" }) },
    );
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json() as { group: { slots: { name: string; winner_variant_id: number }[] } };
    expect(putJson.group.slots[0]).toMatchObject({ name: "Plus 1 Bulan", winner_variant_id: 39401 });

    // Storefront /api/catalog & /api/products: ONLY 2 variants visible (39401 winner + 17402 Full Garansi); 17401 hidden!
    const detail1 = await getProductDetail("chatgpt-plus-sb");
    expect(detail1?.variants.map((v) => v.id)).toEqual([39401, 17402]);

    const { GET: getProducts } = await import("@/app/api/products/route");
    const prods1 = await (await getProducts(new NextRequest("https://axvara.tech/api/products?active=1&slug=chatgpt-plus-sb"))).json() as { products: Record<string, unknown>[] };
    expect(prods1.products[0]).toMatchObject({ variantCount: 2, price: 103400, maxPrice: 128000, stock: 47 });

    // Telegram & promo digest agree
    const tg1 = await readTelegramCatalog();
    expect(tg1.find((p) => p.id === 394)).toMatchObject({ price: 103400, stock: 47 });
    const promo1 = await loadPromoProducts(db);
    expect(promo1.find((p) => p.id === 394)?.price).toBe(103400);

    // Admin live status: 17401 is hidden_loser (Kalah slot), while 17402 is live (Gabung di)!
    const losers1 = await loadProductGroupLosers(db.queryAll);
    expect(computeVariantLiveStatus({
      supplier_active: 1, axvara_product_id: 174, variant_id: 17401, variant_active: 1,
      product_active: 1, product_archived: 0, stock: 10, min_qty: 1,
    }, losers1)).toEqual({
      status: "hidden_loser",
      reason: 'Kalah slot "Plus 1 Bulan" vs Plus 1 Bulan (Garansi 24 Jam)',
    });
    expect(computeVariantLiveStatus({
      supplier_active: 1, axvara_product_id: 174, variant_id: 17402, variant_active: 1,
      product_active: 1, product_archived: 0, stock: 15, min_qty: 1,
    }, losers1)).toEqual({
      status: "live",
      reason: "Gabung di ChatGPT Plus #394",
    });

    // --- AUTOMATIC FAILOVER: SB-60 sells out (stock = 0) ---
    const revBeforeFailover = await getCatalogRevision("market", db);
    fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=39401");
    const decidedFailover = await decideDirtyGroups(db);
    expect(decidedFailover.changed).toBeGreaterThanOrEqual(1);
    expect(await getCatalogRevision("market", db)).not.toBe(revBeforeFailover);

    // Now product winner flips to #174 (because #394 has 0 stock), AND slot winner flips to 17401!
    const [groupAfterFailover] = await listProductGroups(db, 37);
    expect(groupAfterFailover.winner_product_id).toBe(174);
    expect(groupAfterFailover.slots?.[0]?.winner_variant_id).toBe(17401);

    const detail2 = await getProductDetail("chatgpt-plus-av");
    expect(detail2?.variants.map((v) => v.id)).toEqual([17401, 17402]);

    // --- AUTOMATIC RECOVERY: SB-60 restocks (stock = 20) & is cheaper modal -> steps forward again! ---
    const revBeforeRestock = await getCatalogRevision("market", db);
    fx.sql.exec("UPDATE product_variants SET stock=20 WHERE id=39401");
    const decidedRestock = await decideDirtyGroups(db);
    expect(decidedRestock.changed).toBeGreaterThanOrEqual(1);
    expect(await getCatalogRevision("market", db)).not.toBe(revBeforeRestock);

    const [groupAfterRestock] = await listProductGroups(db, 37);
    expect(groupAfterRestock.winner_product_id).toBe(394);
    expect(groupAfterRestock.slots?.[0]?.winner_variant_id).toBe(39401);

    const detail3 = await getProductDetail("chatgpt-plus-sb");
    expect(detail3?.variants.map((v) => v.id)).toEqual([39401, 17402]);

    // --- AUTOMATIC PRICE SWITCH: AIVault drops modal below StoreBat while both have stock ---
    fx.sql.exec("UPDATE aivault_products SET unit_price_usd=3.5 WHERE service_id='svc_gpt_1m'");
    await decideDirtyGroups(db);
    const [groupAfterPriceDrop] = await listProductGroups(db, 37);
    expect(groupAfterPriceDrop.slots?.[0]?.winner_variant_id).toBe(17401);
  });

  it("validates PUT /slots inputs, enforces auth, and cleans up slots when a member is removed", async () => {
    seed();
    const { PUT } = await import("@/app/api/admin/product-groups/[id]/slots/route");
    const send = (body: unknown) => PUT(
      new NextRequest("http://localhost/api/admin/product-groups/37/slots", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "37" }) },
    );

    // Cross-group variant 50001 (Canva) rejected 400
    expect((await send({ slots: [{ name: "Bad", variant_ids: [39401, 50001] }] })).status).toBe(400);
    // Single-variant slot rejected 400
    expect((await send({ slots: [{ name: "Single", variant_ids: [39401] }] })).status).toBe(400);
    // Duplicate variant across 2 slots rejected 400
    expect((await send({
      slots: [
        { name: "Slot A", variant_ids: [39401, 17401] },
        { name: "Slot B", variant_ids: [39401, 17402] },
      ],
    })).status).toBe(400);
    // Duplicate slot names rejected 400
    expect((await send({
      slots: [
        { name: "Plus 1B", variant_ids: [39401, 17401] },
        { name: "plus 1b", variant_ids: [17402, 50001] },
      ],
    })).status).toBe(400);
    // Unauth rejected 401
    auth.admin = false;
    expect((await send({ slots: [] })).status).toBe(401);
    auth.admin = true;

    // Add 3rd member (#500) so removing #174 keeps the group alive, and verify slot < 2 auto-cleans!
    fx.sql.exec("INSERT INTO product_group_members(group_id, product_id, position) VALUES (37, 500, 2)");
    const db = createDatabaseAccess(fx.db);
    await replaceGroupSlots(37, [{ name: "Plus 1 Bulan", variant_ids: [39401, 17401] }], db);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM product_group_slots WHERE group_id=37").get()?.n).toBe(1);
    await removeGroupMember(37, 174, db);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM product_group_slots WHERE group_id=37").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM product_group_slot_members").get()?.n).toBe(0);
  });

  it("migration 0164 and notLoserSlotVariantSql run cleanly on real Miniflare workerd D1", async () => {
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2026-08-06",
      d1Databases: ["DB"],
      script: 'export default { fetch() { return new Response("ok"); } }',
    });
    try {
      const db = await runtime.getD1Database("DB");
      await db.batch([
        db.prepare(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, archived_at TEXT)`),
        db.prepare(`CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, label TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT -1, is_active INTEGER NOT NULL DEFAULT 1)`),
        db.prepare(`CREATE TABLE product_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'winner', winner_product_id INTEGER)`),
        db.prepare(`CREATE TABLE product_group_members (group_id INTEGER NOT NULL, product_id INTEGER NOT NULL UNIQUE, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, product_id))`),
      ]);
      const stmts = migration0164.replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
      await db.batch(stmts.map((sql) => db.prepare(sql)));

      await db.batch([
        db.prepare("INSERT INTO products(id,name,slug) VALUES(394,'ChatGPT Plus','chatgpt-plus-sb'),(174,'ChatGPT Plus','chatgpt-plus-av')"),
        db.prepare("INSERT INTO product_variants(id,product_id,label,price,stock) VALUES(39401,394,'Plus 24h',103400,32),(17401,174,'Plus Std',108000,10),(17402,174,'Plus Full Garansi',128000,15)"),
        db.prepare("INSERT INTO product_groups(id,name,mode,winner_product_id) VALUES(37,'ChatGPT Plus','merge_variants',394)"),
        db.prepare("INSERT INTO product_group_members(group_id,product_id,position) VALUES(37,394,0),(37,174,1)"),
        db.prepare("INSERT INTO product_group_slots(id,group_id,name,winner_variant_id) VALUES(1,37,'Plus 1 Bulan',39401)"),
        db.prepare("INSERT INTO product_group_slot_members(slot_id,variant_id,position) VALUES(1,39401,0),(1,17401,1)"),
      ]);

      const visible = (await db.prepare(
        `SELECT pv.id FROM product_variants pv WHERE ${notLoserSlotVariantSql("pv")} ORDER BY pv.id ASC`,
      ).all()).results;
      expect(visible).toEqual([{ id: 17402 }, { id: 39401 }]);
    } finally {
      await runtime.dispose();
    }
  }, 30_000);
});
