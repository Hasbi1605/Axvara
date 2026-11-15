-- 0125_aivault_chatgpt_plus_family.sql — AIVault: family eksplisit ChatGPT Plus.
--
-- Upstream menambah `service_chatgpt_plus_1m` ("ChatGPT Plus 1 Month (Apple
-- Pay)") SETELAH peta statis families.ts, sehingga publisher fallback membuat
-- produk produksi id174 dengan slug hex-encoded penuh (URL pembeli jelek),
-- tanpa gambar, nonaktif, tanpa order. Revisi ini memindahkan HANYA baris
-- fallback yang tepat itu ke family eksplisit `chatgpt-plus`.
--
-- Guard: hanya baris dengan aivault_family lama, nonaktif, dan belum ada
-- produk slug `chatgpt-plus-av` (atau family baru) yang disentuh. Idempoten:
-- re-run tidak menemukan baris lama lagi. Tidak ada kolom/DDL baru.

UPDATE products SET
  aivault_family = 'chatgpt-plus',
  slug = 'chatgpt-plus-av',
  name = 'ChatGPT Plus',
  -- Deskripsi hanya diganti bila masih auto-default untuk nama lama.
  description = CASE WHEN description = 'ChatGPT Plus 1 Month (Apple Pay). Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'
    THEN 'ChatGPT Plus. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'
    ELSE description END,
  image_url = COALESCE(NULLIF(trim(image_url),''),'/r2/products/f87f491ee2f9034845db18eb08c9236d.webp'),
  -- products.images disimpan sebagai JSON array string (pola schema default '[]').
  images = CASE WHEN images IS NULL OR images IN ('','[]') THEN '["/r2/products/f87f491ee2f9034845db18eb08c9236d.webp"]' ELSE images END,
  updated_at = datetime('now')
WHERE aivault_family = 'service:service_chatgpt_plus_1m'
  AND is_active = 0
  AND NOT EXISTS(SELECT 1 FROM products WHERE slug = 'chatgpt-plus-av')
  AND NOT EXISTS(SELECT 1 FROM products WHERE aivault_family = 'chatgpt-plus');

UPDATE product_variants SET label = 'Plus 1 Bulan (Apple Pay)'
WHERE aivault_service_id = 'service_chatgpt_plus_1m' AND is_active = 0;
