// src/app/pedia/page.tsx — Beranda Pedia (PD-01, DESIGN §6.1).
// SSR katalog (≤60 baris, berindeks) — tanpa fetch client untuk katalog.
import { headers } from "next/headers";
import { PediaHomeClient } from "./home-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export const dynamic = "force-dynamic";

async function getCatalog(): Promise<PediaCatalogProduct[]> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const d = await res.json();
    return d.products ?? [];
  } catch {
    return [];
  }
}

async function getTicker(): Promise<{ text: string }[]> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const res = await fetch(`${proto}://${host}/api/pedia/ticker`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const d = await res.json();
    return d.items ?? [];
  } catch {
    return [];
  }
}

export default async function PediaHome() {
  const [products, ticker] = await Promise.all([getCatalog(), getTicker()]);
  const featured = products.filter((p) => p.is_featured).slice(0, 8);
  const list = (featured.length > 0 ? featured : products).slice(0, 8);
  return <PediaHomeClient products={list} ticker={ticker} />;
}
