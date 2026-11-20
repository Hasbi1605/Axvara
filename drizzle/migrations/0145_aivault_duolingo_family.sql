-- 0145_aivault_duolingo_family.sql — AIVault: family eksplisit Duolingo Super.
--
-- Upstream menambah `service_duolingo_12m` ("Duolingo Super 12M") SETELAH peta
-- statis families.ts, sehingga publisher fallback membuat produk produksi
-- id51946 (`duolingo-super-12m-64cf01f1-av`) tanpa gambar, nonaktif. Revisi ini
-- memindahkan HANYA baris fallback yang tepat itu ke family `duolingo` dan
-- memakai gambar R2 produk Duolingo existing (`duolingo-sk`/`duolingo-sb`).
--
-- Guard sama dengan 0125: hanya baris family lama yang nonaktif, dan belum ada
-- produk slug `duolingo-super-av`/family `duolingo`. Idempoten; tanpa DDL.

UPDATE products SET
  aivault_family = 'duolingo',
  slug = 'duolingo-super-av',
  name = 'Duolingo Super',
  description = CASE WHEN description = 'Duolingo Super 12M. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'
    THEN 'Duolingo Super. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'
    ELSE description END,
  image_url = COALESCE(NULLIF(trim(image_url),''),'/r2/products/2de7b838e34432f6ec7a8129c1a4d210.webp'),
  images = CASE WHEN images IS NULL OR images IN ('','[]') THEN '["/r2/products/2de7b838e34432f6ec7a8129c1a4d210.webp"]' ELSE images END,
  updated_at = datetime('now')
WHERE aivault_family = 'service:service_duolingo_12m'
  AND is_active = 0
  AND NOT EXISTS(SELECT 1 FROM products WHERE slug = 'duolingo-super-av')
  AND NOT EXISTS(SELECT 1 FROM products WHERE aivault_family = 'duolingo');

UPDATE product_variants SET label = 'Super 12 Bulan'
WHERE aivault_service_id = 'service_duolingo_12m' AND is_active = 0 AND label = 'Duolingo Super 12M';
