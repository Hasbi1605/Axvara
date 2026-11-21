// Resend credentials and the current PIN after explicit admin rotation.
//
// Invariants:
// - Queue key `email:credential_access:<order_code>:v<version>`; status antre 'failed'
//   dengan attempts 0 / error NULL (konsisten klaim ulang claimNotice).
// - Metadata-only: PIN di-derive hanya saat kirim/render; HTML/text/PIN tidak
//   pernah disimpan. Baris hanya berisi order ref + versi di key, attempts,
//   lease, provider_id, dan error tag finite yang disanitasi.
// - Payload stabil dari order+version; header Idempotency-Key Resend berbasis
//   order+version (BUKAN PIN).
// - CAS lease sebelum fetch (satu pemenang paralel); reclaim basi 10 menit
//   tepat satu; attempts 5 dengan backoff 1/5/15/60 mnt; settle akhir fenced
//   pada lease yang sama. D1/admission gagal = jangan kirim (tanpa fail-open);
//   Resend tak terkonfigurasi = tunda tanpa makan retry; versi berubah = job
//   lama exhausted 'superseded', PIN baru tidak dikirim di key versi lama.
// - Hanya order pin6 berversi + email valid + non-WA yang dikirim; WA,
//   non-pin6, tanpa email, legacy v0 di-exhaust tanpa kirim.
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { keyPrefixRange } from "@/lib/db/key-prefix";
import { ACCESS_PIN_EMAIL_PREFIX } from "./access-email-queue";
export { ACCESS_PIN_EMAIL_PREFIX, credentialAccessEmailStatement } from "./access-email-queue";

/**
 * BINARY range covering the credential-access key namespace. `LIKE 'prefix%'`
 * is case-insensitive by default and cannot use the TEXT primary-key index
 * (full SCAN); the range form SEARCHes it (audit AU-G2-4).
 */
export function credentialAccessKeyRange(column = "idempotency_key"): string {
  const { start, end } = keyPrefixRange(ACCESS_PIN_EMAIL_PREFIX);
  return `${column} >= '${start}' AND ${column} < '${end}'`;
}

export const ACCESS_PIN_SEND_TIMEOUT_MS = 8_000;
export const ACCESS_PIN_MAX_ATTEMPTS = 5;
export const ACCESS_PIN_STALE_MINUTES = 10;
/** Backoff retry (menit) untuk attempt 1..4; attempt 5 = exhausted. */
const RETRY_MINUTES = [1, 5, 15, 60];

export function accessPinEmailKey(orderCode: string, version: number): string {
  return `${ACCESS_PIN_EMAIL_PREFIX}${orderCode}:v${version}`;
}

function parseKeyVersion(key: string): number | null {
  const match = /:v(\d+)$/.exec(key);
  if (!match) return null;
  const version = Number(match[1]);
  // v0 diterima agar job manual/legacy ikut jalur settle eligible (exhausted
  // ineligible_format), bukan dilewati diam-diam.
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function newLease(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
  }
}

function siteUrl(): string {
  return (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
}

async function credentialEmailKey(code: string, version: number, to: string, content: string): Promise<string> {
  // Partial fulfillment can add credentials between retries. Same content must
  // dedupe; changed content needs a new key without exposing PINs to offline guesses.
  const secret = process.env.BUYER_ORDER_ACCESS_SECRET?.trim() || "axvara-dev-only-buyer-access-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`axvara:credential-email:v1:${code}:${version}:${to}:${content}`)));
  const hash = Array.from(mac.slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return `axvara-credential-access:${code}:v${version}:${hash}`;
}

/** Hanya tag finite yang boleh disimpan; pesan provider mentah (bisa
 *  menggema PIN/PII) tidak pernah dipersist/di-log. */
export function sanitizeAccessPinError(raw: unknown): string {
  const value = String(raw ?? "send_failed").slice(0, 64);
  if (/^resend_[0-9]{3}$/.test(value)) return value;
  if (["resend_timeout", "resend_failed", "forward_email_not_configured", "send_failed",
    "superseded", "ineligible_recipient", "ineligible_format", "ineligible_channel",
    "order_missing", "derive_failed", "claim_unavailable"].includes(value)) return value;
  return "send_failed";
}

function retryAtSql(attempts: number): string | null {
  if (attempts >= ACCESS_PIN_MAX_ATTEMPTS) return null;
  const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] ?? 60;
  return `datetime('now','+${minutes} minute${minutes === 1 ? "" : "s"}')`;
}

/**
 * Resend the full credentials email. Capture ctx.waitUntil before starting
 * task dimulai (pola paid-fulfillment); dev/test tanpa context menunggu task
 * yang sama. Hanya mengirim versi antre untuk order ini.
 */
export async function scheduleCredentialAccessEmail(orderCode: string): Promise<void> {
  let waitUntil: ((task: Promise<unknown>) => void) | undefined;
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    waitUntil = getRequestContext().ctx.waitUntil.bind(getRequestContext().ctx);
  } catch { /* Dev/test tanpa Pages context. */ }
  const task = processCredentialAccessEmails(createDatabaseAccess(), 2, String(orderCode))
    .then(() => undefined).catch(() => undefined);
  if (waitUntil) {
    try { waitUntil(task); return; } catch { /* Await task yang sama. */ }
  }
  await task;
}

