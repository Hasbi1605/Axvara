// Migrasi 0127: deskripsi produk + S&K/cara aktivasi varian TUNVN & AIVault ID/EN
// dan shortlink axvara.tech/go/* pengganti situs pihak ketiga.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { parseAdminVariantCopy } from "@/lib/product-copy/format";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";
import { TUNVN_FAMILIES, tunvnDefaultDescription } from "@/lib/tunvn/families";
import { aivaultDefaultDescription } from "@/lib/aivault/families";

const M = fs.readFileSync("drizzle/migrations/0127_supplier_copy_id_en.sql", "utf8");
let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  fx.sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, tunvn_family)
      VALUES (50, 2, 'CapCut Pro', 'capcut-pro-tunvn', '${tunvnDefaultDescription("CapCut Pro")}', 1000, 0, 0, 'capcut'),
             (51, 2, 'Nord VPN', 'nord-vpn-tunvn', 'Deskripsi suntingan admin.', 1000, 0, 0, 'nord'),
             (52, 2, 'Muse AI 1 Miliar Token', 'muse-ai-1-miliar-token', 'Deskripsi owner Muse.', 1000, 0, 1, 'muse');
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, admin_terms)
      VALUES (500, 50, 'TUNVN-37', 'Team 1 Bulan', 1000, -1, 0, NULL),
             (501, 51, 'TUNVN-105', 'Kupon 3 Bulan', 1000, -1, 0, 'S&K admin lama'),
             (502, 52, 'TUNVN-111', 'Akun 1B Token (garansi 2 hari)', 1000, -1, 0, NULL);
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, tunvn_family)
      VALUES (53, 2, 'Google AI / Gemini', 'gemini-tunvn', '${tunvnDefaultDescription("Google AI / Gemini")}', 1000, 0, 0, 'gemini');
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active)
      VALUES (503, 53, 'TUNVN-115', 'Gemini Plus 6 Bulan (link redeem)', 1000, -1, 0);
    INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, aivault_family)
      VALUES (60, 2, 'Google AI / Gemini Plus', 'gemini-plus-av', '${aivaultDefaultDescription("Google AI / Gemini Plus")}', 1000, 0, 0, 'gemini'),
             (61, 2, 'Notion Education Plus', 'notion-plus-av', '${aivaultDefaultDescription("Notion Education Plus")}', 1000, 0, 0, 'notion');
    INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, aivault_service_id)
      VALUES (600, 60, 'AV-service_gemini_plus_6m', 'Gemini Plus 6 Bulan', 1000, 0, 0, 'service_gemini_plus_6m'),
             (601, 61, 'AV-service_notion_plus', 'Plus 12 Bulan', 1000, 0, 0, 'service_notion_plus');
  `);
});
afterEach(() => fx.close());

const product = (id: number) => fx.sql.prepare("SELECT description, description_en FROM products WHERE id=?").get(id) as { description: string; description_en: string | null };
const variant = (id: number) => fx.sql.prepare("SELECT admin_terms, admin_activation, admin_terms_en, admin_activation_en FROM product_variants WHERE id=?").get(id) as Record<string, string | null>;

describe("0127 salinan TUNVN ID/EN", () => {
  it("mengganti template saja, tidak menimpa suntingan admin atau produk owner Muse", () => {
    fx.sql.exec(M);
    expect(product(50).description).toContain("CapCut Pro untuk edit video");
    expect(product(50).description_en).toContain("CapCut Pro for video editing");
    expect(product(51).description).toBe("Deskripsi suntingan admin.");
    expect(product(51).description_en).toContain("Nord VPN 3-month coupon");
    expect(product(52).description).toBe("Deskripsi owner Muse.");
    expect(variant(501).admin_terms).toBe("S&K admin lama");
    expect(variant(501).admin_terms_en).toContain("Package details:");
    expect(variant(502).admin_activation).toContain("axvara.tech/go/mail-dongvan");
  });

  it("idempoten: menjalankan ulang tidak menimpa hasil suntingan berikutnya", () => {
    fx.sql.exec(M);
    fx.sql.exec("UPDATE product_variants SET admin_terms='Suntingan baru' WHERE id=500; UPDATE products SET description='Admin ubah' WHERE id=50");
    fx.sql.exec(M);
    expect(variant(500).admin_terms).toBe("Suntingan baru");
    expect(product(50).description).toBe("Admin ubah");
  });

  it("tanpa URL pihak ketiga di salinan pembeli; shortlink baru tersedia", () => {
    fx.sql.exec(M);
    const copy = M.split("INSERT OR IGNORE INTO supplier_links")[1].split(";\n").slice(1).join(";\n");
    for (const host of ["fableaiapi.com", "fviainboxes.com", "dongvanfb.net", "generator.email", "2fa.live", "drive.google.com", "https://"]) expect(copy).not.toContain(host);
    const slugs = (fx.sql.prepare("SELECT slug FROM supplier_links WHERE slug IN ('claude-api','claude-api-docs','mail-fvia','mail-dongvan','muse-login') AND is_active=1").all() as { slug: string }[]).map(r => r.slug).sort();
    expect(slugs).toEqual(["claude-api", "claude-api-docs", "mail-dongvan", "mail-fvia", "muse-login"]);
    // Shortlink yang dirujuk salinan harus ada (lama atau baru).
    const referenced = [...new Set([...copy.matchAll(/axvara\.tech\/go\/([a-z0-9-]+)/g)].map(m => m[1]))];
    const known = new Set((fx.sql.prepare("SELECT slug FROM supplier_links").all() as { slug: string }[]).map(r => r.slug));
    for (const slug of referenced) expect(known.has(slug), slug).toBe(true);
  });

  it("mencakup semua varian TUNVN di peta family", () => {
    const skus = TUNVN_FAMILIES.flatMap(f => f.members.map(m => `TUNVN-${m.supplier_product_id}`));
    for (const sku of skus) expect(M, sku).toContain(`WHERE sku='${sku}'`);
  });

  it("salinan ID dan EN terurai ke bagian yang benar dan tampil sebagai salinan admin", () => {
    fx.sql.exec(M);
    const v = variant(500);
    const id = parseAdminVariantCopy(v.admin_terms, v.admin_activation)!;
    const en = parseAdminVariantCopy(v.admin_terms_en, v.admin_activation_en)!;
    expect(id.sections.map(s => s.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
    expect(en.sections.map(s => s.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
    expect(en.sections.find(s => s.kind === "garansi")!.items[0]).toContain("Full warranty");
    expect(id.activation[0].steps.length).toBe(3);
    const admin = { terms: v.admin_terms, activation: v.admin_activation, fingerprint: null, termsEn: v.admin_terms_en, activationEn: v.admin_activation_en };
    expect(resolveVariantCopy(null, null, admin, "en")?.source).toBe("admin");
    expect(resolveVariantCopy(null, null, admin, "id")?.sections[0].items[0]).toContain("CapCut Pro Team Plan");
  });

  it("Gemini TUNVN meniru produk manual (hold 1 jam); Gemini AIVault manual + aturan 24 jam", () => {
    fx.sql.exec(M);
    const tunvn = variant(503), av = variant(600);
    expect(tunvn.admin_terms).toContain("garansi hold link hanya 1 jam");
    expect(tunvn.admin_activation).toContain("Claim Offer");
    expect(av.admin_terms).toContain("Garansi 24 jam: link mati yang dilaporkan dalam 24 jam");
    expect(av.admin_terms).toContain("dicek bot 100% valid");
    expect(av.admin_terms_en).toContain("without an active Google One conflict");
    expect(av.admin_activation).toBe(tunvn.admin_activation);
    expect(product(53).description).toContain("Gemini Plus 6 bulan");
    expect(product(60).description).toBe(product(53).description);
  });

  it("AIVault: deskripsi dan salinan varian dari materi owner, ChatGPT Plus belum diisi", () => {
    fx.sql.exec(M);
    expect(product(61).description).toContain("Notion Education Plus 12 bulan");
    expect(product(61).description_en).toContain("pre-activated");
    const notion = variant(601);
    expect(notion.admin_activation).toContain("notion.so/login");
    expect(parseAdminVariantCopy(notion.admin_terms_en, notion.admin_activation_en)!.sections.map(s => s.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
    for (const sku of ["AV-service_gemini_plus_6m", "AV-service_notion_plus", "AV-service_udemy_1m", "AV-service_adobe_express_6m", "AV-service_1789191781", "AV-service_1789191878"]) expect(M, sku).toContain(`WHERE sku='${sku}'`);
    expect(M).not.toContain("AV-service_chatgpt_plus_1m");
  });
});
