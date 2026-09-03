-- Apply once to an existing D1 database before deploying the Agent Content API.
-- New databases get the same tables from ../schema.sql. SQLite ALTER ADD COLUMN
-- is intentionally kept in this migration, not re-run as a seed script.
ALTER TABLE articles ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE articles ADD COLUMN author_type TEXT DEFAULT 'admin';
ALTER TABLE articles ADD COLUMN author_name TEXT;
ALTER TABLE articles ADD COLUMN source_urls TEXT;
ALTER TABLE articles ADD COLUMN idempotency_key TEXT;
ALTER TABLE articles ADD COLUMN scheduled_at TEXT;
ALTER TABLE articles ADD COLUMN reviewed_at TEXT;
ALTER TABLE articles ADD COLUMN reviewed_by TEXT;
-- Preserve the public visibility of articles that predate the editorial status
-- column. Without this backfill they would silently become drafts.
UPDATE articles
SET status = 'published', author_type = COALESCE(author_type, 'admin')
WHERE is_published = 1;
CREATE UNIQUE INDEX IF NOT EXISTS articles_idempotency_key_unique ON articles(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS agent_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, token_prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL, scopes TEXT NOT NULL, is_active INTEGER DEFAULT 1,
  expires_at TEXT, last_used_at TEXT, created_at TEXT DEFAULT (datetime('now')), revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS article_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER REFERENCES articles(id),
  actor_type TEXT NOT NULL, actor_name TEXT, action TEXT NOT NULL, metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
