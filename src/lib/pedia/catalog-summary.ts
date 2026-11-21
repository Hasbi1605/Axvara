import type { PediaCatalogProduct, PediaCatalogTier } from "./public-catalog";

export type PediaCatalogSummary = Pick<PediaCatalogProduct, "slug" | "platform" | "metric" | "name"> & {
  tiers: Pick<PediaCatalogTier, "public_name" | "region">[];
};

export function pediaCatalogSummary({ slug, platform, metric, name, tiers }: PediaCatalogProduct): PediaCatalogSummary {
  return { slug, platform, metric, name, tiers: tiers.map(({ public_name, region }) => ({ public_name, region })) };
}
