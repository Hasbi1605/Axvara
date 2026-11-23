import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { PIXELVERIF_COPY, pixelverifBuyerErrorMessage } from "@/lib/pixelverif/copy";
import { PIXELVERIF_FAMILY } from "@/lib/pixelverif/families";
import { PIXELVERIF_BLOCKED_EMAIL_MESSAGE } from "@/lib/pixelverif/blocklist";
import { composeAdminCopy, splitAdminCopy } from "@/lib/product-copy/editor-model";
import { mergeProductCopy, parseAdminVariantCopy, parseProductDescription } from "@/lib/product-copy/format";
import { createD1Fixture } from "./helpers/d1-fixture";

const copy = PIXELVERIF_COPY.google_ai_pro_3m;
const buyerTexts = (): string[] => [
  copy.description, copy.description_en ?? "", copy.name_en,
  ...Object.values(copy.variants).flatMap((v) => [v.admin_terms, v.admin_terms_en ?? "", v.admin_activation, v.admin_activation_en ?? ""]),
  PIXELVERIF_BLOCKED_EMAIL_MESSAGE,
  ...["WRONG_PASSWORD", "WRONG_2FA_CODE", "WRONG_EMAIL", "2FA_WARNING", "PAYMENT_WARNING", "CAPTCHA_DETECTED", "ACTIVATION_ITEM_NOT_AVAILABLE", "ACTIVATION_FAILED"]
    .map((code) => pixelverifBuyerErrorMessage(code) ?? ""),
];
const MIGRATION_0157 = fs.readFileSync("drizzle/migrations/0157_pixelverif_whitelabel_copy.sql", "utf8");
const MIGRATION_0162 = fs.readFileSync("drizzle/migrations/0162_pixelverif_activation_copy.sql", "utf8");
let fx: ReturnType<typeof createD1Fixture> | null = null;
afterEach(() => { fx?.close(); fx = null; });

it("keeps every buyer-facing Pixel text 100% white label (owner decision 23 Nov 2026)", () => {
  for (const text of buyerTexts()) {
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/supplier|pemasok|mitra|pixel ?verif|tanvir|pvsk_/i);
    // The removed after-activation helper (re-add only on owner request); "do not change during processing" is a different rule.
    expect(text).not.toMatch(/segera ganti password|reset 2FA|change your password and reset|after activation.*change/i);
  }
});

it("ships Indonesian and English description, terms and activation with pre-order checklist, video placeholder, and round-trip editor compatibility", () => {
  expect(PIXELVERIF_FAMILY.description).toBe(copy.description);
  expect(PIXELVERIF_FAMILY.description_en).toBe(copy.description_en);
  expect(copy.description).toMatch(/bot/);
  expect(copy.description).toMatch(/Link Redeem: cocok bila kamu ingin menukarkan sendiri/);
  expect(copy.description).toMatch(/Aktivasi Langsung: cocok bila ingin beres tanpa langkah tambahan/);
  expect(copy.description).not.toMatch(/Syarat akun:|Syarat & Ketentuan:/);
  expect(copy.description_en).toMatch(/Redeem Link: [\s\S]*Direct Activation: /);
  expect(copy.description_en).not.toMatch(/Account requirements:/);
  expect(parseProductDescription(copy.description).terms).toEqual([]);

  for (const v of Object.values(copy.variants)) {
    expect(v.admin_terms).toMatch(/dikembalikan penuh/);
    expect(v.admin_terms).toMatch(/kunci setup 2FA/);
    expect(v.admin_terms_en).toMatch(/refunded in full/);
    expect(v.admin_activation).toMatch(/^Persiapan akun sebelum order:\n1\. /);
    expect(v.admin_activation).toContain("https://families.google.com/families");
    expect(v.admin_activation).toContain("Setelah pembayaran:\n1. ");
    expect(v.admin_activation).toContain("Catatan:\n- Tonton video tutorial berikut: yt.....");
    expect(v.admin_activation_en).toMatch(/^Before ordering:\n1\. /);
    expect(v.admin_activation_en).toContain("https://families.google.com/families");
    expect(v.admin_activation_en).toContain("After payment:\n1. ");
    expect(v.admin_activation_en).toContain("Notes:\n- Watch the tutorial video here: yt.....");

    // Round-trip through CopyEditorSheet model must be lossless (no silent dirty/rewrites).
    expect(composeAdminCopy(splitAdminCopy(v.admin_terms, v.admin_activation), "id")).toEqual({
      terms: v.admin_terms,
      activation: v.admin_activation,
    });
    expect(composeAdminCopy(splitAdminCopy(v.admin_terms_en, v.admin_activation_en), "en")).toEqual({
      terms: v.admin_terms_en,
      activation: v.admin_activation_en,
    });

    // Storefront merge keeps all 6 pre-order steps + post-payment steps + video note.
    const mergedId = mergeProductCopy(parseAdminVariantCopy(v.admin_terms, v.admin_activation), parseProductDescription(copy.description));
    expect(mergedId.activation.map((g) => g.title)).toEqual(["Persiapan akun sebelum order", "Setelah pembayaran"]);
    expect(mergedId.activation[0]?.steps).toHaveLength(6);
    expect(mergedId.notes).toEqual(["Tonton video tutorial berikut: yt....."]);

    const mergedEn = mergeProductCopy(parseAdminVariantCopy(v.admin_terms_en, v.admin_activation_en), parseProductDescription(copy.description_en));
    expect(mergedEn.activation.map((g) => g.title)).toEqual(["Before ordering", "After payment"]);
    expect(mergedEn.activation[0]?.steps).toHaveLength(6);
    expect(mergedEn.notes).toEqual(["Watch the tutorial video here: yt....."]);
  }
  expect(pixelverifBuyerErrorMessage("WRONG_PASSWORD")).toMatch(/dikembalikan penuh/);
});

