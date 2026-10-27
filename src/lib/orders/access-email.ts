// src/lib/orders/access-email.ts — Antrean + pengirim email PIN akses checkout.
//
// Invariants:
// - Queue key `email:access_pin:<order_code>:v<version>`; status antre 'failed'
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
import { ACCESS_PIN_EMAIL_PREFIX } from "./access-email-queue";
export { ACCESS_PIN_EMAIL_PREFIX, checkoutPinEmailStatement } from "./access-email-queue";

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
 * Jadwalkan kirim PIN checkout. Menangkap Cloudflare ctx.waitUntil SEBELUM
 * task dimulai (pola paid-fulfillment); dev/test tanpa context menunggu task
 * yang sama. Hanya mengirim versi antre untuk order ini.
 */
export async function scheduleCheckoutPinEmail(orderCode: string): Promise<void> {
  let waitUntil: ((task: Promise<unknown>) => void) | undefined;
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    waitUntil = getRequestContext().ctx.waitUntil.bind(getRequestContext().ctx);
  } catch { /* Dev/test tanpa Pages context. */ }
  const task = processCheckoutPinEmails(createDatabaseAccess(), 2, String(orderCode))
    .then(() => undefined).catch(() => undefined);
  if (waitUntil) {
    try { waitUntil(task); return; } catch { /* Await task yang sama. */ }
  }
  await task;
}

type OrderRow = {
  code?: unknown; customer_email?: unknown; sales_channel?: unknown;
  buyer_access_version?: unknown; buyer_access_format?: unknown;
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

/**
 * Sapu bounded antrean PIN checkout: hanya prefix access_pin, maks 2/tick,
 * hormati db.canSpend, deadline jaringan 8 dtk/email, tanpa override
 * budget/tail. CAS lease sebelum fetch; reclaim basi 10 menit tepat satu;
 * attempts dibatasi 5 dengan retry 1/5/15/60 mnt; settle akhir hanya bila
 * lease sama (fenced).
 */
export async function processCheckoutPinEmails(
  db: DatabaseAccess, limit = 2, orderCode?: string,
  options: { hasTime?: (needMs: number) => boolean } = {},
): Promise<{ sent: number; failed: number }> {
  const empty = { sent: 0, failed: 0 };
  const max = Math.min(2, Math.max(1, Math.floor(Number(limit) || 2)));
  const onlyCode = typeof orderCode === "string" && orderCode ? orderCode : null;
  if (!db.canSpend(4)) return empty;

  // Reclaim tepat satu lease basi agar worker crash tidak menahan antrean.
  try {
    if (onlyCode) {
      await db.execRun(
        `UPDATE buyer_notice_log SET status='failed', access_lease=NULL, updated_at=datetime('now')
          WHERE idempotency_key IN (
            SELECT idempotency_key FROM buyer_notice_log
             WHERE idempotency_key LIKE '${ACCESS_PIN_EMAIL_PREFIX}%'
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
             WHERE idempotency_key LIKE '${ACCESS_PIN_EMAIL_PREFIX}%'
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
          WHERE idempotency_key LIKE '${ACCESS_PIN_EMAIL_PREFIX}%'
            AND order_code=? AND status='failed' AND access_attempts < ?
            AND (access_retry_at IS NULL OR datetime(access_retry_at) <= datetime('now'))
          ORDER BY created_at ASC LIMIT ?`,
        onlyCode, ACCESS_PIN_MAX_ATTEMPTS, max,
      )
      : await db.queryAll(
        `SELECT idempotency_key, order_code, access_attempts FROM buyer_notice_log
          WHERE idempotency_key LIKE '${ACCESS_PIN_EMAIL_PREFIX}%'
            AND status='failed' AND access_attempts < ?
            AND (access_retry_at IS NULL OR datetime(access_retry_at) <= datetime('now'))
          ORDER BY created_at ASC LIMIT ?`,
        ACCESS_PIN_MAX_ATTEMPTS, max,
      );
  } catch {
    return empty;
  }

  let sent = 0, failed = 0;
  for (const row of due.slice(0, max)) {
    if (!db.canSpend(4) || (options.hasTime && !options.hasTime(ACCESS_PIN_SEND_TIMEOUT_MS + 1_000))) break;
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
        `SELECT code, customer_email, sales_channel, buyer_access_version, buyer_access_format
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
    const { renderBrandedNotice } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    // Status-netral: email ini juga boleh dikirim saat rotate/retry sesudah paid.
    const rendered = renderBrandedNotice({
      orderCode: code,
      orderUrl,
      supportWa: SITE.adminWaLocal,
      title: "PIN Akses Pesanan",
      subtitle: "Gunakan PIN untuk membuka halaman pesananmu.",
      paragraphs: [
        `Simpan PIN ini baik-baik dan jangan bagikan ke siapa pun.`,
        `Buka halaman pesanan untuk memeriksa pembayaran dan produkmu.`,
      ],
      buyerAccessCode: pin,
    });
    const subject = `PIN akses pesanan ${code} | AXVARA`;
    const idempotencyKey = `axvara-access-pin:${code}:v${version}`;
    if (options.hasTime && !options.hasTime(ACCESS_PIN_SEND_TIMEOUT_MS + 1_000)) {
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
