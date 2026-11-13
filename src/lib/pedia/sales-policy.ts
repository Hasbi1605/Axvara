// src/lib/pedia/sales-policy.ts — INDO-POLICY-20: IndoSMM sole supplier.
//
// Bounded sales policy, not transport policy. Public sale surfaces
// (catalog/prices/quote/orders) and admin creation/activation offer the
// curated IndoSMM catalog only. Owner decision 2026-11-13 retires the
// 2026-11-12 automatic-catalog experiment; the curated IndoSMM tiers that
// survived in D1 are the sale catalog again. No automatic remap of catalog
// rows or order snapshots happens here.
//
// Persisted orders keep their stored supplier/service snapshot and are still
// readable and recoverable; rows of an unknown/retired supplier are never
// offered for new sales and never dispatched.

/** The only supplier allowed for NEW catalog offers, quotes, orders, drafts. */
export const PEDIA_SALE_PROVIDER = "indosmm" as const;
export type PediaSaleProvider = typeof PEDIA_SALE_PROVIDER;

export function isPediaSaleProvider(value: unknown): value is PediaSaleProvider {
  return value === PEDIA_SALE_PROVIDER;
}

/** Public/admin rejection payload for retired-provider new sales. */
export const PEDIA_SALE_RETIRED = {
  error: "provider_retired",
  message: "Layanan ini sudah tidak dijual. Muat ulang katalog dan pilih layanan lain.",
} as const;

// Premium-tool guard for IndoSMM curation candidates: Pedia SMM never sells
// premium tools (Canva/Gemini/CapCut live on Market). Names or categories
// mentioning them are excluded from the admin shortlist.
const PREMIUM_TOOL_RE = /canva|gemini|capcut/i;

export function isPediaPremiumToolCandidate(name: unknown, category: unknown): boolean {
  return PREMIUM_TOOL_RE.test(String(name ?? "")) || PREMIUM_TOOL_RE.test(String(category ?? ""));
}
