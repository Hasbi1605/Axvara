-- Migrasi 0143: pindahkan produk non-arsip dengan sort_order <= 0 ke ekor kategori masing-masing.
--
-- Produk sinkronisasi StoreBat/Mirai/AIVault sebelumnya disisipkan tanpa sort_order
-- sehingga jatuh ke default 0 dan menggeser urutan kategori di promo digest
-- maupun daftar produk.
--
-- Aturan:
-- 1. Produk non-arsip dengan sort_order <= 0 (atau NULL) yang berada di dalam
--    product_group yang sudah memiliki anggota lain bersort_order > 0 menyalin
--    sort_order grup tersebut (menjaga satu slot per grup).
-- 2. Produk non-arsip tersisa dengan sort_order <= 0 (produk solo maupun grup
--    yang seluruh anggotanya <= 0) diberi slot ekor per kategori setelah
--    MAX(sort_order) non-arsip di kategori tersebut, dengan langkah +10 urut id,
--    dan grup seluruh-nol mendapat satu slot bersama untuk seluruh anggotanya.
-- 3. Produk bersort_order > 0 dan produk terarsip tidak disentuh. Idempoten.

WITH group_positive_slot AS (
  SELECT gm.product_id,
         (
           SELECT p2.sort_order
           FROM product_group_members m2
           JOIN product_groups g ON g.id = m2.group_id
           JOIN products p2 ON p2.id = m2.product_id
           WHERE m2.group_id = gm.group_id
             AND p2.id <> gm.product_id
             AND COALESCE(p2.sort_order, 0) > 0
           ORDER BY CASE WHEN p2.archived_at IS NULL THEN 0 ELSE 1 END ASC,
                    CASE WHEN p2.id = g.winner_product_id THEN 0 ELSE 1 END ASC,
                    m2.position ASC,
                    p2.id ASC
           LIMIT 1
         ) AS existing_sort_order
  FROM product_group_members gm
)
UPDATE products
SET sort_order = (SELECT gps.existing_sort_order FROM group_positive_slot gps WHERE gps.product_id = products.id),
    updated_at = datetime('now')
WHERE archived_at IS NULL
  AND COALESCE(sort_order, 0) <= 0
  AND EXISTS (
    SELECT 1 FROM group_positive_slot gps
    WHERE gps.product_id = products.id
      AND gps.existing_sort_order IS NOT NULL
  );

WITH moved_rows AS (
  SELECT p.id AS product_id,
         CASE WHEN gm.group_id IS NULL THEN 'p:' || p.id ELSE 'g:' || gm.group_id END AS unit_key,
         COALESCE(
           (SELECT anchor.category_id
            FROM product_groups g
            JOIN products anchor ON anchor.id = COALESCE(
              g.winner_product_id,
              (SELECT m2.product_id
               FROM product_group_members m2
               WHERE m2.group_id = g.id
               ORDER BY m2.position ASC, m2.product_id ASC
               LIMIT 1)
            )
            WHERE g.id = gm.group_id),
           p.category_id
         ) AS target_category_id
  FROM products p
  LEFT JOIN product_group_members gm ON gm.product_id = p.id
  WHERE p.archived_at IS NULL
    AND COALESCE(p.sort_order, 0) <= 0
),
moved_units AS (
  SELECT unit_key,
         MIN(product_id) AS unit_order_id,
         MIN(target_category_id) AS target_category_id
  FROM moved_rows
  GROUP BY unit_key
),
category_base AS (
  SELECT p.category_id,
         MAX(0, COALESCE(MAX(p.sort_order), 0)) AS base_sort_order
  FROM products p
  WHERE p.archived_at IS NULL
    AND COALESCE(p.sort_order, 0) > 0
  GROUP BY p.category_id
),
unit_slots AS (
  SELECT u.unit_key,
         MAX(0, COALESCE((SELECT cb.base_sort_order FROM category_base cb WHERE cb.category_id IS u.target_category_id), 0))
         + (ROW_NUMBER() OVER (PARTITION BY u.target_category_id ORDER BY u.unit_order_id ASC) * 10) AS new_sort_order
  FROM moved_units u
),
row_targets AS (
  SELECT mr.product_id,
         us.new_sort_order
  FROM moved_rows mr
  JOIN unit_slots us ON us.unit_key = mr.unit_key
)
UPDATE products
SET sort_order = (SELECT rt.new_sort_order FROM row_targets rt WHERE rt.product_id = products.id),
    updated_at = datetime('now')
WHERE id IN (SELECT product_id FROM row_targets);
