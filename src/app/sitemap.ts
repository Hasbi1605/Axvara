export const runtime = "edge";
import type { MetadataRoute } from "next";
import { products } from "@/lib/products";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.SITE_URL || "https://axvara.id";
  const now = new Date();
  // Fetch articles if available (best-effort)
  let articles: { slug: string; updated_at?: string }[] = [];
  try {
    const r = await fetch(`${base}/api/articles?published=1`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    articles = (r.articles ?? []).map((a: Record<string, unknown>) => ({ slug: String(a.slug), updated_at: String(a.updated_at ?? a.published_at ?? "") }));
  } catch {}
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/artikel`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/#katalog`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...products.map((p) => ({ url: `${base}/produk/${p.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...articles.map((a) => ({ url: `${base}/artikel/${a.slug}`, lastModified: a.updated_at ? new Date(a.updated_at) : now, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
