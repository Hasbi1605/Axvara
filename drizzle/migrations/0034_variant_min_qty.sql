-- 0034_variant_min_qty.sql — Minimum pembelian per varian (mode generik).
--
-- Masalah (request owner 2026-09-17): akun GSuite wajib minimal order 50 akun,
-- dan ke depan bisa ada produk lain yang seperti ini (bulk B2B, lisensi tim).
-- Selama ini qty dibatasi 1–20 (web) / 1–100 (Telegram) tanpa batas bawah per
-- produk, sehingga aturan "min. 50" hanya bisa dijaga manual oleh admin.
--
-- Desain (rekomendasi terbaik — generik per-varian, bukan hardcode GSuite):
-- - product_variants.min_qty (INTEGER, default 1, CHECK >= 1): milik ADMIN,
--   TIDAK PERNAH ditulis sync WR (lihat ownership.ts — field ini tidak masuk
--   WR_OWNED_VARIANT_FIELDS, dan sync.ts tidak menyentuh kolom ini).
-- - GSuite jadi kasus pertama: UPDATE di bawah mengunci min 50 untuk varian
--   produk yang slug/namanya mengandung gsuite/g-suite/google-workspace.
--   Produk lain default 1 (tanpa perubahan perilaku) dan tinggal set angka
--   dari admin bila butuh.
-- - Batas atas channel tetap: web 100 & Telegram 100 per baris (lihat quote/
--   orders/cart). Admin wajib menjaga min <= 100 agar produk tetap bisa
--   dibeli; validasi API/UI menolak min > 100 dengan pesan jelas.
-- - Validasi server (quote 409 + orders 409 + guard atomik) adalah sumber
--   kebenaran; UI/bot hanya cermin agar pembeli tahu SEBELUM bayar.
--
-- Idempoten: pola 0031/0033 (ALTER langsung; jalur CI mencatat migrasi).
-- UPDATE GSuite memakai WHERE min_qty=1 agar kunci manual admin tak tertimpa
-- bila migrasi dijalankan ulang parsial.

ALTER TABLE product_variants ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 1
  CHECK (min_qty >= 1);

-- Kasus pertama: GSuite min. 50 akun (slug/nama varian umum di prod).
UPDATE product_variants SET min_qty=50, updated_at=datetime('now')
  WHERE min_qty=1 AND product_id IN (
    SELECT id FROM products WHERE
      slug LIKE '%gsuite%' OR slug LIKE '%g-suite%'
      OR slug LIKE '%google-workspace%' OR slug LIKE '%googleworkspace%'
      OR name LIKE '%gsuite%' OR name LIKE '%G Suite%'
      OR name LIKE '%Google Workspace%'
  );
