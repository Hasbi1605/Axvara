import { publicPediaCatalogResponse } from "@/lib/pedia/public-catalog";

export type { PediaCatalogProduct, PediaCatalogTier } from "@/lib/pedia/public-catalog";
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  return publicPediaCatalogResponse();
}
