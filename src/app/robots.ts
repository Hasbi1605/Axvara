export const runtime = "edge";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.SITE_URL || "https://axvara.tech";
  // `/api/` tetap tertutup, kecuali 3 endpoint baca publik yang dipakai
  // halaman: renderer Google memanggilnya saat merender PDP/beranda
  // (aturan terpanjang menang). Halaman transaksi pribadi ditutup.
  const rule = {
    allow: ["/", "/api/products", "/api/categories", "/api/store-settings"],
    // /go/ = shortlink operasional internal (redirect 307 + noindex di page):
    // bukan konten, jangan di-crawl.
    disallow: ["/admin", "/api/", "/checkout", "/pesanan/", "/go/"],
  };
  return {
    rules: [
      { userAgent: "*", ...rule },
      // GEO: crawler mesin jawab AI diizinkan eksplisit (aturan sama).
      { userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"], ...rule },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
