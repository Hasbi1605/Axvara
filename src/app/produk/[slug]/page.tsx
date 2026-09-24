
import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { queryFirst, queryAll } from "@/lib/db";
import { displayDescription } from "@/lib/catalog";
import type { Product } from "@/lib/products";
import {
  seoDescription,
  seoImages,
  seoProductJsonLd,
  type SeoProduct,
} from "@/lib/product-seo";
import ProductDetailClient, { type InitialCatalog } from "./product-detail-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SITE_BASE = process.env.SITE_URL || "https://axvara.tech";

type SeoRow = Record<string, unknown>;

async function getSeoProduct(slug: string): Promise<SeoProduct | null> {
  const product = (await queryFirst(
    `SELECT p.slug, p.name, p.description, p.admin_description_override,
            p.image_url, p.images, p.badge,
            p.sold_count, p.updated_at
     FROM products p
     WHERE p.slug=? AND p.is_active=1`,
    slug,
  )) as SeoRow | undefined;
  if (!product) return null;
  const variants = (await queryAll(
    `SELECT pv.price, pv.compare_price, pv.stock, pv.min_qty
     FROM product_variants pv
     JOIN products p ON p.id=pv.product_id
     WHERE p.slug=? AND p.is_active=1 AND pv.is_active=1
     ORDER BY pv.sort_order ASC, pv.price ASC, pv.id ASC`,
    slug,
  )) as SeoRow[];
  if (variants.length === 0) return null;
  return {
    slug: String(product.slug),
    name: String(product.name),
    // Override admin (migrasi 0030) menang atas deskripsi WR, sama seperti
    // storefront dan bot. PDP adalah halaman yang dibaca pembeli DAN mesin
    // pencari, jadi meta/OG/JSON-LD tidak boleh memakai teks yang berbeda.
    description: displayDescription(product),
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: product.sold_count != null ? Number(product.sold_count) : null,
    updated_at: product.updated_at ? String(product.updated_at) : null,
    variants: variants.map((v) => ({
      price: Number(v.price),
      compare_price: v.compare_price != null ? Number(v.compare_price) : null,
      stock: Number(v.stock ?? -1),
      min_qty: v.min_qty != null ? Number(v.min_qty) : 1,
    })),
  };
}

/**
 * Data interaktif PDP diambil server lewat handler API yang sama dengan
 * klien (pola beranda): halaman tampil lengkap dari satu respons navigasi,
 * bukan skeleton lalu dua fetch klien lagi. Gagal = undefined → klien fetch.
 */
async function loadInitialProducts(slug: string): Promise<Product[] | undefined> {
  try {
    const { GET } = await import("@/app/api/products/route");
    const response = await GET(new NextRequest(`https://axvara.tech/api/products?active=1&slug=${encodeURIComponent(slug)}`));
    if (!response.ok) return undefined;
    const data = (await response.json()) as { products?: Product[] };
    return Array.isArray(data.products) ? data.products : undefined;
  } catch {
    return undefined;
  }
}

async function loadInitialCatalog(slug: string): Promise<InitialCatalog | undefined> {
  try {
    const { GET } = await import("@/app/api/catalog/route");
    const response = await GET(new Request(`https://axvara.tech/api/catalog?slug=${encodeURIComponent(slug)}`));
    if (!response.ok) return undefined;
    const data = (await response.json()) as { product?: InitialCatalog["product"]; variantsEnabled?: boolean };
    return data.product ? { slug, product: data.product, variantsEnabled: data.variantsEnabled === true } : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `${SITE_BASE}/produk/${slug}`;
  try {
    const product = await getSeoProduct(slug);
    if (!product) return { title: "Produk tidak ditemukan | AXVARA" };
    const description = seoDescription(product);
    const images = seoImages(product);
    return {
      title: `${product.name} | AXVARA`,
      description,
      alternates: { canonical },
      openGraph: {
        type: "website",
        url: canonical,
        title: `${product.name} | AXVARA`,
        description,
        images: images.length > 0 ? images.slice(0, 1).map((url) => ({ url })) : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${product.name} | AXVARA`,
        description,
        images: images.length > 0 ? images.slice(0, 1) : undefined,
      },
    };
  } catch {
    return { title: "Produk | AXVARA" };
  }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, initialProducts, initialCatalog] = await Promise.all([
    getSeoProduct(slug).catch(() => null),
    loadInitialProducts(slug),
    loadInitialCatalog(slug),
  ]);
  if (!product) return notFound();
  const canonical = `${SITE_BASE}/produk/${slug}`;
  const jsonLd = seoProductJsonLd(product, canonical);
  const safeJsonLd = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
  return (
    <>
      {/* Konten SEO server-rendered untuk crawler/preview (issue #11):
          JSON-LD dari data nyata D1. BLOK VISUAL DIHAPUS (bug PDP ganda):
          h1 + harga + deskripsi + gambar versi server tampil mentah di atas
          PDP client sehingga seluruh konten terlihat DUA KALI
          (Canva Pro → Rp1.000 → deskripsi → gambar, lalu Kembali →
          galeri → Canva Pro → Rp 1.000 → deskripsi lagi). Crawler/preview
          tidak butuh blok visual — metadata + JSON-LD + h1 sr-only cukup.
          Interaktivitas (galeri/varian/keranjang/checkout) tetap di client
          di bawah, yang memakai API yang sama sehingga tidak ada duplikasi
          sumber. */}
      {/* Client yang di-seed server merender h1 visual di HTML awal; h1
          sr-only hanya cadangan bila seed gagal (klien mulai dari skeleton). */}
      {!initialProducts && <h1 className="sr-only">{product.name}</h1>}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} />
      <ProductDetailClient slug={slug} initialProducts={initialProducts} initialCatalog={initialCatalog} />
    </>
  );
}
