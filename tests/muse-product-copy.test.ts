import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { parseProductDescription } from "@/lib/product-copy/format";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";

const originalPatch = fs.readFileSync("issue/muse-ai-copy-2026-10-21.sql", "utf8");
const patch = fs.readFileSync("issue/muse-ai-copy-compact-2026-10-21.sql", "utf8");

function seed() {
  const fixture = createD1Fixture();
  fixture.sql.exec(`
    INSERT INTO products (id, name, slug, source, description, price, image_url)
    VALUES (112, 'Muse AI 1 Miliar Token', 'muse-ai-1-miliar-token', 'manual', '', 16000, '/r2/muse.webp');
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, warranty_type, admin_terms, admin_copy_fingerprint)
    VALUES (248, 112, 'DEFAULT-MUSE-AI-1-MILIAR-TOKEN', 'Default', 16000, 10, 'none', 'Testinggg', '');
  `);
  fixture.sql.exec(originalPatch);
  fixture.sql.exec("UPDATE products SET updated_at='2026-10-21 07:45:29' WHERE id=112; UPDATE product_variants SET updated_at='2026-10-21 07:45:29' WHERE id=248;");
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
      expect(copy.sections.map((section) => section.kind)).toEqual(["paket", "aturan", "garansi"]);
      expect(copy.sections.find((section) => section.kind === "paket")!.items.join(" ")).toContain("Akun Free dengan 1 miliar token tambahan, bukan unlimited");
      expect(copy.sections.find((section) => section.kind === "garansi")!.items.join(" ")).toContain("Tanpa garansi");
      expect(copy.sections.flatMap((section) => section.items)).toHaveLength(5);
      expect(copy.activation.map((group) => group.steps.length)).toEqual([4]);
      expect(copy.activation[0].steps.join(" ")).toContain("verifikasi email baru sebelum keluar");
      expect(copy.notes).toEqual([]);
      expect(String(product.description).length).toBeLessThan(650);
      expect(String(variant.admin_terms).length).toBeLessThan(500);
      expect(String(variant.admin_activation).length).toBeLessThan(450);
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
      const beforeProduct = fixture.sql.prepare("SELECT description FROM products WHERE id=112").get();
      const beforeVariant = fixture.sql.prepare("SELECT admin_terms FROM product_variants WHERE id=248").get();
      fixture.sql.exec("UPDATE products SET source='warung_rebahan', slug='produk-lain' WHERE id=112;");
      fixture.sql.exec(patch);
      expect(fixture.sql.prepare("SELECT description FROM products WHERE id=112").get()).toEqual(beforeProduct);
      expect(fixture.sql.prepare("SELECT admin_terms FROM product_variants WHERE id=248").get()).toEqual(beforeVariant);
    } finally { fixture.close(); }
  });
});


const metaPatch = fs.readFileSync("issue/muse-ai-meta-copy-2026-10-23.sql", "utf8");
const ownerDescription = `Muse AI adalah agent autonomus yang dapat berjalan 24 jam dan memiliki mesin virtual sendiri, dapat digunakan untuk membantu coding, riset, analisis, pembuatan konten, dan scheduling. Muse juga multimodal model yang dapat membaca teks, gambar, video, hingga audio. Dapat juga digunakan untuk generate gambar dan generate video.

Kelebihannya:
- VPS bawaan: 2 vCPU, RAM ±7,7 GB, storage 100 GB
- Tugas latar belakang 24 jam tanpa menyewa VPS tambahan
- Browser bawaan dan kendali / chat langsung melalui WhatsApp
- Konektor ke Google Workspace, GitHub, Canva, instagram, threads, dan layanan lainnya
- Akun siap pakai tanpa kartu kredit, tanpa VPN`;

function seedOwnerCopy() {
  const fixture = seed();
  fixture.sql.prepare("UPDATE products SET description=?, updated_at='2026-10-23 04:38:56' WHERE id=112").run(ownerDescription);
  return fixture;
}

describe("revisi Muse dari Meta", () => {
  it("menambah konteks ekosistem dan manfaat konten tanpa mengubah informasi atau varian owner", () => {
    const fixture = seedOwnerCopy();
    try {
      const beforeProduct = fixture.sql.prepare("SELECT * FROM products WHERE id=112").get()!;
      const beforeVariant = fixture.sql.prepare("SELECT * FROM product_variants WHERE id=248").get();
      fixture.sql.exec(metaPatch);
      const product = fixture.sql.prepare("SELECT * FROM products WHERE id=112").get()!;
      const description = String(product.description);
      expect(description).toContain("AI agent otonom dari Meta");
      expect(description).toContain("WhatsApp, Instagram, Threads, dan Facebook");
      expect(description).toContain("caption dan materi promosi");
      expect(description).toContain("kalender konten");
      expect(description).toContain(ownerDescription.slice(ownerDescription.indexOf("24 jam")));
      expect(parseProductDescription(description).sections).toEqual(parseProductDescription(ownerDescription).sections);
      expect(parseProductDescription(description).sections[0].items).toHaveLength(5);
      const { description: _oldCopy, updated_at: _oldTimestamp, ...beforeFields } = beforeProduct;
      const { description: _newCopy, updated_at: _newTimestamp, ...afterFields } = product;
      expect(afterFields).toEqual(beforeFields);
      expect(fixture.sql.prepare("SELECT * FROM product_variants WHERE id=248").get()).toEqual(beforeVariant);
      fixture.sql.exec(metaPatch);
      expect(fixture.sql.prepare("SELECT * FROM products WHERE id=112").get()).toEqual(product);
    } finally { fixture.close(); }
  });

  it.each([
    "description='Suntingan owner terbaru'",
    "updated_at='2026-10-23 05:00:00'",
    "admin_description_override='Override owner'",
    "source='warung_rebahan'",
    "slug='produk-lain'",
  ])("melewati data yang berubah: %s", (change) => {
    const fixture = seedOwnerCopy();
    try {
      fixture.sql.exec(`UPDATE products SET ${change} WHERE id=112`);
      const before = fixture.sql.prepare("SELECT * FROM products WHERE id=112").get();
      fixture.sql.exec(metaPatch);
      expect(fixture.sql.prepare("SELECT * FROM products WHERE id=112").get()).toEqual(before);
    } finally { fixture.close(); }
  });
});
