import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { headers } from "next/headers";
import { PlatformCatalog } from "@/components/pedia/PlatformCatalog";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "catalog", "/layanan");
}

export default async function PediaServicesPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  let products: PediaCatalogProduct[] = [];
  try {
    const res = await fetch(`${proto}://${host}/api/pedia/catalog`, { next: { revalidate: 60 } });
    if (res.ok) products = (await res.json()).products ?? [];
  } catch { /* empty state */ }
  return <div className="pt-3"><PlatformCatalog products={products} headingLevel={1} /></div>;
}
