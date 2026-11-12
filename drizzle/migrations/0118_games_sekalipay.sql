-- 0118_games_sekalipay.sql — AXVARA Games dual-supplier foundation
-- (2026-11-12, docs/GAMES.md §12). Sekalipay H2H menjadi supplier katalog
-- Game; baris lama tetap `supplier='digiflazz'` dan perilakunya tidak diubah.
-- Aditif saja: ALTER TABLE + indeks baru, tanpa menulis ulang baris lama.
-- Harus identik dengan drizzle/schema.sql.
--
-- Kolom snapshot order/attempt disiapkan untuk P2 (dispatch SK): target,
-- payload, ref dan invoice immutable + sent-fence. Tidak ada kode P2 yang
-- memakainya pada migrasi ini.
--
-- SQLite tidak punya `ADD COLUMN IF NOT EXISTS`. Skrip ini dicatat di ledger
-- migrasi D1 (sekali jalan); pengulangan menghasilkan "duplicate column name"
-- dan itu disengaja (pola 0108).

-- Katalog: supplier per baris + identitas varian SK yang stabil.
ALTER TABLE games_products ADD COLUMN supplier TEXT NOT NULL DEFAULT 'digiflazz' CHECK (supplier IN ('digiflazz','sekalipay'));
ALTER TABLE games_products ADD COLUMN supplier_active INTEGER NOT NULL DEFAULT 0 CHECK (supplier_active IN (0,1));
ALTER TABLE games_products ADD COLUMN sk_variant_id INTEGER;
ALTER TABLE games_products ADD COLUMN sk_sku TEXT;
ALTER TABLE games_products ADD COLUMN sk_product_id INTEGER;
ALTER TABLE games_products ADD COLUMN sk_product_name TEXT;
ALTER TABLE games_products ADD COLUMN game_slug TEXT;
ALTER TABLE games_products ADD COLUMN product_type_name TEXT;
ALTER TABLE games_products ADD COLUMN image_url TEXT;
ALTER TABLE games_products ADD COLUMN required_fields_json TEXT;
ALTER TABLE games_products ADD COLUMN validation_json TEXT;
ALTER TABLE games_products ADD COLUMN min_order INTEGER NOT NULL DEFAULT 1 CHECK (min_order >= 1);

-- Pesanan: supplier yang benar-benar dipakai + snapshot buyer input/ref/invoice.
ALTER TABLE games_order_items ADD COLUMN supplier TEXT NOT NULL DEFAULT 'digiflazz' CHECK (supplier IN ('digiflazz','sekalipay'));
ALTER TABLE games_order_items ADD COLUMN sk_variant_id INTEGER;
ALTER TABLE games_order_items ADD COLUMN target_snapshot TEXT;
ALTER TABLE games_order_items ADD COLUMN fields_snapshot TEXT;
ALTER TABLE games_order_items ADD COLUMN sk_invoice TEXT;
ALTER TABLE games_order_items ADD COLUMN supplier_ref TEXT;

-- Percobaan dispatch: payload/fence untuk exactly-once SK (P2).
ALTER TABLE games_dispatch_attempts ADD COLUMN supplier TEXT NOT NULL DEFAULT 'digiflazz' CHECK (supplier IN ('digiflazz','sekalipay'));
ALTER TABLE games_dispatch_attempts ADD COLUMN sk_invoice TEXT;
ALTER TABLE games_dispatch_attempts ADD COLUMN request_sent_at TEXT;
ALTER TABLE games_dispatch_attempts ADD COLUMN payload_snapshot TEXT;
ALTER TABLE games_dispatch_attempts ADD COLUMN dispatch_status TEXT;
ALTER TABLE games_dispatch_attempts ADD COLUMN units_json TEXT;

-- Unik varian SK hanya untuk supplier SK: baris Digiflazz legacy tidak terpengaruh.
CREATE UNIQUE INDEX IF NOT EXISTS idx_games_products_sk_variant
  ON games_products(sk_variant_id) WHERE supplier='sekalipay';
CREATE INDEX IF NOT EXISTS idx_games_products_sk_product
  ON games_products(supplier, sk_product_id);
