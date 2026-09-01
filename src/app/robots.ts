export const runtime = "edge";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://axvara.pages.dev";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
