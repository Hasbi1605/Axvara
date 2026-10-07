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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pedia-mark.svg" alt="" width={32} height={28} className="h-7 w-8" />
          <span className="text-[13px] font-light tracking-[0.22em] text-white sm:text-sm">
            AXVARA<span className="mx-1 inline-block h-3 w-px bg-white/20 align-middle" />
            <span className="pedia-gradient-text font-bold tracking-[0.18em]">PEDIA</span>
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
