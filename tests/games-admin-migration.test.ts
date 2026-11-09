import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const core = fs.readFileSync("drizzle/migrations/0107_games_core.sql", "utf8");
const admin = fs.readFileSync("drizzle/migrations/0108_games_admin.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
const body = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`${name} missing`);
  return m[1].replace(/\s+/g, " ").trim();
};

describe("0108 games admin migration", () => {
  it("mirrors games_reference_prices and the new product columns in drizzle/schema.sql", () => {
    expect(body(admin, "games_reference_prices")).toBe(body(schema, "games_reference_prices"));
    for (const column of [
      "display_group TEXT CHECK (display_group IS NULL OR display_group IN ('special','bestseller'))",
      "display_order INTEGER",
    ]) {
      expect(body(schema, "games_products")).toContain(column);
    }
    expect(admin).toContain("ALTER TABLE games_products ADD COLUMN display_group");
    expect(admin).toContain("ALTER TABLE games_products ADD COLUMN display_order");
  });

  it("applies on top of 0107 and enforces the reference + display group contracts", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(core);
    db.exec(admin);
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price) VALUES('ml86','ML 86',10000,10300)");
    // SKU referensi boleh mendahului baris katalog (seed sebelum sinkron pertama).
    db.exec("INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES('ff140',25000,'admin','2026-11-09T00:00:00.000Z','2026-11-09T00:00:00.000Z')");
    expect(() => db.exec("INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES('ff140',9000,'admin','x','x')")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES('ml5',0,'admin','x','x')")).toThrow(/CHECK/);
    expect(() => db.exec("UPDATE games_products SET display_group='bogus' WHERE buyer_sku_code='ml86'")).toThrow(/CHECK/);
    db.exec("UPDATE games_products SET display_group='special', display_order=3 WHERE buyer_sku_code='ml86'");
    expect(db.prepare("SELECT display_group,display_order FROM games_products WHERE buyer_sku_code='ml86'").get())
      .toEqual({ display_group: "special", display_order: 3 });
    db.close();
  });
});
