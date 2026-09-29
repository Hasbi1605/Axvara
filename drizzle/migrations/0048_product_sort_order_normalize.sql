-- Migrasi 0048: normalisasi final kunci urutan produk menjadi unik dan berjarak.
--
-- 0047 mengisi nilai nol, tetapi sesudah UI lama memakai delta ±1, produksi
-- kembali mempunyai key kembar (0,0,1,1,2,2,18,19,…). Key kembar membuat
-- satu klik dapat melewati beberapa produk sekaligus karena tie-break `id`.
--
-- Urutan visual yang SUDAH benar dipertahankan persis, lalu key diganti
-- 10,20,30… agar setiap posisi unik dan tersedia ruang. Aturan status sama
-- dengan admin/storefront: aktif → ready, aktif → habis, nonaktif terakhir.
-- Idempoten: rerun menghasilkan nilai yang sama.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           ORDER BY is_active DESC,
                    CASE WHEN stock != -1 AND stock <= 0 THEN 1 ELSE 0 END ASC,
                    sort_order ASC,
                    id ASC
         ) AS position
  FROM products
)
UPDATE products
SET sort_order = (SELECT position * 10 FROM ranked WHERE ranked.id = products.id),
    updated_at = datetime('now');
