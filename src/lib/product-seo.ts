// src/lib/product-seo.ts — Helper SEO server-side untuk halaman produk (issue #11).
//
// PDP adalah "use client" sehingga crawler/preview yang tidak mengeksekusi
// JS hanya melihat shell kosong: title generik, tanpa h1, tanpa canonical,
// tanpa JSON-LD, dan slug ngawur tetap 200. Helper ini dipakai oleh
// `generateMetadata` + JSON-LD server component agar metadata selalu dari
// data nyata D1 (produk aktif + varian aktif), bukan seed statis.

export type SeoVariant = {
  price: number;
  compare_price: number | null;
  stock: number;
};

export type SeoProduct = {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  images: string | null;
  badge: string | null;
  sold_count: number | null;
  updated_at?: string | null;
  variants: SeoVariant[];
};

export function seoDescription(product: SeoProduct, maxLen = 160): string {
  const raw = String(product.description ?? "").replace(/\s+/g, " ").trim();
  if (raw) return raw.length > maxLen ? `${raw.slice(0, maxLen - 1).trimEnd()}…` : raw;
  return `${product.name} — tersedia di AXVARA dengan garansi sesuai deskripsi produk.`;
}

export function seoMinPrice(product: SeoProduct): number | null {
  if (product.variants.length === 0) return null;
  return Math.min(...product.variants.map((v) => v.price));
}

export function seoMaxPrice(product: SeoProduct): number | null {
  if (product.variants.length === 0) return null;
  return Math.max(...product.variants.map((v) => v.price));
}

export function seoAvailability(product: SeoProduct): "InStock" | "OutOfStock" {
  if (product.variants.length === 0) return "OutOfStock";
  const anyAvailable = product.variants.some((v) => v.stock === -1 || v.stock > 0);
  return anyAvailable ? "InStock" : "OutOfStock";
}

export function seoImages(product: SeoProduct): string[] {
  const out: string[] = [];
  if (product.image) out.push(product.image);
  try {
    const parsed = product.images ? (JSON.parse(product.images) as unknown) : [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string" && item && !out.includes(item)) out.push(item);
      }
    }
  } catch { /* abaikan images korup — pakai image utama saja */ }
  return out.slice(0, 8);
}

export function seoProductJsonLd(product: SeoProduct, canonicalUrl: string): Record<string, unknown> {
  const minPrice = seoMinPrice(product);
  const images = seoImages(product);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: seoDescription(product),
    image: images.length > 0 ? images : undefined,
    sku: product.slug,
    brand: { "@type": "Brand", name: "AXVARA" },
    offers: {
      "@type": "AggregateOffer",
      url: canonicalUrl,
      priceCurrency: "IDR",
      lowPrice: minPrice ?? undefined,
      highPrice: seoMaxPrice(product) ?? undefined,
      offerCount: product.variants.length || undefined,
      availability: `https://schema.org/${seoAvailability(product)}`,
    },
  };
}
