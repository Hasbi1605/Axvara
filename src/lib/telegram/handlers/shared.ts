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

/** Bersihkan state percakapan (pending_action) milik user, best-effort. */
export async function clearPendingAction(from?: { id: number }) {
  if (from && isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action IS NOT NULL`,
      String(from.id),
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
