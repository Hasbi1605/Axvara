-- 0167_axvara_2fa_links.sql — Arahkan shortlink 2FA lama dan seluruh salinan produk/varian
-- yang masih menunjuk situs generator TOTP 2FA pihak ketiga atau /go/otp-2fa* ke 2fa.axvara.tech.
--
-- Keputusan owner 25 November 2026 (Opsi B):
-- 1. Pertahankan slug shortlink `otp-2fa` dan `otp-2fa-auth` (email/pesanan lama tetap hidup),
--    namun alihkan tujuannya ke https://2fa.axvara.tech/.
-- 2. Perbarui copy ID/EN & handover_template pada product_variants (serta deskripsi products bila ada)
--    agar menampilkan langsung `2fa.axvara.tech` (tanpa menyentuh mailbox OTP email atau portal redeem).
-- 3. Idempoten penuh; bump catalog_revision_market agar cache katalog storefront & bot segar.

UPDATE supplier_links
SET destination = 'https://2fa.axvara.tech/',
    title = 'AXVARA 2FA',
    updated_at = datetime('now')
WHERE slug IN ('otp-2fa', 'otp-2fa-auth')
  AND (destination != 'https://2fa.axvara.tech/' OR title != 'AXVARA 2FA');

UPDATE product_variants
SET admin_activation = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          admin_activation,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE admin_activation IS NOT NULL
  AND (
    admin_activation LIKE '%otp-2fa%'
    OR admin_activation LIKE '%2fa.cn%'
    OR admin_activation LIKE '%2fa.live%'
    OR admin_activation LIKE '%2fa-auth.com%'
  );

UPDATE product_variants
SET admin_activation_en = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          admin_activation_en,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE admin_activation_en IS NOT NULL
  AND (
    admin_activation_en LIKE '%otp-2fa%'
    OR admin_activation_en LIKE '%2fa.cn%'
    OR admin_activation_en LIKE '%2fa.live%'
    OR admin_activation_en LIKE '%2fa-auth.com%'
  );

UPDATE product_variants
SET admin_terms = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          admin_terms,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE admin_terms IS NOT NULL
  AND (
    admin_terms LIKE '%otp-2fa%'
    OR admin_terms LIKE '%2fa.cn%'
    OR admin_terms LIKE '%2fa.live%'
    OR admin_terms LIKE '%2fa-auth.com%'
  );

UPDATE product_variants
SET admin_terms_en = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          admin_terms_en,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE admin_terms_en IS NOT NULL
  AND (
    admin_terms_en LIKE '%otp-2fa%'
    OR admin_terms_en LIKE '%2fa.cn%'
    OR admin_terms_en LIKE '%2fa.live%'
    OR admin_terms_en LIKE '%2fa-auth.com%'
  );

UPDATE product_variants
SET handover_template = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          handover_template,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE handover_template IS NOT NULL
  AND (
    handover_template LIKE '%otp-2fa%'
    OR handover_template LIKE '%2fa.cn%'
    OR handover_template LIKE '%2fa.live%'
    OR handover_template LIKE '%2fa-auth.com%'
  );

UPDATE products
SET description = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          description,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE description IS NOT NULL
  AND (
    description LIKE '%otp-2fa%'
    OR description LIKE '%2fa.cn%'
    OR description LIKE '%2fa.live%'
    OR description LIKE '%2fa-auth.com%'
  );

UPDATE products
SET description_en = replace(replace(replace(replace(replace(replace(
      replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(
          description_en,
          'https://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa-auth', '2fa.axvara.tech'),
          'https://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'http://axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
          'axvara.tech/go/otp-2fa', '2fa.axvara.tech'),
        'https://www.2fa.cn/', '2fa.axvara.tech'),
        'https://www.2fa.cn', '2fa.axvara.tech'),
        'https://2fa.cn/', '2fa.axvara.tech'),
        'https://2fa.cn', '2fa.axvara.tech'),
        'http://2fa.cn/', '2fa.axvara.tech'),
        'http://2fa.cn', '2fa.axvara.tech'),
      'https://2fa.live/', '2fa.axvara.tech'),
      'https://2fa.live', '2fa.axvara.tech'),
      'http://2fa.live/', '2fa.axvara.tech'),
      'http://2fa.live', '2fa.axvara.tech'),
      'https://2fa-auth.com/', '2fa.axvara.tech'),
      'https://2fa-auth.com', '2fa.axvara.tech'),
    updated_at = datetime('now')
WHERE description_en IS NOT NULL
  AND (
    description_en LIKE '%otp-2fa%'
    OR description_en LIKE '%2fa.cn%'
    OR description_en LIKE '%2fa.live%'
    OR description_en LIKE '%2fa-auth.com%'
  );

INSERT INTO store_settings (key, value, updated_at)
VALUES ('catalog_revision_market', '0167-axvara-2fa', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = '0167-axvara-2fa',
  updated_at = datetime('now')
WHERE value != '0167-axvara-2fa';
