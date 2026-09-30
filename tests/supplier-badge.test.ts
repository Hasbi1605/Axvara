import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

// Badge asal supplier (keputusan owner 2026-09-30): pembeli hanya melihat
// nama bersih; WR/SK/Manual hanya dibedakan di admin + slug.
// SK = sk_product_id NOT NULL (source tetap 'manual' karena CHECK D1 lama);
// WR = source warung_rebahan ATAU wr_product_id; selainnya Manual.

function supplierOf(row: Record<string, unknown>): "WR" | "SK" | "Manual" {
  if (row.sk_product_id != null) return "SK";
  if (String(row.source ?? "") === "warung_rebahan" || row.wr_product_id != null) return "WR";
  return "Manual";
}

describe("badge asal supplier (nama bersih storefront)", () => {
  it("SK terdeteksi walau source=manual (CHECK D1 lama)", () => {
    expect(supplierOf({ source: "manual", sk_product_id: "14" })).toBe("SK");
    expect(supplierOf({ source: "warung_rebahan", wr_product_id: "p1" })).toBe("WR");
    expect(supplierOf({ source: "manual", wr_product_id: null, sk_product_id: null })).toBe("Manual");
  });

  it("migrasi 0051 mengupas suffix hanya milik sync", async () => {
    const { createD1Fixture } = await import("./helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,source,wr_product_id) VALUES(1,'Netflix Premium (WR)','netflix-premium',100,'warung_rebahan','p1')").run();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,source,sk_product_id) VALUES(2,'Netflix (SK)','netflix-sk',100,'manual','14')").run();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,source) VALUES(3,'Kopi (SK) Manual','kopi',100,'manual')").run();
      const fs = await import("node:fs");
      // Migrasi idempoten: rerun tidak mengubah hasil.
      for (let i = 0; i < 2; i++) {
        fx.sql.exec(fs.readFileSync("drizzle/migrations/0051_clean_supplier_suffix.sql", "utf8"));
      }
      const rows = fx.sql.prepare("SELECT id, name FROM products ORDER BY id").all() as { id: number; name: string }[];
      expect(rows).toEqual([
        { id: 1, name: "Netflix Premium" },
        { id: 2, name: "Netflix" },
        { id: 3, name: "Kopi (SK) Manual" },
      ]);
      // Badge tetap benar setelah nama dibersihkan.
      const sup = fx.sql.prepare("SELECT source, wr_product_id, sk_product_id FROM products ORDER BY id").all() as Record<string, unknown>[];
      expect(sup.map(supplierOf)).toEqual(["WR", "SK", "Manual"]);
    } finally {
      fx.close();
      vi.unstubAllEnvs();
    }
  });

  it("sync SK/WR tidak menulis ulang products.name", async () => {
    const src = await import("node:fs").then((fs) => ({
      sk: fs.readFileSync("src/lib/sekalipay/sync.ts", "utf8"),
      wr: fs.readFileSync("src/lib/warung-rebahan/sync.ts", "utf8"),
    }));
    // Sync SK: tidak ada UPDATE products SET name.
    expect(src.sk).not.toMatch(/UPDATE products SET name/);
    // Sync WR: satu-satunya UPDATE products hanya description.
    const wrNameWrites = [...src.wr.matchAll(/UPDATE products SET ([^\n;]+)/g)].map((m) => m[1]);
    expect(wrNameWrites.every((s) => !/\bname\b/.test(s))).toBe(true);
  });
});
