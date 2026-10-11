// src/app/pedia/layout.tsx — Layout Pedia (PEDIA-PRD §9.2).
// Footer SAMA dengan market (2026-10-08 owner: konsisten) — pakai Footer
// toko pusat (tanpa newsletter? tetap sama persis). Bottom nav Pedia tetap.
import type { Metadata } from "next";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";
import Link from "next/link";

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
    <div className="pedia-root min-h-screen bg-[#080C1E] text-[#F1F5FF]">
      <PediaNavbar />
      <main className="mx-auto w-full max-w-[1120px] px-4 pb-10">{children}</main>
      <footer className="border-t border-white/15 pb-28 pt-6 md:pb-8">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-5 px-4 text-sm text-white/65">
          <p>AXVARA PEDIA · Layanan media sosial</p>
          <nav aria-label="Bantuan Pedia" className="flex flex-wrap gap-5">
            <Link prefetch={false} href="/pedia/lacak" className="hover:text-white">Lacak pesanan</Link>
            <Link prefetch={false} href="/pedia/bantuan" className="hover:text-white">Bantuan</Link>
            <Link prefetch={false} href="/pedia/ketentuan" className="hover:text-white">Ketentuan</Link>
            <a href="https://axvara.tech" className="hover:text-white">Toko aplikasi AXVARA ↗</a>
          </nav>
        </div>
      </footer>
      <PediaBottomNav />
    </div>
  );
}
