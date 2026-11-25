import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

const M0167 = readFileSync("drizzle/migrations/0167_axvara_2fa_links.sql", "utf8");

describe("0167_axvara_2fa_links.sql — konsolidasi semua tautan TOTP 2FA ke 2fa.axvara.tech", () => {
  it("mengalihkan supplier_links otp-2fa* ke https://2fa.axvara.tech/ tanpa menyentuh mailbox OTP", () => {
    const { sql, close } = createD1Fixture();
    try {
      sql.exec(`
        INSERT OR REPLACE INTO supplier_links (slug, destination, title, is_active) VALUES
          ('otp', 'https://netflix-codes.sekalipay.com/mailbox', 'Mailbox OTP Netflix', 1),
          ('otp-bot', 'https://bototp.site/', 'Mailbox OTP BotOTP', 1),
          ('otp-2fa', 'https://2fa.live/', 'Alat kode 2FA (Gemini)', 1),
          ('otp-2fa-auth', 'https://2fa-auth.com/', 'Alat kode 2FA (2fa-auth)', 1);
      `);

      sql.exec(M0167);
      sql.exec(M0167); // idempoten

      expect(sql.prepare("SELECT destination, title FROM supplier_links WHERE slug='otp-2fa'").get()).toEqual({
        destination: "https://2fa.axvara.tech/",
        title: "AXVARA 2FA",
      });
      expect(sql.prepare("SELECT destination, title FROM supplier_links WHERE slug='otp-2fa-auth'").get()).toEqual({
        destination: "https://2fa.axvara.tech/",
        title: "AXVARA 2FA",
      });
      expect(sql.prepare("SELECT destination FROM supplier_links WHERE slug='otp'").get()).toEqual({
        destination: "https://netflix-codes.sekalipay.com/mailbox",
      });
      expect(sql.prepare("SELECT destination FROM supplier_links WHERE slug='otp-bot'").get()).toEqual({
        destination: "https://bototp.site/",
      });
    } finally {
      close();
    }
  });

  it("mengganti semua tautan 2FA luar dan /go/otp-2fa* pada varian & produk tanpa merusak teks lain, serta bump revisi katalog", () => {
    const { sql, close } = createD1Fixture();
    try {
      sql.exec(`
        INSERT INTO products (id, category_id, name, slug, description, description_en, price, stock, is_active) VALUES
          (1, 1, 'ChatGPT Plus', 'chatgpt-plus', 'Buka https://2fa.cn/ untuk kode.', 'Use axvara.tech/go/otp-2fa-auth.', 10000, 5, 1),
          (2, 1, 'Gmail 2FA', 'gmail-aged-sb', 'Format: Gmail | Password | Link 2FA', 'Format: Gmail | Password | 2FA Link', 10000, 0, 0);

        INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, admin_activation, admin_activation_en, admin_terms, admin_terms_en, handover_template) VALUES
          (10, 1, 'SB-60', 'Plus 1 Bulan', 98000, 10, 1,
            '1. Buka https://2fa.cn/, tempel kode.',
            '1. Open axvara.tech/go/otp-2fa-auth and paste key.',
            'Gunakan axvara.tech/go/otp-2fa untuk 2FA.',
            'Use https://2fa.live/ to get OTP.',
            'Kode 2FA dapat dicek di https://2fa-auth.com'),
          (11, 1, 'CHATGPT-PLUS-1-BULAN-1', 'Manual VCC', 99000, 2, 1,
            'Buka https://2fa.cn lalu tempel kunci.',
            'Open https://2fa.cn and paste key.',
            NULL, NULL, NULL),
          (12, 2, 'SK-1', 'Zoom 1 Bulan', 15000, 10, 1,
            'Buka axvara.tech/go/otp-genjos untuk kode email.',
            'Open axvara.tech/go/otp-genjos for email OTP.',
            'Garansi login awal.', 'Initial login warranty.', NULL);
      `);

      sql.exec(M0167);
      sql.exec(M0167); // idempoten

      const v10 = sql
        .prepare("SELECT admin_activation, admin_activation_en, admin_terms, admin_terms_en, handover_template FROM product_variants WHERE id=10")
        .get() as Record<string, string>;
      expect(v10.admin_activation).toBe("1. Buka 2fa.axvara.tech, tempel kode.");
      expect(v10.admin_activation_en).toBe("1. Open 2fa.axvara.tech and paste key.");
      expect(v10.admin_terms).toBe("Gunakan 2fa.axvara.tech untuk 2FA.");
      expect(v10.admin_terms_en).toBe("Use 2fa.axvara.tech to get OTP.");
      expect(v10.handover_template).toBe("Kode 2FA dapat dicek di 2fa.axvara.tech");

      const v11 = sql
        .prepare("SELECT admin_activation, admin_activation_en FROM product_variants WHERE id=11")
        .get() as Record<string, string>;
      expect(v11.admin_activation).toBe("Buka 2fa.axvara.tech lalu tempel kunci.");
      expect(v11.admin_activation_en).toBe("Open 2fa.axvara.tech and paste key.");

      const v12 = sql
        .prepare("SELECT admin_activation, admin_activation_en FROM product_variants WHERE id=12")
        .get() as Record<string, string>;
      expect(v12.admin_activation).toBe("Buka axvara.tech/go/otp-genjos untuk kode email.");
      expect(v12.admin_activation_en).toBe("Open axvara.tech/go/otp-genjos for email OTP.");

      const p1 = sql.prepare("SELECT description, description_en FROM products WHERE id=1").get() as Record<string, string>;
      expect(p1.description).toBe("Buka 2fa.axvara.tech untuk kode.");
      expect(p1.description_en).toBe("Use 2fa.axvara.tech.");

      const p2 = sql.prepare("SELECT description, description_en FROM products WHERE id=2").get() as Record<string, string>;
      expect(p2.description).toBe("Format: Gmail | Password | Link 2FA");
      expect(p2.description_en).toBe("Format: Gmail | Password | 2FA Link");

      const rev = sql.prepare("SELECT value FROM store_settings WHERE key='catalog_revision_market'").get() as { value: string };
      expect(rev.value).toBe("0167-axvara-2fa");
    } finally {
      close();
    }
  });
});
