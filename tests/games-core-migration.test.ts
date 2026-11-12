import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const migration = fs.readFileSync("drizzle/migrations/0107_games_core.sql", "utf8");
const nicknameMigration = fs.readFileSync("drizzle/migrations/0109_games_nickname.sql", "utf8");
const skMigration = fs.readFileSync("drizzle/migrations/0118_games_sekalipay.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
const TABLES = ["games_products", "games_order_items", "games_dispatch_attempts"];
const body = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`${name} missing`);
  return m[1].replace(/\s+/g, " ").trim();
};
// 0118 menambah kolom dual-supplier/snapshot ke tiga tabel Games. Indeks baru
// pada games_products dibandingkan terpisah.
const LATER_INDEXES = new Set(["idx_games_products_sk_product"]);
const indexes = (sql: string) => (sql.match(/CREATE INDEX IF NOT EXISTS idx_games_[^;]+;/g) ?? [])
  .filter(s => TABLES.some(t => s.includes(`ON ${t}(`)))
  .filter(s => !LATER_INDEXES.has(s.match(/idx_games_[a-z_]+/)?.[0] ?? ""))
  .map((s) => s.replace(/\s+/g, " "));
// 0108 (migrasi aditif berikutnya) menambah dua kolom ini ke games_products,
// 0118 menambah kolom supplier/SK. schema.sql adalah gabungan semua migrasi,
// jadi kolom tersebut dikeluarkan saat membandingkan bentuk dasar 0107 —
// bukan melonggarkan pemeriksaan kolom lain.
const SUPPLIER_COLUMN = ", supplier TEXT NOT NULL DEFAULT 'digiflazz' CHECK (supplier IN ('digiflazz','sekalipay'))";
const LATER_COLUMNS = [
  ", display_group TEXT CHECK (display_group IS NULL OR display_group IN ('special','bestseller'))",
  ", display_order INTEGER",
  SUPPLIER_COLUMN,
  ", supplier_active INTEGER NOT NULL DEFAULT 0 CHECK (supplier_active IN (0,1))",
  ", sk_variant_id INTEGER",
  ", sk_sku TEXT",
  ", sk_product_id INTEGER",
  ", sk_product_name TEXT",
  ", game_slug TEXT",
  ", product_type_name TEXT",
  ", image_url TEXT",
  ", required_fields_json TEXT",
  ", validation_json TEXT",
  ", min_order INTEGER NOT NULL DEFAULT 1 CHECK (min_order >= 1)",
  ", target_snapshot TEXT",
  ", fields_snapshot TEXT",
  ", sk_invoice TEXT",
  ", supplier_ref TEXT",
  ", request_sent_at TEXT",
  ", payload_snapshot TEXT",
  ", dispatch_status TEXT",
  ", units_json TEXT",
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

it("0118 adds SK columns without rewriting legacy Digiflazz rows and scopes variant uniqueness", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE orders(code TEXT PRIMARY KEY, order_kind TEXT NOT NULL DEFAULT 'apps'); INSERT INTO orders(code,order_kind) VALUES('G1','games');");
    db.exec(migration);
    db.exec(fs.readFileSync("drizzle/migrations/0108_games_admin.sql", "utf8"));
    db.exec(nicknameMigration);
    db.exec(`INSERT INTO games_products(buyer_sku_code,product_name,cost,seller_active,enabled,display_group,display_order,sell_price)
      VALUES('ml86','ML 86 DM',15000,1,1,'bestseller',7,20000)`);
    db.exec(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price,status)
      VALUES('G1',1,'ml86','12345',20000,20000,15000,15750,'pending')`);
    db.exec(`INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status)
      VALUES('G1-1','G1',1,'ml86','pending')`);

    db.exec(skMigration);

    // Baris lama tidak berubah; kolom baru memakai default legacy.
    const legacy = db.prepare("SELECT * FROM games_products WHERE buyer_sku_code='ml86'").get() as Record<string, unknown>;
    expect(legacy).toMatchObject({
      product_name: "ML 86 DM", cost: 15000, seller_active: 1, enabled: 1,
      reference_price: null, display_group: "bestseller", display_order: 7, sell_price: 20000,
      supplier: "digiflazz", supplier_active: 0, sk_variant_id: null, min_order: 1,
    });
    expect(db.prepare("SELECT supplier,sk_invoice,request_sent_at FROM games_dispatch_attempts WHERE ref_id='G1-1'").get())
      .toEqual({ supplier: "digiflazz", sk_invoice: null, request_sent_at: null });
    expect(db.prepare("SELECT supplier,sk_invoice,target_snapshot FROM games_order_items WHERE order_code='G1'").get())
      .toEqual({ supplier: "digiflazz", sk_invoice: null, target_snapshot: null });

    // Varian SK unik hanya untuk supplier='sekalipay'.
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name,sk_variant_id,supplier) VALUES('sk:5','Game',5,'sekalipay')");
    expect(() => db.exec("INSERT INTO games_products(buyer_sku_code,product_name,sk_variant_id,supplier) VALUES('sk:5b','dup',5,'sekalipay')")).toThrow(/UNIQUE/);
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name,sk_variant_id,supplier) VALUES('legacy-a','a',5,'digiflazz')");
    db.exec("INSERT INTO games_products(buyer_sku_code,product_name,sk_variant_id,supplier) VALUES('legacy-b','b',5,'digiflazz')");
    expect(() => db.exec("INSERT INTO games_products(buyer_sku_code,product_name,supplier) VALUES('bad','x','other')")).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO games_products(buyer_sku_code,product_name,min_order) VALUES('bad2','x',0)")).toThrow(/CHECK/);

    // Snapshot P2 dapat ditulis.
    db.exec(`UPDATE games_order_items SET supplier='sekalipay', sk_variant_id=5, target_snapshot='{"note":"123"}',
      fields_snapshot='{"note":"123"}', sk_invoice='INV-1', supplier_ref='AXG1' WHERE order_code='G1'`);
    db.exec(`UPDATE games_dispatch_attempts SET supplier='sekalipay', sk_invoice='INV-1', request_sent_at='2026-11-12T00:00:00Z',
      payload_snapshot='{}', dispatch_status='pending', units_json='[]' WHERE ref_id='G1-1'`);
    expect(db.prepare("SELECT sk_invoice,supplier_ref FROM games_order_items WHERE order_code='G1'").get())
      .toEqual({ sk_invoice: "INV-1", supplier_ref: "AXG1" });
  } finally { db.close(); }
});
