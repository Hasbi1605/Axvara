import { SITE } from "@/lib/site";

export const runtime = "edge";

export function GET() {
  // Allow status pages to be crawled so their noindex can be seen.
  return new Response(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE.pediaUrl}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
