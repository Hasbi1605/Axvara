-- 0035: Set sold_count random pada semua produk untuk social proof.
-- Angka acak 50–350 (non-WR) / 30–200 (WR).
-- MAX menjaga produk yang sudah punya penjualan riil ≥ nilai random.
-- Pembelian baru tetap menambah sold_count+=qty di atas base ini.

UPDATE products
SET sold_count = MAX(COALESCE(sold_count, 0), abs(random()) % 301 + 50),
    updated_at = datetime('now')
WHERE wr_auto_managed = 0 OR wr_auto_managed IS NULL;

UPDATE products
SET sold_count = MAX(COALESCE(sold_count, 0), abs(random()) % 171 + 30),
    updated_at = datetime('now')
WHERE wr_auto_managed = 1;
