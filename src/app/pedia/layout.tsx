// src/app/pedia/layout.tsx — Layout Pedia (PEDIA-PRD §9.2).
import type { Metadata } from "next";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";
import { Footer } from "@/components/storefront/Footer";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { CrossAppTransition } from "@/components/ui/CrossAppTransition";

export const metadata: Metadata = {
  metadataBase: new URL("https://pedia.axvara.tech"),
  title: { default: "Axvara Pedia — Layanan sosial media termurah", template: "%s · Axvara Pedia" },
  description: "Katalog followers, likes, dan views. Bandingkan jumlah, harga, estimasi proses, dan ketentuan setiap paket sebelum memesan.",
  icons: { icon: "/brand/pedia-mark-favicon.png", apple: "/brand/pedia-apple-touch-180.png" },
  openGraph: {
    type: "website", siteName: "Axvara Pedia", locale: "id_ID",
    images: [{ url: "/brand/pedia-icon-512.png", width: 512, height: 512, alt: "Axvara Pedia — Layanan sosial media" }],
  },
};

export default function PediaLayout({ children }: { children: React.ReactNode }) {
  return (
      <div className="pedia-root min-h-screen overflow-x-clip bg-[#080C1E] text-[#F1F5FF]">
      <PediaNavbar />
      {/* 2026-10-12: <main> TANPA max-width/padding 1:1 Market (dulu
          max-w-1280 + px-4/sm:px-6/lg:px-8 di sini → padding GANDA 64px
          dengan tiap section di dalamnya, konten 1216px vs Market 1280px).
          Tiap section mengatur containernya sendiri seperti Market. */}
      <NavigationProgress />
      <CrossAppTransition />
      <main className="pb-10">{children}</main>
      <Footer />
      <PediaBottomNav />
    </div>
  );
}
