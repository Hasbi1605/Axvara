-- ============================================================
-- Migration 0049: Sekalipay supplier kedua (paralel dengan WR).
-- Dijalankan SEKALI oleh `wrangler d1 migrations apply` terhadap DB
-- production yang sudah ada. SQLite tidak punya ADD COLUMN IF NOT EXISTS,
-- jadi menjalankan ulang berkas ini secara manual akan gagal dengan
-- "duplicate column name" — sama seperti migrasi ALTER lain di repo ini
-- (0027/0032/0043). Wrangler mencatat migrasi yang sudah diterapkan, jadi
-- jalur CI normal aman; JANGAN apply manual untuk DB yang sudah berisi
-- kolom ini. Bootstrap D1 baru memakai `drizzle/schema.sql` yang sudah
-- final (blok SK inline di sana), bukan replay migrasi.
--
-- Kontrak kepemilikan (cermin 0030):
--   SK    : stok, harga modal, label varian, seller_note, order_process.
--   Admin : foto, badge, sort_order, is_active, markup, tampil/tidak.
--   Sync TIDAK PERNAH menulis: sold_count, admin_* copy, require_email,
--   min_qty, fulfillment_mode.
--   SQLite tidak bisa ALTER CHECK: CHECK source lama (manual/warung_rebahan)
--   TIDAK diubah di sini — baris SK ditulis dengan source='sekalipay' dan
--   validasi CHECK dijaga di kode + test.
-- Tabel/index baru IF NOT EXISTS/OR IGNORE (rerun aman).
--
-- Fase 1: hanya varian order_process=auto yang dibuatkan pasangan katalog.
-- Varian manual/h2h/smm/vip dicatat di sk_products TANPA pasangan katalog.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Kolom tautan SK di katalog utama + CHECK source diperluas.
--    SQLite tak bisa ALTER CHECK: rebuild 12-langkah pola 0029 dalam satu
--    transaksi (data dicopy penuh, id dipertahankan agar FK sk_products /
--    sk_order_links tetap konsisten). CHECK baru: manual/warung_rebahan/
--    sekalipay. Nilai liar lama (tidak ada di prod) akan menggagalkan migrasi
--    dengan jelas alih-alih lolos diam-diam.
--    Rebuild parent ber-FK (products dirujuk product_variants +
--    fulfillment_inventory): prosedur resmi SQLite — FK dimatikan sementara
--    selama swap (D1 wrangler mencatat migrasi; pola 0008 memakai defer untuk
--    kasus order_code TEXT, tetapi untuk parent id-INTEGER yang di-DROP,
--    OFF sementara adalah satu-satunya cara yang lolos enforcement),
--    child dipindah ke namespace negatif dulu agar tidak ikut terhapus saat
--    DROP parent. Verifikasi FK utuh di test sk-migrations (varian +
--    inventory menunjuk id positif yang sama sebelum/sesudah migrasi) +
--    PRAGMA foreign_key_check di ekor migrasi.
-- ────────────────────────────────────────────────────────────
PRAGMA foreign_keys=OFF;

