import type { DatabaseAccess } from "@/lib/db-access";

// Market and Pedia share durable admission counters. The quote claim and
// counter updates commit together, so parallel retries consume one slot.
// HMAC prevents dictionary lookup of guessable contacts in a database dump.
export const CHECKOUT_WINDOW_MS = 15 * 60_000;
export const CHECKOUT_LIMITS = { ip: 5, wa: 3, email: 3 } as const;

export type CheckoutSubject = { scope: keyof typeof CHECKOUT_LIMITS; hash: string };
export type CheckoutDecision =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "unavailable"; retryAfterSeconds: number };

const unavailable: CheckoutDecision = { allowed: false, reason: "unavailable", retryAfterSeconds: 60 };

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hashSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_JWT_SECRET required for checkout guard");
  return "axvara-dev-only-checkout-guard-secret";
}

async function subjectHash(scope: string, value: string): Promise<string> {
  return hmac(hashSecret(), `${scope}:${value}`);
}

export async function checkoutSubjects(input: { ip: string; wa: string; email: string }): Promise<CheckoutSubject[]> {
  const subjects: CheckoutSubject[] = [];
  let ip = input.ip.trim().split(",")[0]?.trim().toLowerCase() || "";
  if (ip.includes(":")) {
    try { ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { /* Cloudflare supplies a valid IP. */ }
  }
  // The no-IP sentinel (plain local dev without proxy headers) must not
  // collapse every local checkout into one shared bucket.
  if (ip && (process.env.NODE_ENV === "production" || (ip !== "0.0.0.0" && ip !== "::"))) {
    subjects.push({ scope: "ip", hash: await subjectHash("ip", ip) });
  }
  const wa = input.wa.replace(/\D/g, "");
  if (wa) subjects.push({ scope: "wa", hash: await subjectHash("wa", wa) });
  const email = input.email.trim().toLowerCase();
  if (email) subjects.push({ scope: "email", hash: await subjectHash("email", email) });
  return subjects;
}

function retryAfterSeconds(now: number): number {
  const window = Math.floor(now / CHECKOUT_WINDOW_MS);
  return Math.max(1, Math.ceil(((window + 1) * CHECKOUT_WINDOW_MS - now) / 1000));
}

async function currentCounts(db: DatabaseAccess, subjects: CheckoutSubject[], window: number): Promise<number[]> {
  const counts: number[] = [];
  for (const subject of subjects) {
    const row = await db.queryFirst(
      "SELECT orders_created FROM checkout_attempts WHERE scope=? AND subject_hash=? AND window_id>=?",
      subject.scope, subject.hash, window,
    );
    counts.push(Number(row?.orders_created ?? 0));
  }
  return counts;
}

function exceeded(subjects: CheckoutSubject[], counts: number[]): boolean {
  return subjects.some((subject, i) => counts[i] >= CHECKOUT_LIMITS[subject.scope]);
}

/** Read-only precheck so a blocked buyer is rejected before pricing work. */
export async function checkoutLimited(
  db: DatabaseAccess,
  subjects: CheckoutSubject[],
  now = Date.now(),
): Promise<CheckoutDecision> {
  if (!db.d1) return process.env.NODE_ENV === "production" ? unavailable : { allowed: true };
  if (subjects.length === 0) return unavailable;
  const window = Math.floor(now / CHECKOUT_WINDOW_MS);
  try {
    const counts = await currentCounts(db, subjects, window);
    return exceeded(subjects, counts)
      ? { allowed: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) }
      : { allowed: true };
  } catch { return unavailable; }
}

/**
 * Only the request that inserts the quote claim increments counters. A limit
 * violation rolls back the claim too. Admission survives an order/stock race;
 * retries of that quote reuse it, including across a window boundary.
 */
export async function consumeCheckoutSlot(
  db: DatabaseAccess,
  subjects: CheckoutSubject[],
  quoteId: string,
  now = Date.now(),
): Promise<CheckoutDecision> {
  if (!db.d1) return process.env.NODE_ENV === "production" ? unavailable : { allowed: true };
  if (!quoteId || subjects.length === 0) return unavailable;
  const window = Math.floor(now / CHECKOUT_WINDOW_MS);
  const denied: CheckoutDecision = { allowed: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) };
  const admitted = () => db.queryFirst("SELECT quote_id FROM checkout_claims WHERE quote_id=?", quoteId);
  try {
    if (await admitted()) return { allowed: true };
    if (exceeded(subjects, await currentCounts(db, subjects, window))) {
      // The same quote may have won admission while these reads yielded.
      return await admitted() ? { allowed: true } : denied;
    }
  } catch { return unavailable; }

  const claimToken = crypto.randomUUID();
  const guardId = `checkout-guard:${claimToken}`;
  const stmt = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  const ownsClaim = "EXISTS(SELECT 1 FROM checkout_claims WHERE quote_id=? AND claim_token=?)";
  const statements = [stmt(
    "INSERT INTO checkout_claims(quote_id,claim_token,created_at_ms) VALUES (?,?,?) ON CONFLICT(quote_id) DO NOTHING",
    quoteId, claimToken, now,
  )];
  statements.push(...subjects.map((subject) =>
    stmt(
      `INSERT INTO checkout_attempts(scope,subject_hash,window_id,orders_created)
       SELECT ?,?,?,1 WHERE ${ownsClaim}
       ON CONFLICT(scope,subject_hash) DO UPDATE SET
         window_id=MAX(checkout_attempts.window_id,excluded.window_id),
         orders_created=CASE WHEN checkout_attempts.window_id>=excluded.window_id
           THEN MIN(checkout_attempts.orders_created+1,1000) ELSE 1 END`,
      subject.scope, subject.hash, window, quoteId, claimToken,
    )));
  statements.push(stmt(
    `INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN NOT EXISTS(
       SELECT 1 FROM checkout_attempts WHERE window_id>=? AND (
         ${subjects.map((s) => `(scope='${s.scope}' AND subject_hash=? AND orders_created>?)`).join(" OR ")}
       )) THEN 1 ELSE 0 END WHERE ${ownsClaim}`,
    guardId, window,
    ...subjects.flatMap((s) => [s.hash, CHECKOUT_LIMITS[s.scope]]),
    quoteId, claimToken,
  ));
  statements.push(stmt("DELETE FROM operation_guards WHERE operation_id=?", guardId));
  try {
    await db.d1.batch(statements);
    return { allowed: true };
  } catch {
    try {
      if (await admitted()) return { allowed: true };
      if (exceeded(subjects, await currentCounts(db, subjects, window))) return denied;
    } catch { /* An unreadable counter cannot authorize a new order. */ }
    return unavailable;
  }
}
