import { isStorebatEnabled, positiveId, storebatRequest, validInvite, validReference } from "./client";

export function buyStorebatProduct(product_id: number, quantity: number, idempotency_key: string, invite_code?: string) {
  if (!isStorebatEnabled() || !positiveId(product_id) || !positiveId(quantity) || quantity > (invite_code ? 30 : 100) || !validReference(idempotency_key) || (invite_code !== undefined && !validInvite(invite_code))) throw new Error("invalid_purchase");
  return invite_code
    ? storebatRequest("/muse-buff/orders", { invite_code, quantity, idempotency_key })
    : storebatRequest("/orders", { product_id, quantity, idempotency_key, customer_reference: idempotency_key });
}
