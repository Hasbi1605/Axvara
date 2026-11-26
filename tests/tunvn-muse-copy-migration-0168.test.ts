import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAdminVariantCopy } from "@/lib/product-copy/format";
import { adminCopyOf, resolveVariantCopy } from "@/lib/product-copy/resolve";
import { tunvnFamilyForSupplierId } from "@/lib/tunvn/families";
import { createD1Fixture } from "./helpers/d1-fixture";

const M0168 = readFileSync("drizzle/migrations/0168_tunvn_muse_copy_and_gmail_label.sql", "utf8");
const MUSE_YOUTUBE_URL = "https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd";

type VariantRow = {
  id: number;
  sku: string;
  label: string;
  is_active: number;
  admin_terms: string | null;
  admin_terms_en: string | null;
  admin_activation: string | null;
  admin_activation_en: string | null;
  admin_copy_fingerprint: string | null;
  updated_at: string;
};

function seedMuseVariants(sql: ReturnType<typeof createD1Fixture>["sql"]) {
  sql.exec(`
    INSERT INTO products (id, category_id, name, slug, description, description_en, price, stock, is_active) VALUES
      (112, 1, 'Muse AI', 'muse-ai-1-miliar-token', 'AI agent otonom dari Meta.', 'Autonomous AI agent by Meta.', 4200, 406, 1),
      (99, 1, 'Produk Lain', 'produk-lain', 'Tetap', 'Keep', 15000, 10, 1);

    INSERT INTO product_variants (
      id, product_id, sku, label, price, stock, is_active,
      buyer_field_key, max_qty, tunvn_source_product_id,
      admin_terms, admin_terms_en, admin_activation, admin_activation_en
    ) VALUES
      (248, 112, 'DEFAULT-MUSE-AI-1-MILIAR-TOKEN', 'Akun 1B Token (tanpa garansi)', 16000, 0, 0,
        NULL, NULL, NULL,
        'Detail paket:\n- Lama', 'Package details:\n- Old 1B', '1. Lama', '1. axvara.tech/go/muse-login-gmail'),
      (279, 112, 'TUNVN-BUFF-1B', 'Buff Token Muse AI per 1B', 1500, 0, 0,
        'muse_invite_code', 30, NULL,
        'Detail paket:\n- Akun Muse AI siap pakai (tertimpa)', 'Package details:\n- Overwritten', '1. Buka https://muse.ai', '1. axvara.tech/go/muse-login-gmail'),
      (7647, 112, 'TUNVN-97', 'Akun 1B Token (tanpa garansi)', 4200, 406, 1,
        NULL, NULL, 97,
        'Detail paket:\n- Akun 1B', 'Package details:\n- 1B NW', '1. Salin\n\nCatatan:\n- Panduan login bergambar: ' || '${MUSE_YOUTUBE_URL}', '1. axvara.tech/go/muse-login-gmail'),
      (7649, 112, 'TUNVN-111', 'Akun 1B Token (garansi 2 hari)', 6200, 81, 1,
        NULL, NULL, 111,
        'Detail paket:\n- Hilang Gmail dan 2FA', 'Package details:\n- No warranty at all', '1. Lama\n\nCatatan:\n- Panduan login video: ' || '${MUSE_YOUTUBE_URL}', '1. axvara.tech/go/muse-login-gmail'),
      (7651, 112, 'TUNVN-114', 'Akun 25–28B Token (tanpa garansi)', 12000, 0, 1,
        NULL, NULL, 114,
        'Detail paket:\n- 25-28B lama', 'Package details:\n- 1 billion tokens', '1. Lama', '1. axvara.tech/go/muse-login-gmail'),
      (7648, 112, 'TUNVN-98', 'Akun 31B Token (tanpa garansi)', 19900, 0, 1,
        NULL, NULL, 98,
        'Detail paket:\n- 31B lama', 'Package details:\n- 1 billion tokens', '1. Lama', '1. axvara.tech/go/muse-login-gmail'),
      (7650, 112, 'TUNVN-112', 'Akun 31B Token (garansi 2 hari)', 20800, 0, 1,
        NULL, NULL, 112,
        'Detail paket:\n- 31B Gmail lama', 'Package details:\n- 1 billion tokens', '1. Lama', '1. axvara.tech/go/muse-login-gmail'),
      (433216, 112, 'TUNVN-120', 'Akun 1B Token (tanpa garansi)', 3600, 612, 0,
        NULL, NULL, 120,
        NULL, NULL, NULL, NULL),
      (9001, 99, 'SK-1', 'Zoom 1 Bulan', 15000, 10, 1,
        NULL, NULL, NULL,
        'Detail paket:\n- Tetap aman', 'Package details:\n- Safe', '1. Tetap', '1. Keep');

    INSERT INTO store_settings (key, value) VALUES ('catalog_revision_market', 'old-rev');
  `);
}

