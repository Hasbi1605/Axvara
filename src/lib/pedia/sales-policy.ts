// src/lib/pedia/sales-policy.ts — PSMM-POLICY-12: ProviderSMM sole supplier for NEW sales.
//
// Bounded sales policy, not transport policy. Public sale surfaces
// (catalog/prices/quote/orders) and admin creation/activation offer ProviderSMM
// only, even when stale IndoSMM rows remain active in DB. Owner decision
// 2026-11-12 replaces the 2026-11-01 IndoSMM-only policy for NEW sales only;
// no automatic remap of curated legacy rows or order snapshots happens here.
//
// Transport stays two-provider capable: proxy/dispatch/status/refill/credits,
// quote verification, and persisted-order recovery keep serving historical
// IndoSMM orders. No env/DB/proxy changes here.

/** The only supplier allowed for NEW catalog offers, quotes, orders, drafts. */
export const PEDIA_SALE_PROVIDER = "providersmm" as const;
export type PediaSaleProvider = typeof PEDIA_SALE_PROVIDER;
/** Historical supplier: readable + recoverable, never offered for new sales. */
export const PEDIA_LEGACY_PROVIDER = "indosmm" as const;

export function isPediaSaleProvider(value: unknown): value is PediaSaleProvider {
  return value === PEDIA_SALE_PROVIDER;
}

export function isPediaLegacyProvider(value: unknown): value is "indosmm" {
  return value === PEDIA_LEGACY_PROVIDER;
}

/** Public/admin rejection payload for retired-provider new sales. */
export const PEDIA_SALE_RETIRED = {
  error: "provider_retired",
  message: "Layanan ini sudah tidak dijual. Muat ulang katalog dan pilih layanan lain.",
} as const;

// Premium-tool guard for supplier curation candidates: Pedia SMM never sells
// premium tools (Canva/Gemini/CapCut live on Market). Names or categories
// mentioning them are excluded from the admin shortlist.
const PREMIUM_TOOL_RE = /canva|gemini|capcut/i;

export function isPediaPremiumToolCandidate(name: unknown, category: unknown): boolean {
  return PREMIUM_TOOL_RE.test(String(name ?? "")) || PREMIUM_TOOL_RE.test(String(category ?? ""));
}
