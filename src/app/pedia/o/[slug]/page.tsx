// src/app/pedia/o/[slug]/page.tsx — Halaman order (PD-04, DESIGN §6.3).
// SSR produk + tingkat aktif; interaksi di OrderClient.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { notFound } from "next/navigation";
import { PlatformPageClient } from "../../p/[platform]/platform-client";
import { pediaPlatform } from "@/lib/pedia/platforms";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "order");
}

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function PediaOrderPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  let product: PediaCatalogProduct | null = null;
  let products: PediaCatalogProduct[] = [];
  try {
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (res.ok) {
      const list: PediaCatalogProduct[] = (await res.json()).products ?? [];
      products = list;
      product = list.find((p) => p.slug === slug) ?? null;
    }
  } catch { /* notFound di bawah */ }
  if (!product) notFound();
  return <PlatformPageClient platform={product.platform} name={pediaPlatform(product.platform)?.label ?? product.platform} products={products.filter((p) => p.platform === product!.platform)} initialSlug={product.slug} initialTarget={typeof t === "string" ? t : ""} ordersEnabled={process.env.PEDIA_ORDERS_ENABLED === "true"} />;
}
