-- 0015_fulfillment_items.sql — Fulfillment per item + reservasi per item (issue #4).
--
-- Masalah: fulfillment berpusat pada items[0] + satu job per order. Keranjang
-- Telegram dua varian shared hanya mengirim item pertama tetapi seluruh order
-- ditandai delivered; reservasi unique web tidak ada (db.ts hanya memotong
-- stok varian); penerima kanal tidak eksplisit per item.
--
-- Desain: tabel anak `fulfillment_items` — satu baris per (order, item) —
-- dengan status masing-masing (queued/sending/delivered/manual_required/
-- retry/failed). Order dianggap selesai hanya setelah SELURUH baris terminal
-- sukses (delivered/manual_required). Job lama (UNIQUE order_code) tetap
-- kompatibel: migrasi mem-backfill satu baris per order lama dari
-- orders.items, dan deliver.ts membaca baris baru bila ada, fallback ke job
-- lama bila tidak.
--
-- Idempoten dan aman diulang: CREATE TABLE / INDEX IF NOT EXISTS, kolom
-- ditambah hanya bila belum ada (guard PRAGMA), backfill INSERT OR IGNORE
-- berbasis (order_code, item_index).

CREATE TABLE IF NOT EXISTS fulfillment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  item_index INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  qty INTEGER NOT NULL DEFAULT 1,
  fulfillment_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (fulfillment_mode IN ('manual','shared','unique','mixed')),
  inventory_id INTEGER REFERENCES fulfillment_inventory(id),
  recipient_channel TEXT NOT NULL DEFAULT 'telegram'
    CHECK (recipient_channel IN ('web','telegram','whatsapp')),
  recipient_target TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','delivered','manual_required','retry','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_until TEXT,
  delivered_message_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(order_code, item_index)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_order
  ON fulfillment_items(order_code, status);
CREATE INDEX IF NOT EXISTS idx_fulfillment_items_next
  ON fulfillment_items(status, next_attempt_at);
