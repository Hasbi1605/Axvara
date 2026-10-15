"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useState } from "react";
import { usePediaSearch } from "@/stores/pedia-search";
import { IosIcon } from "@/components/ui/IosIcon";
import { ServicesMenu } from "@/components/shared/ServicesMenu";

export function PediaNavbar() {
  const path = usePathname();
  const router = useRouter();
  const q = usePediaSearch((s) => s.q);
  const setQ = usePediaSearch((s) => s.setQ);
  const [mobileSearch, setMobileSearch] = useState(false);

  const onSearch = (v: string) => {
    setQ(v);
    if (v.trim()) {
      if (path && path !== "/pedia" && path !== "/pedia/layanan") router.push("/pedia/layanan");
      document.getElementById("pedia-catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <header className="ax-glass-strong sticky top-0 z-40 border-b border-white/10">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <Link prefetch={false} href="/pedia" className="flex min-w-0 shrink items-center gap-2 sm:gap-3" aria-label="Axvara Pedia — beranda">
          {/* 2026-10-08 (owner): mark SVG trace dari logo Muse (mirip 91% IoU
             vs PNG, kanvas padat tanpa padding transparan → tampil penuh
             sebesar mark pusat). File: public/brand/pedia-mark.svg.
             currentColor tak turun ke <img>, jadi svg difilter putih via CSS
             (brightness(0) invert(1)) — ganti warna cukup ubah filter. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pedia-mark.svg" alt="" width={36} height={32} className="h-[32px] w-[36px] shrink-0 brightness-0 invert" />
          {/* 2026-10-08 (owner): lockup "AXVARA PEDIA" tanpa pemisah, disamakan
             dengan navbar pusat: font-display 22px tracking 0.16em.
             2026-10-12 (owner): mobile juga "AXVARA PEDIA" penuh 1:1 Market
             (kecil 15px + truncate agar muat di layar sempit). */}
          <span className="hidden whitespace-nowrap font-display text-[22px] font-[300] leading-none tracking-[0.16em] text-white md:inline">
            AXVARA PEDIA
          </span>
          <span className="max-w-[130px] truncate whitespace-nowrap font-display text-[15px] font-[300] leading-none tracking-[0.12em] text-white md:hidden">
            AXVARA PEDIA
          </span>
        </Link>
        {/* Field cari ala navbar Market 1:1 — pill rounded-full + ikon kiri + tombol clear. */}
        <div className="hidden lg:flex min-w-0 flex-1 max-w-[520px] mx-2">
          <div className="relative w-full">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input aria-label="Cari layanan Pedia" type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Cari Followers Instagram, Likes TikTok..." className="w-full h-10 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40 focus:bg-white/[0.08] transition" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 transition" aria-label="Clear">
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </div>
        </div>
        <nav aria-label="Navigasi Pedia" className="ml-auto hidden items-center gap-5 text-sm text-white/70 lg:flex">
          <Link prefetch={false} href="/pedia/layanan" className="hover:text-white">Katalog</Link>
          <Link prefetch={false} href="/pedia/lacak" className="hover:text-white">Lacak pesanan</Link>
          <Link prefetch={false} href="/pedia/bantuan" className="hover:text-white">Bantuan</Link>
        </nav>
        <div className="ml-auto min-w-0 lg:ml-0 flex items-center gap-1 sm:gap-2">
          {/* Urutan 1:1 Market: ServicesMenu dulu, tombol search sesudahnya. */}
          <ServicesMenu active="pedia" />
          <button onClick={() => setMobileSearch((v) => !v)} className="lg:hidden shrink-0 w-11 h-11 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label="Cari layanan" aria-expanded={mobileSearch}>
            {mobileSearch ? <X className="w-4 h-4" /> : <IosIcon name="search" size={16} tint="white" />}
          </button>
        </div>
      </div>
      {mobileSearch && (
        <div className="lg:hidden px-4 pb-3">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input aria-label="Cari layanan Pedia" type="search" autoFocus value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Cari layanan..." className="w-full h-11 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-base text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 transition" aria-label="Clear">
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
