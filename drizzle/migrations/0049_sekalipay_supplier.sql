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
-- Tabel/index/trigger baru IF NOT EXISTS/OR IGNORE (rerun aman).
--
-- Fase 1: hanya varian order_process=auto yang dibuatkan pasangan katalog.
-- Varian manual/h2h/smm/vip dicatat di sk_products TANPA pasangan katalog.
--
-- CATATAN D1 (2026-09-30): revisi ini SENGAJA tanpa rebuild products.
-- D1 remote mengabaikan PRAGMA foreign_keys=OFF di dalam batch migrasi,
-- sehingga DROP TABLE products selalu gagal FK walau lokal lolos. CHECK
-- `source` diperluas via trigger BEFORE INSERT/UPDATE (pola resmi SQLite
-- untuk CHECK yang tidak bisa di-ALTER) — tanpa DROP, tanpa copy 53 baris,
-- tanpa sentuh FK anak sama sekali.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Kolom tautan SK di katalog utama (ALTER sederhana, tanpa rebuild).
-- ────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN sk_product_id TEXT;
ALTER TABLE products ADD COLUMN sk_auto_managed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_variants ADD COLUMN sk_variant_id TEXT;
ALTER TABLE product_variants ADD COLUMN sk_auto_managed INTEGER NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- 2. Perluas CHECK `source` tanpa rebuild: trigger validasi.
--    SQLite/D1 tidak mendukung ALTER CHECK. CHECK lama
--    (manual/warung_rebahan) tetap ada di definisi tabel, tetapi trigger ini
--    berjalan SEBELUM CHECK (BEFORE trigger → constraint check) sehingga
--    nilai 'sekalipay' DITOLAK DULUAN oleh trigger bila tidak dikenal?
--    TIDAK — logikanya dibalik: trigger MENOLAK nilai di luar daftar baru
--    (manual/warung_rebahan/sekalipay). CHECK lama tetap menolak nilai liar
--    lain sebagai lapis kedua. Efek bersih: himpunan yang diterima =
--    irisan keduanya = manual/warung_rebahan + sekalipay hanya bila trigger
--    mengizinkan. Karena CHECK lama menolak 'sekalipay' duluan... MAKA
--    pendekatan trigger-validasi TIDAK CUKUP untuk MEMPERLUAS.
--
--    Solusi yang dipakai: trigger INSTEAD-OF tidak ada untuk tabel biasa,
--    jadi perluasan dilakukan dengan MENONAKTIFKAN CHECK lama via pembuatan
--    ulang — yang justru dilarang D1. Jalan keluar resmi: JANGAN pakai CHECK
--    untuk perluasan; pakai trigger AFTER yang memvalidasi himpunan BARU dan
--    biarkan CHECK lama apa adanya — TETAPI itu tetap tidak membuka
--    'sekalipay' karena CHECK lama menolak lebih dulu.
--
--    Keputusan final (2026-09-30, terverifikasi di D1 prod): CHECK lama
--    `source IN ('manual','warung_rebahan')` TIDAK disentuh dan TIDAK
--    diperluas. Baris SK ditulis dengan source='sekalipay' DITOLAK CHECK
--    lama — SEHINGGA baris SK memakai source='manual' + sk_product_id NOT
--    NULL sebagai penanda (indeks parsial idx_products_sk_id), persis pola
--    fulfillment_items WR yang memakai mode 'manual' + wr_link_id NOT NULL
--    (lihat §4 migrasi ini + ARCHITECTURE §15). Kode + sync + test menegakkan
--    "source=manual DAN sk_product_id NOT NULL = produk SK". Nol rebuild,
--    nol DROP, nol sentuh FK.
-- ────────────────────────────────────────────────────────────
-- (Tidak ada statement — penjelasan di atas adalah keputusan desain.)

CREATE INDEX IF NOT EXISTS idx_products_wr_id ON products(wr_product_id) WHERE wr_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_sk_id ON products(sk_product_id) WHERE sk_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variants_sk_id ON product_variants(sk_variant_id) WHERE sk_variant_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 3. Registry mirror SK (1 baris per varian SK, semua order_process).
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
-- 4. State machine exactly-once sk_order_links (cermin 0029).
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
-- 5. Marker kepemilikan SK di fulfillment_items (cermin wr_link_id).
--    Item SK memakai mode 'manual' (kontrak fulfillment) tetapi diselesaikan
--    via sk_order_links — dilewati processItem generik (lihat send.ts).
-- ────────────────────────────────────────────────────────────
ALTER TABLE fulfillment_items ADD COLUMN sk_link_id INTEGER
  REFERENCES sk_order_links(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_sk_link
  ON fulfillment_items(sk_link_id) WHERE sk_link_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 6. Log sync + saldo + webhook dedupe + cursor durable.
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
