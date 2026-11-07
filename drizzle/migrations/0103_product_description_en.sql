-- 0103_product_description_en.sql — deskripsi produk versi Inggris, milik admin.
--
-- Storefront EN memakai kolom ini bila terisi; NULL/kosong jatuh ke teks ID
-- (admin_description_override ?? description). Sync WR/SK TIDAK PERNAH menulis
-- kolom ini (lihat WR_OWNED_PRODUCT_FIELDS + sync description-only update).
-- Tambah saja (nullable): baris lama tidak berubah dan fallback ID tetap aman.
ALTER TABLE products ADD COLUMN description_en TEXT;
