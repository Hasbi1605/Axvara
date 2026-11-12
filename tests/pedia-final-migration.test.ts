// tests/pedia-final-migration.test.ts — PSMM-FINAL-PATCH C (2026-11-12).
// Migrasi 0117 harus bisa diterapkan pada skema PRA-0117 dan menambah kolom
// `managed` (produk+tier) serta `managed_snapshot_at` (tier) dengan default
// aman: seluruh baris lama menjadi `curated` dan cap versi kosong (gate
// syarat tidak menahan baris pra-gate).
import { expect, it } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createD1Fixture } from "./helpers/d1-fixture";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => { exec: (sql: string) => void; prepare: (sql: string) => { all: () => Record<string, unknown>[]; get: (...p: unknown[]) => Record<string, unknown> | undefined }; close: () => void };
};

const MIGRATION = fs.readFileSync("drizzle/migrations/0117_pedia_managed_catalog.sql", "utf8");

/** Skema minimal PRA-0117 (tanpa kolom managed / managed_snapshot_at). */
function preMigration() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE pedia_products (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, platform TEXT NOT NULL, metric TEXT NOT NULL, target_kind TEXT NOT NULL, name TEXT NOT NULL, packages_json TEXT NOT NULL DEFAULT '[]', step INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 0)`);
  sql.exec(`CREATE TABLE pedia_tiers (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, tier TEXT NOT NULL DEFAULT 'standar', supplier TEXT NOT NULL DEFAULT 'providersmm', supplier_service_id INTEGER NOT NULL, price_group TEXT NOT NULL, markup_pct REAL NOT NULL, min_profit_rp INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 0, UNIQUE(product_id, supplier, supplier_service_id))`);
  sql.exec(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name) VALUES ('legacy','instagram','followers','profile','Legacy')`);
  sql.exec(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active) VALUES (1,'standar','providersmm',86,'G3',20,1000,1)`);
  return sql;
}

it("0117 applies on a pre-0117 schema and defaults existing rows to curated with no stamp", () => {
  const sql = preMigration();
  try {
    sql.exec(MIGRATION);
    // Idempoten-terbaca: penerapan kedua harus gagal jelas (ALTER duplikat),
    // bukan merusak data — kita hanya memastikan penerapan pertama benar.
    expect(sql.prepare(`SELECT managed FROM pedia_products WHERE slug='legacy'`).get()).toMatchObject({ managed: "curated" });
    expect(sql.prepare(`SELECT managed, managed_snapshot_at FROM pedia_tiers WHERE supplier_service_id=86`).get())
      .toMatchObject({ managed: "curated", managed_snapshot_at: null });
    // Nilai `auto` valid setelah migrasi (CHECK tersedia).
    sql.exec(`UPDATE pedia_tiers SET managed='auto', managed_snapshot_at='2026-11-12T10:00:00.000Z' WHERE supplier_service_id=86`);
    expect(sql.prepare(`SELECT managed, managed_snapshot_at FROM pedia_tiers WHERE supplier_service_id=86`).get())
      .toMatchObject({ managed: "auto", managed_snapshot_at: "2026-11-12T10:00:00.000Z" });
  } finally { sql.close(); }
});

it("schema.sql carries the same columns as the migration", () => {
  const fx = createD1Fixture();
  try {
    const cols = fx.sql.prepare("PRAGMA table_info(pedia_tiers)").all().map((c) => String(c.name));
    expect(cols).toContain("managed");
    expect(cols).toContain("managed_snapshot_at");
    const productCols = fx.sql.prepare("PRAGMA table_info(pedia_products)").all().map((c) => String(c.name));
    expect(productCols).toContain("managed");
  } finally { fx.close(); }
});
