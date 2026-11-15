export type AivaultFamily = { key: string; name: string; slug: string; images: string[]; label: string };
const specs: { key:string; name:string; slug:string; images:string[]; services:Record<string,string> }[] = [
  { key: "adobe-express", name: "Adobe Express", slug: "adobe-express-av", images: ["adobe-creative-cloud","adobe-firefly-sk"], services: { service_adobe_express_6m: "6 Bulan", service_1789191781: "12 Bulan" } },
  { key: "gemini", name: "Google AI / Gemini Plus", slug: "gemini-plus-av", images: ["google-ai-pro-antigravity","gemini-ai-sk"], services: { service_gemini_plus_6m: "Gemini Plus 6 Bulan" } },
  { key: "apple-music", name: "Apple Music", slug: "apple-music-av", images: ["apple-music","apple-music-sk"], services: { service_1789191878: "5 Bulan" } },
  { key: "notion", name: "Notion Education Plus", slug: "notion-plus-av", images: [], services: { service_notion_plus: "Plus 12 Bulan" } },
  { key: "udemy", name: "Udemy Personal Plan", slug: "udemy-av", images: [], services: { service_udemy_1m: "1 Bulan" } },
];
export function aivaultFamily(serviceId: string, name: string): AivaultFamily {
  for (const s of specs) {
    const label = s.services[serviceId];
    if (label) return { key:s.key, name:s.name, slug:s.slug, images:s.images, label };
  }
  // Full service ID is an injective suffix: equal names and sanitized names cannot collide.
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,70) || "product";
  const suffix = Array.from(serviceId).map(c => c.charCodeAt(0).toString(16).padStart(2,"0")).join("");
  return { key:`service:${serviceId}`, name, slug:`${slug}-${suffix}-av`, images:[], label:name };
}
export const aivaultDefaultDescription = (name: string) => `${name}. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.`;
export function aivaultSellPrice(cost: number, fx: number, markup = 35): number {
  if (![cost,fx,markup].every(Number.isFinite) || cost <= 0 || fx <= 0 || markup < 0 || markup > 1000) throw new Error("invalid_pricing");
  const sell = Math.ceil(cost * fx * (1 + markup / 100) / 100) * 100;
  if (!Number.isSafeInteger(sell) || sell <= 0) throw new Error("invalid_pricing");
  return sell;
}
