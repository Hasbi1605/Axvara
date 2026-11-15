import { getAivaultApiKey, getAivaultBaseUrl, isAivaultConfigured, validServiceId } from "./client";
/** Internal dispatcher only. Always replay the exact durable external ID; never accept normal price. */
export async function buyAivaultProduct(serviceId: string, quantity: number, externalOrderId: string): Promise<{ status: number; text: string }> {
  if (!isAivaultConfigured()) throw new Error("not_configured");
  if (!validServiceId(serviceId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || !/^[A-Za-z0-9_-]{1,200}$/.test(externalOrderId)) throw new Error("invalid_purchase");
  const res = await fetch(`${getAivaultBaseUrl()}/api/v1/order`, {
    method: "POST", headers: { "x-api-key": getAivaultApiKey(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ service_id: serviceId, quantity, external_order_id: externalOrderId }), redirect: "manual", signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}
