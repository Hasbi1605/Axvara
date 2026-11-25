-- 0166_storebat_supplier_topups.sql — Tambah StoreBat pada invoice topup saldo supplier (USDT BEP20).
-- Memperluas CHECK constraint `supplier` dari ('sekalipay','tunvn') menjadi ('sekalipay','tunvn','storebat')
-- sambil mempertahankan seluruh baris riwayat dan indeks yang sudah ada.
CREATE TABLE supplier_topups_storebat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL CHECK(supplier IN ('sekalipay','tunvn','storebat')),
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
INSERT INTO supplier_topups_storebat
  (id,supplier,ref_id,supplier_ref,channel,currency,requested_amount,pay_amount,credit_amount,fee_amount,status,payment_json,error,expires_at,created_at,updated_at,paid_at)
SELECT id,supplier,ref_id,supplier_ref,channel,currency,requested_amount,pay_amount,credit_amount,fee_amount,status,payment_json,error,expires_at,created_at,updated_at,paid_at
FROM supplier_topups;
DROP TABLE supplier_topups;
ALTER TABLE supplier_topups_storebat RENAME TO supplier_topups;
CREATE INDEX idx_supplier_topups_recent ON supplier_topups(supplier, created_at DESC);
