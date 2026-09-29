-- Migrasi 0047: backfill sort_order produk agar unik dan stabil (reorder admin).
--
-- Masalah: seluruh produk existing (manual + hasil sync WR yang selalu
-- INSERT sort_order=0) bernilai 0, sehingga tombol ↑↓ admin hanya menukar
-- dua angka yang sama (0 ↔ 0) dan daftar tampak tidak bergerak walau PUT
-- 200. Sort `ORDER BY sort_order, id` lalu jatuh ke id — swap nilai kembar
-- tidak mengubah urutan tampil.
--
-- Isi: beri nomor urut 1..N berdasarkan id (idempotent — hanya baris yang
-- masih 0/NULL yang disentuh, sehingga urutan yang sudah diatur admin via
-- tombol ↑↓ / field angka TIDAK PERNAH ditimpa saat migrasi jalan ulang).
-- Produk baru sesudahnya tetap memakai nilai dari API (sortOrder form).
--
-- Aman untuk CI: UPDATE murni tanpa ALTER, rerun-aman, tanpa backfill
-- destruktif. Wrangler mencatat migrasi yang sudah diterapkan (journal),
-- jadi hanya jalan sekali di production.

-- 1. Normalisasi NULL → 0 (kolom lama nullable di DB pra-schema final).
UPDATE products SET sort_order = 0 WHERE sort_order IS NULL;

-- 2. Backfill hanya baris yang masih 0: nomor urut mengikuti id, di-offset
--    setelah nilai terbesar yang sudah diatur (>0). CTE `ranked` + `base`
--    difoto sebelum UPDATE sehingga rerun idempoten: putaran kedua tidak
--    punya baris 0 lagi dan tidak menggeser apa pun. Pola UPDATE..FROM/CTE
--    didukung SQLite ≥3.33 (D1) dan diuji di tests/product-reorder via
--    node:sqlite.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM products WHERE sort_order = 0
),
base AS (
  SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE sort_order > 0
)
UPDATE products
SET sort_order = (SELECT m FROM base) + (SELECT rn FROM ranked WHERE ranked.id = products.id)
WHERE sort_order = 0;
