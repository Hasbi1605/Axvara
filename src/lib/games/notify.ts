// src/lib/games/notify.ts — notifikasi admin Telegram untuk AXVARA Games
// (docs/GAMES.md §12.3). Best-effort: kegagalan Telegram tidak pernah
// mengubah status pesanan. Meniru notifyPediaNeedsCheck.

import type { DatabaseAccess } from "@/lib/db-access";
import { escapeHtml } from "@/lib/telegram/messages/format";

/** Admin: pesanan Games butuh tindakan manual (MANUAL — bukan auto-refund). */
export async function notifyGamesNeedsCheck(db: DatabaseAccess | null, orderCode: string, reason: string): Promise<"sent" | "rejected" | "unknown"> {
  void db;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return "unknown";
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `🟡 <b>Games butuh tindakan manual</b>\n${escapeHtml(orderCode)}\nSebab: ${escapeHtml(reason.slice(0, 500))}\n\nCek order di dashboard Digiflazz (ref_id ${escapeHtml(orderCode)}-N) sebelum refund/ulang.`,
    parse_mode: "HTML",
  }).catch(() => null);
  if (result?.ok) return "sent";
  return result && [400, 403, 429].includes(Number(result.error_code)) ? "rejected" : "unknown";
}
