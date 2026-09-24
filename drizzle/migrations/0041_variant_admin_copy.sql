-- 0041_variant_admin_copy.sql — S&K + cara aktivasi yang bisa disunting admin per varian.
--
-- Permintaan owner (2026-09-24): S&K dan cara aktivasi bisa diedit manual
-- dari panel admin, termasuk untuk produk WR yang teksnya milik sync.
--
-- Kepemilikan: ketiga kolom milik ADMIN. Sync WR tidak pernah menulisnya
-- (UPDATE/INSERT varian di sync.ts hanya menyentuh kolom miliknya), dan
-- PUT /api/products/:id juga tidak — penulis satu-satunya adalah
-- PUT /api/admin/variant-copy (tombol simpan S&K per varian).
--
-- admin_copy_fingerprint = supplierFingerprint(wr_terms, wr_delivery_terms)
-- saat admin menyimpan ('' untuk varian non-WR). Bila WR kemudian mengubah
-- teksnya, sidik jari tidak cocok lagi: storefront kembali ke teks WR
-- terbaru (aturan baru pemasok tidak tertutup suntingan lama) dan panel
-- admin menandai varian itu "perlu ditinjau" sampai admin menyimpan ulang.
--
-- Tanpa perubahan data: kolom baru NULL = tanpa suntingan (perilaku lama).

ALTER TABLE product_variants ADD COLUMN admin_terms TEXT;
ALTER TABLE product_variants ADD COLUMN admin_activation TEXT;
ALTER TABLE product_variants ADD COLUMN admin_copy_fingerprint TEXT;
