-- 0108_games_admin.sql — AXVARA Games admin: harga referensi + grup tampilan
-- (2026-11-09, docs/GAMES.md §12.6–§12.7). Tambahan aditif saja; harus identik
-- dengan drizzle/schema.sql.
--
-- `games_reference_prices` adalah SUMBER KEBENARAN harga pembanding (Oura) per
-- `buyer_sku_code`; `games_products.reference_price` hanya cermin yang diisi
-- sinkron/admin. Tabel ini boleh berisi kode yang belum ada di games_products
-- (seed sebelum sinkron pertama).
CREATE TABLE IF NOT EXISTS games_reference_prices (
  buyer_sku_code TEXT PRIMARY KEY,
  price INTEGER NOT NULL CHECK (price > 0),
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- SQLite tidak punya `ADD COLUMN IF NOT EXISTS`. Skrip ini dicatat di ledger
-- migrasi D1 (sekali jalan); jangan dijalankan ulang manual — pengulangan
-- menghasilkan "duplicate column name" dan itu disengaja.
ALTER TABLE games_products ADD COLUMN display_group TEXT CHECK (display_group IS NULL OR display_group IN ('special','bestseller'));
ALTER TABLE games_products ADD COLUMN display_order INTEGER;
