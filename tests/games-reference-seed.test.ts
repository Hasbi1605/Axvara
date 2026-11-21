import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { isGamesNicknameProduct } from "@/lib/games/sellable";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const migration = readFileSync("drizzle/migrations/0111_games_reference_seed.sql", "utf8");
function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0107_games_core.sql", "0108_games_admin.sql", "0109_games_nickname.sql"]) {
    db.exec(readFileSync(`drizzle/migrations/${file}`, "utf8"));
  }
  return db;
}

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
