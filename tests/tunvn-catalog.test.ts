import fs from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  TUNVN_BUFF_COST_USDT_PER_B, TUNVN_BUFF_MARKUP_PERCENT, TUNVN_CHATGPT_MARKUP_PERCENT,
  tunvnBuffSellPriceIdr, tunvnChatGptSellPriceIdr,
} from "@/lib/tunvn/pricing";
import { publishTunvnCatalog, TUNVN_CHATGPT_IMAGE_URL } from "@/lib/tunvn/catalog";
import { createD1Fixture } from "./helpers/d1-fixture";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const RATE = 18_086;

const upstreamProduct = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: id === 86 ? "ACC CHAT GPT BUSINESS 1M(W1D)" : "CHAT GPT GPAY (W1D)",
  price_vnd: id === 86 ? 119_000 : 129_000, price_usdt: id === 86 ? 4.6 : 4.96,
  discount_threshold: 0, discount_price_vnd: 0, discount_threshold_usdt: 0,
  discount_price_usdt: 0, stock: id === 86 ? 22 : 6, description: "d", ...over,
});

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "test-key-not-real");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
  fx.sql.exec("INSERT INTO products(name,slug,price,stock,source) VALUES('Muse AI 1 Miliar Token','muse-ai-1-miliar-token',16000,0,'manual')");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    success: true, products: [upstreamProduct(86), upstreamProduct(83)], usdt_vnd: 25_496,
  }), { status: 200 })));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const db = () => createDatabaseAccess(fx.db);

describe("TUNVN pricing (markup owner 35%/40%, kurs Rp18.086)", () => {
  it("computes ChatGPT prices rounded up to Rp100", () => {
    expect(TUNVN_CHATGPT_MARKUP_PERCENT).toBe(35);
    expect(tunvnChatGptSellPriceIdr(4.6, RATE)).toBe(112_400);
    expect(tunvnChatGptSellPriceIdr(4.96, RATE)).toBe(121_200);
  });

  it("computes Buff prices per variant at 40%", () => {
    expect(TUNVN_BUFF_MARKUP_PERCENT).toBe(40);
    expect(tunvnBuffSellPriceIdr(5, RATE)).toBe(7_500);
    expect(tunvnBuffSellPriceIdr(10, RATE)).toBe(14_900);
    expect(tunvnBuffSellPriceIdr(20, RATE)).toBe(29_800);
    expect(tunvnBuffSellPriceIdr(30, RATE)).toBe(44_700);
    expect(TUNVN_BUFF_COST_USDT_PER_B * 20).toBeCloseTo(1.176);
    expect(() => tunvnBuffSellPriceIdr(31, RATE)).toThrow();
  });
});

describe("0112 tunvn catalog publish migration", () => {
  const migration = fs.readFileSync("drizzle/migrations/0112_tunvn_catalog_publish.sql", "utf8");
  it("adds TUNVN columns and seeds the approved catalog idempotently", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(fs.readFileSync("drizzle/schema.sql", "utf8"));
    } finally { sqlite.close(); }
    expect(migration).toContain("chatgpt-business-1-bulan-tunvn");
    expect(migration).toContain("TUNVN-BUFF-30B");
    expect(migration).toContain(TUNVN_CHATGPT_IMAGE_URL);
  });
});

describe("publishTunvnCatalog", () => {
  it("publishes both ChatGPT products with the existing ChatGPT image and Buff variants on Muse", async () => {
    const result = await publishTunvnCatalog(db(), RATE);
    expect(result).toMatchObject({ ok: true, chatgpt: 2, buff_variants: 4, idr_per_usdt: RATE });

    const business = fx.sql.prepare("SELECT * FROM products WHERE slug='chatgpt-business-1-bulan-tunvn'").get() as Record<string, unknown>;
    const gpay = fx.sql.prepare("SELECT * FROM products WHERE slug='chatgpt-gpay-1-bulan-tunvn'").get() as Record<string, unknown>;
    expect(business).toMatchObject({ price: 112_400, stock: 22, is_active: 1, image_url: TUNVN_CHATGPT_IMAGE_URL });
    expect(gpay).toMatchObject({ price: 121_200, stock: 6, is_active: 1, image_url: TUNVN_CHATGPT_IMAGE_URL });
    expect(fx.sql.prepare("SELECT price,stock FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({ price: 112_400, stock: 22 });
    expect(fx.sql.prepare("SELECT visible,sell_price_idr FROM tunvn_products WHERE supplier_product_id=86").get())
      .toEqual({ visible: 1, sell_price_idr: 112_400 });

    const buff = fx.sql.prepare("SELECT sku,price,tunvn_buff_quantity_b FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%' ORDER BY tunvn_buff_quantity_b").all();
    expect(buff).toEqual([
      { sku: "TUNVN-BUFF-5B", price: 7_500, tunvn_buff_quantity_b: 5 },
      { sku: "TUNVN-BUFF-10B", price: 14_900, tunvn_buff_quantity_b: 10 },
      { sku: "TUNVN-BUFF-20B", price: 29_800, tunvn_buff_quantity_b: 20 },
      { sku: "TUNVN-BUFF-30B", price: 44_700, tunvn_buff_quantity_b: 30 },
    ]);
    // Produk Muse manual lain dari fixture schema tidak berubah harganya.
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%' AND product_id=(SELECT id FROM products WHERE slug='muse-ai-1-miliar-token')").get()).toEqual({ c: 4 });
  });

  it("is idempotent on re-publish and refreshes price from a new FX", async () => {
    await publishTunvnCatalog(db(), RATE);
    const again = await publishTunvnCatalog(db(), 20_000);
    expect(again).toMatchObject({ ok: true, chatgpt: 2 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM products WHERE slug LIKE 'chatgpt-%-tunvn'").get()).toEqual({ c: 2 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%'").get()).toEqual({ c: 4 });
    expect(fx.sql.prepare("SELECT price FROM products WHERE slug='chatgpt-business-1-bulan-tunvn'").get())
      .toEqual({ price: tunvnChatGptSellPriceIdr(4.6, 20_000) });
  });

  it("does nothing when the sync gate is off", async () => {
    vi.stubEnv("TUNVN_SYNC_ENABLED", "false");
    expect(await publishTunvnCatalog(db(), RATE)).toEqual({ skipped: "not_configured" });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM products WHERE slug LIKE 'chatgpt-%-tunvn'").get()).toEqual({ c: 0 });
  });
});
