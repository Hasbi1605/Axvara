-- Pixel Verification: Gmail yang ditolak supplier dengan ACTIVATION_ITEM_NOT_AVAILABLE
-- tidak boleh dikirim ulang untuk penawaran (validity) yang sama (README supplier).
-- Hanya hash SHA-256 dari Gmail ternormalisasi; tidak ada email/kredensial mentah.
CREATE TABLE IF NOT EXISTS pixelverif_blocked_emails (
  email_hash TEXT NOT NULL,
  validity INTEGER NOT NULL CHECK(validity > 0),
  error_code TEXT NOT NULL,
  order_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email_hash, validity)
);
