export type ClaimedPaymentMethod = "QRIS" | "SEABANK" | "EWALLET";

type ProofOrderState = {
  status?: unknown;
  payment_status?: unknown;
  expires_at?: unknown;
};

/**
 * A DANA QRIS Hook event can arrive before an optional WhatsApp proof. Keep
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
 * A dynamic QRIS screenshot is supporting evidence only; QRIS Hook remains
 * authoritative. Manual rails become paid after admin confirms the mutation.
 */
export function authoritativePaymentMethodForProof(
  claimedMethod: string,
  hasDynamicQrisTransaction = false,
): "bank:seabank" | "ewallet" | null {
  if (claimedMethod === "SEABANK") return "bank:seabank";
  if (claimedMethod === "EWALLET") return "ewallet";
  // Every QRIS order is dynamic; screenshots never replace QRIS Hook authority.
  void hasDynamicQrisTransaction;
  return null;
}
