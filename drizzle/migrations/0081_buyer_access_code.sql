-- Existing orders retain contact proof by owner choice; every new creation path explicitly writes version 1.
ALTER TABLE orders ADD COLUMN buyer_access_version INTEGER NOT NULL DEFAULT 0 CHECK (buyer_access_version >= 0);

-- Preserve the audit trail while extending SQLite's existing event CHECK.
CREATE TABLE security_events_buyer_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL CHECK(event IN ('login_failed','login_succeeded','login_limited','admin_authorized','buyer_access_revealed','buyer_access_rotated')),
  subject_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO security_events_buyer_access SELECT * FROM security_events;
DROP TABLE security_events;
ALTER TABLE security_events_buyer_access RENAME TO security_events;
CREATE INDEX idx_security_events_created ON security_events(created_at);
