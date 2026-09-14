-- ============================================================
-- Migration 0030: Kepemilikan field produk Warung Rebahan.
-- Aman untuk production existing DAN bootstrap kosong (rerun aman).
--
-- Masalah yang diperbaiki:
--   Deskripsi produk WR ditimpa setiap sync (sync.ts UPDATE products
--   SET description=?), sehingga copywriting admin hilang tanpa jejak.
--   Admin butuh kolom terpisah agar teksnya tidak beradu dengan
--   deskripsi upstream — bukan sekadar "jangan sync deskripsi", karena
--   deskripsi WR tetap berguna sebagai fallback saat admin belum menulis.
--
-- Kontrak kepemilikan setelah migrasi ini:
--   WR    : stok, harga modal, label varian, durasi, garansi, description.
--   Admin : foto, badge, sort_order, is_active, admin_description_override.
--   Panel : markup (wr_variants.markup_percent/markup_fixed).
-- ============================================================

-- Teks deskripsi milik admin. NULL = pakai `description` (milik WR).
-- Sync TIDAK PERNAH menulis kolom ini.
ALTER TABLE products ADD COLUMN admin_description_override TEXT;
