// src/lib/sekalipay/deliver.ts — Completion + delivery lisensi SK.
//
// Cermin WR deliver.ts dengan penyesuaian kontrak SK fase 1 (auto):
// - Lisensi datang LANGSUNG di detail trx / webhook order.completed:
//   `items[].licenses[]` (array) atau `product_license` (string).
//   Tidak ada akun invite, tidak ada email_invite, tidak ada SN per-unit.
// - seller_note per varian (instruksi pakai) ikut disimpan + ditampilkan.
// - Status vendor monotonik via CAS (completed tak diregresi failed replay).
// - Item SK memakai fulfillment_items mode 'manual' + kolom sk_link_id
//   (kontrak fulfillment: hanya manual/shared/unique) — diselesaikan via
//   sk_order_links, dilewati processItem generik (pola wr_link_id).
// - Detail lisensi dienkripsi AES-256-GCM; retrieval via jalur kredensial
//   generik yang SUDAH ada (capability token + panel + email).
// - Delivery kredensial REUSE pipeline WR yang sudah ada: plaintext lisensi
//   SK ditulis sebagai fulfillment_items.delivered_ciphertext (migrasi 0043)
//   sehingga panel/email/panel otomatis jalan tanpa kode kirim baru.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { normalizeAccountDetailsForDisplay } from "@/lib/warung-rebahan/deliver";
import type { SkTrxDetail, SkWebhookEvent } from "./client";

export type SkOrderLinkRow = {
  id: number;
  order_code: string;
  sk_invoice: string | null;
  sk_variant_id: string;
  quantity: number;
  sk_cost: number;
  status: string;
};

const SK_STATUS_RANK: Record<string, number> = {
  pending: 0,
  claimed: 1,
  retry: 1,
  blocked_balance: 1,
  submitted: 2,
  ordering: 2,
  processing: 3,
  completed: 4,
  failed: 4,
};

export function skStatusRank(status: unknown): number {
  return SK_STATUS_RANK[String(status)] ?? -1;
}

export async function advanceSkLinkMonotonic(
  skInvoice: string,
  toStatus: "processing" | "completed" | "failed",
  fields: Record<string, unknown> | null,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM sk_order_links WHERE sk_invoice=?`, skInvoice).catch(
    () => null,
  );
  if (!link) return false;
  const from = String(link.status || "");
  if (eventId) {
    const seen = await queryFirst(
      `SELECT id FROM sk_webhook_events WHERE sk_invoice=? AND event_id=? AND applied=1`,
      skInvoice,
      eventId,
    ).catch(() => null);
    if (seen) {
      await logSkWebhookEvent(db, skInvoice, toStatus, eventId, false, "duplicate_event_id").catch(
        () => undefined,
      );
      return true;
    }
  }
  const fromRank = skStatusRank(from);
  const toRank = skStatusRank(toStatus);
  if (fromRank >= 4 && toRank >= 4 && from !== toStatus) {
    await logSkWebhookEvent(db, skInvoice, toStatus, eventId, false, `terminal_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  if (toRank < fromRank) {
    await logSkWebhookEvent(db, skInvoice, toStatus, eventId, false, `rank_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  if (from === toStatus) {
    await logSkWebhookEvent(db, skInvoice, toStatus, eventId, true, "idempotent_replay").catch(
      () => undefined,
    );
    return true;
  }
  const now = new Date().toISOString();
  const sets = [`status='${toStatus}'`, `last_event_at='${now}'`];
  const values: unknown[] = [];
  if (eventId) {
    sets.push(`last_event_id=?`);
    values.push(eventId);
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key}=?`);
      values.push(value);
    }
  }
  sets.push(`updated_at=datetime('now')`);
  const res = await execRun(
    `UPDATE sk_order_links SET ${sets.join(", ")} WHERE sk_invoice=? AND status=?`,
    ...values,
    skInvoice,
    from,
  ).catch(() => ({ changes: 0 as number | undefined }));
  const applied = Number(res.changes ?? 0) > 0;
  await logSkWebhookEvent(
    db,
    skInvoice,
    toStatus,
    eventId,
    applied,
    applied ? `advanced:${from}` : "lost_race",
  ).catch(() => undefined);
  return applied;
}