it("historical migration 0157 replaces only the old built-in Pixel copy and never an admin edit", () => {
  fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,pixelverif_family,description)
      VALUES(1,'Google AI Pro 3 Bulan','google-ai-pro-3-bulan',21500,2,0,1,'google_ai_pro_3m','Google AI Pro 3 bulan via Pixel Verification. Dua pilihan: lama');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,max_qty,admin_terms,admin_activation)
      VALUES(1,1,'PV-NORMAL-3','Link Redeem 3 Bulan',21500,2,0,'normal',3,1,1,'Syarat: akun aktif tanpa captcha/unusual activity; lama','1. Login ke Gmail yang didaftarkan.\nlama'),
            (2,1,'PV-FULL-3','Aktivasi Langsung 3 Bulan',32000,2,0,'full',3,1.5,1,'S&K khusus admin','Langkah khusus admin');`);
  fx.sql.exec(MIGRATION_0157);
  fx.sql.exec(MIGRATION_0157); // idempotent
  const p = fx.sql.prepare("SELECT description,description_en,name_en FROM products WHERE id=1").get() as Record<string, string>;
  expect(p.name_en).toBe(copy.name_en);
  expect(p.description).toContain("Langganan Google AI Pro 3 bulan");
  expect(p.description_en).toContain("A 3-month Google AI Pro subscription");
  const normal = fx.sql.prepare("SELECT admin_terms,admin_activation FROM product_variants WHERE id=1").get() as Record<string, string>;
  expect(normal.admin_terms).toContain("Detail paket:");
  expect(normal.admin_activation).toContain("Tunggu link muncul");
  const full = fx.sql.prepare("SELECT admin_terms,admin_activation FROM product_variants WHERE id=2").get() as Record<string, string>;
  expect(full).toEqual({ admin_terms: "S&K khusus admin", admin_activation: "Langkah khusus admin" });
});

it("migration 0162 strips hidden product-wide terms tail while preserving owner edits and updates activation ID+EN idempotently", () => {
  fx = createD1Fixture();
  const ownerDescBody =
    "Langganan Google AI Pro 3 bulan langsung di akun Gmail kamu sendiri.\n" +
    "- Masa aktif 3 bulan\n" +
    "- Gagal diproses = dana dikembalikan";
  const ownerDescWithGhostTail =
    `${ownerDescBody}\n\nSyarat & Ketentuan:\n- Gmail aktif, tidak sedang diminta captcha.\n- Hapus passkey.`;
  const ownerTerms =
    "Detail paket:\n- Custom owner terms\n\nProses & pengiriman:\n- Estimasi 3-5 menit\n\nAturan pakai:\n- Jangan ganti password";
  const ownerDescEn = "Custom English description kept as-is";

  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,pixelverif_family,description,description_en)
      VALUES(51961,'Google AI Pro 3 Bulan (Testing)','google-ai-pro-3-bulan',45000,2,0,1,'google_ai_pro_3m','${ownerDescWithGhostTail.replace(/'/g, "''")}','${ownerDescEn}');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,max_qty,admin_terms,admin_terms_en,admin_activation,admin_activation_en,admin_copy_fingerprint)
      VALUES(754389,51961,'PV-NORMAL-3','Link Redeem 3 Bulan',21500,2,0,'normal',3,1,1,'${ownerTerms.replace(/'/g, "''")}','EN terms kept','1. Lama','1. Old EN',''),
            (754390,51961,'PV-FULL-3','Aktivasi Langsung 3 Bulan',45000,2,1,'full',3,1.5,1,'${ownerTerms.replace(/'/g, "''")}','EN full terms kept','1. Lama full','1. Old full EN',NULL);`);

  fx.sql.exec(MIGRATION_0162);

  const productAfterFirst = fx.sql.prepare("SELECT description,description_en,updated_at FROM products WHERE id=51961").get() as Record<string, string>;
  expect(productAfterFirst.description).toBe(ownerDescBody);
  expect(productAfterFirst.description_en).toBe(ownerDescEn);

  const normalAfter = fx.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en,admin_copy_fingerprint FROM product_variants WHERE id=754389").get() as Record<string, string>;
  expect(normalAfter).toEqual({
    admin_terms: ownerTerms,
    admin_terms_en: "EN terms kept",
    admin_activation: copy.variants["PV-NORMAL-3"].admin_activation,
    admin_activation_en: copy.variants["PV-NORMAL-3"].admin_activation_en,
    admin_copy_fingerprint: "",
  });

  const fullAfter = fx.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en,admin_copy_fingerprint FROM product_variants WHERE id=754390").get() as Record<string, string>;
  expect(fullAfter).toEqual({
    admin_terms: ownerTerms,
    admin_terms_en: "EN full terms kept",
    admin_activation: copy.variants["PV-FULL-3"].admin_activation,
    admin_activation_en: copy.variants["PV-FULL-3"].admin_activation_en,
    admin_copy_fingerprint: "",
  });

  // Also test stripping 0157's raw "\n\nSyarat akun:" tail and verify idempotency on repeat.
  fx.sql.exec("UPDATE products SET updated_at='2026-01-01 00:00:00' WHERE id=51961; UPDATE product_variants SET updated_at='2026-01-01 00:00:00' WHERE product_id=51961;");
  fx.sql.exec(MIGRATION_0162); // second run must be a no-op
  expect((fx.sql.prepare("SELECT updated_at FROM products WHERE id=51961").get() as { updated_at: string }).updated_at).toBe("2026-01-01 00:00:00");
  expect((fx.sql.prepare("SELECT updated_at FROM product_variants WHERE id=754390").get() as { updated_at: string }).updated_at).toBe("2026-01-01 00:00:00");

  fx.sql.exec("UPDATE products SET description='Intro.\n\nSyarat akun:\n- Gmail aktif' WHERE id=51961;");
  fx.sql.exec(MIGRATION_0162);
  expect((fx.sql.prepare("SELECT description FROM products WHERE id=51961").get() as { description: string }).description).toBe("Intro.");
});

it("migration 0162 activation copy stays in sync with copy.ts (no drift)", () => {
  for (const sku of ["PV-NORMAL-3", "PV-FULL-3"] as const) {
    expect(MIGRATION_0162).toContain(copy.variants[sku].admin_activation.replace(/'/g, "''"));
    expect(MIGRATION_0162).toContain((copy.variants[sku].admin_activation_en ?? "").replace(/'/g, "''"));
  }
});
