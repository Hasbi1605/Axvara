CREATE TABLE IF NOT EXISTS security_auth_attempts (
  client_hash TEXT PRIMARY KEY,
  window_id INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 10)
);
CREATE INDEX IF NOT EXISTS idx_security_auth_window ON security_auth_attempts(window_id);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL CHECK(event IN ('login_failed','login_succeeded','login_limited','admin_authorized')),
  subject_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
