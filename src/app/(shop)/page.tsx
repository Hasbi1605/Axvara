import type { Metadata } from "next";
import { NextRequest } from "next/server";
import type { Product } from "@/lib/products";
import type { OrderableCategory } from "@/lib/product-order";
import { CATALOG_REVISION_HEADER } from "@/lib/catalog-cache";
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
async function loadCatalog(): Promise<{ products: Product[] | undefined; revision: string | null }> {
  try {
    const { GET } = await import("@/app/api/products/route");
    const response = await GET(new NextRequest("https://axvara.tech/api/products?active=1"));
    if (!response.ok) return { products: undefined, revision: null };
    const revision = response.headers.get(CATALOG_REVISION_HEADER);
    const data = (await response.json()) as { products?: Product[] };
    return {
      products: Array.isArray(data.products) ? data.products : undefined,
      revision,
    };
  } catch {
    return { products: undefined, revision: null };
  }
}

export default async function HomePage() {
  const [{ products, revision }, categories] = await Promise.all([loadCatalog(), loadCategories()]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(homeJsonLd(products ?? [])) }} />
      <HomeClient initialProducts={products} initialCategories={categories} initialRevision={revision} />
    </>
  );
}

async function loadCategories(): Promise<OrderableCategory[] | undefined> {
  try {
    const { GET } = await import("@/app/api/categories/route");
    const response = await GET(new NextRequest("https://axvara.tech/api/categories"));
    if (!response.ok) return undefined;
    const data = await response.json() as { categories?: OrderableCategory[] };
    return Array.isArray(data.categories) ? data.categories : undefined;
  } catch { return undefined; }
}
