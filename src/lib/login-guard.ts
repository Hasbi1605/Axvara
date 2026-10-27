import type { DatabaseAccess } from "@/lib/db-access";
import { securitySubject } from "@/lib/security-events";

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_ATTEMPTS = 10;

export async function loginClientHash(ip: string): Promise<string> {
  let canonical = ip.trim().split(",")[0].toLowerCase();
  if (canonical.includes(":")) {
    try { canonical = new URL(`http://[${canonical}]/`).hostname.replace(/^\[|\]$/g, ""); } catch { canonical = "unknown"; }
  }
  return securitySubject("login", canonical || "unknown");
}

export async function admitLogin(db: DatabaseAccess, hash: string, now = Date.now()) {
  if (!db.d1) return { allowed: process.env.NODE_ENV !== "production", unavailable: process.env.NODE_ENV === "production", window: Math.floor(now / LOGIN_WINDOW_MS), retryAfter: 60 };
  const window = Math.floor(now / LOGIN_WINDOW_MS);
  const retryAfter = Math.max(1, Math.ceil(((window + 1) * LOGIN_WINDOW_MS - now) / 1000));
  try {
    const result = await db.execRun(`INSERT INTO security_auth_attempts(client_hash,window_id,attempts) VALUES(?,?,1)
      ON CONFLICT(client_hash) DO UPDATE SET
        window_id=MAX(security_auth_attempts.window_id,excluded.window_id),
        attempts=CASE WHEN security_auth_attempts.window_id>=excluded.window_id THEN security_auth_attempts.attempts+1 ELSE 1 END
      WHERE security_auth_attempts.window_id<excluded.window_id OR security_auth_attempts.attempts<?`, hash, window, LOGIN_ATTEMPTS);
    if (result.changes !== 0 && result.changes !== 1) throw new Error("missing_admission_result");
    return { allowed: result.changes === 1, unavailable: false, window, retryAfter };
  } catch { return { allowed: false, unavailable: true, window, retryAfter: 60 }; }
}

export async function resetLogin(db: DatabaseAccess, hash: string, window: number) {
  if (db.d1) await db.execRun("DELETE FROM security_auth_attempts WHERE client_hash=? AND window_id=?", hash, window);
}