ALTER TABLE products ADD COLUMN sk_product_id TEXT;
ALTER TABLE products ADD COLUMN sk_auto_managed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_variants ADD COLUMN sk_variant_id TEXT;
ALTER TABLE product_variants ADD COLUMN sk_auto_managed INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  compare_price INTEGER,
  image_url TEXT,
  images TEXT,
  badge TEXT,
  sold_count INTEGER DEFAULT 0,
  stock INTEGER DEFAULT -1,
  aliases TEXT DEFAULT '[]',
  whatsapp_alias TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  fulfillment_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (fulfillment_mode IN ('manual','shared','unique')),
  shared_secret_ciphertext TEXT,
  shared_secret_iv TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'warung_rebahan', 'sekalipay')),
  wr_product_id TEXT,
  wr_auto_managed INTEGER NOT NULL DEFAULT 0,
  sk_product_id TEXT,
  sk_auto_managed INTEGER NOT NULL DEFAULT 0,
  admin_description_override TEXT,
  require_email INTEGER NOT NULL DEFAULT 0
    CHECK (require_email IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO products_new
  (id, category_id, name, slug, description, price, compare_price, image_url,
   images, badge, sold_count, stock, aliases, whatsapp_alias, is_active,
   sort_order, fulfillment_mode, shared_secret_ciphertext, shared_secret_iv,
   telegram_enabled, source, wr_product_id, wr_auto_managed,
   sk_product_id, sk_auto_managed, admin_description_override, require_email,
   created_at, updated_at)
SELECT
  id, category_id, name, slug, description, price, compare_price, image_url,
  images, badge, sold_count, stock, aliases, whatsapp_alias, is_active,
  sort_order, fulfillment_mode, shared_secret_ciphertext, shared_secret_iv,
  telegram_enabled, source, wr_product_id, wr_auto_managed,
  sk_product_id, sk_auto_managed, admin_description_override, require_email,
  created_at, updated_at
FROM products;

-- Pindahkan FK anak ke namespace sementara SEBELUM DROP parent (pola 0008):
-- D1 menjalankan migrasi dengan foreign_keys=ON dan DROP parent memicu
-- implicit delete terhadap baris anak. Prosedur resmi SQLite: FK dimatikan
-- sementara (baris 40) selama swap; nilai dikembalikan setelah tabel kanonis
-- `products` ada lagi, lalu FK dinyalakan kembali + diverifikasi.
UPDATE product_variants SET product_id = -product_id;
UPDATE fulfillment_inventory SET product_id = -product_id;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

UPDATE product_variants SET product_id = -product_id;
UPDATE fulfillment_inventory SET product_id = -product_id;

PRAGMA foreign_keys=ON;

CREATE INDEX IF NOT EXISTS idx_products_source ON products(source) WHERE source = 'warung_rebahan';
CREATE INDEX IF NOT EXISTS idx_products_source_sk ON products(source) WHERE source = 'sekalipay';
CREATE INDEX IF NOT EXISTS idx_products_wr_id ON products(wr_product_id) WHERE wr_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_sk_id ON products(sk_product_id) WHERE sk_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variants_sk_id ON product_variants(sk_variant_id) WHERE sk_variant_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Registry mirror SK (1 baris per varian SK, semua order_process).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sk_products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sk_variant_id     TEXT NOT NULL UNIQUE,
  sk_product_id     TEXT NOT NULL,
  sk_product_name   TEXT NOT NULL,
  sk_category       TEXT,
  sk_variant_name   TEXT NOT NULL,
  sk_price          INTEGER NOT NULL,
  sk_stock          INTEGER NOT NULL DEFAULT 0,
  sk_order_process  TEXT NOT NULL DEFAULT 'auto',
  sk_seller_note    TEXT,
  axvara_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  axvara_variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  markup_percent    INTEGER NOT NULL DEFAULT 50,
  markup_fixed      INTEGER NOT NULL DEFAULT 0,
  axvara_sell_price INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  last_synced_at    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sk_products_product ON sk_products(sk_product_id);

-- ────────────────────────────────────────────────────────────
-- 3. State machine exactly-once sk_order_links (cermin 0029).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sk_order_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code      TEXT NOT NULL REFERENCES orders(code),
  sk_invoice      TEXT,
  sk_variant_id   TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  sk_cost         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',
                    'claimed',
                    'submitted',
                    'ordering',
                    'processing',
                    'completed',
                    'failed',
                    'retry',
                    'blocked_balance'
                  )),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  last_error      TEXT,
  sk_account_details TEXT,
  sk_account_iv   TEXT,
  completed_at    TEXT,
  idempotency_key TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  request_sent_at TEXT,
  last_claim_at TEXT,
  last_event_id TEXT,
  last_event_at TEXT,
  fulfillment_item_id INTEGER REFERENCES fulfillment_items(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sk_links_idempotency
  ON sk_order_links(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sk_order_links_order_code ON sk_order_links(order_code);
CREATE INDEX IF NOT EXISTS idx_sk_order_links_invoice ON sk_order_links(sk_invoice) WHERE sk_invoice IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sk_order_links_status ON sk_order_links(status);
CREATE INDEX IF NOT EXISTS idx_sk_order_links_retry ON sk_order_links(status, next_attempt_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_sk_links_lease
  ON sk_order_links(status, lease_expires_at)
  WHERE status IN ('claimed','submitted','ordering');
CREATE INDEX IF NOT EXISTS idx_sk_links_item
  ON sk_order_links(fulfillment_item_id) WHERE fulfillment_item_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 4. Marker kepemilikan SK di fulfillment_items (cermin wr_link_id).
--    Item SK memakai mode 'manual' (kontrak fulfillment) tetapi diselesaikan
--    via sk_order_links — dilewati processItem generik (lihat send.ts).
-- ────────────────────────────────────────────────────────────
ALTER TABLE fulfillment_items ADD COLUMN sk_link_id INTEGER
  REFERENCES sk_order_links(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_sk_link
  ON fulfillment_items(sk_link_id) WHERE sk_link_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 5. Log sync + saldo + webhook dedupe + cursor durable.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sk_sync_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type         TEXT NOT NULL CHECK (sync_type IN ('products', 'saldo', 'order_status')),
  status            TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  products_total    INTEGER,
  products_synced   INTEGER,
  products_excluded INTEGER,
  products_new      INTEGER,
  variants_synced   INTEGER,
  stock_changes     INTEGER,
  price_changes     INTEGER,
  saldo_amount      INTEGER,
  error_message     TEXT,
  duration_ms       INTEGER,
  trigger           TEXT NOT NULL DEFAULT 'manual'
                    CHECK (trigger IN ('manual', 'cron')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sk_saldo_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  balance     INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'api_check'
              CHECK (source IN ('api_check', 'order_deduct', 'manual_topup', 'low_alert')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sk_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sk_invoice TEXT NOT NULL,
  event TEXT NOT NULL,
  event_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied INTEGER NOT NULL DEFAULT 0,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_sk_webhook_invoice ON sk_webhook_events(sk_invoice, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sk_webhook_event
  ON sk_webhook_events(sk_invoice, event, event_id) WHERE event_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sk_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sk_sync_state (key, value) VALUES
  ('products_cursor', '0'),
  ('products_server_time', ''),
  ('products_snapshot_complete', '0');

-- Gagalkan migrasi bila ada FK yatim akibat swap (fail-closed, bukan diam).
PRAGMA foreign_key_check;
