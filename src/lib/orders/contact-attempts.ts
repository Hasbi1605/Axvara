import type { DatabaseAccess } from "@/lib/db-access";

// Durable order+client limiter shared by isolates. Hash IPs before storage;
// the composite scope prevents strangers from locking out every buyer globally.
async function clientHash(ip: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function contactAttemptLimited(db: DatabaseAccess, code: string, ip: string): Promise<boolean> {
  if (!db.d1) return false;
  const row = await db.queryFirst("SELECT failures FROM order_contact_attempts WHERE order_code=? AND client_hash=? AND window_id=?", code, await clientHash(ip), Math.floor(Date.now() / 900_000));
  return Number(row?.failures) >= 20;
}
export async function recordContactFailure(db: DatabaseAccess, code: string, ip: string): Promise<boolean> {
  if (!db.d1) return false;
  const window = Math.floor(Date.now() / 900_000);
  await db.execRun(`INSERT INTO order_contact_attempts(order_code,client_hash,window_id,failures) VALUES (?,?,?,1)
    ON CONFLICT(order_code,client_hash) DO UPDATE SET window_id=excluded.window_id,
      failures=CASE WHEN order_contact_attempts.window_id=excluded.window_id THEN MIN(order_contact_attempts.failures+1,1000) ELSE 1 END`, code, await clientHash(ip), window);
  return contactAttemptLimited(db, code, ip);
}
