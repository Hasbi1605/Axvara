import type { DatabaseAccess } from "@/lib/db-access";

export async function purgePixelverifInput(db: DatabaseAccess, order_code: string, item_index: number): Promise<number> {
  const result = await db.execRun(
    `UPDATE pixelverif_buyer_inputs SET input_ciphertext=NULL, input_iv=NULL, purged_at=datetime('now')
     WHERE order_code=? AND item_index=? AND purged_at IS NULL`,
    order_code, item_index,
  );
  return Number(result.changes ?? 0);
}

export async function purgeExpiredPixelverifInputs(db: DatabaseAccess) {
  // One statement: select and clear atomically, so payment cannot race a stale read.
  return db.execRun(
    `UPDATE pixelverif_buyer_inputs SET input_ciphertext=NULL, input_iv=NULL, purged_at=datetime('now')
     WHERE rowid IN (
       SELECT i.rowid FROM pixelverif_buyer_inputs i JOIN orders o ON o.code=i.order_code
       WHERE i.purged_at IS NULL AND (
         o.status IN ('kadaluarsa','dibatalkan') OR
         (o.status='pending' AND o.payment_status IN ('unpaid','pending','expired','failed') AND datetime(o.expires_at)<=datetime('now'))
       ) ORDER BY i.created_at,i.rowid LIMIT 50
     )`,
  );
}
