-- 0105_product_name_variant_copy_en.sql — nama produk & S&K admin versi Inggris.
--
-- Semua kolom admin-owned: sync WR/SK tidak menulisnya dan tidak ada di
-- WR_OWNED_PRODUCT_FIELDS. NULL/kosong = fallback ke teks Indonesia.
-- Tambah saja (nullable): baris lama tidak berubah.
ALTER TABLE products ADD COLUMN name_en TEXT;
ALTER TABLE product_variants ADD COLUMN admin_terms_en TEXT;
ALTER TABLE product_variants ADD COLUMN admin_activation_en TEXT;
