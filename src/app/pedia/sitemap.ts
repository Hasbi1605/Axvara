import type { MetadataRoute } from "next";
import { PEDIA_PLATFORM_CONFIG } from "@/lib/pedia/platforms";
import { loadPublicPediaProducts } from "@/lib/pedia/public-catalog";
import { SITE } from "@/lib/site";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await loadPublicPediaProducts();
  const platforms = new Set(products.map(product => product.platform));
  return [
    "/", "/layanan", "/bantuan", "/ketentuan",
    ...PEDIA_PLATFORM_CONFIG.filter(platform => platforms.has(platform.id)).map(platform => `/p/${platform.id}`),
    ...products.map(product => `/o/${encodeURIComponent(product.slug)}`),
  ].map(path => ({ url: `${SITE.pediaUrl}${path}` }));
}
