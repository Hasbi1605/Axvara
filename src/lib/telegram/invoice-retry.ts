import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
// src/lib/telegram/invoice-retry.ts — Pemulihan pengiriman foto invoice
// Telegram yang gagal (RR3-05).
//
// Masalah: createAndSendCartInvoice / createAndSendVariantInvoice memanggil
// sendPhoto invoice TANPA memeriksa hasil {ok:false}. Order + invoice +
// reservasi stok sudah tercipta, cart dikosongkan, tetapi foto pembayaran
// tidak sampai — dan update ditandai done sehingga retry Telegram tidak
// pernah mengirim ulang foto tersebut.
//
// Desain (durable, idempoten, tanpa order kedua):
// - Penanda pengiriman disimpan di kolom orders.telegram_invoice_sent_at
//   (NULL = belum terkirim). Migrasi 0021 (forward-only, nullable).
// - Jalur checkout menandai invoice "pending" (NULL) SEBELUM sendPhoto dan
//   "terkirim" (timestamp) HANYA bila sendPhoto {ok:true}.
// - retryTelegramInvoiceDelivery(orderCode): membaca ulang order + ledger
//   aktif + snapshot item, membangun ulang caption invoice yang SAMA
//   (nominal payable, expiry, nama produk dari DB — bukan dari memori
//   request lama), lalu sendPhoto ulang. Idempoten: bila marker sudah
//   terisi, kembalikan true tanpa kirim ulang.
// - Stok TIDAK dipotong ulang, reservasi TIDAK dibuat ulang, cart TIDAK
//   disentuh (sudah kosong sejak invoice pertama terbit).
// - Cron operations memanggil retryInvoicePendingTelegramInvoices() tiap
//   fase notify (termasuk biaya ke budget) sehingga pemulihan berjalan
//   lewat entrypoint aplikasi — bukan hanya helper manual. "Done saja
//   bukan keberhasilan": update tetap failed/500 agar Telegram redelivery,
//   dan cron menyapu invoice pending yang lolos.
// - Semantik provider yang ambigu didokumentasikan jujur di bawah: Telegram
//   tidak memberi exactly-once untuk sendPhoto — retry dibatasi (maks 5x,
//   backoff via next_attempt_at implisit cron 5-menit) dan dideduplikasi
//   oleh marker DB + guard double-tap order pending yang sudah ada.

