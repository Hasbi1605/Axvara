-- Preserve the legacy display order and IDs, including inactive banners.
-- Refuse an over-capacity legacy catalog rather than silently exceed 0..999.
CREATE TABLE banner_order_capacity (valid INTEGER CHECK (valid = 1));
INSERT INTO banner_order_capacity SELECT CASE WHEN COUNT(*) <= 1000 THEN 1 ELSE 0 END FROM banners;
DROP TABLE banner_order_capacity;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id DESC) - 1 AS position
  FROM banners
)
UPDATE banners SET sort_order = (SELECT position FROM ranked WHERE ranked.id = banners.id);

CREATE UNIQUE INDEX IF NOT EXISTS banners_sort_order_unique ON banners(sort_order);
