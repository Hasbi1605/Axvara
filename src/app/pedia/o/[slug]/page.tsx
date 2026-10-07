// src/app/pedia/o/[slug]/page.tsx — Halaman order (PD-04, DESIGN §6.3).
// SSR produk + tingkat aktif; interaksi di OrderClient.
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OrderClient } from "./order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

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
  try {
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (res.ok) {
      const list: PediaCatalogProduct[] = (await res.json()).products ?? [];
      product = list.find((p) => p.slug === slug) ?? null;
    }
  } catch { /* notFound di bawah */ }
  if (!product) notFound();
  return <OrderClient product={product} initialTarget={typeof t === "string" ? t : ""} ordersEnabled={process.env.PEDIA_ORDERS_ENABLED === "true"} />;
}
