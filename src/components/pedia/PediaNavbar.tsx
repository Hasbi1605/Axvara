"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { usePediaSearch } from "@/stores/pedia-search";
import { IosIcon } from "@/components/ui/IosIcon";
import { ServicesMenu } from "@/components/shared/ServicesMenu";
import { PreferenceControls } from "@/components/storefront/PreferenceControls";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { pediaCopy } from "@/lib/pedia/copy";
import { SITE } from "@/lib/site";
import { pediaRoutePath } from "@/lib/pedia/route-path";

export function PediaNavbar() {
  // Subdomain memberi `/` dan `/lacak`; normalkan ke `/pedia...` agar pembandingan rute konsisten.
  const path = pediaRoutePath(usePathname());
  const router = useRouter();
  const q = usePediaSearch((s) => s.q);
  const setQ = usePediaSearch((s) => s.setQ);
  const [mobileSearch, setMobileSearch] = useState(false);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  // 2026-11-07: bahasa mengikuti cookie axv_locale yang sama dengan Market.
  const t = pediaCopy(useDisplayLocale());

  const onCatalog = path === "/pedia" || path === "/pedia/layanan";
  const scrollToCatalog = () => document.getElementById("pedia-catalog")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  const onSearch = (value: string) => {
    setQ(value);
    if (onCatalog && value.trim()) scrollToCatalog();
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!q.trim()) return;
    if (onCatalog) scrollToCatalog();
    else router.push("/pedia/layanan");
  };

  return (
    <header className="ax-glass-strong sticky top-0 z-50 border-b border-white/10">
      <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <Link prefetch={false} href="/pedia" className="flex min-w-0 shrink items-center gap-2 sm:gap-3" aria-label={t.homeAria}>
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
          <span className="max-[343px]:hidden max-w-[130px] truncate whitespace-nowrap font-display text-[15px] font-[300] leading-none tracking-[0.12em] text-white md:hidden">
            AXVARA PEDIA
          </span>
        </Link>
        {/* Field cari ala navbar Market 1:1 — pill rounded-full + ikon kiri + tombol clear. */}
        <div className="hidden lg:flex min-w-0 flex-1 max-w-[520px] mx-2">
          <form className="relative w-full" onSubmit={submitSearch} onKeyDown={(event) => { if (event.key === "Escape" && q) { event.preventDefault(); setQ(""); event.currentTarget.querySelector("input")?.focus(); } }}>
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input aria-label={t.searchAria} type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder={t.searchPlaceholder} className="w-full h-10 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40 focus:bg-white/[0.08] transition" />
            {q && (
              <button type="button" onClick={(event) => { setQ(""); event.currentTarget.form?.querySelector("input")?.focus(); }} className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition" aria-label={t.clear}>
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </form>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          {/* Urutan 1:1 Market: ServicesMenu dulu, tombol search sesudahnya. */}
          <ServicesMenu active="pedia" />
          <button ref={mobileToggle} type="button" onClick={() => setMobileSearch((v) => !v)} className="lg:hidden shrink-0 w-11 h-11 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label={t.searchToggle} aria-expanded={mobileSearch}>
            {mobileSearch ? <X className="w-4 h-4" /> : <IosIcon name="search" size={16} tint="white" />}
          </button>
          <nav aria-label={t.navAria} className="hidden items-center gap-1 text-sm text-white/70 xl:flex">
            <Link prefetch={false} href="/pedia/layanan" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">{t.navCatalog}</Link>
            <Link prefetch={false} href="/pedia/lacak" aria-current={path === "/pedia/lacak" ? "page" : undefined} className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">{t.navTrack}</Link>
            <a href={SITE.webUrl + "/artikel"} className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">{t.navArticles}</a>
          </nav>
          {/* 2026-11-07 (owner): switcher bahasa + mata uang yang sama dengan Market,
              cookie axv_locale / axv_currency. Hanya tampilan; quote & pesanan tetap.
              Urutan 1:1 Market: setelah nav; Pedia tanpa keranjang. */}
          <PreferenceControls />
        </div>
      </div>
      {mobileSearch && (
        <div className="lg:hidden px-4 pb-3">
          <form className="relative" onSubmit={submitSearch} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setMobileSearch(false); mobileToggle.current?.focus(); } }}>
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input aria-label={t.searchAria} type="search" autoFocus value={q} onChange={(e) => onSearch(e.target.value)} placeholder={t.searchShort} className="w-full h-11 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-base text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40" />
            {q && (
              <button type="button" onClick={(event) => { setQ(""); event.currentTarget.form?.querySelector("input")?.focus(); }} className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/10 transition" aria-label={t.clear}>
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </form>
        </div>
      )}
    </header>
  );
}
