export type ClaimedPaymentMethod = "QRIS" | "SEABANK" | "EWALLET";

type ProofOrderState = {
  status?: unknown;
  payment_status?: unknown;
  expires_at?: unknown;
};

/**
 * A KlikQRIS callback can arrive before the mandatory WhatsApp proof. Keep
 * accepting proof for that paid order; only an unpaid pending order is bound
 * by the invoice TTL.
 */
export function canAcceptWhatsAppPaymentProof(
  order: ProofOrderState,
  now = Date.now(),
): boolean {
  const status = String(order.status || "");
  const paymentStatus = String(order.payment_status || "");
  if (status === "lunas") return paymentStatus === "paid";
  if (status !== "pending" || !["unpaid", "pending"].includes(paymentStatus)) return false;
  if (!order.expires_at) return true;
  const expiresAt = Date.parse(String(order.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * A dynamic QRIS screenshot is supporting evidence only; KlikQRIS
 * callback/status remains authoritative. Static QRIS and manual rails become
 * paid only after an admin confirms the corresponding mutation in the CMS.
 */
export function authoritativePaymentMethodForProof(
  claimedMethod: string,
  hasDynamicQrisTransaction = false,
): "bank:seabank" | "ewallet" | "qris:manual" | null {
  if (claimedMethod === "SEABANK") return "bank:seabank";
  if (claimedMethod === "EWALLET") return "ewallet";
  // A static QR has no provider callback, so an admin-confirmed merchant
  // mutation is its authority. Dynamic QR remains KlikQRIS-authoritative.
  if (claimedMethod === "QRIS" && !hasDynamicQrisTransaction) return "qris:manual";
  return null;
}
