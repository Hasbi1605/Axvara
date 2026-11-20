// src/app/pedia/p/[platform]/page.tsx — Halaman per platform (PD-03).
// Header ikon 40px + segmented filter jenis + grid ProductCard.
import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { notFound } from "next/navigation";
import { pediaPlatform } from "@/lib/pedia/platforms";
import { loadPublicPediaProducts } from "@/lib/pedia/public-catalog";
import { PlatformPageClient } from "./platform-client";

export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "platform");
}

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function PediaPlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const config = pediaPlatform(platform);
  if (!config) notFound();
  const products = (await loadPublicPediaProducts()).filter((p) => p.platform === platform);
  return <PlatformPageClient platform={platform} name={config.label} products={products} ordersEnabled={process.env.PEDIA_ORDERS_ENABLED === "true"} />;
}
