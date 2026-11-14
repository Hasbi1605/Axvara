import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  DEFAULT_GAMES_PRICING,
  gamesEffectiveMarkup,
  gamesRowMarkupPrice,
  parseGamesMarkupPercent,
  parseGamesRounding,
  readGamesPricingSettings,
  readVariantMarkupMap,
  recomputeGamesSkPrices,
  writeGamesPricingSettings,
  writeVariantMarkup,
} from "@/lib/games/markup";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); });

const db = () => createDatabaseAccess(fx.db);
const contract = JSON.stringify({
  version: 1,
  fields: [{ key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 }],
  requires_zone_id: false,
  validation_available: false,
  open_denom: false,
  supported: true,
  reason: null,
});

function seedSku(sku: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    buyer_sku_code: sku, product_name: "5 Diamond", game_slug: "mobile-legends", cost: 11750,
    sell_price: 1, enabled: 1, supplier: "sekalipay", supplier_active: 1, stock: 100, min_order: 1,
    required_fields_json: contract, ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

const price = (sku: string) => Number((fx.sql.prepare("SELECT sell_price FROM games_products WHERE buyer_sku_code=?").get(sku) as { sell_price: number }).sell_price);

describe("games pricing settings", () => {
  it("defaults to 5 %/Rp100 and ignores corrupt stored values", async () => {
    expect(await readGamesPricingSettings(db())).toEqual(DEFAULT_GAMES_PRICING);
    fx.sql.exec("INSERT OR REPLACE INTO store_settings(key,value) VALUES('games_markup_percent','bogus'),('games_price_rounding','77')");
    expect(await readGamesPricingSettings(db())).toEqual({ markup_percent: 5, rounding: 100 });
  });

  it("validates and round-trips settings", async () => {
    expect(parseGamesMarkupPercent("8.25")).toBe(8.25);
    expect(parseGamesRounding("500")).toBe(500);
    for (const bad of ["", "x", -1, 101, 4.505]) expect(() => parseGamesMarkupPercent(bad)).toThrow(RangeError);
    for (const bad of [0, 50, 250, "abc"]) expect(() => parseGamesRounding(bad)).toThrow(RangeError);

    await writeGamesPricingSettings(db(), { markup_percent: 8.25, rounding: 1000 });
    expect(await readGamesPricingSettings(db())).toEqual({ markup_percent: 8.25, rounding: 1000 });
    // Upsert, bukan duplikat.
    await writeGamesPricingSettings(db(), { markup_percent: 3, rounding: 1 });
    expect(await readGamesPricingSettings(db())).toEqual({ markup_percent: 3, rounding: 1 });
    expect((fx.sql.prepare("SELECT COUNT(*) n FROM store_settings WHERE key LIKE 'games_%'").get() as { n: number }).n).toBe(2);
  });
});

describe("effective markup resolution", () => {
  it("prefers variant, then game, then global", () => {
    expect(gamesEffectiveMarkup({ markup_percent: 12, markup_fixed: 500 }, 7, DEFAULT_GAMES_PRICING))
      .toEqual({ percent: 12, fixed: 500, source: "variant" });
    expect(gamesEffectiveMarkup({}, 7, DEFAULT_GAMES_PRICING))
      .toEqual({ percent: 7, fixed: 0, source: "game" });
    expect(gamesEffectiveMarkup({}, null, DEFAULT_GAMES_PRICING))
      .toEqual({ percent: 5, fixed: 0, source: "global" });
    // Fixed varian tanpa persen tetap berlaku di atas markup game.
    expect(gamesEffectiveMarkup({ markup_fixed: 1000 }, 7, DEFAULT_GAMES_PRICING))
      .toEqual({ percent: 7, fixed: 1000, source: "game" });
  });

  it("gamesRowMarkupPrice mirrors computeGamesMarkupPrice and returns 0 for cost 0", () => {
    expect(gamesRowMarkupPrice({ cost: 11750 }, null, DEFAULT_GAMES_PRICING)).toBe(12400);
    expect(gamesRowMarkupPrice({ cost: 11750, markup_percent: 0 }, null, DEFAULT_GAMES_PRICING)).toBe(11800);
    expect(gamesRowMarkupPrice({ cost: 0 }, null, DEFAULT_GAMES_PRICING)).toBe(0);
  });

  it("stores variant markup in its own table and deletes it on reset", async () => {
    await writeVariantMarkup(db(), ["sk:1", "sk:2"], { percent: 12, fixed: 250 });
    const map = await readVariantMarkupMap(db());
    expect(map.get("sk:1")).toEqual({ percent: 12, fixed: 250 });
    expect(map.get("sk:2")).toEqual({ percent: 12, fixed: 250 });
    await writeVariantMarkup(db(), ["sk:1"], { percent: null, fixed: null });
    const after = await readVariantMarkupMap(db());
    expect(after.has("sk:1")).toBe(false);
    expect(after.get("sk:2")).toEqual({ percent: 12, fixed: 250 });
  });
});

describe("recomputeGamesSkPrices", () => {
  it("recomputes all, one game, or a list of SKUs in ≤3 statements", async () => {
    seedSku("sk:1");
    seedSku("sk:2", { game_slug: "free-fire", cost: 321115, supplier_active: 0 });
    seedSku("sk:3", { game_slug: "free-fire", cost: 10000 });
    fx.sql.exec("INSERT INTO games_meta(slug,markup_percent,hidden) VALUES('free-fire',10,0)");
    fx.sql.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed,updated_at) VALUES('sk:3',null,500,'2026-11-14T00:00:00Z')");

    fx.control.queries = 0;
    expect(await recomputeGamesSkPrices(db(), { all: true })).toEqual({ updated: 3 });
    expect(fx.control.queries).toBeLessThanOrEqual(3);
    // sk:1 global 5 % → 12400; sk:2 game 10 % → 353300; sk:3 game 10 % + Rp500 → 11500.
    expect(price("sk:1")).toBe(12400);
    expect(price("sk:2")).toBe(353300);
    expect(price("sk:3")).toBe(11500);

    expect(await recomputeGamesSkPrices(db(), { slug: "free-fire" })).toEqual({ updated: 2 });
    expect(await recomputeGamesSkPrices(db(), { skus: ["sk:1", "sk:3"] })).toEqual({ updated: 2 });
    expect(await recomputeGamesSkPrices(db(), { skus: [] })).toEqual({ updated: 0 });
  });

  it("never touches rows with cost 0 or Digiflazz rows", async () => {
    seedSku("sk:1", { cost: 0, sell_price: 777 });
    fx.sql.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,supplier) VALUES('ml86','legacy',15000,20000,'digiflazz')");
    await recomputeGamesSkPrices(db(), { all: true });
    expect(price("sk:1")).toBe(777);
    expect(price("ml86")).toBe(20000);
  });

  it("recomputes 1.700 rows in ≤3 statements with one bounded JSON parameter", async () => {
    const insert = (from: number, to: number) => {
      const payload = Array.from({ length: to - from }, (_, i) => `sk:${from + i}`);
      fx.sql.prepare(
        `INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,supplier,supplier_active,game_slug)
         SELECT value, 'Diamond', 1106018, 1, 'sekalipay', 0, 'mobile-legends' FROM json_each(?)`,
      ).run(JSON.stringify(payload));
    };
    insert(1, 1701);
    expect((fx.sql.prepare("SELECT COUNT(*) n FROM games_products").get() as { n: number }).n).toBe(1700);

    fx.control.queries = 0;
    const all = await recomputeGamesSkPrices(db(), { all: true });
    expect(all.updated).toBe(1700);
    expect(fx.control.queries).toBeLessThanOrEqual(3);
    // 5 %/R100 dari modal 1.106.018 = 1.161.400 (pasangan uji B1).
    expect(price("sk:1")).toBe(1161400);
    expect(price("sk:1700")).toBe(1161400);

    // Scope daftar: 1.700 SKU lewat SATU parameter JSON (json_each), bukan 1.700 bind.
    const skus = Array.from({ length: 1700 }, (_, i) => `sk:${i + 1}`);
    fx.control.queries = 0;
    expect((await recomputeGamesSkPrices(db(), { skus })).updated).toBe(1700);
    expect(fx.control.queries).toBeLessThanOrEqual(2);
  });
});
