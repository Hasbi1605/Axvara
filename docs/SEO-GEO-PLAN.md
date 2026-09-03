# SEO & GEO Plan — AXVARA

> Stage minimal sekarang, bertahap ke atas. Target: #1 Google untuk "tools premium murah", "akun premium", "AI Gateway" + GEO (AI Overview) ready.

## Stage 1 — Minimal (Sekarang, DONE)
- [x] `metadata` Next.js per page: `title`, `description`, `openGraph`, `icons`
- [x] `sitemap.xml` dynamic (via `src/app/sitemap.ts`) + `robots.txt` (allow, sitemap link)
- [x] `JSON-LD` Organization + Product + Article di `/produk/[slug]` & `/artikel/[slug]`
- [x] Canonical URL per page (`https://axvara.tech`)
- [x] Security headers + CSP (SEO trust)
- [x] Image `alt` & semantic headings (`h1` satu per page)

## Stage 2 — Artikel Cluster (Minggu 2-4)
- Buat 8-12 artikel pillar seputar produk digital dan teknologi: panduan penggunaan, perbandingan layanan, keamanan akun, dan tren teknologi
- Internal linking: artikel → produk terkait (`/produk/[slug]`) + produk → artikel
- Kategori artikel + tag + related articles (3 bawah)
- Publish 2/minggu, share ke FB/Threads/Twitter via `wa.me` & OG image 1200x630

## Stage 3 — GEO & AI Overview (Bulan 2-3)
- `llms.txt` + `ai.txt` di root (untuk crawler AI)
- FAQ schema per produk & artikel
- HowTo schema untuk "Cara order"
- Submit sitemap ke Search Console + Bing Webmaster
- Monitor: Coverage, Core Web Vitals (LCP <2.5s), CTR

## Checklist Harian
- Judul 50-60 char, description 150-160 char, satu H1, H2-H3 terstruktur
- URL slug pendek: `/artikel/tips-chatgpt-gratis`
- Cover 1200x630, compress WebP

## Metrik
- Organic traffic, # keyword top 10, CTR, CWV, backlinks dari share sosmed
