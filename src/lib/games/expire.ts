// src/lib/games/expire.ts — order Games belum dibayar lewat deadline →
// order kadaluarsa + item `expired`. Tidak pernah menyentuh stok Market:
// Games tidak mereservasi `products`/`product_variants`, jadi semua cancel
// memakai daftar restock kosong dan guard `transitionPendingOrder` juga
// mengecualikan order_kind 'games' untuk pemanggil bersama.
import type { DatabaseAccess } from "@/lib/db-access";
import { transitionPendingOrder } from "@/lib/db";

const PER_RUN = 5;

export async function expireGamesCheckouts(db: DatabaseAccess): Promise<number> {
  if (!db.d1 || !db.canSpend(3)) return 0;
  const due = await db.queryAll(
    `SELECT o.code FROM orders o JOIN games_order_items i ON i.order_code=o.code
      WHERE o.order_kind='games' AND o.status='pending' AND o.paid_at IS NULL
        AND i.status='awaiting_payment'
        AND o.expires_at IS NOT NULL AND datetime(o.expires_at)<=datetime('now')
      LIMIT ${PER_RUN}`,
  ).catch(() => []);
  for (const row of due) {
    if (!db.canSpend(1)) break;
    try {
      await transitionPendingOrder(String(row.code), "kadaluarsa", "games_expired", [], db.d1);
    } catch { /* sudah terminal / guard kalah — item disapu di bawah */ }
  }
  if (!db.canSpend(1)) return 0;
  const expired = await db.execRun(
    `UPDATE games_order_items SET status='expired', updated_at=datetime('now')
      WHERE status='awaiting_payment' AND order_code IN (
        SELECT o.code FROM orders o JOIN games_order_items i ON i.order_code=o.code
         WHERE o.order_kind='games' AND o.paid_at IS NULL AND i.status='awaiting_payment'
            AND o.status IN ('kadaluarsa','dibatalkan','batal','expired')
         LIMIT 20)`,
  ).catch(() => ({ changes: 0 }));
  return Number(expired.changes) || 0;
}
