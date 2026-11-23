/** Non-catalog entries, even if they reappear in the mirror. */
export const AIVAULT_EXCLUDED_SERVICE_IDS = ["service_1", "service_2", "service_3", "service_4", "service_5"] as const;

export type AivaultFamily = { key: string; name: string; slug: string; images: string[]; imageUrl?: string; label: string };
const specs: (Omit<AivaultFamily, "label"> & { services: Record<string, string> })[] = [
  { key: "chatgpt-plus", name: "ChatGPT Plus", slug: "chatgpt-plus-av", images: ["chatgpt-plus-1-bulan","chatgpt-tunvn","chatgpt-sk","chatgpt-premium"], services: { service_chatgpt_plus_1m: "Plus 1 Bulan (Apple Pay)", service_chatgpt_plus_1m_fw: "Plus 1 Bulan (Full Garansi)" } },
  { key: "adobe-express", name: "Adobe Express", slug: "adobe-express-av", images: ["adobe-creative-cloud","adobe-firefly-sk"], services: { service_adobe_express_6m: "6 Bulan", service_1789191781: "12 Bulan" } },
  { key: "gemini", name: "Google AI / Gemini Plus", slug: "gemini-plus-av", images: ["google-ai-pro-antigravity","gemini-ai-sk"], services: { service_gemini_plus_6m: "Gemini Plus 6 Bulan" } },
  { key: "apple-music", name: "Apple Music", slug: "apple-music-av", images: ["apple-music","apple-music-sk"], services: { service_1789191878: "5 Bulan" } },
  { key: "notion", name: "Notion Education Plus", slug: "notion-plus-av", images: [], services: { service_notion_plus: "Plus 12 Bulan" } },
  { key: "udemy", name: "Udemy Personal Plan", slug: "udemy-av", images: [], services: { service_udemy_1m: "1 Bulan" } },
  { key: "duolingo", name: "Duolingo Super", slug: "duolingo-super-av", images: ["duolingo-sk","duolingo-sb"], services: { service_duolingo_12m: "Super 12 Bulan" } },
  { key: "ilovepdf", name: "iLovePDF Premium", slug: "ilovepdf-premium-1-year-1d779655-av", images: [], services: { service_ilovepdf_1y: "Premium 1 Tahun", service_ilovepdf_nw: "Premium (Tanpa Garansi)" } },
  { key: "uned-mail", name: "Email Student UNED", slug: "email-student-uned-av", images: [], imageUrl: "/r2/products/c204df6e033ebd2e9f018f51e76f1a5e.webp", services: { service_uned_mail: "Email Student UNED (Spanyol)" } },
];
/** FNV-1a 32-bit: stable, dependency-free short hash for buyer-visible fallback slugs. */
export function aivaultSlugHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
export function aivaultFamily(serviceId: string, name: string): AivaultFamily {
  for (const { services, ...family } of specs) {
    if (Object.hasOwn(services, serviceId)) return { ...family, label: services[serviceId] };
  }
  // Fallback 1:1 keeps the `service:<id>` key (existing identities never move)
  // but the buyer URL uses an 8-hex FNV-1a of the service id instead of the
  // full hex-encoded id. A 32-bit collision is astronomically unlikely, and the
  // publisher's INSERT OR IGNORE + explicit-family ownership never steals
  // another product, so a collision would surface as a skipped insert, not a
  // merged/overwritten catalog row.
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,68) || "product";
  return { key:`service:${serviceId}`, name, slug:`${slug}-${aivaultSlugHash(serviceId)}-av`, images:[], label:name };
}
export const aivaultDefaultDescription = (name: string) => `${name}. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.`;
export function aivaultSellPrice(cost: number, fx: number, markup = 35): number {
  if (![cost,fx,markup].every(Number.isFinite) || cost <= 0 || fx <= 0 || markup < 0 || markup > 1000) throw new Error("invalid_pricing");
  const sell = Math.ceil(cost * fx * (1 + markup / 100) / 100) * 100;
  if (!Number.isSafeInteger(sell) || sell <= 0) throw new Error("invalid_pricing");
  return sell;
}
