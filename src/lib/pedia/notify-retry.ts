// src/lib/pedia/notify-retry.ts — Bounded recovery sweep for Pedia buyer lifecycle emails.
//
// Two recovery paths, both inside the existing pedia cron tick (no new cron):
//  1. Existing ledger rows left `failed` (attempts<5, backoff due) or stale
//     `sending` — re-drive the phase sender (fenced claim owns retry).
//  2. Missing ledger rows for phases implied by the CURRENT item state —
//     synthesize them (paid hook may have missed items already past queued,
//     or claim-DB-error sent nothing). Paid/completed discovery is recent-only;
//     active processing waits for valid counts without a 24h ceiling. LIMIT 2
//     per phase, terminal
//     suppression inside the sender (no bulk email of historic orders).
// Partial/canceled/needs_check keep their manual followup flow; no
// repurchase happens here. Transport is bounded at-least-once, not
// exactly-once (documented in notify-channel + contract).
import type { createDatabaseAccess } from "@/lib/db-access";

type Db = ReturnType<typeof createDatabaseAccess>;

const PHASES = ["paid", "processing", "completed"] as const;
type Phase = (typeof PHASES)[number];

const RETRY_LIMIT = 2;

/** Recent eligibility window for missing-phase discovery (avoid historic spam). */
const DISCOVERY_WINDOW = "-24 hours";

// Match the sender's safe-integer bounds before LIMIT so unready rows cannot
// monopolize recovery; the sender rechecks the live row before any claim.
const PROCESSING_READY = `i.status IN ('submitted','in_progress')
  AND length(trim(COALESCE(i.supplier_order_id,''))) > 0
  AND typeof(i.quantity) IN ('integer','real') AND i.quantity > 0 AND i.quantity <= 9007199254740991 AND i.quantity = CAST(i.quantity AS INTEGER)
  AND typeof(i.start_count) IN ('integer','real') AND i.start_count >= 0 AND i.start_count <= 9007199254740991 AND i.start_count = CAST(i.start_count AS INTEGER)
  AND typeof(i.remains) IN ('integer','real') AND i.remains >= 0 AND i.remains <= i.quantity AND i.remains = CAST(i.remains AS INTEGER)`;

/** Item statuses implying each phase is due (evaluated at send time).
 *  Processing synthesizes for SUBMITTED (durable accepted receipt with
 *  supplier_order_id) or IN_PROGRESS. A submitted item's sender allow()
 *  accepts submitted, so discovery mail says "Diproses", never
 *  "sedang berjalan". queued/submitting/needs_check have no receipt and
 *  never synthesize; unpaid never mails (verified inside sender). */
function phaseImplied(phase: Phase): string {
  if (phase === "paid") return `('queued','submitting','submitted','in_progress','completed','partial','canceled','needs_check')`;
  if (phase === "processing") return `('submitted','in_progress')`;
  return `('completed')`;
}

export async function retryPendingPediaEmails(db: Db): Promise<number> {
  let retried = 0;
  const { notifyPediaPaid, notifyPediaProcessing, notifyPediaCompleted } = await import("@/lib/pedia/notify");
  for (const phase of PHASES) {
    // Deterministic affordable budget BEFORE each phase scan: scan read +
    // per-row send reserve. Never start what the budget cannot finish.
    if (!db.canSpend(1 + RETRY_LIMIT * 5)) break;
    // Path 1: existing failed/due rows.
    const rows = await db.queryAll(
      `SELECT b.order_code, b.idempotency_key FROM buyer_notice_log b
        JOIN orders o ON o.code=b.order_code
        JOIN pedia_order_items i ON i.order_code=b.order_code
       WHERE b.idempotency_key LIKE ?
          AND o.status='lunas' AND o.payment_status='paid'
          ${phase === "processing" ? `AND (i.status IN ('completed','partial','canceled','expired') OR (${PROCESSING_READY}))` : ""}
         AND b.access_attempts < 5
         AND (b.status='failed'
           OR (b.status='sending' AND julianday(b.updated_at) < julianday('now','-10 minutes')))
         AND (b.access_retry_at IS NULL OR datetime(b.access_retry_at) <= datetime('now'))
       ORDER BY b.updated_at ASC LIMIT ?`,
      `email:pedia-${phase}:%`, RETRY_LIMIT,
    ).catch(() => []);
    for (const row of rows) {
      if (!db.canSpend(5)) break;
      const code = String(row.order_code);
      try {
        const ok = phase === "paid"
          ? await notifyPediaPaid(db, code)
          : phase === "processing"
            ? await notifyPediaProcessing(db, code)
            : await notifyPediaCompleted(db, code);
        if (ok) retried++;
      } catch { /* ledger stays failed/sending; next tick retries */ }
    }
    // Path 2: missing rows; active processing can become ready after 24 hours.
    if (!db.canSpend(1 + RETRY_LIMIT * 5)) break;
    const missing = await db.queryAll(
      `SELECT o.code AS order_code FROM orders o
        JOIN pedia_order_items i ON i.order_code=o.code
       WHERE o.status='lunas' AND o.payment_status='paid'
          AND i.status IN ${phaseImplied(phase)}
          ${phase === "processing" ? `AND (${PROCESSING_READY})` : `AND datetime(COALESCE(o.paid_at, o.updated_at)) >= datetime('now','${DISCOVERY_WINDOW}')`}
         AND NOT EXISTS (SELECT 1 FROM buyer_notice_log b
           WHERE b.idempotency_key='email:pedia-${phase}:' || o.code)
       ORDER BY COALESCE(o.paid_at, o.updated_at) DESC LIMIT ?`,
      RETRY_LIMIT,
    ).catch(() => []);
    for (const row of missing) {
      if (!db.canSpend(5)) break;
      const code = String(row.order_code);
      try {
        const ok = phase === "paid"
          ? await notifyPediaPaid(db, code)
          : phase === "processing"
            ? await notifyPediaProcessing(db, code)
            : await notifyPediaCompleted(db, code);
        if (ok) retried++;
      } catch { /* fenced sender owns retry; next tick recovers */ }
    }
  }
  return retried;
}
