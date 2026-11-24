-- 0165_variant_custom_buyer_field.sql
-- Kolom input pembeli generik pada product_variants tanpa menyentuh CHECK
-- legacy `buyer_field_key` (khusus `muse_invite_code` di migrasi 0115).
-- Mendukung preset bawaan (`invite_email`) maupun mode `custom` dengan
-- definisi kolom yang dapat diatur langsung di Panel Admin
-- (`custom_buyer_fields_json`, maks 6 field, JSON tervalidasi).
-- Otomatis mengaktifkan preset `invite_email` pada varian manual
-- `Google AI Pro Invite - 12 Bulan` (`GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M`).

ALTER TABLE product_variants ADD COLUMN custom_buyer_field TEXT CHECK (
  custom_buyer_field IS NULL
  OR (length(custom_buyer_field) BETWEEN 1 AND 64 AND custom_buyer_field NOT GLOB '*[^a-z0-9_]*')
);

ALTER TABLE product_variants ADD COLUMN custom_buyer_fields_json TEXT CHECK (
  custom_buyer_fields_json IS NULL
  OR (length(custom_buyer_fields_json) <= 4096 AND json_valid(custom_buyer_fields_json))
);

UPDATE product_variants
SET custom_buyer_field = 'invite_email',
    updated_at = datetime('now')
WHERE sku = 'GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M'
  AND custom_buyer_field IS NULL;