type OrderRow = {
  code?: unknown; customer_email?: unknown; sales_channel?: unknown; locale?: unknown;
  buyer_access_version?: unknown; buyer_access_format?: unknown;
  customer_name?: unknown; status?: unknown; payment_status?: unknown;
};

async function settleExhausted(
  db: DatabaseAccess, key: string, lease: string, reason: string,
): Promise<void> {
  await db.execRun(
    `UPDATE buyer_notice_log
        SET status='failed', access_attempts=?, access_retry_at=NULL,
            error=?, access_lease=NULL, updated_at=datetime('now')
      WHERE idempotency_key=? AND access_lease=?`,
    ACCESS_PIN_MAX_ATTEMPTS, sanitizeAccessPinError(reason), key, lease,
  ).catch(() => undefined);
}

async function settleDeferred(db: DatabaseAccess, key: string, lease: string): Promise<void> {
  await db.execRun(
    `UPDATE buyer_notice_log
        SET status='failed', access_retry_at=datetime('now','+1 minute'),
            updated_at=datetime('now')
      WHERE idempotency_key=? AND access_lease=?`,
    key, lease,
  ).catch(() => undefined);
}

export const ACCESS_PIN_BATCH_DEFAULT = 15;
export const ACCESS_PIN_BATCH_MAX = 20;
/** Resend default 2 req/s per team: pace consecutive email sends at 1s (<=1 req/s sustained). */
export const ACCESS_PIN_PACE_MS = 1_000;

/**
 * Sapu bounded antrean resend kredensial: hanya prefix credential_access, maks 20/tick
 * (default 15, jeda 1 dtk antaremail untuk Resend <=1 req/dtk),
 * hormati db.canSpend, deadline jaringan 8 dtk/email, tanpa override
 * budget/tail. CAS lease sebelum fetch; reclaim basi 10 menit tepat satu;
 * attempts dibatasi 5 dengan retry 1/5/15/60 mnt; settle akhir hanya bila
 * lease sama (fenced).
 */
