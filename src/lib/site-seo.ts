// src/lib/site-seo.ts — Data terstruktur (JSON-LD) tingkat situs untuk SEO & GEO.
//
// GEO = mesin jawab AI (ChatGPT, Perplexity, Gemini). Crawler mereka umumnya
// TIDAK menjalankan JavaScript, jadi fakta toko harus ada di HTML server:
// siapa AXVARA, cara bayar, dan produk apa yang dijual beserta URL-nya.
import { SITE } from "@/lib/site";
import type { Product } from "@/lib/products";

export const SITE_BASE = (process.env.SITE_URL || SITE.webUrl).replace(/\/$/, "");

/** JSON-LD & OG wajib URL absolut; gambar produk tersimpan relatif (/r2/...). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@type": "Organization",
    "@id": `${SITE_BASE}/#organization`,
    name: SITE.name,
    url: SITE_BASE,
    logo: absoluteUrl("/brand/axvara-email-mark.png"),
    description: "Toko digital independen (third-party) untuk akun premium, AI gateway, dan tools pro. Bayar QRIS terverifikasi otomatis.",
    sameAs: [`https://t.me/${SITE.adminTelegram}`],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: `+${SITE.adminWaIntl}`,
      availableLanguage: ["id"],
      hoursAvailable: SITE.supportHours,
    },
  };
}

function isSoldOut(product: Product): boolean {
  return product.stock != null && product.stock !== -1 && product.stock <= 0;
}

/** Organization + WebSite + daftar produk (ready dulu, sama dengan urutan beranda). */
export function homeJsonLd(products: Product[]): Record<string, unknown> {
  const listed = products
    .slice()
    .sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .slice(0, 50);
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationJsonLd(),
      {
        "@type": "WebSite",
        "@id": `${SITE_BASE}/#website`,
        name: SITE.name,
        url: SITE_BASE,
        inLanguage: "id-ID",
        publisher: { "@id": `${SITE_BASE}/#organization` },
      },
      {
        "@type": "ItemList",
        name: "Katalog AXVARA",
        numberOfItems: listed.length,
        itemListElement: listed.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: absoluteUrl(`/produk/${product.slug}`),
          name: product.name,
        })),
      },
    ],
  };
}

/** Stringify aman untuk <script>: teks editorial bisa berisi "</script>". */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
