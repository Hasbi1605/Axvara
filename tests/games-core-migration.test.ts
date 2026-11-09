import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const migration = fs.readFileSync("drizzle/migrations/0107_games_core.sql", "utf8");
const nicknameMigration = fs.readFileSync("drizzle/migrations/0109_games_nickname.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
const TABLES = ["games_products", "games_order_items", "games_dispatch_attempts"];
const body = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`${name} missing`);
  return m[1].replace(/\s+/g, " ").trim();
};
const indexes = (sql: string) => (sql.match(/CREATE INDEX IF NOT EXISTS idx_games_[^;]+;/g) ?? [])
  .filter(s => TABLES.some(t => s.includes(`ON ${t}(`))).map((s) => s.replace(/\s+/g, " "));
// 0108 (migrasi aditif berikutnya) menambah dua kolom ini ke games_products.
// schema.sql adalah gabungan semua migrasi, jadi keduanya dikeluarkan saat
// membandingkan bentuk dasar 0107 — bukan melonggarkan pemeriksaan kolom lain.
const LATER_COLUMNS = [
  ", display_group TEXT CHECK (display_group IS NULL OR display_group IN ('special','bestseller'))",
  ", display_order INTEGER",
];
const withoutLaterColumns = (sql: string, name: string) =>
  LATER_COLUMNS.reduce((text, column) => text.replace(column, ""), body(sql, name));

describe("0107 games core migration", () => {
  it("table bodies and indexes are identical to drizzle/schema.sql", () => {
    for (const t of TABLES) expect(body(migration, t)).toBe(withoutLaterColumns(schema, t));
    expect(indexes(migration)).toEqual(indexes(schema));
    expect(indexes(migration).length).toBeGreaterThanOrEqual(5);
  });

  it("applies cleanly on top of an orders table and enforces the constraints", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE orders(code TEXT PRIMARY KEY, order_kind TEXT NOT NULL DEFAULT 'apps'); INSERT INTO orders(code,order_kind) VALUES('G1','games'),('G2','games');");
    db.exec(migration);
    db.exec(migration); // idempotent
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name) VALUES('ml86','ML 86')");
    const item = (code: string, over = "") => `INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price${over ? "," + over.split("=")[0] : ""}) VALUES('${code}',1,'ml86','1',100,100,90,95${over ? "," + over.split("=")[1] : ""})`;
    db.exec(item("G1"));
    expect(() => db.exec(item("G1"))).toThrow(/UNIQUE/);
    expect(() => db.exec(item("NOPE"))).toThrow(/FOREIGN KEY/);
    expect(() => db.exec(item("G2", "quantity=2"))).toThrow(/CHECK/);
    expect(() => db.exec(item("G2", "status='bogus'"))).toThrow(/CHECK/);
    expect(() => db.exec(item("G2", "attempt_no=3"))).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO games_products(buyer_sku_code,product_name) VALUES('ml86','dup')")).toThrow(/UNIQUE/);
    const attempt = (ref: string, no: number, status = "submitting") => `INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES('${ref}','G1',${no},'ml86','${status}')`;
    db.exec(attempt("G1-1", 1));
    expect(() => db.exec(attempt("G1-1b", 1))).toThrow(/UNIQUE/);
    expect(() => db.exec(attempt("G1-1", 2))).toThrow(/UNIQUE/);
    expect(() => db.exec(attempt("G1-2", 2, "nope"))).toThrow(/CHECK/);
    db.exec(attempt("G1-2", 2, "ambiguous"));
    db.close();
  });
});

it("0109 matches canonical nickname tables/indexes and applies idempotently", () => {
  for (const table of ["games_nickname_cache", "games_nickname_checks"]) expect(body(nicknameMigration, table)).toBe(body(schema, table));
  const nicknameIndexes = (sql: string) => sql.match(/CREATE INDEX IF NOT EXISTS idx_games_nickname_[^;]+;/g);
  expect(nicknameIndexes(nicknameMigration)).toEqual(nicknameIndexes(schema));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(nicknameMigration); db.exec(nicknameMigration);
    db.exec("INSERT INTO games_nickname_cache VALUES('ffcekusername','123','NCK-1','pending',NULL,1,NULL)");
    expect(() => db.exec("INSERT INTO games_nickname_cache VALUES('ffcekusername','123','NCK-2','pending',NULL,1,NULL)")).toThrow(/UNIQUE/);
    expect(() => db.exec("INSERT INTO games_nickname_cache VALUES('mlcekusername','456','NCK-1','pending',NULL,1,NULL)")).toThrow(/UNIQUE/);
  } finally { db.close(); }
});
