import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { Miniflare } from "miniflare";

const migration = fs.readFileSync("drizzle/migrations/0129_product_groups.sql", "utf8");
let f: ReturnType<typeof createD1Fixture>;

function runMigration() {
  f.sql.exec(migration);
}

beforeEach(() => {
  f = createD1Fixture();
  // Begin at the real pre-0129 baseline, not bootstrap with new triggers.
  for (const row of f.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pg_%'").all()) f.sql.exec(`DROP TRIGGER ${row.name}`);
  f.sql.exec("DROP TABLE product_group_members; DROP TABLE product_group_dirty; DROP TABLE product_groups");
  // Produk yang relevan untuk langkah Jaspay (lama & baru).
  f.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock,is_active) VALUES
      (15,'Zoom Premium','zoom-premium-lama',1,1,1),
      (20,'Express VPN','express-vpn-lama',1,1,1),
      (25,'Wink Premium','wink-premium-lama',1,1,1),
      (26,'Meitu Premium','meitu-premium-lama',1,1,1),
      (113,'Zoom Pro','zoom-pro',1,1,1),
      (121,'Express VPN','express-vpn',1,1,1),
      (115,'Wink VIP','wink-vip',1,1,1),
       (114,'Meitu VIP','meitu-vip',1,1,1);
    INSERT OR IGNORE INTO products(id,name,slug,price,stock)
      SELECT wr_product_id,'Produk '||wr_product_id,'p'||wr_product_id,1,0 FROM supplier_pairs
      UNION SELECT sk_product_id,'Produk '||sk_product_id,'p'||sk_product_id,1,0 FROM supplier_pairs;
  `);
});
afterEach(() => f.close());

describe("migrasi 0129 — 33 pasangan → grup + Jaspay", () => {
  it("menyalin semua pasangan, prefer/winner lama, dan mengganti produk MBO dengan Jaspay", () => {
    runMigration();
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM supplier_pairs").get()?.n).toBe(33);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_groups").get()?.n).toBe(33);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_members").get()?.n).toBe(66);
    // Zoom (pasangan ke-27) memakai nama produk WR lama.
    expect(f.sql.prepare("SELECT name FROM product_groups WHERE id=27").get()?.name).toBe("Zoom Premium");
    // 15 digantikan 113, 62 (SK) tetap anggota.
    const members = (f.sql.prepare("SELECT product_id FROM product_group_members WHERE group_id=27 ORDER BY position").all() as { product_id: number }[]).map((r) => r.product_id);
    expect(members).toEqual([113, 62]);
    // Produk lama diarsipkan (is_active=0 + archived_at), bukan dihapus.
    const old = f.sql.prepare("SELECT is_active,archived_at FROM products WHERE id=15").get() as { is_active: number; archived_at: string | null };
    expect(old.is_active).toBe(0);
    expect(old.archived_at).not.toBeNull();
    expect(f.sql.prepare("SELECT is_active FROM products WHERE id=113").get()?.is_active).toBe(1);
  });

  it("idempoten: dijalankan ulang tidak menduplikasi grup/anggota dan tetap arsip", () => {
    runMigration();
    const before = {
      groups: f.sql.prepare("SELECT COUNT(*) AS n FROM product_groups").get()?.n,
      members: f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_members").get()?.n,
      archived: f.sql.prepare("SELECT archived_at FROM products WHERE id=15").get()?.archived_at,
    };
    runMigration();
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_groups").get()?.n).toBe(before.groups);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_members").get()?.n).toBe(before.members);
    expect(f.sql.prepare("SELECT archived_at FROM products WHERE id=15").get()?.archived_at).toBe(before.archived);
  });

  it("guard nama: produk baru bernama lain tidak menggantikan/mengarsipkan yang lama", () => {
    f.sql.exec("UPDATE products SET name='Bukan Zoom' WHERE id=113");
    runMigration();
    expect((f.sql.prepare("SELECT product_id FROM product_group_members WHERE group_id=27 ORDER BY position").all() as { product_id: number }[]).map((r) => r.product_id)).toEqual([15, 62]);
    expect(f.sql.prepare("SELECT is_active FROM products WHERE id=15").get()?.is_active).toBe(1);
  });

  it("trigger menandai dirty setelah salinan grup dan saat stok berubah", () => {
    runMigration();
    expect(Number(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_dirty").get()?.n)).toBe(33);
    f.sql.exec("INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES(113,'Z113','Z',1,1,1)");
    f.sql.exec("UPDATE product_group_dirty SET pending=0");
    f.sql.exec("UPDATE product_variants SET stock=2 WHERE product_id=113");
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=27").get()?.pending).toBe(1);
  });

  it("arsip juga berlaku untuk MBO yang sudah OFF, tanpa mematikan Jaspay", () => {
    f.sql.exec("UPDATE products SET is_active=0 WHERE id=15; INSERT INTO product_variants(product_id,sku,label,price,stock) VALUES(15,'OLD','Lama',1,1)");
    runMigration();
    expect(f.sql.prepare("SELECT archived_at FROM products WHERE id=15").get()?.archived_at).not.toBeNull();
    expect(f.sql.prepare("SELECT is_active FROM product_variants WHERE product_id=15").get()?.is_active).toBe(0);
    expect(f.sql.prepare("SELECT is_active FROM products WHERE id=113").get()?.is_active).toBe(1);
  });

  it("guard nama lama juga melindungi prefer/winner; tidak menunjuk non-anggota", () => {
    f.sql.exec("UPDATE products SET name='Produk lain' WHERE id=15; UPDATE supplier_pairs SET prefer='WR',winner='WR' WHERE id=27");
    runMigration();
    expect(f.sql.prepare("SELECT prefer_product_id,winner_product_id FROM product_groups WHERE id=27").get()).toEqual({ prefer_product_id: 15, winner_product_id: 15 });
    expect(f.sql.prepare("SELECT archived_at FROM products WHERE id=15").get()?.archived_at).toBeNull();
  });

  it("D1/workerd applies and replays the actual migration, including all triggers", async () => {
    const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", d1Databases: ["DB"], script: 'export default {fetch(){return new Response("ok")}}' });
    try {
      const db = await runtime.getD1Database("DB");
      const tables = ["categories","products","product_variants","wr_variants","sk_products","tunvn_products","aivault_products","crypto_market_snapshot","fulfillment_inventory","supplier_pairs"];
      await db.batch(tables.map(name => db.prepare(String(f.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql))));
      await db.batch(f.sql.prepare("SELECT id,name,slug,price,stock,is_active FROM products").all().map(p =>
        db.prepare("INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(?,?,?,?,?,?)").bind(p.id,p.name,p.slug,p.price,p.stock,p.is_active)));
      await db.batch(f.sql.prepare("SELECT * FROM supplier_pairs").all().map(p =>
        db.prepare("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id,prefer,prefer_margin,winner) VALUES(?,?,?,?,?,?)").bind(p.id,p.wr_product_id,p.sk_product_id,p.prefer,p.prefer_margin,p.winner)));
      // Triggers are kept whole (their bodies contain semicolons). All data
      // statements precede trigger creation in the production migration too.
      const triggers = migration.match(/CREATE TRIGGER[\s\S]*?\nEND;/g) ?? [];
      const data = migration.replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, "").replace(/^--.*$/gm, "").split(";").map(s => s.trim()).filter(Boolean);
      for (let run=0; run<2; run++) await db.batch([...data,...triggers].map(sql => db.prepare(sql)));
      expect(await db.prepare("SELECT COUNT(*) AS n FROM product_groups").first()).toEqual({ n: 33 });
      expect(await db.prepare("SELECT COUNT(*) AS n FROM product_group_members").first()).toEqual({ n: 66 });
      expect(await db.prepare("SELECT COUNT(*) AS n FROM products WHERE id IN (15,20,25,26) AND archived_at IS NOT NULL AND is_active=0").first()).toEqual({ n: 4 });
      expect((await db.prepare("SELECT product_id FROM product_group_members WHERE group_id=27 ORDER BY position").all()).results).toEqual([{ product_id: 113 },{ product_id: 62 }]);
      await db.prepare("DELETE FROM product_groups WHERE id=27").run();
      expect(await db.prepare("SELECT COUNT(*) AS n FROM product_group_members WHERE group_id=27").first()).toEqual({ n: 0 });
    } finally { await runtime.dispose(); }
  }, 30000);
});