export async function processCredentialAccessEmails(
  db: DatabaseAccess, limit = ACCESS_PIN_BATCH_DEFAULT, orderCode?: string,
  options: { hasTime?: (needMs: number) => boolean; paceMs?: number; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<{ sent: number; failed: number }> {
  const empty = { sent: 0, failed: 0 };
  const max = Math.min(ACCESS_PIN_BATCH_MAX, Math.max(1, Math.floor(Number(limit) || ACCESS_PIN_BATCH_DEFAULT)));
  const paceMs = options.paceMs ?? (process.env.NODE_ENV === "test" ? 0 : ACCESS_PIN_PACE_MS);
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const onlyCode = typeof orderCode === "string" && orderCode ? orderCode : null;
  if (!db.canSpend(4)) return empty;

  // Reclaim tepat satu lease basi agar worker crash tidak menahan antrean.
  try {
    if (onlyCode) {
      await db.execRun(
        `UPDATE buyer_notice_log SET status='failed', access_lease=NULL, updated_at=datetime('now')
          WHERE idempotency_key IN (
            SELECT idempotency_key FROM buyer_notice_log
             WHERE ${credentialAccessKeyRange()}
               AND order_code=? AND status='sending'
               AND julianday(updated_at) < julianday('now','-${ACCESS_PIN_STALE_MINUTES} minutes')
             LIMIT 1)`,
        onlyCode,
      );
    } else {
      await db.execRun(
        `UPDATE buyer_notice_log SET status='failed', access_lease=NULL, updated_at=datetime('now')
          WHERE idempotency_key IN (
            SELECT idempotency_key FROM buyer_notice_log
             WHERE ${credentialAccessKeyRange()}
               AND status='sending'
               AND julianday(updated_at) < julianday('now','-${ACCESS_PIN_STALE_MINUTES} minutes')
             LIMIT 1)`,
      );
    }
  } catch {
    // D1 tak tersedia: JANGAN kirim (tanpa fail-open).
    return empty;
  }

  let due: { idempotency_key?: unknown; order_code?: unknown; access_attempts?: unknown }[];
  try {
    due = onlyCode
      ? await db.queryAll(
        `SELECT idempotency_key, order_code, access_attempts FROM buyer_notice_log
          WHERE ${credentialAccessKeyRange()}
            AND order_code=? AND status='failed' AND access_attempts < ?
            AND (access_retry_at IS NULL OR datetime(access_retry_at) <= datetime('now'))
          ORDER BY created_at ASC LIMIT ?`,
        onlyCode, ACCESS_PIN_MAX_ATTEMPTS, max,
      )
      : await db.queryAll(
        `SELECT idempotency_key, order_code, access_attempts FROM buyer_notice_log
          WHERE ${credentialAccessKeyRange()}
            AND status='failed' AND access_attempts < ?
            AND (access_retry_at IS NULL OR datetime(access_retry_at) <= datetime('now'))
          ORDER BY created_at ASC LIMIT ?`,
        ACCESS_PIN_MAX_ATTEMPTS, max,
      );
  } catch {
    return empty;
  }

  let sent = 0, failed = 0, emailCalls = 0;
  for (const row of due.slice(0, max)) {
    const needMs = ACCESS_PIN_SEND_TIMEOUT_MS + 1_000 + (emailCalls > 0 ? paceMs : 0);
    if (!db.canSpend(8) || (options.hasTime && !options.hasTime(needMs))) break;
    const key = String(row.idempotency_key ?? "");
    const code = String(row.order_code ?? "");
    const keyVersion = parseKeyVersion(key);
    if (!key || !code || keyVersion === null) continue;
    const lease = newLease();

    // CAS lease sebelum fetch: hanya satu pemenang paralel.
    let claimed = false;
    try {
      const result = await db.execRun(
        `UPDATE buyer_notice_log
            SET status='sending', access_lease=?, updated_at=datetime('now')
          WHERE idempotency_key=? AND status='failed' AND access_attempts < ?
            AND (access_retry_at IS NULL OR datetime(access_retry_at) <= datetime('now'))`,
        lease, key, ACCESS_PIN_MAX_ATTEMPTS,
      );
      claimed = Number(result.changes ?? 0) === 1;
    } catch {
      break; // D1 tak tersedia: hentikan sweep, jangan kirim.
    }
    if (!claimed) continue;

    let order: OrderRow | null;
    try {
      order = await db.queryFirst(
        `SELECT code, customer_email, customer_name, status, payment_status, sales_channel, locale, buyer_access_version, buyer_access_format
           FROM orders WHERE code=?`,
        code,
      );
    } catch {
      await settleDeferred(db, key, lease);
      break;
    }

    const version = Number(order?.buyer_access_version);
    const format = String(order?.buyer_access_format ?? "");
    if (!order || !order.code) {
      await settleExhausted(db, key, lease, "order_missing");
      failed++;
      continue;
    }
    // Versi berubah (mis. rotasi): job lama exhausted, PIN baru tidak pernah
    // dikirim di bawah key versi lama.
    if (!Number.isSafeInteger(version) || version !== keyVersion) {
      await settleExhausted(db, key, lease, "superseded");
      failed++;
      continue;
    }
    if (format !== "pin6" || version < 1) {
      await settleExhausted(db, key, lease, "ineligible_format");
      failed++;
      continue;
    }
    if (String(order.sales_channel ?? "") === "whatsapp") {
      await settleExhausted(db, key, lease, "ineligible_channel");
      failed++;
      continue;
    }
    const { isValidBuyerEmail } = await import("@/lib/fulfillment/delivery/buyer-email");
    const to = String(order.customer_email ?? "").trim();
    if (!isValidBuyerEmail(to)) {
      await settleExhausted(db, key, lease, "ineligible_recipient");
      failed++;
      continue;
    }

    if (order.status !== "lunas" || order.payment_status !== "paid") {
      await settleExhausted(db, key, lease, "ineligible_format"); failed++; continue;
    }
    const { getDecryptedAccountDetails } = await import("@/lib/warung-rebahan/deliver");
    const { readDeliveredSnapshots } = await import("@/lib/fulfillment/delivery/buyer-email");
    const wr = await getDecryptedAccountDetails(code, db, { admin: true });
    const snapshots = await readDeliveredSnapshots(code, db);
    const items = [...wr.map(item => ({ label: String(order.locale ?? "id") === "en" ? "Account details" : "Detail akun", details: item.details })), ...snapshots.map(item => ({ label: item.label, details: item.details }))];
    if (!items.length) { await settleDeferred(db, key, lease); continue; }
    const { isForwardEmailConfigured, sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    if (!isForwardEmailConfigured()) {
      // Tunda tanpa makan budget retry.
      await settleDeferred(db, key, lease);
      continue;
    }

    // Derive PIN hanya di sini (ephemeral, tidak disimpan).
    let pin = "";
    try {
      const { deriveOrderAccessCode } = await import("@/lib/order-access");
      pin = await deriveOrderAccessCode({ code, buyer_access_version: version, buyer_access_format: "pin6" });
    } catch {
      await settleDeferred(db, key, lease);
      continue;
    }
    if (!pin) {
      await settleDeferred(db, key, lease);
      continue;
    }

    const orderUrl = `${siteUrl()}/pesanan/${encodeURIComponent(code)}`;
    const { buildOrderReadyTemplate } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    const rendered = buildOrderReadyTemplate({
      locale: String(order.locale ?? "id") === "en" ? "en" : "id",
      axvaraOrderCode: code,
      buyerName: String(order.customer_name || ""),
      invoiceUrl: orderUrl,
      supportWa: SITE.adminWaLocal,
      items,
      buyerAccessCode: pin,
    });
    const subject = rendered.subject;
    const idempotencyKey = await credentialEmailKey(code, version, to, rendered.subject + "\n" + rendered.html + "\n" + rendered.text);
    if (options.hasTime && !options.hasTime(ACCESS_PIN_SEND_TIMEOUT_MS + 1_000 + (emailCalls > 0 ? paceMs : 0))) {
      await settleDeferred(db, key, lease);
      break;
    }
    // Persist before network: a crash or lost provider response still consumes
    // an attempt, so repeated stale leases cannot send indefinitely.
    try {
      const admitted = await db.execRun(`UPDATE buyer_notice_log SET access_attempts=access_attempts+1
        WHERE idempotency_key=? AND access_lease=? AND status='sending' AND access_attempts<?`,
        key, lease, ACCESS_PIN_MAX_ATTEMPTS);
      if (admitted.changes !== 1) continue;
    } catch { break; }
    if (emailCalls > 0 && paceMs > 0) await sleep(paceMs);
    emailCalls++;
    let result: { ok: boolean; providerId?: string; error?: string };
    try {
      result = await sendForwardEmail({
        to, subject, html: rendered.html, text: rendered.text,
        timeoutMs: ACCESS_PIN_SEND_TIMEOUT_MS, idempotencyKey,
      });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : "resend_failed" };
    }

    if (result.ok) {
      // Settle fenced: hanya lease yang sama boleh menutup.
      const settled = await db.execRun(
        `UPDATE buyer_notice_log
            SET status='sent', provider_id=?, error=NULL, access_retry_at=NULL,
                access_lease=NULL, updated_at=datetime('now')
          WHERE idempotency_key=? AND access_lease=?`,
        String(result.providerId ?? "").slice(0, 120) || null, key, lease,
      ).catch(() => null);
      if (settled && Number(settled.changes ?? 0) === 1) sent++;
      continue;
    }

    const attempts = Math.min(ACCESS_PIN_MAX_ATTEMPTS, Number(row.access_attempts ?? 0) + 1);
    const retrySql = retryAtSql(attempts);
    await db.execRun(
      `UPDATE buyer_notice_log
          SET status='failed', access_retry_at=${retrySql ?? "NULL"},
              error=?, access_lease=NULL, updated_at=datetime('now')
        WHERE idempotency_key=? AND access_lease=?`,
      sanitizeAccessPinError(result.error), key, lease,
    ).catch(() => undefined);
    failed++;
  }
  return { sent, failed };
}
