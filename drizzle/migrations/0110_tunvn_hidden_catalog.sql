-- 0110_tunvn_hidden_catalog.sql — Fondasi supplier TUNVN PREHUB (2026-11-09).
-- Setup awal atas instruksi owner: katalog mirror TERSEMBUNYI saja. Tabel ini
-- tidak dibaca storefront/checkout/Telegram mana pun; `visible` selalu 0 pada
-- setup awal dan tidak ada kode publik yang boleh menampilkannya. Tidak
-- mengubah tabel/baris lama. Harus identik dengan drizzle/schema.sql.
-- TUNVN hidden catalog (setup awal 2026-11-09): mirror katalog supplier
-- TUNVN PREHUB untuk persiapan integrasi; tidak pernah tampil publik.
CREATE TABLE IF NOT EXISTS tunvn_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_product_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_vnd INTEGER NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
  price_usdt REAL CHECK (price_usdt IS NULL OR price_usdt > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  discount_threshold INTEGER NOT NULL DEFAULT 0 CHECK (discount_threshold >= 0),
  discount_price_vnd INTEGER CHECK (discount_price_vnd IS NULL OR discount_price_vnd > 0),
  discount_threshold_usdt INTEGER NOT NULL DEFAULT 0 CHECK (discount_threshold_usdt >= 0),
  discount_price_usdt REAL CHECK (discount_price_usdt IS NULL OR discount_price_usdt > 0),
  visible INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0,1)),
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tunvn_products_visible ON tunvn_products(visible, supplier_product_id);
CREATE INDEX IF NOT EXISTS idx_tunvn_products_synced ON tunvn_products(synced_at);
