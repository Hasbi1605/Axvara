import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { PIXELVERIF_COPY } from "@/lib/pixelverif/copy";
import { PIXELVERIF_FAMILY } from "@/lib/pixelverif/families";
import { pixelverifBuyerErrorMessage } from "@/lib/pixelverif/copy";
import { PIXELVERIF_BLOCKED_EMAIL_MESSAGE } from "@/lib/pixelverif/blocklist";
import { createD1Fixture } from "./helpers/d1-fixture";

const copy = PIXELVERIF_COPY.google_ai_pro_3m;
const buyerTexts = (): string[] => [
  copy.description, copy.description_en ?? "", copy.name_en,
  ...Object.values(copy.variants).flatMap((v) => [v.admin_terms, v.admin_terms_en ?? "", v.admin_activation, v.admin_activation_en ?? ""]),
  PIXELVERIF_BLOCKED_EMAIL_MESSAGE,
  ...["WRONG_PASSWORD", "WRONG_2FA_CODE", "WRONG_EMAIL", "2FA_WARNING", "PAYMENT_WARNING", "CAPTCHA_DETECTED", "ACTIVATION_ITEM_NOT_AVAILABLE", "ACTIVATION_FAILED"]
    .map((code) => pixelverifBuyerErrorMessage(code) ?? ""),
];
const MIGRATION = fs.readFileSync("drizzle/migrations/0157_pixelverif_whitelabel_copy.sql", "utf8");
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

it("ships Indonesian and English description, terms and activation with the full-refund policy and both variants explained", () => {
  expect(PIXELVERIF_FAMILY.description).toBe(copy.description);
  expect(PIXELVERIF_FAMILY.description_en).toBe(copy.description_en);
  expect(copy.description).toMatch(/bot/);
  expect(copy.description).toMatch(/Link Redeem: cocok bila kamu ingin menukarkan sendiri/);
  expect(copy.description).toMatch(/Aktivasi Langsung: cocok bila ingin beres tanpa langkah tambahan/);
  expect(copy.description_en).toMatch(/Redeem Link: [\s\S]*Direct Activation: /);
  for (const v of Object.values(copy.variants)) {
    expect(v.admin_terms).toMatch(/dikembalikan penuh/);
    expect(v.admin_terms).toMatch(/kunci setup 2FA/);
    expect(v.admin_terms_en).toMatch(/refunded in full/);
    expect(v.admin_activation_en).toMatch(/^1\. /);
  }
  expect(pixelverifBuyerErrorMessage("WRONG_PASSWORD")).toMatch(/dikembalikan penuh/);
});

it("migration 0157 replaces only the old built-in Pixel copy and never an admin edit", () => {
  fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,pixelverif_family,description)
      VALUES(1,'Google AI Pro 3 Bulan','google-ai-pro-3-bulan',21500,2,0,1,'google_ai_pro_3m','Google AI Pro 3 bulan via Pixel Verification. Dua pilihan: lama');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,max_qty,admin_terms,admin_activation)
      VALUES(1,1,'PV-NORMAL-3','Link Redeem 3 Bulan',21500,2,0,'normal',3,1,1,'Syarat: akun aktif tanpa captcha/unusual activity; lama','1. Login ke Gmail yang didaftarkan.\nlama'),
            (2,1,'PV-FULL-3','Aktivasi Langsung 3 Bulan',32000,2,0,'full',3,1.5,1,'S&K khusus admin','Langkah khusus admin');`);
  fx.sql.exec(MIGRATION);
  fx.sql.exec(MIGRATION); // idempotent
  const p = fx.sql.prepare("SELECT description,description_en,name_en FROM products WHERE id=1").get() as Record<string, unknown>;
  expect(p).toEqual({ description: copy.description, description_en: copy.description_en, name_en: copy.name_en });
  const normal = fx.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE id=1").get() as Record<string, unknown>;
  expect(normal).toEqual({
    admin_terms: copy.variants["PV-NORMAL-3"].admin_terms, admin_terms_en: copy.variants["PV-NORMAL-3"].admin_terms_en,
    admin_activation: copy.variants["PV-NORMAL-3"].admin_activation, admin_activation_en: copy.variants["PV-NORMAL-3"].admin_activation_en,
  });
  const full = fx.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation FROM product_variants WHERE id=2").get() as Record<string, unknown>;
  expect(full).toEqual({ admin_terms: "S&K khusus admin", admin_terms_en: copy.variants["PV-FULL-3"].admin_terms_en, admin_activation: "Langkah khusus admin" });
});

it("migration 0157 is generated from copy.ts (no drift)", () => {
  expect(MIGRATION).toContain(copy.description.replace(/'/g, "''"));
  expect(MIGRATION).toContain((copy.variants["PV-FULL-3"].admin_terms_en ?? "").replace(/'/g, "''"));
});
