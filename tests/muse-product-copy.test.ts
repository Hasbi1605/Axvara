import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { parseProductDescription } from "@/lib/product-copy/format";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";

const patch = fs.readFileSync("issue/muse-ai-copy-2026-10-21.sql", "utf8");

function seed() {
  const fixture = createD1Fixture();
  fixture.sql.exec(`
    INSERT INTO products (id, name, slug, source, description, price, image_url)
    VALUES (112, 'Muse AI 1 Miliar Token', 'muse-ai-1-miliar-token', 'manual', '', 16000, '/r2/muse.webp');
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, warranty_type, admin_terms, admin_copy_fingerprint)
    VALUES (248, 112, 'DEFAULT-MUSE-AI-1-MILIAR-TOKEN', 'Default', 16000, 10, 'none', 'Testinggg', '');
  `);
  return fixture;
}

describe("salinan Muse AI", () => {
  it("menampilkan deskripsi, S&K, dan panduan lewat parser storefront yang sama", () => {
    const fixture = seed();
    try {
      fixture.sql.exec(patch);
      const product = fixture.sql.prepare("SELECT * FROM products WHERE id=112").get()!;
      const variant = fixture.sql.prepare("SELECT * FROM product_variants WHERE id=248").get()!;
      const description = parseProductDescription(String(product.description));
      expect(description.blocks[0].type).toBe("p");
      expect(description.blocks.some((block) => block.type === "list")).toBe(true);
      expect(description.terms).toEqual([]);
      expect(description.activation).toEqual([]);
      const copy = resolveVariantCopy(null, null, {
        terms: String(variant.admin_terms), activation: String(variant.admin_activation), fingerprint: String(variant.admin_copy_fingerprint),
      })!;
      expect(copy.source).toBe("admin");
      expect(copy.sections.map((section) => section.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
      expect(copy.sections.find((section) => section.kind === "paket")!.items.join(" ")).toContain("paket dasar dapat tetap tertulis Free plan");
      expect(copy.sections.find((section) => section.kind === "garansi")!.items.join(" ")).toContain("tanpa garansi");
      expect(copy.activation.map((group) => group.steps.length)).toEqual([7, 6]);
      expect(copy.activation[0].steps.join(" ")).toContain("email baru sudah terverifikasi sebelum keluar");
      expect(copy.notes).toHaveLength(1);
      expect(variant).toMatchObject({ price: 16000, stock: 10, warranty_type: "none" });
      expect(product.image_url).toBe("/r2/muse.webp");
    } finally { fixture.close(); }
  });

  it("tidak menimpa suntingan admin ketika patch dijalankan ulang", () => {
    const fixture = seed();
    try {
      fixture.sql.exec(patch);
      fixture.sql.exec("UPDATE products SET description='Deskripsi owner' WHERE id=112; UPDATE product_variants SET admin_terms='Ketentuan owner', admin_activation='Panduan owner' WHERE id=248;");
      fixture.sql.exec(patch);
      expect(fixture.sql.prepare("SELECT description FROM products WHERE id=112").get()).toEqual({ description: "Deskripsi owner" });
      expect(fixture.sql.prepare("SELECT admin_terms, admin_activation FROM product_variants WHERE id=248").get()).toEqual({ admin_terms: "Ketentuan owner", admin_activation: "Panduan owner" });
    } finally { fixture.close(); }
  });

  it("mengabaikan ID yang sudah menjadi produk supplier atau slug berbeda", () => {
    const fixture = seed();
    try {
      fixture.sql.exec("UPDATE products SET source='warung_rebahan', slug='produk-lain' WHERE id=112;");
      fixture.sql.exec(patch);
      expect(fixture.sql.prepare("SELECT description FROM products WHERE id=112").get()).toEqual({ description: "" });
      expect(fixture.sql.prepare("SELECT admin_terms FROM product_variants WHERE id=248").get()).toEqual({ admin_terms: "Testinggg" });
    } finally { fixture.close(); }
  });
});
