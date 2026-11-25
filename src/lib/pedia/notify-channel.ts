// src/lib/pedia/notify-channel.ts — Kanal pesan pembeli Pedia.
//
// Aturan main (§9.5): email SELALU dikirim (pembeli wajib isi email saat
// checkout). WA hanya bila order berasal dari kanal WA (sales_channel
// whatsapp + conversation id) — pola notifyWhatsAppPaidAdmin. Telegram
// pembeli tidak ada (Pedia web-only di fase 1).
//
// Lifecycle emails (paid/processing/completed) use the existing fenced
// buyer_notice_log pattern (mirror notifyTelegramBuyerPaid): claim
// INSERT…ON CONFLICT with UUID lease owner, attempts+1, backoff 1/5/15/60m,
// max 5 attempts, due/stale guard; settle CAS on (key + sending + lease).
// Claim DB error returns false — NO transport without durable ownership
// (fail-closed). Transport is bounded at-least-once (forwarder has no
// downstream idempotency key), NOT exactly-once. Failed/due rows are
// recovered by the existing pedia cron retry sweep (no new cron).
import type { createDatabaseAccess } from "@/lib/db-access";
import { deriveNameFromEmail } from "@/lib/utils";

type Db = ReturnType<typeof createDatabaseAccess>;

export type PediaEmailPhase = "paid" | "processing" | "completed";

/** Max transport attempts per phase (existing 1/5/15/60m backoff ladder). */
export const PEDIA_EMAIL_MAX_ATTEMPTS = 5;

/** Retry backoff minutes by attempt count (existing ledger ladder). */
export function pediaEmailBackoffMinutes(attempts: number): number {
  if (attempts <= 1) return 1;
  if (attempts === 2) return 5;
  if (attempts === 3) return 15;
  return 60;
}

export function pediaEmailKey(phase: PediaEmailPhase, orderCode: string): string {
  return `email:pedia-${phase}:${orderCode}`;
}

/** Read-time name fallback for legacy Pedia rows stored with `''`. New
 *  checkouts store the derived name at insert; non-empty names are never
 *  overwritten here. */
export function pediaDisplayName(order: Record<string, unknown> | null | undefined): string {
  const stored = String(order?.customer_name ?? "").trim();
  if (stored) return stored;
  return deriveNameFromEmail(String(order?.customer_email ?? ""));
}

/** Fenced claim for one lifecycle phase. Returns the lease owner on win,
 *  null when another worker owns it, attempts exhausted, or backoff not due.
 *  Claim DB error returns null — the caller MUST NOT send (fail-closed). */
export async function claimPediaEmail(
  db: Db, phase: PediaEmailPhase, orderCode: string,
): Promise<{ key: string; lease: string } | null> {
  const key = pediaEmailKey(phase, orderCode);
  const lease = crypto.randomUUID();
  try {
    const result = await db.execRun(
      `INSERT INTO buyer_notice_log AS b
         (idempotency_key, order_code, channel, status, access_attempts, access_lease, access_retry_at)
       SELECT ?, ?, 'email', 'sending', 1, ?, datetime('now','+1 minute')
       FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'
       ON CONFLICT(idempotency_key) DO UPDATE SET
         status='sending', access_attempts=b.access_attempts+1, access_lease=excluded.access_lease,
         access_retry_at=datetime('now', CASE b.access_attempts
           WHEN 0 THEN '+1 minute' WHEN 1 THEN '+5 minutes'
           WHEN 2 THEN '+15 minutes' ELSE '+60 minutes' END),
         error=NULL, updated_at=datetime('now')
       WHERE b.access_attempts < ${PEDIA_EMAIL_MAX_ATTEMPTS}
         AND (b.access_retry_at IS NULL OR datetime(b.access_retry_at) <= datetime('now'))
         AND (b.status='failed' OR (b.status='sending'
           AND julianday(b.updated_at) <= julianday('now','-10 minutes')))`,
      key, orderCode, lease, orderCode,
    );
    if (Number(result.changes ?? 0) !== 1) return null;
    return { key, lease };
  } catch {
    // No durable ownership → no transport (fail-closed, precedent:
    // notifyTelegramBuyerPaid returns false when the claim write fails).
    return null;
  }
}

/** Settle ONLY while this worker still holds the lease (CAS). Returns true
 *  when this worker's outcome landed; false (stale lease / already settled)
 *  must not be counted as a send. Attempts increment happened at claim
 *  (before transport), so a timed-out-but-delivered mail keeps its send
 *  without consuming an extra attempt here. */
export async function settlePediaEmail(
  db: Db, key: string, lease: string, ok: boolean, error?: string,
): Promise<boolean> {
  try {
    const result = await db.execRun(
      `UPDATE buyer_notice_log SET status=?, error=?, access_lease=NULL, updated_at=datetime('now')
       WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
      ok ? "sent" : "failed", ok ? null : String(error || "send_failed").slice(0, 300), key, lease,
    );
    return Number(result.changes ?? 0) === 1;
  } catch {
    return false;
  }
}

/** Mark a stale phase send superseded without transport (e.g. paid/processing
 *  deferred until the order already reached a terminal state). CAS-guarded
 *  like a settle so concurrent owners cannot double-write. */
export async function supersedePediaEmail(db: Db, key: string, lease: string, reason: string): Promise<boolean> {
  try {
    const result = await db.execRun(
      `UPDATE buyer_notice_log SET status='sent', error=?, access_lease=NULL, updated_at=datetime('now')
       WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
      `superseded:${reason}`.slice(0, 300), key, lease,
    );
    return Number(result.changes ?? 0) === 1;
  } catch {
    return false;
  }
}

/** Kirim pesan pembeli via email (bila ada) + DM Telegram (bila kanal Telegram). */
export async function sendPediaBuyerMessage(db: Db, orderCode: string, text: string): Promise<void> {
  const order = await db.queryFirst(
    `SELECT code, customer_email, sales_channel, telegram_user_id, locale, buyer_access_version, buyer_access_format FROM orders WHERE code=?`, orderCode,
  ).catch(() => null);
  const email = String(order?.customer_email ?? "").trim();
  if (email) {
    try {
      const { sendPediaEmail } = await import("@/lib/pedia/email");
      await sendPediaEmail({ to: email, subject: `Pedia — ${orderCode}`, text });
    } catch { /* email best-effort; Telegram di bawah tetap jalan */ }
  }
  if (
    String(order?.sales_channel ?? "") === "telegram"
    && process.env.TELEGRAM_BOT_ENABLED === "true"
    && process.env.TELEGRAM_BOT_TOKEN
  ) {
    const chatId = String(order?.telegram_user_id ?? "").trim();
    if (/^[1-9]\d*$/.test(chatId) && Number.isSafeInteger(Number(chatId))) {
      try {
        const locale = String(order?.locale ?? "") === "en" ? "en" as const : "id" as const;
        const { sendMessage } = await import("@/lib/telegram/api");
        const { pediaFollowupNoticeMessage } = await import("@/lib/telegram/messages/pedia");
        const { SITE } = await import("@/lib/site");
        await sendMessage({
          chat_id: chatId,
          text: pediaFollowupNoticeMessage(orderCode, locale),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo admin, mohon bantu pesanan Pedia ${orderCode}.`)}` }],
              [{ text: locale === "en" ? "📋 View Order" : "📋 Lihat Pesanan", callback_data: `order:${orderCode}` }],
            ],
          },
        });
      } catch { /* best-effort; admin followup queue stays durable */ }
    }
  }
}
