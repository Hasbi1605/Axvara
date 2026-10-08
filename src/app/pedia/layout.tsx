// src/app/pedia/layout.tsx — Layout Pedia (PEDIA-PRD §9.2).
// Footer SAMA dengan market (2026-10-08 owner: konsisten) — pakai Footer
// toko pusat (tanpa newsletter? tetap sama persis). Bottom nav Pedia tetap.
import type { Metadata } from "next";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";
import { Footer } from "@/components/storefront/Footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://pedia.axvara.tech"),
  title: { default: "Axvara Pedia — Naikkan sosmedmu, tanpa ribet", template: "%s · Axvara Pedia" },
  description: "Followers, likes, dan views untuk Instagram, TikTok, YouTube, dan lainnya. Bayar QRIS, mulai dalam hitungan menit.",
  icons: { icon: "/brand/pedia-mark-favicon.png", apple: "/brand/pedia-apple-touch-180.png" },
  openGraph: {
    type: "website", siteName: "Axvara Pedia", locale: "id_ID",
    images: [{ url: "/og/pedia.png", width: 1200, height: 630, alt: "Axvara Pedia — Tempel link, sisanya beres." }],
  },
};

export default function PediaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pedia-root min-h-screen bg-[#080C1E] text-[#F1F5FF]">
      <PediaNavbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 pb-28 md:pb-16">{children}</main>
      {/* Footer SAMA dengan market (2026-10-08 owner) — shopBase agar link
          market absolut ke axvara.tech. */}
      <Footer shopBase="https://axvara.tech" />
      <PediaBottomNav />
    </div>
  );
}
