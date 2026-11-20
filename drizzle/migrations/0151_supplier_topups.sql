-- 0151_supplier_topups.sql — Invoice topup saldo supplier (Sekalipay + TUNVN) dari admin.
-- AXVARA hanya MEMBUAT invoice deposit dan MELACAK statusnya; owner membayar sendiri.
-- Tidak ada payout otomatis / pengiriman uang oleh AXVARA.
CREATE TABLE IF NOT EXISTS supplier_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL CHECK(supplier IN ('sekalipay','tunvn')),
  ref_id TEXT NOT NULL UNIQUE,
  supplier_ref TEXT,
  channel TEXT,
  currency TEXT NOT NULL CHECK(currency IN ('IDR','USDT')),
  requested_amount REAL NOT NULL,
  pay_amount REAL,
  credit_amount REAL,
  fee_amount REAL,
  status TEXT NOT NULL CHECK(status IN ('creating','pending','paid','expired','failed','unknown')),
  payment_json TEXT,
  error TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_supplier_topups_recent ON supplier_topups(supplier, created_at DESC);
