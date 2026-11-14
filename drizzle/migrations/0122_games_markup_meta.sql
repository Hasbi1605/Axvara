-- 0122_games_markup_meta.sql — harga markup Games (OD1) + metadata game (OD2).
--
-- Keputusan owner 14 November 2026:
--   harga = ceil(modal × (1 + markup% / 100) / R) × R + Rp tetap
--   default markup 5 %, pembulatan R = 100; override per game (`games_meta`) dan
--   per varian (`games_variant_markup`).
--   Harga referensi Oura dipensiunkan untuk katalog Sekalipay (kolom/tabel lama
--   DIPERTAHANKAN sebagai histori, bukan sumber harga lagi).
--
-- Kenapa `games_products` dibangun ulang:
--   Daftar `display_group` bertambah dari 2 nilai legacy (special|bestseller)
--   menjadi 8 kategori Oura (special, bestseller, promo, first_topup, pass,
--   pack, topup, other). SQLite/D1 tidak bisa mengubah CHECK lewat ALTER TABLE,
--   jadi tabel dibangun ulang dengan pola 0019: salin SEMUA kolom yang sudah
--   ada + data, buang tabel lama, pakai nama lama, buat ulang index.
--   `PRAGMA defer_foreign_keys` menunda pemeriksaan FK
--   (games_order_items.product_id) sampai commit; karena id disalin apa adanya,
--   pemeriksaan itu tetap lulus. File ini dijalankan D1 sebagai satu transaksi
--   per migrasi (sama seperti migrasi rebuild 0019/0084).
--
-- Kenapa markup varian ada di tabel sendiri:
--   Rebuild harus menyalin kolom yang ADA DI DUA BENTUK tabel (sebelum/sesudah).
--   Kalau kolom markup ditambahkan ke `games_products`, menjalankan file ini dua
--   kali akan mengosongkan override markup admin pada run kedua. Tabel
--   `games_variant_markup` memakai `CREATE TABLE IF NOT EXISTS` (idempoten) dan
--   tidak pernah disentuh sinkron katalog, sehingga override aman di kedua run.
--
-- Idempoten: struktur & baris sama pada run berikutnya; harga hanya dihitung
-- ulang pada run pertama (`_games_0122_probe`), jadi harga/override admin yang
-- sudah diubah tidak pernah ditimpa.

PRAGMA defer_foreign_keys=ON;

-- Penanda: apakah `games_products` sudah memakai definisi baru. Recompute harga
-- hanya boleh terjadi sekali.
DROP TABLE IF EXISTS _games_0122_probe;
CREATE TABLE _games_0122_probe AS
SELECT (instr(COALESCE((SELECT sql FROM sqlite_master WHERE type='table' AND name='games_products'), ''), 'first_topup') > 0) AS already;

DROP TABLE IF EXISTS games_products_new;

