export const runtime = "edge";
import type { MetadataRoute } from "next";
import { products } from "@/lib/products";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.SITE_URL || "https://axvara.tech";
  const now = new Date();
  // Query D1 langsung — jangan self-fetch /api/* (gagal di Edge workerd
  // saat relative, dan boros 1 hop saat absolute). Sama pola dengan /artikel.
  let articles: { slug: string; updated_at?: string }[] = [];
  try {
    const { queryAll } = await import("@/lib/db");
    const { normalizeArticle } = await import("@/lib/articles");
    const rows = await queryAll("SELECT * FROM articles ORDER BY updated_at DESC, id DESC");
    articles = rows
      .map(normalizeArticle)
      .filter((a) => a.status === "published")
      .map((a) => ({ slug: String(a.slug), updated_at: String(a.updated_at ?? a.published_at ?? "") }));
  } catch {}
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/artikel`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/cara-order`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/garansi-replace`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/#katalog`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...products.map((p) => ({ url: `${base}/produk/${p.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...articles.map((a) => ({ url: `${base}/artikel/${a.slug}`, lastModified: a.updated_at ? new Date(a.updated_at) : now, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
