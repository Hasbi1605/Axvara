// Audit AU-G2-3: pg_member_valid_insert guarded only INSERT, so an UPDATE of
// product_group_members could move a member onto an archived (hidden) product.
// 0152 adds the mirrored BEFORE UPDATE guard; schema.sql carries the same block.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

let f: ReturnType<typeof createD1Fixture>;
const migration = fs.readFileSync("drizzle/migrations/0152_product_group_member_update_guard.sql", "utf8");

beforeEach(() => {
  f = createD1Fixture();
  f.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock,is_active) VALUES
      (9001,'Aktif A','aktif-a',1,1,1),
      (9002,'Arsip','arsip-produk',1,1,0),
      (9003,'Aktif B','aktif-b',1,1,1);
    UPDATE products SET archived_at=datetime('now') WHERE id=9002;
    INSERT INTO product_groups(id,name) VALUES (900,'Grup Uji');
    INSERT INTO product_group_members(group_id,product_id,position) VALUES (900,9001,0);
  `);
});
afterEach(() => f.close());

const memberProductIds = () => f.sql
  .prepare("SELECT product_id FROM product_group_members WHERE group_id=900 ORDER BY position")
  .all()
  .map((row) => Number(row.product_id));

describe("guard update anggota grup (0152)", () => {
  it("masih menolak INSERT anggota produk arsip", () => {
    expect(() => f.sql.exec("INSERT INTO product_group_members(group_id,product_id,position) VALUES(900,9002,1)"))
      .toThrow(/invalid_group_product/);
  });

  it("menolak UPDATE anggota menjadi produk arsip", () => {
    expect(() => f.sql.exec("UPDATE product_group_members SET product_id=9002 WHERE group_id=900 AND product_id=9001"))
      .toThrow(/invalid_group_product/);
    expect(memberProductIds()).toEqual([9001]);
  });

  it("menolak UPDATE anggota menjadi produk yang tidak ada", () => {
    expect(() => f.sql.exec("UPDATE product_group_members SET product_id=99999 WHERE group_id=900"))
      .toThrow(/invalid_group_product/);
  });

  it("mengizinkan UPDATE anggota ke produk aktif", () => {
    f.sql.exec("UPDATE product_group_members SET product_id=9003 WHERE group_id=900 AND product_id=9001");
    expect(memberProductIds()).toEqual([9003]);
  });

  it("tidak memblokir perubahan non-product_id pada anggota yang produknya diarsipkan", () => {
    f.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=9001");
    f.sql.exec("UPDATE product_group_members SET position=5 WHERE group_id=900 AND product_id=9001");
    expect(f.sql.prepare("SELECT position FROM product_group_members WHERE group_id=900 AND product_id=9001").get()?.position).toBe(5);
  });

  it("arsip produk anggota tetap boleh dan keanggotaan tidak dihapus", () => {
    f.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now') WHERE id=9001");
    expect(f.sql.prepare("SELECT archived_at FROM products WHERE id=9001").get()?.archived_at).not.toBeNull();
    expect(memberProductIds()).toEqual([9001]);
  });

  it("migrasi 0152 aditif, idempoten, dan memasang guard saat trigger belum ada", () => {
    f.sql.exec("DROP TRIGGER IF EXISTS pg_member_valid_update");
    expect(() => f.sql.exec("UPDATE product_group_members SET product_id=9002 WHERE group_id=900 AND product_id=9001"))
      .not.toThrow(); // reproduksi celah sebelum migrasi
    f.sql.exec("UPDATE product_group_members SET product_id=9001 WHERE group_id=900");
    f.sql.exec(migration);
    f.sql.exec(migration);
    expect(() => f.sql.exec("UPDATE product_group_members SET product_id=9002 WHERE group_id=900 AND product_id=9001"))
      .toThrow(/invalid_group_product/);
  });
});
