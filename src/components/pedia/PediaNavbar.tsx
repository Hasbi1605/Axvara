import Link from "next/link";
import { ServicesMenu } from "@/components/shared/ServicesMenu";

export function PediaNavbar() {
  return (
    <header className="ax-glass-strong sticky top-0 z-40 border-b border-white/10">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <Link prefetch={false} href="/pedia" className="flex min-w-0 shrink-0 items-center gap-3" aria-label="Axvara Pedia — beranda">
          {/* 2026-10-08 (owner): mark SVG trace dari logo Muse (mirip 91% IoU
             vs PNG, kanvas padat tanpa padding transparan → tampil penuh
             sebesar mark pusat). File: public/brand/pedia-mark.svg.
             currentColor tak turun ke <img>, jadi svg difilter putih via CSS
             (brightness(0) invert(1)) — ganti warna cukup ubah filter. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pedia-mark.svg" alt="" width={36} height={32} className="h-[32px] w-[36px] shrink-0 brightness-0 invert" />
          {/* 2026-10-08 (owner): lockup "AXVARA PEDIA" tanpa pemisah, disamakan
             dengan navbar pusat: font-display 22px tracking 0.16em.
             Mobile: "PEDIA" saja (tanpa AXVARA) agar muat. */}
          <span className="hidden whitespace-nowrap font-display text-[22px] font-[300] leading-none tracking-[0.16em] text-white md:inline">
            AXVARA PEDIA
          </span>
          <span className="whitespace-nowrap font-display text-[22px] font-[300] leading-none tracking-[0.16em] text-white md:hidden">
            PEDIA
          </span>
        </Link>
        <nav aria-label="Navigasi Pedia" className="ml-auto hidden items-center gap-5 text-sm text-white/70 lg:flex">
          <Link prefetch={false} href="/pedia/layanan" className="hover:text-white">Katalog</Link>
          <Link prefetch={false} href="/pedia/lacak" className="hover:text-white">Lacak pesanan</Link>
          <Link prefetch={false} href="/pedia/bantuan" className="hover:text-white">Bantuan</Link>
        </nav>
        <div className="ml-auto min-w-0 lg:ml-0">
          <ServicesMenu active="pedia" />
        </div>
      </div>
    </header>
  );
}
