-- ============================================================
-- Migration 0051: Nama storefront bersih tanpa suffix supplier.
-- Keputusan owner 2026-09-30 (preseden Antigravity 0045): pembeli melihat
-- nama produk Axvara ("Netflix"), bukan "Netflix (WR)"/"Netflix (SK)".
-- Pembedaan supplier hanya di admin (badge asal) + slug (-wr/-sk).
--
-- Data-only, idempoten: kupas suffix " (WR)"/" (SK)" di akhir nama untuk
-- produk yang memang milik sync (wr_product_id/sk_product_id NOT NULL).
-- Produk manual yang kebetulan bernama mirip TIDAK disentuh. Rerun aman:
-- nama yang sudah bersih tidak cocok pola LIKE lagi.
-- Sync tidak pernah menulis ulang products.name (hanya description), jadi
-- nama bersih tidak akan ditimpa sweep berikutnya.
-- ============================================================

UPDATE products
SET name = TRIM(SUBSTR(name, 1, LENGTH(name) - 5)), updated_at = datetime('now')
WHERE (name LIKE '% (WR)' OR name LIKE '% (SK)%')
  AND (wr_product_id IS NOT NULL OR sk_product_id IS NOT NULL);
