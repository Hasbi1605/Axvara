import type { DatabaseAccess } from "@/lib/db-access";
import { PIXELVERIF_INPUT_MAX_AGE_HOURS, PIXELVERIF_RETRYABLE_ERRORS } from "./retryable";

export async function purgePixelverifInput(db: DatabaseAccess, order_code: string, item_index: number): Promise<number> {
  const result = await db.execRun(
    `UPDATE pixelverif_buyer_inputs SET input_ciphertext=NULL, input_iv=NULL, purged_at=datetime('now')
     WHERE order_code=? AND item_index=? AND purged_at IS NULL`,
    order_code, item_index,
  );
  return Number(result.changes ?? 0);
}

export async function purgeExpiredPixelverifInputs(db: DatabaseAccess) {
  const retryableList = [...PIXELVERIF_RETRYABLE_ERRORS].map(() => "?").join(",");
  // One statement: select and clear atomically, so payment cannot race a stale read.
  // Terminal paid links are swept too (settle() purge is best-effort; a failed
  // purge must not leave credentials behind). Retryable pre-send needs_admin
  // links keep the input only within the hard 24h ceiling from creation.
  return db.execRun(
    `UPDATE pixelverif_buyer_inputs SET input_ciphertext=NULL, input_iv=NULL, purged_at=datetime('now')
     WHERE rowid IN (
       SELECT i.rowid FROM pixelverif_buyer_inputs i JOIN orders o ON o.code=i.order_code
       WHERE i.purged_at IS NULL AND (
         datetime(i.created_at)<=datetime('now','-${PIXELVERIF_INPUT_MAX_AGE_HOURS} hours') OR
         o.status IN ('kadaluarsa','dibatalkan') OR
         (o.status='pending' AND o.payment_status IN ('unpaid','pending','expired','failed') AND datetime(o.expires_at)<=datetime('now')) OR
         EXISTS(
           SELECT 1 FROM pixelverif_order_links l
           WHERE l.order_code=i.order_code AND l.item_index=i.item_index
             AND (l.status='completed' OR (l.status='needs_admin' AND NOT (
               l.attempt_count<3 AND l.request_sent_at IS NULL AND l.provider_order_id IS NULL
               AND l.last_error IN (${retryableList})
             )))
         )
       ) ORDER BY i.created_at,i.rowid LIMIT 50
     )`,
    ...PIXELVERIF_RETRYABLE_ERRORS,
  );
}
