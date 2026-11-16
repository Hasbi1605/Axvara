// src/lib/games/notify.ts — notifikasi admin Telegram untuk AXVARA Games
// (docs/GAMES.md §12.3). Best-effort: kegagalan Telegram tidak pernah
// mengubah status pesanan. Meniru notifyPediaNeedsCheck.

import type { DatabaseAccess } from "@/lib/db-access";
import { escapeHtml } from "@/lib/telegram/messages/format";
import { sendToBuyer } from "@/lib/notify-buyer";
import { renderBrandedNotice } from "@/lib/warung-rebahan/email-forward";
import { SITE } from "@/lib/site";

/** One ledger key per lifecycle phase, shared by every payment/webhook/poll path. */
async function notifyGamesBuyer(db: DatabaseAccess, orderCode: string, phase: "paid" | "completed" | "needs-check"): Promise<boolean> {
  try {
    if (!db.canSpend(5)) return false;
    const row = await db.queryFirst(
      `SELECT o.locale, o.status AS order_status, o.payment_status, i.status, i.customer_no,
              i.customer_nickname, i.sn, p.product_name, p.game_brand, p.sk_product_name
         FROM orders o JOIN games_order_items i ON i.order_code=o.code
         LEFT JOIN games_products p ON p.id=i.product_id
        WHERE o.code=? AND o.order_kind='games'`, orderCode,
    );
    if (!row || row.order_status !== "lunas" || row.payment_status !== "paid") return false;
    if (phase === "completed" && (row.status !== "success" || !String(row.sn ?? "").trim())) return false;
    if (phase === "needs-check" && row.status !== "needs_check") return false;
    const en = row.locale === "en";
    const title = phase === "paid" ? (en ? "Payment Received" : "Pembayaran Diterima")
      : phase === "completed" ? (en ? "Top Up Successful" : "Top Up Berhasil")
      : (en ? "Admin Follow-up Required" : "Perlu Tindakan Admin");
    // Late payment notices state the current lifecycle, not stale processing.
    const processing = en ? "Your top up is being processed automatically." : "Top up kamu sedang diproses otomatis.";
    const subtitle = row.status === "success" ? (en ? "Your top up was successful." : "Top up kamu berhasil.")
      : row.status === "needs_check" ? (en ? "Our team is checking your order and will contact you." : "Tim kami sedang memeriksa pesanan dan akan menghubungimu.")
      : processing;
    const details = [
      { label: "Game", value: String(row.sk_product_name || row.game_brand || "Games").slice(0, 200) },
      { label: en ? "Package" : "Nominal", value: String(row.product_name || "Top up").slice(0, 200) },
      { label: en ? "Account ID" : "ID Akun", value: String(row.customer_no).slice(0, 120) },
    ];
    if (row.customer_nickname) details.push({ label: "Nickname", value: String(row.customer_nickname).slice(0, 120) });
    if (phase === "completed") details.push({ label: "SN", value: String(row.sn).slice(0, 120) });
    const orderUrl = `${SITE.gamesUrl.replace(/\/$/, "")}/pesanan/${encodeURIComponent(orderCode)}`;
    const rendered = renderBrandedNotice({
      locale: en ? "en" : "id", orderCode, orderUrl, supportWa: SITE.adminWaLocal,
      title, subtitle, paragraphs: [subtitle], details,
      ctaLabel: en ? "View Order Status →" : "Lihat Status Pesanan →",
      status: { label: title, tone: phase === "needs-check" ? "info" : "success" },
    });
    const subject = `${title} — ${orderCode}`;
    return await sendToBuyer(orderCode, {
      subject, body: `${escapeHtml(title)}\n${escapeHtml(orderCode)}\n${escapeHtml(subtitle)}\n${escapeHtml(orderUrl)}`,
      email: { title, subtitle, paragraphs: [subtitle] },
      emailOverride: { subject, ...rendered }, refKey: `games-${phase}:${orderCode}`,
    }, db, { whatsappFallback: false });
  } catch { return false; }
}

export const notifyGamesPaid = (db: DatabaseAccess, code: string) => notifyGamesBuyer(db, code, "paid");
export const notifyGamesCompleted = (db: DatabaseAccess, code: string) => notifyGamesBuyer(db, code, "completed");
export const notifyGamesBuyerNeedsCheck = (db: DatabaseAccess, code: string) => notifyGamesBuyer(db, code, "needs-check");

/** Admin: pesanan Games butuh tindakan manual (MANUAL — bukan auto-refund). */
export async function notifyGamesNeedsCheck(db: DatabaseAccess | null, orderCode: string, reason: string): Promise<"sent" | "rejected" | "unknown"> {
  if (db) await notifyGamesBuyerNeedsCheck(db, orderCode).catch(() => false);
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return "unknown";
  const item = db && db.canSpend(1) ? await db.queryFirst(
    "SELECT supplier,sk_invoice,supplier_ref FROM games_order_items WHERE order_code=?", orderCode,
  ).catch(() => null) : null;
  const instruction = item?.supplier === "digiflazz"
    ? `Cek order di dashboard Digiflazz (ref_id ${orderCode}-N) sebelum refund/ulang.`
    : `Cek invoice Sekalipay ${String(item?.sk_invoice || "(belum tersedia)")} (ref ${String(item?.supplier_ref || orderCode.replace(/[^A-Za-z0-9]/g, ""))}) di dashboard Sekalipay sebelum refund/ulang.`;
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `🟡 <b>Games butuh tindakan manual</b>\n${escapeHtml(orderCode)}\nSebab: ${escapeHtml(reason.slice(0, 500))}\n\n${escapeHtml(instruction)}`,
    parse_mode: "HTML",
  }).catch(() => null);
  if (result?.ok) return "sent";
  return result && [400, 403, 429].includes(Number(result.error_code)) ? "rejected" : "unknown";
}
