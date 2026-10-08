// src/components/pedia/PediaNavbar.tsx — Navbar Pedia + AppSwitcher (PD-16).
// ax-glass-strong sticky 60px, lockup kiri, AppSwitcher tengah (desktop) /
// kanan ringkas (mobile), tombol "Lacak" kanan.
import Link from "next/link";
import { AppSwitcher } from "./AppSwitcher";

export function PediaNavbar() {
  return (
    <header className="ax-glass-strong sticky top-0 z-40 border-b border-white/10">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/pedia" className="flex shrink-0 items-center gap-3" aria-label="Axvara Pedia — beranda">
          {/* 2026-10-08 (owner): mark dari logo Muse (PNG) + versi putih default.
             File: public/brand/pedia-mark-white.png (crop + mask dari
             .opencode/muse-images/muse-image-1791400094014.png). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pedia-mark-white.png" alt="" width={36} height={32} className="h-[32px] w-[36px] object-contain" />
          {/* 2026-10-08 (owner): lockup "AXVARA PEDIA" tanpa pemisah, disamakan
             dengan navbar pusat: font-display 22px tracking 0.16em. */}
          <span className="whitespace-nowrap font-display text-[22px] font-[300] leading-none tracking-[0.16em] text-white">
            AXVARA PEDIA
          </span>
        </Link>
        <div className="hidden flex-1 justify-center md:flex">
          <AppSwitcher active="pedia" />
        </div>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <div className="md:hidden">
            <AppSwitcher active="pedia" compact />
          </div>
          <Link
            href="/pedia/lacak"
            className="flex h-9 min-h-[44px] items-center rounded-full bg-white/5 px-4 text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
          >
            Lacak
          </Link>
        </div>
      </div>
    </header>
  );
}