import { isFutureIso } from "@/lib/expiry";
import { execRun } from "@/lib/db";
import { sendMessage, sendPhoto } from "@/lib/telegram/api";
import { invoiceMessage } from "@/lib/telegram/messages";
import { invoiceItemSummary } from "@/lib/telegram/messages/format";
import { qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";

type InvoiceOrderRow = {
  code: string;
  telegram_user_id: string | null;
  items: string;
  telegram_chat_id: string | null;
  subtotal: number;
  locale: "id" | "en";
  telegram_invoice_sent_at: string | null;
  telegram_invoice_attempts: number;
  buyer_access_version: unknown;
  buyer_access_format: unknown;
};

async function readInvoiceOrder(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<InvoiceOrderRow | null> {
  const { queryFirst } = database;
  const row = await queryFirst(
    `SELECT code, items, telegram_chat_id, telegram_user_id, subtotal, locale, buyer_access_version, buyer_access_format,
            telegram_invoice_sent_at, telegram_invoice_attempts
     FROM orders WHERE code=? AND sales_channel='telegram' AND status='pending'`,
    orderCode,
  );
  if (!row) return null;
  return {
    code: String(row.code),
    telegram_user_id: row.telegram_user_id != null ? String(row.telegram_user_id) : null,
    items: String(row.items ?? "[]"),
    telegram_chat_id: row.telegram_chat_id != null ? String(row.telegram_chat_id) : null,
    subtotal: Number(row.subtotal ?? 0),
    locale: String(row.locale ?? "") === "en" ? "en" : "id",
    telegram_invoice_sent_at: row.telegram_invoice_sent_at != null ? String(row.telegram_invoice_sent_at) : null,
    telegram_invoice_attempts: Number(row.telegram_invoice_attempts ?? 0),
    buyer_access_version: row.buyer_access_version,
    buyer_access_format: row.buyer_access_format,
  };
}

/**
 * Hasil sendPhoto AMBIGU: timeout/jaringan tanpa error_code dari Telegram.
 * Permintaan mungkin sudah diterima dan foto mendarat belakangan (insiden
 * 2026-11-03: API Telegram lambat → kita menyerah di timeout → cron kirim
 * ulang → pembeli menerima 3 foto QRIS yang sama). Hasil ambigu TIDAK
 * boleh dikirim ulang; penolakan pasti Telegram (ada error_code) tetap
 * memakai jalur retry lama.
 */
export function isAmbiguousSendResult(result: { ok: boolean; error_code?: number }): boolean {
  return !result.ok && result.error_code == null;
}

/**
 * Tutup pengiriman ambigu: tandai terkirim (cron berhenti mengirim ulang)
 * lalu kirim satu teks cadangan berisi link QRIS yang sama agar pembeli
 * tidak buntu bila foto benar-benar tidak sampai.
 */
export async function settleAmbiguousInvoiceSend(
  chatId: number | string,
  orderCode: string,
  qrisUrl: string,
  database: DatabaseAccess = createDatabaseAccess(),
  locale: "id" | "en" = "id",
): Promise<void> {
  await markInvoiceSent(orderCode, database);
  const link = /^https:\/\//.test(qrisUrl) ? `\n\nBuka QRIS: ${qrisUrl}` : "";
  await sendMessage({
    chat_id: chatId,
    text: locale === "en"
      ? `Slow connection — QRIS for <code>${orderCode}</code> may arrive shortly.${link}\nDo not reorder; tap Check Payment.`
      : `Koneksi lambat — QRIS <code>${orderCode}</code> mungkin menyusul.${link}\nJangan order ulang; tekan Cek Pembayaran.`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: qrisInvoiceKeyboard(orderCode, { locale }),
  }).catch(() => {});
}

/** Minimum age of the last claim before another sender may take over a pending
 * gateway/crypto invoice send. Bounds an in-flight first send (Telegram timeout
 * is 10 s) and a crashed claim: recovery is the existing retry, never a lock. */
export const PROVIDER_INVOICE_CLAIM_BACKOFF_SECONDS = 60;
const CLAIM_RELEASED_SQL = `datetime('now','-${PROVIDER_INVOICE_CLAIM_BACKOFF_SECONDS} seconds')`;

/**
 * Tutup klaim kirim sebagai GAGAL PASTI: Telegram menjawab dengan error_code,
 * jadi tidak ada kiriman yang mungkin masih mendarat. Stempel klaim dimundurkan
 * agar retry berikutnya (redelivery/Refresh/cron) boleh langsung mengambil alih
 * tanpa menunggu jendela freshness. Hasil AMBIGU (timeout tanpa error_code)
 * tidak pernah memanggil ini — foto bisa tetap mendarat.
 */
export async function releaseInvoiceSendClaim(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<void> {
  const { execRun } = database;
  await execRun(
    `UPDATE orders SET updated_at=${CLAIM_RELEASED_SQL} WHERE code=? AND telegram_invoice_sent_at IS NULL`,
    orderCode,
  ).catch(() => undefined);
}

/**
 * ONE durable claim for every gateway/crypto invoice text send (initial
 * dispatch AND retry): CAS on the observed `telegram_invoice_attempts`, only
 * while the invoice is undelivered, below the 5-attempt ceiling and not freshly
 * claimed (`updated_at` is stamped by the claim). The first dispatch may claim a
 * brand-new invoice (attempts=0); retries always wait out the backoff. Returns
 * "sent" when already delivered, "busy" when another sender holds it.
 */
export async function claimProviderInvoiceSend(
  orderCode: string,
  opts: { allowFresh: boolean },
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<"claimed" | "sent" | "busy"> {
  const row = await database.queryFirst(
    `SELECT telegram_invoice_sent_at AS sent, telegram_invoice_attempts AS attempts FROM orders WHERE code=?`, orderCode,
  ).catch(() => null);
  if (!row) return "busy";
  if (row.sent) return "sent";
  const attempts = Number(row.attempts ?? 0);
  if (attempts >= 5) return "busy";
  const claimed = await database.execRun(
    `UPDATE orders SET telegram_invoice_attempts=telegram_invoice_attempts+1, updated_at=datetime('now')
     WHERE code=? AND telegram_invoice_sent_at IS NULL AND telegram_invoice_attempts=? AND telegram_invoice_attempts<5
       AND ((?=1 AND telegram_invoice_attempts=0)
         OR COALESCE(updated_at,created_at) IS NULL
         OR julianday(COALESCE(updated_at,created_at))<=julianday('now',?))`,
    orderCode, attempts, opts.allowFresh ? 1 : 0, `-${PROVIDER_INVOICE_CLAIM_BACKOFF_SECONDS} seconds`,
  ).catch(() => ({ changes: 0 }));
  return claimed.changes ? "claimed" : "busy";
}

/**
 * Ambiguous send of a gateway/crypto invoice view. Same convention as the QRIS
 * photo: close the delivery (marker set, no blind resend of a message that may
 * already be on the buyer's screen) and send ONE safe same-order nudge. The
 * nudge carries no amount/address/link/VA — details only come from the saved
 * status view behind the refresh button.
 */
export async function settleAmbiguousProviderInvoice(
  chatId: number | string,
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
  savedLocale?: "id" | "en",
): Promise<void> {
  await markInvoiceSent(orderCode, database);
  // Copy follows the SAVED ORDER locale, never the buyer's current preference.
  const locale = savedLocale ?? (String((await database.queryFirst(`SELECT locale FROM orders WHERE code=?`, orderCode).catch(() => null))?.locale ?? "") === "en" ? "en" : "id");
  await sendMessage({
    chat_id: chatId,
    text: locale === "en"
      ? `Slow connection — details for <code>${orderCode}</code> may arrive shortly.\nDo not reorder; tap Refresh status.`
      : `Koneksi lambat — detail <code>${orderCode}</code> mungkin menyusul.\nJangan order ulang; tekan Refresh status.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: locale === "en" ? "🔄 Refresh status" : "🔄 Refresh status", callback_data: `refresh:${orderCode}` }]] },
  }).catch(() => {});
}

/** Tandai invoice belum terkirim (dipanggil SEBELUM sendPhoto pertama). */
export async function markInvoicePending(orderCode: string): Promise<void> {
  await execRun(
    `UPDATE orders SET telegram_invoice_sent_at=NULL, updated_at=datetime('now') WHERE code=?`,
    orderCode,
  ).catch(() => {});
}

/** Tandai invoice sudah terkirim (HANYA bila sendPhoto {ok:true}). */
export async function markInvoiceSent(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<void> {
  const { execRun } = database;
  await execRun(
    `UPDATE orders SET telegram_invoice_sent_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_invoice_sent_at IS NULL`,
    orderCode,
  ).catch(() => {});
}

/**
 * Kirim ulang foto invoice untuk order pending yang fotonya belum sampai.
 * Idempoten: marker terisi → true tanpa kirim ulang. Stok/reservasi tidak
 * disentuh. Mengembalikan true bila foto kini terkirim (atau sudah
 * terkirim sebelumnya), false bila order/invoice/chat tak valid atau
 * provider masih gagal (cron akan mencoba lagi).
 */
export async function retryTelegramInvoiceDelivery(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
  const order = await readInvoiceOrder(orderCode, database);
  if (!order || !order.telegram_chat_id) return false;
  if (order.telegram_invoice_sent_at) return true; // sudah terkirim
  if (order.telegram_invoice_attempts >= 5) return false; // budget retry habis
  // R3: gateway/crypto invoices retry through the SAME marker/attempt ceiling,
  // but resend the SAVED status view as text (never a QRIS photo, never a
  // create/POST/re-quote/reservation).
  const railTx = await queryFirst(
    `SELECT provider, expires_at FROM payment_transactions
      WHERE order_code=? AND provider IN ('nowpayments','sekalipay_gateway') AND status='pending'`,
    orderCode,
  );
  if (railTx) {
    if (!isFutureIso(railTx.expires_at) || !order.telegram_user_id) return false;
    // Eligibility read + claim (2) + render (2) + delivery marker must fit
    // before the external send, including direct callers with a bounded DB.
    if (!database.canSpend(6)) return false;
    // Pre-read eligibility (existing saved-view builders): a non-live view
    // (expired/review/failed/paid) sends nothing and does NOT burn an attempt.
    const { buildNowpaymentsPaymentView, buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
    const view = railTx.provider === "nowpayments"
      ? await buildNowpaymentsPaymentView(orderCode, database).catch(() => null)
      : await buildSekalipayGatewayPaymentView(orderCode, database).catch(() => null);
    if (!view || !["pending", "confirming", "fee_consent_required"].includes(String(view.state))) return false;
    const claim = await claimProviderInvoiceSend(orderCode, { allowFresh: false }, database);
    if (claim !== "claimed") return claim === "sent";
    const { showProviderInvoiceStatus } = await import("@/lib/telegram/handlers/payment-status");
    const delivery = await showProviderInvoiceStatus(
      Number(order.telegram_chat_id), 0, orderCode, { id: Number(order.telegram_user_id), first_name: "" },
      { locale: order.locale, savedOnly: true, database },
    ).catch(() => ({ kind: "none", ok: false, ambiguous: false }) as const);
    if (delivery.kind !== "live") return false; // view changed between pre-read and render: nothing sent/marked
    if (delivery.ok) return true; // showProviderInvoiceStatus already set the marker
    if (delivery.ambiguous) {
      await settleAmbiguousProviderInvoice(Number(order.telegram_chat_id), order.code, database, order.locale);
      return true;
    }
    return false; // definite rejection: stays pending, bounded by the attempt ceiling
  }
  const ledger = await queryFirst(
    `SELECT provider, payable_amount, expires_at, qris_url FROM payment_transactions
      WHERE order_code=? AND provider IN ('gopay','klikqris') AND status='pending'`,
    orderCode,
  );
  // R2 provider guard: new-rail invoices are handled by the text branch above;
  // this QRIS photo resender MUST NOT touch them.
  if (!ledger || !isFutureIso(ledger.expires_at)) return false;
  if (ledger.provider && !["gopay", "klikqris"].includes(String(ledger.provider))) return false;
  const payableAmount = Number(ledger.payable_amount ?? order.subtotal ?? 0);
  if (!Number.isSafeInteger(payableAmount) || payableAmount <= 0) return false;
  if (!database.canSpend(2)) return false;
  // AU-E2-2: QRIS photos take the SAME atomic pre-send claim as provider text
  // invoices (attempts CAS + claim timestamp). Cron retry and the Refresh
  // callback reading the same unsent marker now defer to one sender instead of
  // double-sending the photo. An invoice that was never claimed may be taken
  // immediately; a failed claim waits out the freshness window unless the last
  // attempt was a DEFINITIVE rejection (releaseInvoiceSendClaim).
  const claim = await claimProviderInvoiceSend(orderCode, { allowFresh: true }, database);
  if (claim !== "claimed") return claim === "sent";
  const result = await sendPhoto({
    chat_id: Number(order.telegram_chat_id),
    photo: String(ledger.qris_url ?? ""),
    caption: invoiceMessage({
      orderCode: order.code,
      productName: invoiceItemSummary(order.items, order.locale === "en"),
      payableAmount,
      expiresAt: String(ledger.expires_at ?? ""),
      paymentMethod: "qris",
    }, { locale: order.locale, chargeNote: true }),
    parse_mode: "HTML",
    reply_markup: qrisInvoiceKeyboard(order.code, { locale: order.locale }),
  }).catch(() => ({ ok: false as const, description: "send_threw", error_code: 0 }));
  if (isAmbiguousSendResult(result)) {
    // Jangan kirim ulang foto yang mungkin sudah mendarat (lihat helper).
    await settleAmbiguousInvoiceSend(Number(order.telegram_chat_id), order.code, String(ledger.qris_url ?? ""), database);
    return true;
  }
  if (!result.ok) {
    // Definitif: lepas stempel klaim agar retry berikutnya boleh langsung.
    await releaseInvoiceSendClaim(orderCode, database);
    return false;
  }
  await markInvoiceSent(orderCode, database);
  return true;
}

/**
 * Sapu invoice pending Telegram (dipanggil cron fase notify).
 * Batasan per panggilan agar tunduk pada budget cron. Mengembalikan jumlah
 * foto yang akhirnya terkirim pada panggilan ini.
 */
export async function retryInvoicePendingTelegramInvoices(limit = 25, database: DatabaseAccess = createDatabaseAccess(), hasTime = (_ms: number) => true): Promise<number> {
  const { queryAll } = database;
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") return 0;
  if (!database.canSpend(1)) return 0;

  const pending = await queryAll(
    `SELECT o.code,pt.provider FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider IN ('gopay','klikqris','nowpayments','sekalipay_gateway') AND pt.status='pending'
     WHERE o.sales_channel='telegram' AND o.status='pending'
       AND o.telegram_invoice_sent_at IS NULL AND o.telegram_invoice_attempts < 5
       AND (pt.provider IN ('gopay','klikqris') OR COALESCE(o.updated_at,o.created_at) IS NULL
         OR julianday(COALESCE(o.updated_at,o.created_at))<=julianday('now','-60 seconds'))
       AND julianday(pt.expires_at)>julianday('now')
     ORDER BY o.created_at ASC LIMIT ?`,
    limit,
  ).catch(() => [] as Record<string, unknown>[]);
  let sent = 0;
  for (const row of pending) {
    const providerText = ["nowpayments", "sekalipay_gateway"].includes(String(row.provider));
    // Reserve the primary send and a possible ambiguity notice before claim.
    if (!database.canSpend(providerText ? 8 : 5) || !hasTime(providerText ? 21_000 : 36_000)) break;
    try {
      if (await retryTelegramInvoiceDelivery(String(row.code), database)) sent++;
    } catch { /* cron berikutnya retry */ }
  }
  return sent;
}
