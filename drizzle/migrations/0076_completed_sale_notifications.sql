-- Keep the bounded, post-activation completion sweep on paid-time candidates.
CREATE INDEX IF NOT EXISTS idx_orders_completed_notice_candidates
  ON orders(julianday(paid_at), code) WHERE status='lunas' AND payment_status='paid';
