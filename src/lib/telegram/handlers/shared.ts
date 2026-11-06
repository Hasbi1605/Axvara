// src/lib/telegram/handlers/shared.ts — Helper kecil bersama antar-handler.
//
// MENGAPA dipisah: markDone, clearPendingAction, getBestsellers, clampQty, dan
// cartLineLabel dipakai oleh beberapa handler (command, callback, cart,
// invoice). Menaruhnya di satu tempat mencegah impor melingkar antar-handler
// dan menjaga perilaku IDENTIK dengan route.ts lama (pemindahan murni).

import { execRun, isD1Mode } from "@/lib/db";
import { TELEGRAM_MAX_QTY } from "@/lib/telegram/keyboards";
import type { TelegramBestseller } from "@/lib/telegram/messages";
import type { CartLine } from "@/lib/telegram/cart";

/** Tandai update Telegram sebagai selesai (idempotency, issue #6). */
export async function markDone(updateId: string) {
  if (isD1Mode()) {
    await execRun(
      `UPDATE telegram_updates SET status='done', updated_at=datetime('now') WHERE update_id=?`,
      updateId,
    );
  }
}

/** Bersihkan state percakapan (pending_action) milik user, best-effort.
 * R2 anchor guard: durable `creating` payq1 TIDAK PERNAH dihapus di sini —
 * berlaku untuk /start, /language, /currency, /batal, katalog, cart, help,
 * checkout lama, dan navigasi router. Hanya quoted/contact/namespace lain
 * yang boleh dibersihkan. Creating dibersihkan HANYA setelah TX tersimpan
 * (status apa pun) atau order terminal via clearPayq1AfterDurableTx. */
export async function clearPendingAction(from?: { id: number }) {
  if (from && isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action IS NOT NULL AND pending_action NOT LIKE 'payq1:%"st":"creating"%'`,
      String(from.id),
    ).catch(() => {});
  }
}

/** Set a new conversational state (qty/search/email/wa) WITHOUT ever replacing
 * a durable `creating` payq1 anchor (R2-C). Returns true when the state was
 * written (or there is no row to write — legacy no-op), false when a creating
 * anchor blocked it; in that case the buyer gets the existing "creating"
 * notice and the caller must stop (the anchor is resumed with the same
 * confirmation button, never discarded). */
export async function setPendingActionUnlessCreating(
  userId: string,
  chatId: number,
  value: string,
): Promise<boolean> {
  if (!isD1Mode()) return true;
  const { queryFirst } = await import("@/lib/db");
  const written = await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND (pending_action IS NULL OR pending_action NOT LIKE 'payq1:%"st":"creating"%')`,
    value, userId,
  ).catch(() => ({ changes: 1 }));
  if ((written.changes ?? 0) > 0) return true;
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, userId).catch(() => null);
  if (!/^payq1:.*"st":"creating"/.test(String(row?.pending_action ?? ""))) return true;
  const { sendMessage } = await import("@/lib/telegram/api");
  const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
  const { paymentMethodNoticeMessage } = await import("@/lib/telegram/messages/purchase");
  const ctx = await tgCtxFor(Number(userId)).catch(() => ({ locale: "id" as const }));
  await sendMessage({ chat_id: chatId, text: paymentMethodNoticeMessage("creating", { locale: ctx.locale }), parse_mode: "HTML" }).catch(() => {});
  return false;
}

/** Explicit /batal: hapus quoted/contact payq1 via exact-CAS, JANGAN sentuh
 * creating (durable anchor; dibersihkan hanya setelah TX/order terminal). */
export async function clearPayq1DraftForCancel(from?: { id: number }) {
  if (!from || !isD1Mode()) return;
  const { readPayq1State } = await import("@/lib/telegram/payment-quote");
  const stored = await readPayq1State(String(from.id)).catch(() => null);
  if (stored?.state && (stored.state.st === "quoted" || stored.state.st === "contact")) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
      String(from.id),
      stored.raw,
    ).catch(() => {});
  }
}

// Bestsellers for the welcome landing (free marketing from sold_count).
export async function getBestsellers(limit = 3): Promise<TelegramBestseller[]> {
  try {
    // Sapaan /start tidak boleh mempromosikan produk yang habis.
    const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
    return (await readTelegramCatalog()).filter(row => row.price !== null && row.sold_count > 0)
      .sort((a,b) => b.sold_count-a.sold_count || a.sort_order-b.sort_order)
      .slice(0, Math.max(0, limit))
      .map(row => ({ productId: row.id, name: row.name, price: row.price!, soldCount: row.sold_count }));
  } catch {
    return [];
  }
}

// --- Clear qty stepper followed directly by dynamic QRIS ---
// (Bulk cap lives in keyboards.ts as TELEGRAM_MAX_QTY.)
export function clampQty(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(TELEGRAM_MAX_QTY, Math.floor(raw)));
}

export function cartLineLabel(line: CartLine): string {
  return `${line.productName} — ${line.variantLabel} ×${line.qty}`;
}
