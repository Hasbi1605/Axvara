// src/app/pedia/p/[platform]/page.tsx — Halaman per platform (PD-03).
// Header ikon 40px + segmented filter jenis + grid ProductCard.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { pediaPlatform } from "@/lib/pedia/platforms";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PlatformPageClient } from "./platform-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function PediaPlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const config = pediaPlatform(platform);
  if (!config) notFound();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  let products: PediaCatalogProduct[] = [];
  try {
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (res.ok) products = ((await res.json()).products ?? []).filter((p: PediaCatalogProduct) => p.platform === platform);
  } catch { /* kosong di bawah */ }
  return <PlatformPageClient platform={platform} name={config.label} products={products} ordersEnabled={process.env.PEDIA_ORDERS_ENABLED === "true"} />;
}
