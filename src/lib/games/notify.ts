// src/lib/games/notify.ts — notifikasi admin Telegram untuk AXVARA Games
// (docs/GAMES.md §12.3). Best-effort: kegagalan Telegram tidak pernah
// mengubah status pesanan. Meniru notifyPediaNeedsCheck.

import type { DatabaseAccess } from "@/lib/db-access";
import { escapeHtml } from "@/lib/telegram/messages/format";
import { sendToBuyer } from "@/lib/notify-buyer";
import { renderBrandedNotice } from "@/lib/warung-rebahan/email-forward";
import { SITE } from "@/lib/site";
import { gamesVariantName } from "@/lib/games/display-name";

/** One ledger key per lifecycle phase, shared by every payment/webhook/poll path. */
// Pembeli hanya menerima 2 email (keputusan owner 17 Nov 2026): "Pembayaran
// diterima — top up diproses" dan "Top up berhasil" (+SN). Status needs_check
// cukup notif Telegram admin; halaman pesanan tetap menampilkan statusnya.
async function notifyGamesBuyer(db: DatabaseAccess, orderCode: string, phase: "paid" | "completed"): Promise<boolean> {
  try {
    if (!db.canSpend(5)) return false;
    const row = await db.queryFirst(
      `SELECT o.locale, o.status AS order_status, o.payment_status, i.status, i.customer_no,
              i.customer_nickname, i.sn, p.product_name, p.game_brand, p.sk_product_name, p.game_slug,
              gm.display_name AS game_display_name
         FROM orders o JOIN games_order_items i ON i.order_code=o.code
         LEFT JOIN games_products p ON p.id=i.product_id
         LEFT JOIN games_meta gm ON gm.slug=p.game_slug
        WHERE o.code=? AND o.order_kind='games'`, orderCode,
    );
    if (!row || row.order_status !== "lunas" || row.payment_status !== "paid") return false;
    if (phase === "completed" && (row.status !== "success" || !String(row.sn ?? "").trim())) return false;
    const en = row.locale === "en";
    const title = phase === "paid" ? (en ? "Payment Received — Top Up Processing" : "Pembayaran Diterima — Top Up Diproses")
      : (en ? "Top Up Successful" : "Top Up Berhasil");
    // Email lunas yang terlambat menyebut status terkini; tidak pernah menyebut pemeriksaan admin.
    const subtitle = row.status === "success" ? (en ? "Your top up was successful." : "Top up kamu berhasil.")
      : (en ? "Your payment is confirmed and your top up is being processed automatically." : "Pembayaranmu sudah kami terima dan top up sedang diproses otomatis.");
    // Nama game = nama tampilan toko (games_meta), sama dengan storefront/admin.
    const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").slice(0, 200);
    const details = [
      { label: "Game", value: gameName },
      { label: en ? "Package" : "Nominal", value: (gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug: String(row.game_slug ?? "") }) || "Top up").slice(0, 200) },
      { label: en ? "Account ID" : "ID Akun", value: String(row.customer_no).slice(0, 120) },
    ];
    if (row.customer_nickname) details.push({ label: "Nickname", value: String(row.customer_nickname).slice(0, 120) });
    if (phase === "completed") details.push({ label: "SN", value: String(row.sn).slice(0, 120) });
    const orderUrl = `${SITE.gamesUrl.replace(/\/$/, "")}/pesanan/${encodeURIComponent(orderCode)}`;
    const rendered = renderBrandedNotice({
      locale: en ? "en" : "id", orderCode, orderUrl, supportWa: SITE.adminWaLocal,
      title, subtitle, paragraphs: [subtitle], details,
      ctaLabel: en ? "View Order Status →" : "Lihat Status Pesanan →",
      status: { label: title, tone: "success" },
    });
    const subject = `${title} — ${orderCode}`;
    return await sendToBuyer(orderCode, {
      subject, body: `${escapeHtml(title)}\n${escapeHtml(orderCode)}\n${escapeHtml(subtitle)}\n${escapeHtml(orderUrl)}`,
      email: { title, subtitle, paragraphs: [subtitle] },
      emailOverride: { subject, ...rendered }, refKey: `games-${phase}:${orderCode}`,
    }, db);
  } catch { return false; }
}

export const notifyGamesPaid = (db: DatabaseAccess, code: string) => notifyGamesBuyer(db, code, "paid");
export const notifyGamesCompleted = (db: DatabaseAccess, code: string) => notifyGamesBuyer(db, code, "completed");

/** Admin: pesanan Games butuh tindakan manual (MANUAL — bukan auto-refund). */
export async function notifyGamesNeedsCheck(db: DatabaseAccess | null, orderCode: string, reason: string): Promise<"sent" | "rejected" | "unknown"> {
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
