import { SITE } from "@/lib/site";

export const runtime = "edge";

export function GET() {
  return new Response(`User-agent: *\nAllow: /\nAllow: /api/games/catalog\nDisallow: /admin\nDisallow: /api/\nDisallow: /pesanan/\nDisallow: /lacak\nSitemap: ${SITE.gamesUrl}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
