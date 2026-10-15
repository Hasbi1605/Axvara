import type { DatabaseAccess } from "@/lib/db-access";

/** Return reserved credit once when an unpaid order expires/cancels. The claim
 * and positive ledger entry share the transaction, so a retry cannot duplicate it. */
export async function expirePediaCheckouts(db: DatabaseAccess) {
  if (!db.d1 || !db.canSpend(4)) return;
  const items = await db.queryAll(`SELECT i.order_code FROM pedia_order_items i JOIN orders o ON o.code=i.order_code
    WHERE i.status IN ('queued','awaiting_payment') AND i.supplier_order_id IS NULL AND i.submit_attempts=0
      AND o.paid_at IS NULL AND (o.status IN ('kadaluarsa','dibatalkan','batal','expired') OR (o.status='pending' AND datetime(o.expires_at)<=datetime('now')))
    LIMIT 5`);
  for (const item of items) {
    if (!db.canSpend(4)) return;
    const nonce=crypto.randomUUID(), code=String(item.order_code);
    const stmt=(q:string,...params:unknown[])=>db.d1!.prepare(q).bind(...params);
    const claimed=`EXISTS(SELECT 1 FROM pedia_order_items WHERE order_code=? AND credit_return_token=?)`;
    await db.d1.batch([
      stmt(`UPDATE pedia_order_items SET status='expired',credit_return_token=?,updated_at=datetime('now') WHERE order_code=? AND status IN ('queued','awaiting_payment') AND supplier_order_id IS NULL AND submit_attempts=0 AND credit_return_token IS NULL
        AND EXISTS(SELECT 1 FROM orders WHERE code=? AND paid_at IS NULL AND (status IN ('kadaluarsa','dibatalkan','batal','expired') OR (status='pending' AND datetime(expires_at)<=datetime('now'))))`,nonce,code,code),
      stmt(`UPDATE orders SET status='kadaluarsa',payment_status='expired' WHERE code=? AND status='pending' AND paid_at IS NULL AND ${claimed}`,code,code,nonce),
      stmt(`UPDATE pedia_credits SET remaining=remaining+(SELECT credit_used FROM pedia_order_items WHERE order_code=?)
        WHERE id=(SELECT credit_id FROM pedia_credit_ledger WHERE order_code=? AND delta<0 LIMIT 1) AND ${claimed}`,code,code,code,nonce),
      stmt(`INSERT INTO pedia_credit_ledger(credit_id,order_code,delta) SELECT credit_id,order_code,-delta FROM pedia_credit_ledger WHERE order_code=? AND delta<0 AND ${claimed}`,code,code,nonce),
    ]);
  }
}
