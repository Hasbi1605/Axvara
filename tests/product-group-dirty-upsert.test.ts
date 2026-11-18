// Regresi 17 Nov 2026: trigger pg_dirty_* yang memakai INSERT OR REPLACE gagal
// "UNIQUE constraint failed: product_group_dirty.group_id" bila terpicu dari
// UPSERT luar (mirror tunvn_products), sehingga seluruh sync katalog TUNVN
// gagal. Migrasi 0132 mengganti semuanya dengan ON CONFLICT DO UPDATE.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncTunvnCatalog } from "@/lib/tunvn/sync";
import { createD1Fixture } from "./helpers/d1-fixture";

const m0129 = fs.readFileSync("drizzle/migrations/0129_product_groups.sql", "utf8");
const m0132 = fs.readFileSync("drizzle/migrations/0132_product_group_dirty_upsert.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");

const T0 = Date.UTC(2026, 10, 17, 11, 0, 0);
const product = (id: number, price_usdt: number, stock: number) => ({
  id, name: `Produk ${id}`, price_vnd: 100_000, price_usdt,
  discount_threshold: 0, discount_price_vnd: 0, discount_threshold_usdt: 0,
  discount_price_usdt: 0, stock, description: "deskripsi",
});
const stubCatalog = (rows: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () =>
  new Response(JSON.stringify({ success: true, products: rows, usdt_vnd: 25_000 }), { status: 200 })));

let f: ReturnType<typeof createD1Fixture>;
const db = () => createDatabaseAccess(f.db);
const one = (sql: string, ...p: unknown[]) => f.sql.prepare(sql).get(...p) as Record<string, unknown>;

function seedGroup() {
  f.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock,is_active) VALUES (117,'ChatGPT Private','chatgpt-tunvn',1,0,1),(119,'ChatGPT Plus','chatgpt-plus-1-bulan',1,0,1);
    INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,tunvn_source_product_id) VALUES (117,'TUNVN-83','GPay',1,0,1,83);
    INSERT INTO product_groups(id,name) VALUES (37,'ChatGPT Plus');
    INSERT INTO product_group_members(group_id,product_id,position) VALUES (37,117,0),(37,119,1);
  `);
}

async function syncAt(now: number, rows: unknown[]) {
  stubCatalog(rows);
  return syncTunvnCatalog(db(), { now, force: true });
}

beforeEach(() => {
  f = createD1Fixture();
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "test-key-not-real");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("0132 trigger pg_dirty_* aman di bawah UPSERT luar", () => {
  it("schema.sql dan 0132 tidak lagi memakai INSERT OR REPLACE ke product_group_dirty", () => {
    expect(schema).not.toMatch(/INSERT OR REPLACE INTO product_group_dirty/);
    expect(m0132).not.toMatch(/INSERT OR REPLACE INTO product_group_dirty/);
    // Semua trigger 0129 yang menulis dirty didefinisikan ulang di 0132.
    const names = (sql: string) => [...sql.matchAll(/CREATE TRIGGER (?:IF NOT EXISTS )?(pg_dirty_\w+)/g)].map(m => m[1]).sort();
    expect(names(m0132)).toEqual(names(m0129));
    expect(names(m0132)).toHaveLength(28);
  });

  it("sync TUNVN berhasil saat harga produk anggota grup berubah dan grup ditandai dirty", async () => {
    seedGroup();
    expect(await syncAt(T0, [product(83, 4.19, 0)])).toMatchObject({ ok: true });
    f.sql.exec("UPDATE product_group_dirty SET pending=0");
    const before = one("SELECT version FROM product_group_dirty WHERE group_id=37").version;

    // Harga naik + restok — persis kasus produksi #83 (4.19 → 5.3, stok 0 → 14).
    const res = await syncAt(T0 + 5 * 60_000, [product(83, 5.3, 14)]);
    expect(res).toMatchObject({ ok: true });
    expect(one("SELECT price_usdt,stock FROM tunvn_products WHERE supplier_product_id=83")).toMatchObject({ price_usdt: 5.3, stock: 14 });
    const dirty = one("SELECT version,pending FROM product_group_dirty WHERE group_id=37");
    expect(dirty.pending).toBe(1);
    expect(dirty.version).not.toBe(before);
  });

  it("jalur migrasi produksi 0129 → 0132: bug terjadi sebelum 0132, hilang sesudahnya", async () => {
    // Mulai dari trigger versi 0129 persis seperti di D1 produksi.
    for (const r of f.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pg_dirty_%'").all()) f.sql.exec(`DROP TRIGGER ${r.name}`);
    for (const m of m0129.matchAll(/CREATE TRIGGER IF NOT EXISTS pg_dirty_\w+[\s\S]*?\nEND;/g)) f.sql.exec(m[0]);
    seedGroup();
    expect(await syncAt(T0, [product(83, 4.19, 0)])).toMatchObject({ ok: true });
    expect(await syncAt(T0 + 5 * 60_000, [product(83, 5.3, 14)])).toEqual({ ok: false, error: "catalog_write_failed:constraint" });
    expect(f.sql.prepare("SELECT stock FROM tunvn_products WHERE supplier_product_id=83").get()?.stock).toBe(0);

    f.sql.exec(m0132);
    f.sql.exec(m0132); // idempoten (DROP IF EXISTS + CREATE)
    expect(await syncAt(T0 + 10 * 60_000, [product(83, 5.3, 14)])).toMatchObject({ ok: true });
    expect(one("SELECT stock FROM tunvn_products WHERE supplier_product_id=83").stock).toBe(14);
    expect(one("SELECT pending FROM product_group_dirty WHERE group_id=37").pending).toBe(1);
  });

  it("FX snapshot tanpa WHERE tetap menandai semua grup (WHERE true di UPSERT trigger)", () => {
    seedGroup();
    f.sql.exec("INSERT INTO product_groups(id,name) VALUES (38,'Lain')");
    f.sql.exec("UPDATE product_group_dirty SET pending=0");
    f.sql.exec("INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES (1,'16000') ON CONFLICT(id) DO UPDATE SET fx_rate_text='16500'");
    f.sql.exec("INSERT INTO crypto_market_snapshot(id,fx_rate_text) VALUES (1,'17000') ON CONFLICT(id) DO UPDATE SET fx_rate_text=excluded.fx_rate_text");
    expect(Number(one("SELECT COUNT(*) AS n FROM product_group_dirty WHERE pending=1").n)).toBe(2);
  });
});
