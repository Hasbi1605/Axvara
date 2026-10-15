// tests/pedia-release-ux.regression.test.ts — Rilis Pedia 2026-10-14:
// kartu bergambar, skeleton, overlay transisi lintas aplikasi, footer padat.
//
// Mengunci kontrak yang diminta owner:
// 1. Kartu katalog Pedia punya panel visual brand (bukan ikon kecil polos).
// 2. Rute Pedia dikenal routeSkeletonKind → NavigationProgress menampilkan
//    skeleton (bukan layar diam), termasuk katalog + order/pesanan.
// 3. Overlay transisi Market↔Pedia ada di KEDUA layout dengan teks kecil
//    "Memuat AXVARA Pedia" / "Memuat AXVARA Market".
// 4. Footer bersama tidak lagi memaksa 44px per tautan di desktop.
// 5. Halaman pesanan Pedia: tanpa window.prompt, tanpa nomor WA hardcoded,
//    loading = skeleton (bukan teks "Memuat…" polos).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf-8");

describe("rilis Pedia 2026-10-14 — UX setara Market", () => {
  it("kartu katalog memakai panel visual brand platform (gambar dulu)", () => {
    const card = read("src/components/pedia/PlatformGrid.tsx");
    expect(card).toContain("PLATFORM_VISUAL");
    expect(card).toContain("aspect-[16/10]");
    expect(card).toContain("ProductCardSkeleton");
    // Kata metrik ramah tampil di panel visual.
    expect(card).toContain("METRIC_WORD");
    // 2026-10-15 (owner): tile Axvara-style per platform ala Market —
    // path R2 statis, label platform + metrik tetap di atas gambar.
    expect(card).toContain("PLATFORM_CARD_IMAGE");
    expect(card).toContain("pedia-platform-");
    const api = read("src/app/api/pedia/catalog/route.ts");
    expect(api).toContain("platformCardImage");
    expect(api).toContain("pedia-platform-");
  });

  it("routeSkeletonKind mengenal rute Pedia (katalog + order + konten)", async () => {
    const { routeSkeletonKind } = await import("@/components/storefront/Skeletons");
    expect(routeSkeletonKind("/pedia")).toBe("pedia");
    expect(routeSkeletonKind("/pedia/o/likes-instagram")).toBe("pedia-order");
    expect(routeSkeletonKind("/pedia/pesanan/AXP-20261014-ABCD1234")).toBe("pedia-order");
    expect(routeSkeletonKind("/pedia/lacak")).toBe("content");
    // Rute Market lama tidak berubah.
    expect(routeSkeletonKind("/")).toBe("home");
    expect(routeSkeletonKind("/pesanan/AXV-20261014-ABCD1234")).toBe("order");
  });

  it("overlay transisi lintas aplikasi terpasang dua arah dengan teks tujuan", () => {
    const overlay = read("src/components/ui/CrossAppTransition.tsx");
    expect(overlay).toContain("Memuat AXVARA Pedia");
    expect(overlay).toContain("Memuat AXVARA Market");
    expect(overlay).toContain("cross-app-transition");
    // Kembali via bfcache tidak macet di overlay.
    expect(overlay).toContain("pageshow");
    const shopLayout = read("src/app/(shop)/layout.tsx");
    const pediaLayout = read("src/app/pedia/layout.tsx");
    expect(shopLayout).toContain("<CrossAppTransition />");
    expect(pediaLayout).toContain("<CrossAppTransition />");
    // Pedia kini juga punya indikator navigasi internal seperti Market.
    expect(pediaLayout).toContain("<NavigationProgress />");
  });

  it("footer padat: 44px hanya sentuh mobile, desktop rapat; kartu rata atas", () => {
    const footer = read("src/components/storefront/Footer.tsx");
    expect(footer).not.toContain("[&_a]:min-h-[44px]");
    expect(footer).toContain("md:[&_a]:min-h-7");
    expect(footer).toContain("lg:self-start");
  });

  it("halaman pesanan Pedia: skeleton + modal refill, tanpa prompt/hardcode WA", () => {
    const page = read("src/app/pedia/pesanan/[code]/page.tsx");
    expect(page).not.toContain("window.prompt");
    expect(page).not.toContain("wa.me/6282135277434");
    expect(page).toContain("PediaOrderSkeleton");
    expect(page).toContain("Verifikasi refill");
    expect(page).not.toContain('>Memuat…<');
  });
});