describe("0168_tunvn_muse_copy_and_gmail_label.sql", () => {
  it("memperjelas label 1B/31B Gmail, menyelaraskan S&K ID+EN, menjaga URL YouTube, memulihkan Buff, dan idempoten", () => {
    const { sql, close } = createD1Fixture();
    try {
      seedMuseVariants(sql);

      sql.exec(M0168);

      expect(
        sql.prepare("SELECT destination, is_active FROM supplier_links WHERE slug='otp-haiproxy'").get(),
      ).toEqual({
        destination: "https://otp.haiproxy.top/",
        is_active: 1,
      });

      const bySku = (sku: string) =>
        sql
          .prepare(
            "SELECT id, sku, label, is_active, admin_terms, admin_terms_en, admin_activation, admin_activation_en, admin_copy_fingerprint, updated_at FROM product_variants WHERE sku = ?",
          )
          .get(sku) as VariantRow;

      // 1B & 31B Gmail: label + S&K Gmail | Password | Kode 2FA + 2fa.axvara.tech + garansi 2 hari
      const v111 = bySku("TUNVN-111");
      expect(v111.label).toBe("Akun 1B Token · Gmail (garansi 2 hari)");
      expect(v111.is_active).toBe(1);
      expect(v111.admin_terms).toContain("Gmail");
      expect(v111.admin_terms).toContain("Email | Password | Kode 2FA");
      expect(v111.admin_terms).toContain("Garansi 2 hari");
      expect(v111.admin_terms_en).toContain("1 billion tokens");
      expect(v111.admin_terms_en).toContain("Email | Password | 2FA Code");
      expect(v111.admin_terms_en).toContain("2-day warranty");
      expect(v111.admin_activation).toContain("2fa.axvara.tech");
      expect(v111.admin_activation_en).toContain("2fa.axvara.tech");

      const v112 = bySku("TUNVN-112");
      expect(v112.label).toBe("Akun 31B Token · Gmail (garansi 2 hari)");
      expect(v112.admin_terms).toContain("31 miliar token (31B)");
      expect(v112.admin_terms).toContain("Email | Password | Kode 2FA");
      expect(v112.admin_terms_en).toContain("31 billion tokens (31B)");
      expect(v112.admin_terms_en).toContain("Email | Password | 2FA Code");

      // NW mailbox variants: TUNVN-98 (31B) & TUNVN-120 (1B, tetap nonaktif)
      const v98 = bySku("TUNVN-98");
      expect(v98.label).toBe("Akun 31B Token (tanpa garansi)");
      expect(v98.admin_terms).toContain("31 miliar token (31B)");
      expect(v98.admin_terms).toContain("Email | Link baca mailbox");
      expect(v98.admin_terms_en).toContain("31 billion tokens (31B)");
      expect(v98.admin_terms_en).toContain("Email | Mailbox link");
      expect(v98.admin_activation).toContain("axvara.tech/go/otp-haiproxy");
      expect(v98.admin_activation_en).toContain("axvara.tech/go/otp-haiproxy");

      const v120 = bySku("TUNVN-120");
      expect(v120.is_active).toBe(0);
      expect(v120.label).toBe("Akun 1B Token (tanpa garansi)");
      expect(v120.admin_terms).toContain("1 miliar token (1B)");
      expect(v120.admin_terms).toContain("Email | Link baca mailbox");
      expect(v120.admin_terms_en).toContain("1 billion tokens (1B)");
      expect(v120.admin_activation).toContain("axvara.tech/go/otp-haiproxy");

      // 25-28B & 1B Password (TUNVN-97)
      const v114 = bySku("TUNVN-114");
      expect(v114.admin_terms).toContain("25 sampai 28 miliar token");
      expect(v114.admin_terms_en).toContain("25 to 28 billion tokens");
      const v97 = bySku("TUNVN-97");
      expect(v97.label).toBe("Akun 1B Token (tanpa garansi)");
      expect(v97.admin_terms).toContain("Email | Password (non-Gmail)");
      expect(v97.admin_terms_en).toContain("Email | Password (non-Gmail)");

      // Semua 7 varian akun mempertahankan link YT persis dan bebas link lama/pihak ketiga mentah
      for (const sku of [
        "DEFAULT-MUSE-AI-1-MILIAR-TOKEN",
        "TUNVN-97",
        "TUNVN-98",
        "TUNVN-111",
        "TUNVN-112",
        "TUNVN-114",
        "TUNVN-120",
      ]) {
        const row = bySku(sku);
        expect(row.admin_activation).toContain(MUSE_YOUTUBE_URL);
        expect(row.admin_activation_en).toContain(MUSE_YOUTUBE_URL);
        const allText = `${row.admin_terms}\n${row.admin_terms_en}\n${row.admin_activation}\n${row.admin_activation_en}`;
        expect(allText).not.toContain("muse-login-gmail");
        expect(allText).not.toContain("2fa.live");
        expect(allText).not.toContain("otp.haiproxy.top");

        const parsedId = parseAdminVariantCopy(row.admin_terms, row.admin_activation);
        const parsedEn = parseAdminVariantCopy(row.admin_terms_en, row.admin_activation_en);
        expect(parsedId?.sections.map((s) => s.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
        expect(parsedEn?.sections.map((s) => s.kind)).toEqual(["paket", "proses", "aturan", "garansi"]);
        expect(parsedId?.notes.some((n) => n.includes(MUSE_YOUTUBE_URL))).toBe(true);
        expect(parsedEn?.notes.some((n) => n.includes(MUSE_YOUTUBE_URL))).toBe(true);

        const resolvedId = resolveVariantCopy(null, null, adminCopyOf(row), "id");
        const resolvedEn = resolveVariantCopy(null, null, adminCopyOf(row), "en");
        expect(resolvedId?.source).toBe("admin");
        expect(resolvedEn?.source).toBe("admin");
      }

      // Buff dipulihkan ke salinan Invite Code 6 karakter tanpa URL YouTube akun
      const buff = bySku("TUNVN-BUFF-1B");
      expect(buff.is_active).toBe(0);
      expect(buff.admin_terms).toContain("Invite Code Muse AI");
      expect(buff.admin_terms_en).toContain("Muse AI Invite Code");
      expect(buff.admin_activation).toContain("6 karakter");
      expect(buff.admin_activation_en).toContain("6-character Invite Code");
      expect(buff.admin_activation).not.toContain("youtu.be");
      expect(parseAdminVariantCopy(buff.admin_terms, buff.admin_activation)?.activation).toHaveLength(2);
      expect(parseAdminVariantCopy(buff.admin_terms_en, buff.admin_activation_en)?.activation).toHaveLength(2);

      // Varian non-Muse tetap utuh & revisi katalog dibump
      expect(bySku("SK-1").admin_terms).toBe("Detail paket:\n- Tetap aman");
      expect(
        sql.prepare("SELECT value FROM store_settings WHERE key='catalog_revision_market'").get(),
      ).toEqual({ value: "0168-muse-variant-copy" });

      // Idempoten: eksekusi ulang tidak menulis perubahan baru
      sql.exec("UPDATE product_variants SET updated_at = '2026-01-01 00:00:00';");
      sql.exec("UPDATE store_settings SET updated_at = '2026-01-01 00:00:00' WHERE key='catalog_revision_market';");
      sql.exec(M0168);
      const updatedDates = sql
        .prepare("SELECT DISTINCT updated_at FROM product_variants")
        .all() as Array<{ updated_at: string }>;
      expect(updatedDates).toEqual([{ updated_at: "2026-01-01 00:00:00" }]);
      expect(
        sql.prepare("SELECT updated_at FROM store_settings WHERE key='catalog_revision_market'").get(),
      ).toEqual({ updated_at: "2026-01-01 00:00:00" });
    } finally {
      close();
    }
  });

  it("label 1B/31B Gmail pada src/lib/tunvn/families.ts selaras dengan migrasi 0168", () => {
    expect(tunvnFamilyForSupplierId(111)?.member.label).toBe("Akun 1B Token · Gmail (garansi 2 hari)");
    expect(tunvnFamilyForSupplierId(112)?.member.label).toBe("Akun 31B Token · Gmail (garansi 2 hari)");
    expect(tunvnFamilyForSupplierId(97)?.member.label).toBe("Akun 1B Token (tanpa garansi)");
    expect(tunvnFamilyForSupplierId(120)?.member.label).toBe("Akun 1B Token (tanpa garansi)");
  });
});
