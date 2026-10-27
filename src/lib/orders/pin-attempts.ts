import type { DatabaseAccess } from "@/lib/db-access";

const WINDOW_MS = 900_000;
const LIMIT = 10;
const bucket = (version: number) => `pin:v1:${version}`;

export async function admitBuyerPin(db: DatabaseAccess, code: string, version: number, now = Date.now()) {
  const window = Math.floor(now / WINDOW_MS);
  const retryAfter = Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000));
  if (!db.d1) return { allowed: process.env.NODE_ENV !== "production", unavailable: process.env.NODE_ENV === "production", window, retryAfter };
  try {
    const result = await db.execRun(`INSERT INTO order_contact_attempts(order_code,client_hash,window_id,failures) VALUES(?,?,?,1)
      ON CONFLICT(order_code,client_hash) DO UPDATE SET window_id=excluded.window_id,
        failures=CASE WHEN order_contact_attempts.window_id=excluded.window_id THEN order_contact_attempts.failures+1 ELSE 1 END
      WHERE order_contact_attempts.window_id<excluded.window_id
         OR (order_contact_attempts.window_id=excluded.window_id AND order_contact_attempts.failures<?)`, code, bucket(version), window, LIMIT);
    if (result.changes !== 0 && result.changes !== 1) throw new Error("missing_pin_admission_result");
    return { allowed: result.changes === 1, unavailable: false, window, retryAfter };
  } catch { return { allowed: false, unavailable: true, window, retryAfter: 60 }; }
}

export async function releaseSuccessfulBuyerPin(db: DatabaseAccess, code: string, version: number, window: number) {
  if (db.d1) await db.execRun(`UPDATE order_contact_attempts SET failures=failures-1
    WHERE order_code=? AND client_hash=? AND window_id=? AND failures>0`, code, bucket(version), window);
}
