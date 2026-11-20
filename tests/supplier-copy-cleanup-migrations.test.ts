import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

const M0146 = readFileSync("drizzle/migrations/0146_aivault_duolingo_copy.sql", "utf8");
const M0147 = readFileSync("drizzle/migrations/0147_tunvn_archive_duplicate_118.sql", "utf8");
const AUTO = "Duolingo Super. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.";

it("0146 fills Duolingo AIVault copy only over defaults/empty fields and is idempotent", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,aivault_family,description) VALUES
      (1,'Duolingo Super','duolingo-super-av',0,0,'duolingo','${AUTO}'),
      (2,'Owner','owner-av',0,0,'service:service_duolingo_12m','Admin copy');
      INSERT INTO product_variants(product_id,sku,label,price,is_active,aivault_service_id,admin_terms) VALUES
      (1,'AV-service_duolingo_12m','Super 12 Bulan',0,0,'service_duolingo_12m',NULL),
      (2,'AV-x','x',0,0,NULL,'Admin terms');`);
    sql.exec(M0146); sql.exec(M0146);
    const p = sql.prepare("SELECT id,description,description_en FROM products ORDER BY id").all() as { id: number; description: string; description_en: string | null }[];
    expect(p[0].description).toMatch(/^Link redeem resmi Duolingo Super 12 bulan/);
    expect(p[0].description).toContain("Garansi hold link 5 hari");
    expect(p[0].description_en).toMatch(/^Official 12-month Duolingo Super redeem link/);
    expect(p[1].description).toBe("Admin copy");
    const v = sql.prepare("SELECT admin_terms,admin_terms_en FROM product_variants ORDER BY id").all() as { admin_terms: string; admin_terms_en: string }[];
    expect(v[0].admin_terms).toContain("Garansi hold link 5 hari sejak pembelian");
    expect(v[0].admin_terms_en).toContain("5-day link hold warranty");
    expect(v[1].admin_terms).toBe("Admin terms");
  } finally { close(); }
});

it("0147 archives only the inactive TUNVN #118 duplicate whose mirror is gone", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES
      (51944,'MUSE AI 1B - GMAIL (W2D)','muse-ai-1b-gmail-w2d-tunvn',4700,0,'p118'),
      (112,'Muse AI','muse-ai-1-miliar-token',0,1,NULL);
      INSERT INTO product_variants(product_id,sku,label,price,is_active) VALUES
      (51944,'TUNVN-118','MUSE AI 1B - GMAIL (W2D)',4700,0), (112,'TUNVN-111','Akun 1B Token (garansi 2 hari)',4700,1);
      INSERT INTO tunvn_products(supplier_product_id,name,stock,visible,axvara_product_id) VALUES
      (118,'MUSE AI 1B - GMAIL (W2D)',0,0,51944), (111,'MUSE AI 1B - GMAIL (W2D)',187,1,112);`);
    sql.exec(M0147); sql.exec(M0147);
    expect(sql.prepare("SELECT id,is_active,archived_at IS NOT NULL arch FROM products ORDER BY id").all())
      .toEqual([{ id: 112, is_active: 1, arch: 0 }, { id: 51944, is_active: 0, arch: 1 }]);
    expect(sql.prepare("SELECT sku,is_active FROM product_variants WHERE sku='TUNVN-111'").get()).toEqual({ sku: "TUNVN-111", is_active: 1 });
  } finally { close(); }
});

it("0147 leaves #118 alone if the supplier relists it with stock", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES (51944,'MUSE','muse-ai-1b-gmail-w2d-tunvn',4700,0,'p118');
      INSERT INTO tunvn_products(supplier_product_id,name,stock,visible,axvara_product_id) VALUES (118,'MUSE',5,0,51944);`);
    sql.exec(M0147);
    expect(sql.prepare("SELECT archived_at FROM products WHERE id=51944").get()).toEqual({ archived_at: null });
  } finally { close(); }
});
