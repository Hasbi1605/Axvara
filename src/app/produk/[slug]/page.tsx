
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryFirst, queryAll } from "@/lib/db";
import {
  seoDescription,
  seoImages,
  seoProductJsonLd,
  type SeoProduct,
} from "@/lib/product-seo";
import ProductDetailClient from "./product-detail-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SITE_BASE = process.env.SITE_URL || "https://axvara.tech";

type SeoRow = Record<string, unknown>;

async function getSeoProduct(slug: string): Promise<SeoProduct | null> {
  const product = (await queryFirst(
    `SELECT p.slug, p.name, p.description, p.image_url, p.images, p.badge,
            p.sold_count, p.updated_at
     FROM products p
     WHERE p.slug=? AND p.is_active=1`,
    slug,
  )) as SeoRow | undefined;
  if (!product) return null;
  const variants = (await queryAll(
    `SELECT pv.price, pv.compare_price, pv.stock
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
    description: product.description ? String(product.description) : null,
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: product.sold_count != null ? Number(product.sold_count) : null,
    updated_at: product.updated_at ? String(product.updated_at) : null,
    variants: variants.map((v) => ({
      price: Number(v.price),
      compare_price: v.compare_price != null ? Number(v.compare_price) : null,
      stock: Number(v.stock ?? -1),
    })),
  };
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
  let product: SeoProduct | null = null;
  try {
    product = await getSeoProduct(slug);
  } catch {
    product = null;
  }
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
      <h1 className="sr-only">{product.name}</h1>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} />
      <ProductDetailClient slug={slug} />
    </>
  );
}
