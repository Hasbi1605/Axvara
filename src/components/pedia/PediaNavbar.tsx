// src/components/pedia/PediaNavbar.tsx — Navbar Pedia + AppSwitcher (PD-16).
// ax-glass-strong sticky 60px, lockup kiri, AppSwitcher tengah (desktop) /
// kanan ringkas (mobile), tombol "Lacak" kanan.
import Link from "next/link";
import { AppSwitcher } from "./AppSwitcher";

export function PediaNavbar() {
  return (
    <header className="ax-glass-strong sticky top-0 z-40 h-[60px]">
      <div className="mx-auto flex h-full max-w-[1120px] items-center gap-3 px-4">
        <Link href="/pedia" className="flex items-center gap-2" aria-label="Axvara Pedia — beranda">
          {/* 2026-10-08 (owner): mark dari logo Muse (PNG) + versi putih default.
             File: public/brand/pedia-mark-white.png (crop + mask dari
             .opencode/muse-images/muse-image-1791400094014.png). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pedia-mark-white.png" alt="" width={32} height={30} className="h-[30px] w-8" />
          <span className="text-[13px] font-bold tracking-[0.22em] text-white sm:text-sm">
            AXVARA<span className="mx-1.5 inline-block h-4 w-px bg-white/40 align-middle" />
            PEDIA
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
