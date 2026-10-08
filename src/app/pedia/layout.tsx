// src/app/pedia/layout.tsx — Layout Pedia (PEDIA-PRD §9.2).
// TIDAK memakai Navbar/Footer/MobileBottomNav toko pusat; pakai PediaNavbar
// + PediaBottomNav. Token .pedia-root (DESIGN §3.1).
import type { Metadata } from "next";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";

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
      <footer className="border-t border-white/10 py-8 text-center text-[12.5px] text-white/45">
        <p>
          <span className="font-semibold text-white/70">Axvara Pedia</span> · Naikkan sosmedmu, tanpa ribet.
        </p>
        <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a href="/pedia/bantuan" className="hover:text-white">Bantuan</a>
          <a href="/pedia/ketentuan" className="hover:text-white">Ketentuan</a>
          <a href="/pedia/lacak" className="hover:text-white">Lacak pesanan</a>
          <a href="https://axvara.tech?utm_source=pedia&utm_medium=footer" className="hover:text-white">axvara.tech</a>
        </p>
      </footer>
      <PediaBottomNav />
    </div>
  );
}
