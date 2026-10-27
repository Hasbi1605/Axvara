-- Previously issued codes keep their original format and verification policy.
ALTER TABLE orders ADD COLUMN buyer_access_format TEXT NOT NULL DEFAULT 'code26' CHECK (buyer_access_format IN ('code26','pin6'));
-- Optional metadata belongs only to the new checkout PIN email queue.
ALTER TABLE buyer_notice_log ADD COLUMN access_attempts INTEGER NOT NULL DEFAULT 0 CHECK (access_attempts >= 0);
ALTER TABLE buyer_notice_log ADD COLUMN access_retry_at TEXT;
ALTER TABLE buyer_notice_log ADD COLUMN access_lease TEXT;