async function logSkWebhookEvent(
  db: DatabaseAccess,
  skInvoice: string,
  event: string,
  eventId: string | undefined,
  applied: boolean,
  result: string,
): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO sk_webhook_events (sk_invoice, event, event_id, applied, result)
       VALUES (?,?,?,?,?)`,
      skInvoice,
      event,
      eventId ?? null,
      applied ? 1 : 0,
      result.slice(0, 200),
    );
  } catch {
    /* DB pre-0049: tabel belum ada — abaikan, transisi tetap berlaku. */
  }
}

/** Format lisensi SK menjadi plaintext display (reuse normalisasi WR). */
export function formatSkLicenses(detail: SkTrxDetail | SkWebhookEvent["data"]): string {
  const parts: string[] = [];
  const items = Array.isArray((detail as SkTrxDetail).items)
    ? (detail as SkTrxDetail).items
    : Array.isArray((detail as SkWebhookEvent["data"]).items)
      ? (detail as SkWebhookEvent["data"]).items!
      : [];
  for (const item of items) {
    const variantName = String((item as Record<string, unknown>).variant_name || "");
    const productName = String((item as Record<string, unknown>).product_name || "");
    const sellerNote = (item as Record<string, unknown>).seller_note;
    const licenses = (item as Record<string, unknown>).licenses;
    const productLicense = (item as Record<string, unknown>).product_license;
    const lines: string[] = [];
    if (Array.isArray(licenses)) {
      for (const lic of licenses) {
        const l = lic as { product_license?: unknown; note?: unknown };
        const code = String(l?.product_license || "").trim();
        if (code) lines.push(code);
      }
    } else if (typeof productLicense === "string" && productLicense.trim()) {
      lines.push(productLicense.trim());
    }
    const label = [productName, variantName].filter(Boolean).join(" — ");
    const body = lines.join("\n");
    if (label && body) parts.push(`${label}:\n${body}`);
    else if (body) parts.push(body);
    if (typeof sellerNote === "string" && sellerNote.trim()) {
      parts.push(`Catatan: ${sellerNote.trim()}`);
    }
  }
  const raw = parts.join("\n\n").slice(0, 2000);
  // Normalisasi display yang SAMA dengan WR (label Indonesia, anti JSON mentah).
  return normalizeAccountDetailsForDisplay(raw);
}

/** Webhook/detail completed: simpan lisensi terenkripsi + settle item SK. */
export async function handleSkOrderCompleted(
  skInvoice: string,
  detail: SkTrxDetail | SkWebhookEvent["data"],
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM sk_order_links WHERE sk_invoice=?`, skInvoice).catch(
    () => null,
  );
  if (!link) return false;
  const orderCode = String(link.order_code || "");
  const plaintext = formatSkLicenses(detail);
  const { encryptSecret: enc } = await import("@/lib/fulfillment/crypto");
  const { ciphertext, iv } = await enc(plaintext || "(lisensi kosong dari Sekalipay)");
  const now = new Date().toISOString();
  await execRun(
    `UPDATE sk_order_links SET sk_account_details=?, sk_account_iv=?,
       completed_at=?, last_error=NULL, updated_at=datetime('now')
     WHERE sk_invoice=?`,
    ciphertext,
    iv,
    now,
    skInvoice,
  );
  await advanceSkLinkMonotonic(skInvoice, "completed", { completed_at: now, last_error: null }, db);
  // Kaitkan link ke baris itemnya (pola WR) supaya agregat + panel akurat.
  // Best-effort: reconcile/suite lama bisa mengisi fulfillment_item_id lebih
  // dulu; bindSk.. idempoten bila sudah terisi.
  let fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  try {
    fulfillmentItemId = await bindSkLinkToFulfillmentItem(Number(link.id), db);
  } catch { /* link TETAP completed; agregat memakai fallback SK */ }
  if (!fulfillmentItemId) fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  // Tulis lisensi ke fulfillment_items.delivered_ciphertext agar panel web +
  // email "Pesanan Siap" + retrieval token yang SUDAH ada langsung jalan.
  await settleSkFulfillmentItem(orderCode, fulfillmentItemId, ciphertext, iv, db);
  const { refreshOrderAggregate } = await import("@/lib/warung-rebahan/deliver");
  await refreshOrderAggregate(orderCode, db);
  // Kirim email kredensial versi Axvara yang SAMA PERSIS dengan WR/non-WR
  // (template "Pesanan Siap" buildOrderReadyTemplate + tanda terima — keputusan
  // owner: SK tanpa ingest Gmail, webhook adalah source of truth). Panggil
  // SEKARANG (bukan menunggu cron): SK auto selesai hitungan detik setelah
  // lunas, jadi halaman "Mengirim produkmu…" harus berubah jadi detail dalam
  // poll berikutnya. Idempoten per item via buyer_notice_log — retry webhook
  // tidak mengirim email kedua.
  try {
    await sendSkCredentialEmail(orderCode, fulfillmentItemId, db);
  } catch { /* email menyusul via reconcile berikutnya; panel tetap jalan */ }
  return true;
}

