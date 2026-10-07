-- 0058_variant_manual_cost.sql — Modal manual per varian (dashboard Fase 1).
--
-- Masalah (request owner 2026-10-07): sebagian produk manual/stok sendiri
-- punya modal tersembunyi (mis. akun invite berbayar, stok kredensial beli
-- putus) yang tidak tercatat di mana pun, sehingga laba hanya bisa dihitung
-- dari modal supplier WR/SK.
--
-- Desain (cermin migrasi 0034 min_qty):
-- - product_variants.manual_cost (INTEGER rupiah, default 0, CHECK >= 0):
--   milik ADMIN, berlaku untuk SEMUA varian (manual maupun WR/SK — untuk
--   WR/SK sebagai biaya tambahan di luar modal supplier, mis. fee top-up).
--   Default 0 = tanpa perubahan perilaku (produk manual murni tetap modal 0).
-- - Sync WR/SK TIDAK PERNAH menulis kolom ini (lihat ownership.ts — field ini
--   tidak masuk WR_OWNED_VARIANT_FIELDS, dan sync.ts tidak menyentuh kolom
--   ini) sehingga angka admin aman lintas sweep.
-- - Laba per order = omzet - (modal supplier link WR/SK + manual_cost x qty
--   item manual). Perhitungan di GET /api/admin/overview.
--
-- Idempoten: pola 0031/0033/0034 (ALTER langsung; jalur CI mencatat migrasi).
-- SQLite tak punya ADD COLUMN IF NOT EXISTS — rerun manual akan gagal
-- duplicate column (seperti 0030), jalur CI aman.

ALTER TABLE product_variants ADD COLUMN manual_cost INTEGER NOT NULL DEFAULT 0
  CHECK (manual_cost >= 0);
