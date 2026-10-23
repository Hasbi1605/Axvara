import type { DatabaseAccess } from "@/lib/db-access";
import { claimKlikQrisPollReconcile, isKlikQrisConfigured, reconcileKlikQrisPayment } from "./klikqris";

// Callback remains primary. This bounded GET-only fallback also runs when the
// buyer closes the page. Visible-page polls share last_checked_at and the CAS.
export const KLIKQRIS_BACKGROUND_LIMIT = 4;
export async function reconcileDueKlikQrisPayments(db: DatabaseAccess) {
  const out = { payments_checked: 0, payments_confirmed: 0, payments_failed: 0 };
  if (!isKlikQrisConfigured()) return out;
  const due = await db.queryAll(
    `SELECT pt.order_code FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='klikqris' AND pt.status='pending' AND o.status='pending'
       AND o.payment_status IN ('pending','unpaid') AND pt.provider_signature IS NOT NULL
       AND julianday(pt.expires_at)>julianday('now')
       AND (o.expires_at IS NULL OR julianday(o.expires_at)>julianday('now'))
       AND (pt.last_checked_at IS NULL OR julianday(pt.last_checked_at)<=julianday('now','-60 seconds'))
     ORDER BY COALESCE(pt.last_checked_at,pt.created_at) ASC,pt.id ASC LIMIT ?`,
    KLIKQRIS_BACKGROUND_LIMIT,
  );
  for (const row of due) {
    const code = String(row.order_code);
    if (!await claimKlikQrisPollReconcile(code)) continue;
    out.payments_checked++;
    try {
      const status = await reconcileKlikQrisPayment(code);
      if (status === "paid") out.payments_confirmed++;
    } catch {
      // The timestamp already moved: failures back off to the next minute,
      // never recreate the invoice or treat failed confirmation as payment.
      out.payments_failed++;
    }
  }
  return out;
}
