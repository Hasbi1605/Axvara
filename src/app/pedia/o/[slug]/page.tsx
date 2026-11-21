// src/app/pedia/o/[slug]/page.tsx — Halaman order (PD-04, DESIGN §6.3).
// SSR produk + tingkat aktif; interaksi di OrderClient.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { notFound } from "next/navigation";
import { PlatformPageClient } from "../../p/[platform]/platform-client";
import { pediaPlatform } from "@/lib/pedia/platforms";
import { loadPublicPediaProducts } from "@/lib/pedia/public-catalog";
import { trackFunnelEvent } from "@/lib/analytics/funnel";

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
  const products = await loadPublicPediaProducts();
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();
  trackFunnelEvent({ stage: "view", orderKind: "pedia", productSlug: product.slug, locale: await requestLocale() }, { headers: h });
  return <PlatformPageClient platform={product.platform} name={pediaPlatform(product.platform)?.label ?? product.platform} products={products.filter((p) => p.platform === product.platform)} initialSlug={product.slug} initialTarget={typeof t === "string" ? t : ""} ordersEnabled={process.env.PEDIA_ORDERS_ENABLED === "true"} />;
}
