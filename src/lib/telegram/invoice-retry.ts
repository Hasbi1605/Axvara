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
import { sendPhoto } from "@/lib/telegram/api";
import { invoiceMessage } from "@/lib/telegram/messages";
import { qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";

type InvoiceOrderRow = {
  code: string;
  items: string;
  telegram_chat_id: string | null;
  subtotal: number;
  telegram_invoice_sent_at: string | null;
  telegram_invoice_attempts: number;
};

async function readInvoiceOrder(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<InvoiceOrderRow | null> {
  const { queryFirst } = database;
  const row = await queryFirst(
    `SELECT code, items, telegram_chat_id, subtotal,
            telegram_invoice_sent_at, telegram_invoice_attempts
     FROM orders WHERE code=? AND sales_channel='telegram' AND status='pending'`,
    orderCode,
  );
  if (!row) return null;
  return {
    code: String(row.code),
    items: String(row.items ?? "[]"),
    telegram_chat_id: row.telegram_chat_id != null ? String(row.telegram_chat_id) : null,
    subtotal: Number(row.subtotal ?? 0),
    telegram_invoice_sent_at: row.telegram_invoice_sent_at != null ? String(row.telegram_invoice_sent_at) : null,
    telegram_invoice_attempts: Number(row.telegram_invoice_attempts ?? 0),
  };
}

function productLabel(itemsRaw: string): string {
  try {
    const items = JSON.parse(itemsRaw) as { name?: string; qty?: number }[];
    if (!Array.isArray(items) || !items.length) return "Pesanan";
    if (items.length === 1) return String(items[0]?.name ?? "Pesanan");
    return `Keranjang (${items.length} item): ${items.map((i) => `${String(i.name ?? "Item")} ×${Number(i.qty ?? 1)}`).join(", ")}`;
  } catch {
    return "Pesanan";
  }
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
  const ledger = await queryFirst(
    `SELECT payable_amount, expires_at, qris_url FROM payment_transactions
     WHERE order_code=? AND provider='dana' AND status='pending'`,
    orderCode,
  );
  if (!ledger || !isFutureIso(ledger.expires_at)) return false;
  const payableAmount = Number(ledger.payable_amount ?? order.subtotal ?? 0);
  if (!Number.isSafeInteger(payableAmount) || payableAmount <= 0) return false;
  await execRun(
    `UPDATE orders SET telegram_invoice_attempts=telegram_invoice_attempts+1, updated_at=datetime('now') WHERE code=?`,
    orderCode,
  ).catch(() => {});
  const result = await sendPhoto({
    chat_id: Number(order.telegram_chat_id),
    photo: String(ledger.qris_url ?? ""),
    caption: invoiceMessage({
      orderCode: order.code,
      productName: productLabel(order.items),
      payableAmount,
      expiresAt: String(ledger.expires_at ?? ""),
      paymentMethod: "qris",
    }),
    parse_mode: "HTML",
    reply_markup: qrisInvoiceKeyboard(order.code),
  }).catch(() => ({ ok: false as const, description: "send_threw" }));
  if (!result.ok) return false;
  await markInvoiceSent(orderCode, database);
  return true;
}

/**
 * Sapu invoice pending Telegram (dipanggil cron fase notify).
 * Batasan per panggilan agar tunduk pada budget cron. Mengembalikan jumlah
 * foto yang akhirnya terkirim pada panggilan ini.
 */
export async function retryInvoicePendingTelegramInvoices(limit = 4, database: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  const { queryAll } = database;
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") return 0;
  if (!database.canSpend(1)) return 0;

  const pending = await queryAll(
    `SELECT o.code FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider='dana' AND pt.status='pending'
     WHERE o.sales_channel='telegram' AND o.status='pending'
       AND o.telegram_invoice_sent_at IS NULL AND o.telegram_invoice_attempts < 5
       AND julianday(pt.expires_at)>julianday('now')
     ORDER BY o.created_at ASC LIMIT ?`,
    limit,
  ).catch(() => [] as Record<string, unknown>[]);
  let sent = 0;
  for (const row of pending) {
    if (!database.canSpend(4)) break;
    try {
      if (await retryTelegramInvoiceDelivery(String(row.code), database)) sent++;
    } catch { /* cron berikutnya retry */ }
  }
  return sent;
}
