import type { Metadata } from "next";
import { NextRequest } from "next/server";
import type { Product } from "@/lib/products";
import { homeJsonLd, safeJsonLd } from "@/lib/site-seo";
import { HomeClient } from "./home-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Hanya canonical: `openGraph` di sini akan MENGGANTIKAN seluruh openGraph
// root (merge metadata Next.js dangkal), termasuk judul & gambar.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Katalog dirender server agar produk + link ada di HTML awal (SEO & GEO).
 * Memanggil handler `/api/products` yang sama dengan klien — satu sumber
 * query + mapper, tanpa self-fetch HTTP (gagal di edge untuk URL relatif).
 */
async function loadCatalog(): Promise<Product[] | undefined> {
  try {
    const { GET } = await import("@/app/api/products/route");
    const response = await GET(new NextRequest("https://axvara.tech/api/products?active=1"));
    if (!response.ok) return undefined;
    const data = (await response.json()) as { products?: Product[] };
    return Array.isArray(data.products) ? data.products : undefined;
  } catch {
    return undefined;
  }
}

export default async function HomePage() {
  const products = await loadCatalog();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(homeJsonLd(products ?? [])) }} />
      <HomeClient initialProducts={products} />
    </>
  );
}
