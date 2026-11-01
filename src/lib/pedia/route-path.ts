// src/lib/pedia/route-path.ts — Path rute Pedia kanonis untuk komponen layout Pedia.
// 2026-11-01: di pedia.axvara.tech middleware me-rewrite `/p/x` → `/pedia/p/x`,
// sehingga usePathname() bisa berisi `/p/x` (URL browser) atau `/pedia/p/x`
// (dev lokal/render server). Semua pengecekan rute di layout Pedia memakai
// bentuk `/pedia/...` yang sama agar server dan client selalu sepakat.
export function pediaRoutePath(pathname: string | null | undefined): string {
  const path = pathname || "";
  if (!path) return "";
  if (path === "/pedia" || path.startsWith("/pedia/")) return path;
  return path === "/" ? "/pedia" : `/pedia${path.startsWith("/") ? path : `/${path}`}`;
}

/** Halaman alur pesan Pedia (pilih layanan → bayar) yang memakai bar bawah sendiri. */
export function isPediaOrderFlow(route: string): boolean {
  return route.startsWith("/pedia/p/") || route.startsWith("/pedia/o/");
}