/** Webhook order.canceled / reconcile failed: item SK → failed + agregat ulang. */
export async function handleSkOrderFailed(
  skInvoice: string,
  errorMessage: string,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM sk_order_links WHERE sk_invoice=?`, skInvoice).catch(
    () => null,
  );
  if (!link) return false;
  const applied = await advanceSkLinkMonotonic(
    skInvoice,
    "failed",
    { last_error: String(errorMessage || "sk_order_failed").slice(0, 500) },
    db,
    eventId,
  );
  if (!applied) return true;
  const itemId = Number(link.fulfillment_item_id || 0);
  if (itemId > 0) {
    await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?,
         locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      String(errorMessage || "sk_order_failed").slice(0, 500),
      itemId,
    ).catch(() => undefined);
  }
  const { refreshOrderAggregate } = await import("@/lib/warung-rebahan/deliver");
  await refreshOrderAggregate(String(link.order_code), db);
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChatId && process.env.TELEGRAM_BOT_ENABLED === "true") {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: adminChatId,
        text:
          `⚠️ <b>Order Sekalipay gagal</b> <code>${String(link.order_code)}</code>\n` +
          `SK: <code>${skInvoice}</code> — ${String(errorMessage).slice(0, 200)}\n` +
          `Tangani manual (refund/cancel) via admin.`,
        parse_mode: "HTML",
      });
    } catch {
      /* best-effort */
    }
  }
  return true;
}

/** Kaitkan link SK ke baris fulfillment_items yang tepat (pola bindWrLink...). */
export async function bindSkLinkToFulfillmentItem(
  linkId: number,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM sk_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link || Number(link.fulfillment_item_id || 0) > 0) return Number(link?.fulfillment_item_id || 0);
  const orderCode = String(link.order_code || "");
  const items = await queryFirst(
    `SELECT fi.id FROM fulfillment_items fi
     JOIN product_variants pv ON pv.id = fi.variant_id
     WHERE fi.order_code=? AND pv.sk_variant_id=?
     ORDER BY fi.item_index ASC LIMIT 1`,
    orderCode,
    String(link.sk_variant_id || ""),
  ).catch(() => null);
  if (!items) return 0;
  const itemId = Number(items.id);
  await execRun(`UPDATE sk_order_links SET fulfillment_item_id=? WHERE id=?`, itemId, linkId).catch(
    () => undefined,
  );
  await execRun(`UPDATE fulfillment_items SET sk_link_id=? WHERE id=?`, linkId, itemId).catch(
    () => undefined,
  );
  return itemId;
}

/** Selesaikan HANYA item SK terkait (mixed cart tidak delivered prematur). */
async function settleSkFulfillmentItem(
  orderCode: string,
  fulfillmentItemId: number,
  ciphertext: string,
  iv: string,
  db: DatabaseAccess,
): Promise<void> {
  if (fulfillmentItemId > 0) {
    await db
      .execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?,
           delivered_ciphertext=?, delivered_iv=?,
           locked_until=NULL, updated_at=datetime('now') WHERE id=? AND order_code=?`,
        `sk:${fulfillmentItemId}`,
        ciphertext,
        iv,
        fulfillmentItemId,
        orderCode,
      )
      .catch(() => undefined);
    // Tandai kepemilikan SK supaya fulfillment generik melewatinya (pola
    // wr_link_id): tanpa ini processItem mengklaimnya sebagai manual palsu.
    const linked = await db
      .queryFirst(`SELECT id FROM sk_order_links WHERE order_code=? AND fulfillment_item_id=?`, orderCode, fulfillmentItemId)
      .catch(() => null);
    if (linked) {
      await db.execRun(`UPDATE fulfillment_items SET sk_link_id=? WHERE id=?`, Number(linked.id), fulfillmentItemId).catch(
        () => undefined,
      );
    }
    return;
  }
  await db
    .execRun(
      `UPDATE fulfillment_items SET status='delivered', delivered_message_id='sk:legacy',
         delivered_ciphertext=?, delivered_iv=?,
         locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND id IN (
         SELECT fi.id FROM fulfillment_items fi
         JOIN product_variants pv ON pv.id = fi.variant_id
         WHERE fi.order_code=? AND pv.sk_variant_id IS NOT NULL
       )`,
      ciphertext,
      iv,
      orderCode,
      orderCode,
    )
    .catch(() => undefined);
}

