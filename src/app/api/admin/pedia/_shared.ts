import { callPediaProxy, type PediaProvider } from "@/lib/pedia/proxy";

// A successful IndoSMM services response also proves the VPS rate-unit gate passed.
export async function providerPricingGate(provider: PediaProvider): Promise<string | null> {
  if (provider === "providersmm") return null;
  const balance = await callPediaProxy<{ balance?: unknown; currency?: unknown }>(provider, "balance", {}, 15_000);
  if (!balance.ok) return "provider_unavailable";
  if (balance.data.currency !== "IDR" || balance.data.balance == null || !Number.isFinite(Number(balance.data.balance)) || Number(balance.data.balance) < 0) return "unsupported_currency";
  const services = await callPediaProxy<unknown>(provider, "services", {}, 30_000);
  return services.ok && Array.isArray(services.data) && services.data.length ? null : "pricing_unverified";
}

export function canResubmit(item: Record<string, unknown>): boolean {
  // Once add was attempted, absence cannot be established from a timeout/error string.
  return Number(item.submit_attempts) === 0 && !item.supplier_order_id;
}
