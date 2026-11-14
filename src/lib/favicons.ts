import type { Metadata } from "next";

/**
 * Favicon per layanan (14 Nov 2026, permintaan owner): versi logo yang
 * disederhanakan untuk ukuran kecil (garis tebal, tanpa detail tipis) di kotak
 * midnight membulat. Aset di `public/brand/favicons/<service>/`:
 * favicon.svg (browser modern), favicon.ico 16/32/48 (Safari/Windows/lama),
 * apple-touch-icon.png 180 (home screen iOS), icon-192/512.png (Android).
 */
export type FaviconService = "market" | "pedia" | "games";

export function faviconIcons(service: FaviconService): NonNullable<Metadata["icons"]> {
  const base = `/brand/favicons/${service}`;
  return {
    icon: [
      { url: `${base}/favicon.svg`, type: "image/svg+xml" },
      { url: `${base}/favicon.ico`, sizes: "16x16 32x32 48x48" },
      { url: `${base}/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${base}/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `${base}/apple-touch-icon.png`, sizes: "180x180" }],
  };
}
