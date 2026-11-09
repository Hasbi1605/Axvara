import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { generateReferenceSeed } from "../scripts/generate-games-reference-seed.mjs";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const migration = readFileSync("drizzle/migrations/0111_games_reference_seed.sql", "utf8");
const sku = (code: string, extra: Record<string, unknown> = {}) => ({ buyer_sku_code: code, product_name: "Diamonds", brand: "FREE FIRE", price: 100, ...extra });
const ref = (code: string, extra: Record<string, unknown> = {}) => ({ buyer_sku_code: code, oura_price: 110, match: "exact", ...extra });
function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0107_games_core.sql", "0108_games_admin.sql", "0109_games_nickname.sql"]) {
    db.exec(readFileSync(`drizzle/migrations/${file}`, "utf8"));
  }
  return db;
}

describe("Games reference seed selection", () => {
  it("selects exact primary matches, inclusive ratio boundaries, and sorts deterministically", () => {
    const skus = [sku("high"), sku("low"), sku("standaloneb"), sku("normal"), sku("normalb")];
    const refs = [ref("high", { oura_price: 300 }), ref("low", { oura_price: 50 }), ref("standaloneb"), ref("normal"), ref("normalb")];
    const output = generateReferenceSeed({ matches: refs }, skus);
    expect(output.selected.map((r: { buyer_sku_code: string }) => r.buyer_sku_code)).toEqual(["high", "low", "normal", "standaloneb"]);
    expect(output.discarded).toEqual([{ buyer_sku_code: "normalb", reason: "backup" }]);
    expect(generateReferenceSeed({ matches: [...refs].reverse() }, [...skus].reverse())).toEqual(output);
    const db = database();
    try {
      db.exec(output.sql);
      expect(db.prepare("SELECT COUNT(*) AS n FROM games_reference_prices").get().n).toBe(output.selected.length);
      expect(db.prepare("SELECT price,source,captured_at,updated_at FROM games_reference_prices WHERE buyer_sku_code='low'").get()).toEqual({
        price: 50, source: "ourastore.com riset 2026-11-09", captured_at: "2026-11-09T08:28:15Z", updated_at: "2026-11-09T08:28:15Z",
      });
    } finally { db.close(); }
  });
  it("records every dropped match once with an explicit reason", () => {
    const skus = [sku("likely"), sku("ffcekusername"), sku("mlcekusername"), sku("pubgcekusername"),
      sku("named", { product_name: "FF CeK\tUsername" }), sku("refnamed"), sku("other", { brand: "Other" }),
      sku("zero"), sku("fraction"), sku("string"), sku("cost", { price: 0 }), sku("cheap"), sku("expensive")];
    const matches = [ref("likely", { match: "likely" }), ref("missing"), ref("ffcekusername"), ref("mlcekusername"), ref("pubgcekusername"),
      ref("named"), ref("refnamed", { our_name: "Cek Username" }), ref("other"), ref("zero", { oura_price: 0 }),
      ref("fraction", { oura_price: 10.5 }), ref("string", { oura_price: "110" }), ref("cost"), ref("cheap", { oura_price: 49 }), ref("expensive", { oura_price: 301 })];
    const result = generateReferenceSeed({ matches }, skus);
    expect(result.selected).toEqual([]);
    expect(result.discarded).toHaveLength(matches.length);
    expect(Object.fromEntries(result.discarded.map((r: { buyer_sku_code: string; reason: string }) => [r.buyer_sku_code, r.reason]))).toEqual({
      likely: "not_exact", missing: "missing_sku", ffcekusername: "username_utility", mlcekusername: "username_utility", pubgcekusername: "username_utility",
      named: "username_utility", refnamed: "username_utility", other: "not_wave1", zero: "invalid_oura_price", fraction: "invalid_oura_price",
      string: "invalid_oura_price", cost: "invalid_cost", cheap: "ratio_out_of_range", expensive: "ratio_out_of_range",
    });
  });
  it("rejects malformed/duplicate codes rather than generating ambiguous or injected SQL", () => {
    expect(() => generateReferenceSeed({}, [])).toThrow(/JSON array/);
    expect(() => generateReferenceSeed({ matches: [] }, {})).toThrow(/JSON array/);
    expect(() => generateReferenceSeed({ matches: [ref("bad');DROP_TABLE")] }, [])).toThrow(/Invalid/);
    expect(() => generateReferenceSeed({ matches: [ref("ff140"), ref("ff140")] }, [sku("ff140")])).toThrow(/duplicate/);
    expect(() => generateReferenceSeed({ matches: [] }, [sku("ff140"), sku("ff140")])).toThrow(/duplicate/);
  });
});

it("0111 seeds 198 selected primary references over Games0109, preserving admin edits and catalog state", () => {
  // R1 exact+primary+utility+ratio selection: FF16 / FF MAX8 / ML156 / PUBG18.
  const db = database();
  try {
    db.exec(migration);
    const rows = db.prepare("SELECT * FROM games_reference_prices ORDER BY buyer_sku_code").all();
    expect(rows).toHaveLength(198);
    for (const row of rows) {
      expect(Number.isSafeInteger(row.price) && row.price > 0).toBe(true);
      expect(isGamesNicknameProduct(row)).toBe(false);
      expect(row.buyer_sku_code.endsWith("b")).toBe(false);
      expect(row.source).toBe("ourastore.com riset 2026-11-09");
    }
    expect(rows.filter((r: { buyer_sku_code: string }) => r.buyer_sku_code.startsWith("ff") && !r.buyer_sku_code.startsWith("ffmax"))).toHaveLength(16);
    expect(rows.filter((r: { buyer_sku_code: string }) => r.buyer_sku_code.startsWith("ffmax"))).toHaveLength(8);
    expect(rows.filter((r: { buyer_sku_code: string }) => r.buyer_sku_code.startsWith("ml"))).toHaveLength(156);
    expect(rows.filter((r: { buyer_sku_code: string }) => r.buyer_sku_code.startsWith("pubg"))).toHaveLength(18);
    db.exec("DELETE FROM games_reference_prices; INSERT INTO games_reference_prices VALUES('ff140',777,'admin','admin-captured','admin-updated')");
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name,reference_price,sell_price,enabled) VALUES('ff140','FF',1,123,0)");
    db.exec(migration); db.exec(migration);
    expect(db.prepare("SELECT * FROM games_reference_prices WHERE buyer_sku_code='ff140'").get()).toEqual({ buyer_sku_code: "ff140", price: 777, source: "admin", captured_at: "admin-captured", updated_at: "admin-updated" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM games_reference_prices").get().n).toBe(198);
    expect(db.prepare("SELECT reference_price,sell_price,enabled FROM games_products").get()).toEqual({ reference_price: 1, sell_price: 123, enabled: 0 });
  } finally { db.close(); }
});
