-- Migrasi 0138: satu grup produk lintas supplier = satu slot kategori & sort_order.
--
-- Sebelumnya tiap anggota grup punya `sort_order` (dan berpotensi `category_id`)
-- masing-masing. Saat pemenang grup berpindah ke anggota lain (mis. supplier
-- kedua), baris pemenang baru membawa key lama sehingga posisi di katalog ikut
-- melompat ke ekor.
--
-- Aturan: untuk setiap grup, jangkar = `winner_product_id` bila ada, atau
-- anggota dengan `MIN(position)` (tie-break `MIN(product_id)`). Seluruh
-- anggota grup disinkronkan agar memakai `category_id` dan `sort_order` milik
-- jangkarnya. Data-only dan idempoten.

WITH group_anchor AS (
  SELECT gm.product_id AS member_id,
         anchor.category_id AS target_category_id,
         anchor.sort_order AS target_sort_order
  FROM product_group_members gm
  JOIN product_groups g ON g.id = gm.group_id
  JOIN products anchor ON anchor.id = COALESCE(
    g.winner_product_id,
    (SELECT m2.product_id
     FROM product_group_members m2
     WHERE m2.group_id = g.id
     ORDER BY m2.position ASC, m2.product_id ASC
     LIMIT 1)
  )
)
UPDATE products
SET category_id = (SELECT ga.target_category_id FROM group_anchor ga WHERE ga.member_id = products.id),
    sort_order = (SELECT ga.target_sort_order FROM group_anchor ga WHERE ga.member_id = products.id),
    updated_at = datetime('now')
WHERE id IN (SELECT member_id FROM group_anchor)
  AND (
    category_id IS NOT (SELECT ga.target_category_id FROM group_anchor ga WHERE ga.member_id = products.id)
    OR sort_order IS NOT (SELECT ga.target_sort_order FROM group_anchor ga WHERE ga.member_id = products.id)
  );
