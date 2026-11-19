import { displaySoldCountSql } from "@/lib/product-groups";
import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";

import type { Metadata } from "next";
import type {} from "react/canary";
import * as React from "react";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import { queryFirst, queryAll } from "@/lib/db";
import { displayDescription } from "@/lib/catalog";
import { CATALOG_REVISION_HEADER } from "@/lib/catalog-cache";
import type { Product } from "@/lib/products";
import {
  seoDescription,
  seoImages,
  seoProductJsonLd,
  type SeoProduct,
} from "@/lib/product-seo";
import ProductDetailClient, { type InitialCatalog } from "./product-detail-client";
import { requestLocale } from "@/lib/i18n/server-locale";
import { productDisplayName } from "@/lib/i18n/product-name";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const SITE_BASE = process.env.SITE_URL || "https://axvara.tech";

type SeoRow = Record<string, unknown>;

// Next's RSC renderer provides React.cache; plain React 18 unit tests do not.
const getSeoProduct = (React.cache ?? ((fn) => fn))(async (slug: string): Promise<SeoProduct | null> => {
  const product = (await queryFirst(
    `SELECT p.slug, p.name, p.name_en, p.description, p.admin_description_override, p.description_en,
            p.image_url, p.images, p.badge,
            ${displaySoldCountSql("p")} AS sold_count, p.updated_at
     FROM products p
     WHERE p.slug=? AND p.is_active=1`,
    slug,
  )) as SeoRow | undefined;
  if (!product) return null;
  const variants = (await queryAll(
    `SELECT pv.price, pv.compare_price, pv.stock, pv.min_qty
     FROM product_variants pv
     JOIN products p ON p.id=pv.product_id
     WHERE p.slug=? AND p.is_active=1 AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
     ORDER BY pv.sort_order ASC, pv.price ASC, pv.id ASC`,
    slug,
  )) as SeoRow[];
  if (variants.length === 0) return null;
  return {
    slug: String(product.slug),
    name: String(product.name),
    nameEn: product.name_en ? String(product.name_en) : null,
    // Override admin (migrasi 0030) menang atas deskripsi WR, sama seperti
    // storefront dan bot. PDP adalah halaman yang dibaca pembeli DAN mesin
    // pencari, jadi meta/OG/JSON-LD tidak boleh memakai teks yang berbeda.
    description: displayDescription(product),
    descriptionEn: product.description_en ? String(product.description_en) : null,
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
});

/**
 * Data interaktif PDP diambil server lewat handler API yang sama dengan
 * klien (pola beranda): halaman tampil lengkap dari satu respons navigasi,
 * bukan skeleton lalu dua fetch klien lagi. Gagal = undefined → klien fetch.
 */
async function loadInitialProducts(slug: string): Promise<{ products: Product[]; revision: string | null } | undefined> {
  try {
    const { GET } = await import("@/app/api/products/route");
    const response = await GET(new NextRequest(`https://axvara.tech/api/products?active=1&slug=${encodeURIComponent(slug)}`));
    if (!response.ok) return undefined;
    const revision = response.headers.get(CATALOG_REVISION_HEADER);
    const data = (await response.json()) as { products?: Product[] };
    return Array.isArray(data.products) ? { products: data.products, revision } : undefined;
  } catch {
    return undefined;
  }
}

async function loadInitialCatalog(slug: string): Promise<{ catalog: InitialCatalog; revision: string | null } | undefined> {
  try {
    const { GET } = await import("@/app/api/catalog/route");
    const incoming = await headers();
    const response = await GET(new Request(`https://axvara.tech/api/catalog?slug=${encodeURIComponent(slug)}`, {
      headers: { "user-agent": incoming.get("user-agent") ?? "", cookie: incoming.get("cookie") ?? "" },
    }));
    if (!response.ok) return undefined;
    const revision = response.headers.get(CATALOG_REVISION_HEADER);
    const data = (await response.json()) as { product?: InitialCatalog["product"]; variantsEnabled?: boolean };
    return data.product
      ? { catalog: { slug, product: data.product, variantsEnabled: data.variantsEnabled === true }, revision }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const locale = await requestLocale();
  const canonical = `${SITE_BASE}/produk/${slug}`;
  try {
    const product = await getSeoProduct(slug);
    if (!product) return { title: locale === "en" ? "Product not found | AXVARA" : "Produk tidak ditemukan | AXVARA" };
    const description = seoDescription(product, 160, locale);
    const images = seoImages(product);
    const title = `${productDisplayName({ name: product.name, nameEn: product.nameEn }, locale)} | AXVARA`;
    return {
      title,
      description,
      alternates: { canonical },
      openGraph: {
        type: "website",
        url: canonical,
        title,
        description,
        images: images.length > 0 ? images.slice(0, 1).map((url) => ({ url })) : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title,
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
  // URL anggota yang kalah menuju winner aktif grup. Only database reads
  // are best-effort; Next's redirect exception must escape the catch.
  let winnerSlug: string | null = null;
  try {
    const me = (await queryFirst(`SELECT id FROM products WHERE slug=?`, slug)) as
      | Record<string, unknown>
      | undefined;
    if (me?.id != null) {
      const myId = Number(me.id);
      // Grup produk lintas supplier (16 Nov 2026): URL anggota yang bukan
      // winner dialihkan ke slug winner agar 1 barang = 1 kartu.
      const group = (await queryFirst(
        `SELECT g.winner_product_id AS winner_id FROM product_group_members m
         JOIN product_groups g ON g.id=m.group_id
         WHERE m.product_id=? AND g.winner_product_id IS NOT NULL AND g.winner_product_id<>m.product_id
         LIMIT 1`,
        myId,
      )) as Record<string, unknown> | undefined;
      const winnerId = Number(group?.winner_id ?? 0);
      if (Number.isInteger(winnerId) && winnerId > 0) {
        const winner = (await queryFirst(`SELECT slug FROM products WHERE id=? AND is_active=1 AND archived_at IS NULL`, winnerId)) as
          | Record<string, unknown>
          | undefined;
        if (winner?.slug) winnerSlug = String(winner.slug);
      }
    }
  } catch { /* abaikan — lanjut render normal */ }
  if (winnerSlug) redirect(`/produk/${winnerSlug}`);
  const [product, initialProductsResult, initialCatalogResult] = await Promise.all([
    getSeoProduct(slug).catch(() => null),
    loadInitialProducts(slug),
    loadInitialCatalog(slug),
  ]);
  if (!product) return notFound();
  const initialProducts = initialProductsResult?.products;
  const initialCatalog = initialCatalogResult?.catalog;
  const initialRevision = initialCatalogResult?.revision ?? initialProductsResult?.revision ?? null;
  const locale = await requestLocale();
  const canonical = `${SITE_BASE}/produk/${slug}`;
  const seoProduct = { ...product, name: productDisplayName({ name: product.name, nameEn: product.nameEn }, locale), ...(locale === "en" && product.descriptionEn?.trim() ? { description: product.descriptionEn } : {}) };
  const jsonLd = seoProductJsonLd(seoProduct, canonical);
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
      <ProductDetailClient slug={slug} initialProducts={initialProducts} initialCatalog={initialCatalog} initialRevision={initialRevision} />
    </>
  );
}