CREATE TABLE games_products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_sku_code TEXT NOT NULL UNIQUE,
  backup_sku_code TEXT,
  game_brand TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  backup_cost INTEGER CHECK (backup_cost IS NULL OR backup_cost >= 0),
  seller_active INTEGER NOT NULL DEFAULT 0 CHECK (seller_active IN (0,1)),
  backup_seller_active INTEGER NOT NULL DEFAULT 0 CHECK (backup_seller_active IN (0,1)),
  unlimited_stock INTEGER NOT NULL DEFAULT 1 CHECK (unlimited_stock IN (0,1)),
  stock INTEGER NOT NULL DEFAULT 0,
  multi INTEGER NOT NULL DEFAULT 0 CHECK (multi IN (0,1)),
  start_cut_off TEXT NOT NULL DEFAULT '00:00',
  end_cut_off TEXT NOT NULL DEFAULT '00:00',
  description TEXT NOT NULL DEFAULT '',
  reference_price INTEGER CHECK (reference_price IS NULL OR reference_price > 0),
  sell_price INTEGER NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  display_group TEXT CHECK (display_group IS NULL OR display_group IN (
    'special','bestseller','promo','first_topup','pass','pack','topup','other')),
  display_order INTEGER,
  supplier TEXT NOT NULL DEFAULT 'digiflazz' CHECK (supplier IN ('digiflazz','sekalipay')),
  supplier_active INTEGER NOT NULL DEFAULT 0 CHECK (supplier_active IN (0,1)),
  sk_variant_id INTEGER,
  sk_sku TEXT,
  sk_product_id INTEGER,
  sk_product_name TEXT,
  game_slug TEXT,
  product_type_name TEXT,
  image_url TEXT,
  required_fields_json TEXT,
  validation_json TEXT,
  min_order INTEGER NOT NULL DEFAULT 1 CHECK (min_order >= 1),
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO games_products_new (
  id, buyer_sku_code, backup_sku_code, game_brand, product_type, product_name, cost, backup_cost,
  seller_active, backup_seller_active, unlimited_stock, stock, multi, start_cut_off, end_cut_off,
  description, reference_price, sell_price, enabled, display_group, display_order, supplier,
  supplier_active, sk_variant_id, sk_sku, sk_product_id, sk_product_name, game_slug,
  product_type_name, image_url, required_fields_json, validation_json, min_order,
  synced_at, created_at, updated_at
)
SELECT
  id, buyer_sku_code, backup_sku_code, game_brand, product_type, product_name, cost, backup_cost,
  seller_active, backup_seller_active, unlimited_stock, stock, multi, start_cut_off, end_cut_off,
  description, reference_price, sell_price, enabled, display_group, display_order, supplier,
  supplier_active, sk_variant_id, sk_sku, sk_product_id, sk_product_name, game_slug,
  product_type_name, image_url, required_fields_json, validation_json, min_order,
  synced_at, created_at, updated_at
FROM games_products;

DROP TABLE games_products;
ALTER TABLE games_products_new RENAME TO games_products;

CREATE INDEX IF NOT EXISTS idx_games_products_brand ON games_products(game_brand, enabled);
CREATE INDEX IF NOT EXISTS idx_games_products_synced ON games_products(synced_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_products_sk_variant ON games_products(sk_variant_id) WHERE supplier='sekalipay';
CREATE INDEX IF NOT EXISTS idx_games_products_sk_product ON games_products(supplier, sk_product_id);

-- Override markup per VARIAN (NULL = ikut markup game/global). Sinkron katalog
-- tidak pernah menulis tabel ini, jadi edit admin bertahan.
CREATE TABLE IF NOT EXISTS games_variant_markup (
  buyer_sku_code TEXT PRIMARY KEY,
  markup_percent REAL CHECK (markup_percent IS NULL OR (markup_percent >= 0 AND markup_percent <= 100)),
  markup_fixed INTEGER CHECK (markup_fixed IS NULL OR (markup_fixed >= 0 AND markup_fixed <= 1000000)),
  updated_at TEXT
);

-- Metadata per game yang bisa diedit admin (menggantikan registry hard-code).
CREATE TABLE IF NOT EXISTS games_meta (
  slug TEXT PRIMARY KEY,
  display_name TEXT,
  publisher TEXT,
  icon_url TEXT,
  banner_url TEXT,
  description TEXT,
  id_guide TEXT,
  featured_rank INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  markup_percent REAL CHECK (markup_percent IS NULL OR (markup_percent >= 0 AND markup_percent <= 100)),
  updated_at TEXT,
  updated_by TEXT
);

-- Default harga global (OD1). INSERT OR IGNORE: nilai yang sudah diubah admin
-- tidak pernah ditimpa oleh migrasi.
INSERT OR IGNORE INTO store_settings (key, value) VALUES ('games_markup_percent', '5');
INSERT OR IGNORE INTO store_settings (key, value) VALUES ('games_price_rounding', '100');

-- Hitung ulang harga Sekalipay dengan 5 %/R100 (override belum ada saat migrasi).
-- Formula integer: ceil(cost × 10500 / (10000 × 100)) × 100. Hanya pada run
-- pertama (lihat `_games_0122_probe`).
UPDATE games_products
SET sell_price = ((cost * 10500 + 999999) / 1000000) * 100,
    updated_at = datetime('now')
WHERE supplier='sekalipay' AND cost > 0
  AND (SELECT already FROM _games_0122_probe) = 0;

DROP TABLE IF EXISTS _games_0122_probe;

PRAGMA defer_foreign_keys=OFF;
