#!/usr/bin/env node
// 2026-10-10 — keluarkan aset statis publik dari Pages Functions (Workers Free
// ~10 ms CPU/request). next-on-pages hanya mengecualikan `/_next/static/*`,
// sehingga ikon/logo/favicon tetap menyalakan worker (+ middleware) dan ikut
// bisa kena 1102. Script ini menambah pengecualian ke `_routes.json` hasil
// build: file-file ini disajikan CDN langsung. Header keamanan + cache-nya
// diatur di `public/_headers` (middleware tidak lagi menyentuhnya).
//
// Aturan: tiap pola di sini WAJIB hanya berisi file statis di `public/` —
// jangan masukkan path yang punya route dinamis di `src/app`.
const fs = require("node:fs");
const path = require("node:path");

const STATIC_EXCLUDES = [
  "/icons/*",
  "/brand/*",
  "/og/*",
  "/banners/*",
  "/favicon.svg",
  "/google0ff9ac31de94bad3.html",
];

function patchRoutes(routes) {
  const exclude = Array.isArray(routes.exclude) ? [...routes.exclude] : [];
  for (const rule of STATIC_EXCLUDES) if (!exclude.includes(rule)) exclude.push(rule);
  // Batas Cloudflare: include + exclude maksimal 100 aturan.
  const total = (routes.include?.length ?? 0) + exclude.length;
  if (total > 100) throw new Error(`_routes.json melebihi 100 aturan (${total})`);
  return { ...routes, exclude };
}

module.exports = { STATIC_EXCLUDES, patchRoutes };

if (require.main === module) {
  const file = path.join(process.cwd(), ".vercel/output/static/_routes.json");
  if (!fs.existsSync(file)) {
    console.error(`patch-pages-routes: ${file} tidak ada (jalankan next-on-pages dulu)`);
    process.exit(1);
  }
  const next = patchRoutes(JSON.parse(fs.readFileSync(file, "utf8")));
  fs.writeFileSync(file, JSON.stringify(next));
  console.log(`patch-pages-routes: exclude = ${next.exclude.join(", ")}`);
}