export async function decryptSkDetails(ciphertext: string, iv: string): Promise<string> {
  const { decryptSecret } = await import("@/lib/fulfillment/crypto");
  return decryptSecret(ciphertext, iv);
}

// ---------------------------------------------------------------------------
// Email kredensial SK — template Axvara yang SAMA PERSIS dengan WR/non-WR.
// ---------------------------------------------------------------------------

const SK_DELIVERY_EMAIL_TIMEOUT_MS = 8_000;

function skPaymentMethodLabel(method: unknown): string {
  const value = String(method ?? "").trim().toLowerCase();
  if (value === "qris") return "QRIS";
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Kirim email kredensial SK via template "Pesanan Siap" Axvara yang SAMA
 * PERSIS dengan jalur WR (`deliverWebCredentialViaEmail`) dan non-WR
 * (`sendWebDeliveryEmail`): shell Midnight + logo + block detail monospace +
 * kotak peringatan kuning + CTA "Lihat Pesanan →" + blok WA support.
 *
 * Bedanya hanya isi: lisensi SK (formatSkLicenses, sudah didekripsi di
 * pemanggil) + tanda terima pembayaran (satu email, keputusan owner
 * 2026-09-25 — pembeli produk instan menerima SATU email berisi tanda terima
 * + isi produk, bukan dua email terpisah).
 *
 * Idempoten: kunci `email:sk-credential:<order>:<item>` di buyer_notice_log —
 * retry webhook/cron tidak mengirim email kedua. Buyer tanpa email = skip
 * diam (panel + token capability tetap mencakupnya). Gagal kirim = throw agar
 * pemanggil tahu (tapi handleSkOrderCompleted menangkapnya: panel tetap jalan,
 * email menyusul via reconcile).
 */
export async function sendSkCredentialEmail(
  orderCode: string,
  fulfillmentItemId: number,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const code = String(orderCode || "").trim();
  if (!code) throw new Error("sk_credential_order_missing");
  const itemId = Number(fulfillmentItemId || 0);

  const item = itemId > 0
    ? await db
        .queryFirst(
          `SELECT id, item_index, delivered_ciphertext, delivered_iv, status
           FROM fulfillment_items WHERE id=? AND order_code=?`,
          itemId, code,
        )
        .catch(() => null)
    : null;
  if (!item || String(item.status || "") !== "delivered") throw new Error("sk_credential_item_not_delivered");
  const ciphertext = String(item.delivered_ciphertext || "");
  const iv = String(item.delivered_iv || "");
  if (!ciphertext || !iv) throw new Error("sk_credential_empty");

  const key = itemId > 0 ? `email:sk-credential:${code}:${itemId}` : `email:sk-credential:${code}:legacy`;
  const ledger = await db
    .queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key)
    .catch(() => null);
  if (String(ledger?.status ?? "") === "sent") return true;

  const { decryptSecret } = await import("@/lib/fulfillment/crypto");
  const plaintext = await decryptSecret(ciphertext, iv);
  if (!plaintext.trim()) throw new Error("sk_credential_empty");

  const order = await db
    .queryFirst(
      `SELECT o.customer_name, o.customer_email, o.items, o.subtotal, o.payment_method,
              (SELECT pt.payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code
                ORDER BY pt.id DESC LIMIT 1) AS payable_amount,
              (SELECT fi.item_index FROM fulfillment_items fi WHERE fi.id=?) AS item_index
       FROM orders o WHERE o.code=?`,
      itemId > 0 ? itemId : -1, code,
    )
    .catch(() => null);
  if (!order) throw new Error("order_not_found");
  const to = String(order.customer_email ?? "").trim();
  if (!to || !to.includes("@")) return false;

  const { isForwardEmailConfigured, sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
  if (!isForwardEmailConfigured()) throw new Error("forward_email_not_configured");
  const { buildOrderReadyTemplate } = await import("@/lib/warung-rebahan/email-forward");
  const { orderLineLabel } = await import("@/lib/fulfillment/delivery/buyer-email");
  const { SITE } = await import("@/lib/site");
  const siteUrl = (process.env.SITE_URL || SITE.webUrl).replace(/\/$/, "");
  let items: { line: string }[] = [];
  try {
    const parsed = JSON.parse(String(order.items ?? "[]"));
    if (Array.isArray(parsed)) items = parsed as { line: string }[];
  } catch { /* label fallback di bawah */ }
  const label = orderLineLabel(order.items, Number((order as Record<string, unknown>).item_index ?? 0));
  void items;
  const template = buildOrderReadyTemplate({
    axvaraOrderCode: code,
    buyerName: String(order.customer_name ?? ""),
    invoiceUrl: `${siteUrl}/pesanan/${encodeURIComponent(code)}`,
    supportWa: SITE.adminWaLocal,
    items: [{ label, details: plaintext }],
    receipt: {
      total: Number(order.payable_amount ?? order.subtotal ?? 0),
      method: skPaymentMethodLabel(order.payment_method),
      lines: (() => {
        try {
          const parsed = JSON.parse(String(order.items ?? "[]"));
          if (!Array.isArray(parsed)) return [label];
          return (parsed as unknown[]).map((_, index) => orderLineLabel(order.items, index));
        } catch {
          return [label];
        }
      })(),
    },
  });
  const sent = await sendForwardEmail({
    to, subject: template.subject, html: template.html, text: template.text, timeoutMs: SK_DELIVERY_EMAIL_TIMEOUT_MS,
  }).catch((error: unknown) => ({ ok: false as const, providerId: undefined, error: error instanceof Error ? error.message : "resend_failed" }));
  await db.execRun(
    `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status, provider_id, error)
     VALUES (?, ?, 'email', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET status=excluded.status, provider_id=excluded.provider_id,
       error=excluded.error, updated_at=datetime('now')`,
    key, code, sent.ok ? "sent" : "failed", sent.providerId ?? null,
    sent.ok ? null : String(sent.error || "send_failed").slice(0, 300),
  ).catch(() => undefined);
  if (!sent.ok) throw new Error(`sk_credential_email_failed:${String(sent.error || "send_failed").slice(0, 200)}`);
  return true;
}

/** Reconciler email kredensial SK yang tertunda (mis. Resend sempat mati). */
export async function reconcilePendingSkCredentialEmails(
  database?: DatabaseAccess,
  limit = 4,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  const rows = await db
    .queryAll(
      `SELECT fi.order_code AS order_code, fi.id AS item_id
       FROM fulfillment_items fi
       JOIN orders o ON o.code = fi.order_code
       WHERE fi.delivered_message_id LIKE 'sk:%'
         AND fi.status='delivered'
         AND fi.delivered_ciphertext IS NOT NULL
         AND o.status='lunas' AND o.payment_status='paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) > datetime('now','-7 days')
         AND NOT EXISTS(
           SELECT 1 FROM buyer_notice_log b
           WHERE b.idempotency_key IN ('email:sk-credential:' || fi.order_code || ':' || fi.id,
                                       'email:fulfillment-item:' || fi.id)
             AND b.status='sent')
       ORDER BY fi.id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 8)),
    )
    .catch(() => [] as Record<string, unknown>[]);
  let sent = 0;
  for (const row of rows) {
    try {
      if (await sendSkCredentialEmail(String(row.order_code || ""), Number(row.item_id || 0), db)) sent++;
    } catch { /* run berikutnya mencoba lagi */ }
  }
  return sent;
}

export { encryptSecret };
