import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { PlatformCatalog } from "@/components/pedia/PlatformCatalog";
import { loadPublicPediaProducts } from "@/lib/pedia/public-catalog";
import { pediaCatalogSummary } from "@/lib/pedia/catalog-summary";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "catalog", "/layanan");
}

export default async function PediaServicesPage() {
  const products = await loadPublicPediaProducts();
  return <div className="pt-3"><PlatformCatalog products={products.map(pediaCatalogSummary)} headingLevel={1} /></div>;
}
