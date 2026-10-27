-- Durable checkout limiter (2026-10-27): the in-memory per-isolate limit in
-- src/lib/rateLimit.ts cannot stop order spam spread across isolates, so new
-- orders are also counted in D1 per HMAC-hashed IP / WA / email over one
-- shared 15-minute window. Quote claims dedupe parallel checkout retries.
CREATE TABLE IF NOT EXISTS checkout_attempts (
  scope TEXT NOT NULL CHECK(scope IN ('ip','wa','email')),
  subject_hash TEXT NOT NULL,
  window_id INTEGER NOT NULL,
  orders_created INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope,subject_hash)
);
CREATE INDEX IF NOT EXISTS idx_checkout_attempts_window ON checkout_attempts(window_id);
CREATE TABLE IF NOT EXISTS checkout_claims (
  quote_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkout_claims_created ON checkout_claims(created_at_ms);
