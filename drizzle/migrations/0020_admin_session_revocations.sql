-- 0020_admin_session_revocations.sql — Pencabutan sesi tahan restart/lintas instance.
--
-- Latar (review R8): logout hanya bump Map memori proses (revokedSessions di
-- auth.ts). Instance baru / restart menerima kembali cookie lama — logout
-- palsu lintas instance. Tabel ini adalah sumber kebenaran bersama (D1):
-- tiap baris = satu sesi yang dicabut (sid), dengan versi agar logout
-- berulang idempoten dan cleanup cron dapat menghapus record kedaluwarsa
-- tanpa anggaran tambahan (TTL ikut expiry JWT 8 jam + margin).
CREATE TABLE IF NOT EXISTS admin_session_revocations (
  sid TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_admin_session_revocations_expiry
  ON admin_session_revocations(expires_at);
