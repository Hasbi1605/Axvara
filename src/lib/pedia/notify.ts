// src/lib/pedia/notify.ts — Notifikasi Telegram Pedia (PEDIA-PRD II/§9.5).
//
// Modest: hanya 3 ke pembeli (dibayar→kirim rupiah; selesai; partial+kredit)
// + 2 ke admin (needs_check konfirmasi ganda resubmit/cancel; saldo < ambang).
// TIDAK ADA spam per-paket kecil. Email pembeli dikirim bersamaan (M5).

import type { createDatabaseAccess } from "@/lib/db-access";

type Db = ReturnType<typeof createDatabaseAccess>;

export async function pediaOrderSummary(db: Db, orderCode: string): Promise<string> {
  const row = await db.queryFirst(
    `SELECT i.*, p.name AS product_name, p.slug AS product_slug
       FROM pedia_order_items i JOIN pedia_products p ON p.id=i.product_id
      WHERE i.order_code=?`,
    orderCode,
  ).catch(() => null);
  if (!row) return orderCode;
  return `${String(row.product_name)} · ${Number(row.quantity)} · ${String(row.target_normalized).slice(0, 80)}`;
}

/** Pembeli: "X sudah dibayar, lagi kami kirim. Cek status: link" (§9.5). */
export async function notifyPediaPaid(db: Db, orderCode: string, siteUrl: string): Promise<void> {
  const order = await db.queryFirst(`SELECT customer_wa FROM orders WHERE code=?`, orderCode).catch(() => null);
  void order;
  const summary = await pediaOrderSummary(db, orderCode);
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  await sendPediaBuyerMessage(db, orderCode,
    `${summary} sudah dibayar, lagi kami kirim. Cek status: ${siteUrl}/pedia/lacak?code=${orderCode}`);
}

/** Pembeli: selesai. */
export async function notifyPediaCompleted(db: Db, orderCode: string): Promise<void> {
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  const summary = await pediaOrderSummary(db, orderCode);
  await sendPediaBuyerMessage(db, orderCode, `${summary} — selesai. Makasih sudah order di Pedia.`);
}

/** Pembeli: partial/canceled + kode kredit. */
export async function notifyPediaCredit(
  db: Db, orderCode: string, creditCode: string, amount: number, kind: string,
): Promise<void> {
  const { sendPediaBuyerMessage } = await import("@/lib/pedia/notify-channel");
  const summary = await pediaOrderSummary(db, orderCode);
  const label = kind === "partial" ? "sebagian terkirim" : "gagal diproses";
  await sendPediaBuyerMessage(db, orderCode,
    `${summary} ${label}. Sisa Rp ${amount.toLocaleString("id-ID")} jadi kode kredit: ${creditCode} (berlaku 180 hari).`);
}

/** Admin: antrean needs_check (MANUAL — bukan auto-refund). */
export async function notifyPediaNeedsCheck(db: Db, orderCode: string, reason: string): Promise<void> {
  void db;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  const { sendMessage } = await import("@/lib/telegram/api");
  await sendMessage({
    chat_id: chatId,
    text: `🟡 <b>Pedia butuh tindakan manual</b>\n${orderCode}\nSebab: ${reason}\n\nBuka Admin → Pedia → Pesanan.`,
    parse_mode: "HTML",
  }).catch(() => null);
}

/** Admin: saldo supplier < ambang (ping 1×/jam — kunci store_settings). */
export async function notifyPediaLowBalance(balance: number): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;
  const { sendMessage } = await import("@/lib/telegram/api");
  await sendMessage({
    chat_id: chatId,
    text: `🔴 <b>Saldo ProviderSMM menipis</b>\nSisa Rp ${Math.round(balance).toLocaleString("id-ID")}. Top up di panel provider sebelum order macet.`,
    parse_mode: "HTML",
  }).catch(() => null);
}
