-- 0084_pedia_order_items_tier_fk.sql — Perbaiki FK tier_id pesanan Pedia (2026-11-01).
--
-- Bug: rebuild 0062 me-rename `pedia_tiers` ke nama arsip. SQLite/D1 menulis
-- ulang FK `pedia_order_items.tier_id` mengikuti rename, sehingga di produksi
-- FK menunjuk `pedia_tiers_archive0062_prev2` (36 tier lama), bukan
-- `pedia_tiers`. Setiap checkout untuk tier yang dibuat sesudah 0062 (146 dari
-- 152 tier aktif pada 1 November) gagal "FOREIGN KEY constraint failed" lalu
-- dibalas 503 "Pesanan belum tersimpan". Hanya tier lama yang bisa dipesan,
-- sehingga error terlihat "kadang-kadang", tergantung layanan yang dipilih.
--
-- Perbaikan: rebuild tabel dengan definisi schema.sql (FK ke pedia_tiers),
-- salin semua baris apa adanya (id/status/riwayat tetap), lalu pasang ulang
-- indeks. Tidak ada tabel lain yang ber-FK ke pedia_order_items. Seluruh
-- tier_id historis (8 baris pada 1 November) ada di pedia_tiers, jadi FK baru
-- terpenuhi. Tabel arsip tier tidak disentuh.
PRAGMA defer_foreign_keys=ON;

DROP TABLE IF EXISTS pedia_order_items_new0084;
CREATE TABLE pedia_order_items_new0084 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier_id INTEGER NOT NULL REFERENCES pedia_tiers(id),
  snapshot_json TEXT NOT NULL,
  target_raw TEXT NOT NULL,
  target_normalized TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total INTEGER NOT NULL,
  credit_used INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL,
  supplier_service_id INTEGER NOT NULL,
  supplier_rate_snapshot REAL NOT NULL,
  supplier_order_id TEXT,
  supplier_charge REAL,
  start_count INTEGER,
  remains INTEGER,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment','queued','submitting','submitted','in_progress',
    'completed','partial','canceled','needs_check','expired')),
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  last_polled_at TEXT,
  completed_at TEXT,
  credit_return_token TEXT,
  refund_credit_code TEXT,
  refill_last_at TEXT,
  refill_supplier_id TEXT,
  refill_status TEXT,
  notified_paid_at TEXT,
  notified_final_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO pedia_order_items_new0084 (
  id, order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
  quantity, unit_price, total, credit_used, supplier, supplier_service_id,
  supplier_rate_snapshot, supplier_order_id, supplier_charge, start_count, remains,
  status, submit_attempts, lease_until, last_error, last_polled_at, completed_at,
  credit_return_token, refund_credit_code, refill_last_at, refill_supplier_id,
  refill_status, notified_paid_at, notified_final_at, created_at, updated_at
)
SELECT
  id, order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
  quantity, unit_price, total, credit_used, supplier, supplier_service_id,
  supplier_rate_snapshot, supplier_order_id, supplier_charge, start_count, remains,
  status, submit_attempts, lease_until, last_error, last_polled_at, completed_at,
  credit_return_token, refund_credit_code, refill_last_at, refill_supplier_id,
  refill_status, notified_paid_at, notified_final_at, created_at, updated_at
FROM pedia_order_items;

DROP TABLE pedia_order_items;
ALTER TABLE pedia_order_items_new0084 RENAME TO pedia_order_items;

CREATE INDEX IF NOT EXISTS idx_pedia_items_status ON pedia_order_items(status, last_polled_at);
CREATE INDEX IF NOT EXISTS idx_pedia_items_target ON pedia_order_items(target_normalized, product_id, status);
