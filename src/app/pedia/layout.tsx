// src/app/pedia/layout.tsx — Layout Pedia (PEDIA-PRD §9.2).
import type { Metadata } from "next";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";
import { Footer } from "@/components/storefront/Footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://pedia.axvara.tech"),
  title: { default: "Axvara Pedia — Layanan media sosial", template: "%s · Axvara Pedia" },
  description: "Katalog followers, likes, dan views. Bandingkan jumlah, harga, estimasi proses, dan ketentuan setiap paket sebelum memesan.",
  icons: { icon: "/brand/pedia-mark-favicon.png", apple: "/brand/pedia-apple-touch-180.png" },
  openGraph: {
    type: "website", siteName: "Axvara Pedia", locale: "id_ID",
    images: [{ url: "/brand/pedia-icon-512.png", width: 512, height: 512, alt: "Axvara Pedia — Layanan media sosial" }],
  },
};

export default function PediaLayout({ children }: { children: React.ReactNode }) {
  return (
      <div className="pedia-root min-h-screen overflow-x-clip bg-[#080C1E] text-[#F1F5FF]">
      <PediaNavbar />
      <main className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 pb-10">{children}</main>
      <Footer />
      <PediaBottomNav />
    </div>
  );
}
