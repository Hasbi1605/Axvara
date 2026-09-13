import { describe, expect, it } from "vitest";
import {
  assertBindCount,
  countPlaceholders,
  createD1Fixture,
} from "./d1-fixture";

// Test regresi wajib #15: fixture harus menolak bind-count mismatch seperti
// D1 asli (temuan WR B2/B4 — node:sqlite diam-diam changes:0).
describe("d1-fixture strict bind check", () => {
  it("menghitung placeholder di luar string literal", () => {
    expect(countPlaceholders("SELECT * FROM t WHERE a=? AND b=?")).toBe(2);
    // '?' di dalam literal TIDAK dihitung.
    expect(countPlaceholders("SELECT '?' FROM t WHERE a=?")).toBe(1);
    expect(countPlaceholders(`UPDATE t SET s='a?b', x=? WHERE y='?'`)).toBe(1);
  });

  it("assertBindCount melempar saat kurang/lebih", () => {
    expect(() => assertBindCount("SELECT ? + ?", [1])).toThrow(/bind mismatch/);
    expect(() => assertBindCount("SELECT ?", [1, 2])).toThrow(/bind mismatch/);
    expect(() => assertBindCount("SELECT ? + ?", [1, 2])).not.toThrow();
  });

  it("fixture first/all/run melempar seperti D1 (bukan changes:0 diam)", async () => {
    const fx = createD1Fixture();
    try {
      const db = fx.db;
      await expect(
        db.prepare("SELECT * FROM products WHERE id=? AND slug=?").bind(1).first(),
      ).rejects.toThrow(/bind mismatch/);
      await expect(
        db.prepare("SELECT * FROM products WHERE id=?").bind(1, 2).all(),
      ).rejects.toThrow(/bind mismatch/);
      await expect(
        db.prepare("UPDATE products SET stock=? WHERE id=?").bind(5).run(),
      ).rejects.toThrow(/bind mismatch/);
      // Kasus B4 persis: 7 placeholder, 6 values.
      await expect(
        db
          .prepare(
            `UPDATE wr_products SET wr_product_name=?, wr_category=?, wr_description=?,
             axvara_product_id=?, is_excluded=0, exclude_reason=NULL,
             last_synced_at=?, updated_at=? WHERE wr_product_id=?`,
          )
          .bind("n", "c", "d", 51, "now", "wr-x")
          .run(),
      ).rejects.toThrow(/bind mismatch.*7 placeholder.*6 value/);
    } finally {
      fx.close();
    }
  });

  it("batch member dengan binding salah menggagalkan batch", async () => {
    const fx = createD1Fixture();
    try {
      const db = fx.db;
      await expect(
        db.batch([
          db.prepare("SELECT 1").bind(),
          db.prepare("SELECT ?").bind(),
        ]),
      ).rejects.toThrow(/bind mismatch/);
    } finally {
      fx.close();
    }
  });
});
