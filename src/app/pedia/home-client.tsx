"use client";

import { useState } from "react";
import { PediaOrbit } from "@/components/pedia/PediaOrbit";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { Typewriter } from "@/components/pedia/Typewriter";
import { usePediaSearch } from "@/stores/pedia-search";
import { PEDIA_PLATFORMS, PlatformIcon, ProductCard, catalogCard } from "@/components/pedia/PlatformGrid";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export function PediaHomeClient({ products }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  const [platform, setPlatform] = useState("");
  const query = usePediaSearch((s) => s.q);
  const setQuery = usePediaSearch((s) => s.setQ);
  const [showAll, setShowAll] = useState(false);
  const featured = products.filter((p) => p.is_featured === 1);
  const browsingAll = showAll || !!platform || !!query.trim();
  const selection = browsingAll ? products : featured.length ? featured.slice(0, 8) : products.slice(0, 6);
  const filtered = selection.filter((p) => (!platform || p.platform === platform) && `${p.name} ${p.platform} ${p.metric}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    {/* Hero 1:1 Market: section full-bleed selebar viewport (w-screen +
        center-translate menembus <main> 1280). TANPA overflow-hidden agar blur
        glow tidak kepotong di batas bawah — glow memudar natural (transparent
        70%) DI BELAKANG kartu ganda yang ikut di dalam section. Teks + orbit +
        kartu tetap sejajar container via inner div; grid teks-orbit disalin
        dari (shop)/home-client.tsx. */}
    <section className="relative w-screen left-1/2 -translate-x-1/2">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[300px] sm:w-[900px] sm:h-[520px] rounded-full opacity-60 blur-[44px] sm:blur-[80px]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.18), transparent 70%)" }} />
        <div className="absolute top-24 right-[10%] w-[240px] h-[240px] sm:w-[420px] sm:h-[420px] rounded-full opacity-30 blur-[36px] sm:blur-[60px] hidden sm:block" style={{ background: "radial-gradient(ellipse at center, rgba(255,184,0,0.15), transparent 70%)" }} />
      </div>
      {/* Analisis gap vs Market (2026-10-12): Market = pt-10/sm:pt-14 + pb-4
          + CommunityBar di LUAR section hero + katalog pt-2. Pedia = pt-10/
          sm:pt-14 + pb-6 + kartu ganda DI DALAM section + katalog mt-8 (32px).
          Total ruang kosong Pedia dari navbar ke judul ≈ 40/56 + konten +
          24 + 32 vs Market ≈ 40/56 + konten + 16 + 8. Selisih ±40px —
          makanya terasa jauh. Fix 1:1 Market: pb-6→pb-4, kartu ganda keluar
          section (seperti CommunityBar), katalog mt-8→pt-2. */}
      <div className="relative mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-4">
        {/* Grid 1:1 Market — teks kiri, orbit kanan (mobile: orbit center di bawah teks) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 lg:gap-8 items-center">
          <div className="max-w-3xl w-full">
            <h1 className="font-display font-[700] tracking-[-0.02em] leading-[0.98] text-[42px] sm:text-[56px] lg:text-[62px] text-white">
              <span className="block">Satu tempat untuk</span>
              <span className="block">Layanan sosial media</span>
              <Typewriter />
            </h1>
            <p className="mt-4 text-[15px] leading-6 text-white/60 max-w-[46ch]">
              Followers, likes, dan views semua platform dengan harga murah. Order cepat dan otomatis tanpa perlu login.
            </p>
            {/* CTA 1:1 Market — Lihat Layanan (putih) + Hubungi Admin (glass + ikon chat). */}
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#pedia-catalog" className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]">Lihat Layanan</a>
              <PediaWhatsAppLink className="h-11 px-6 rounded-full border border-white/14 bg-white/[0.06] text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white/10 transition active:scale-[0.98]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/chat-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} /> Hubungi Admin
              </PediaWhatsAppLink>
            </div>
            {/* Trust strip 1:1 Market — ejaan "reffil" sesuai permintaan owner. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-white/40">
              <span>Order cepat tanpa login</span>
              <span className="opacity-30">•</span>
              <span>Garansi reffil</span>
              <span className="opacity-30">•</span>
              <span>Support WA admin</span>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end shrink-0 mt-6 lg:mt-0">
            <PediaOrbit />
          </div>
        </div>
      </div>
    </section>

    {/* Kartu ganda di LUAR section hero — class container DISALIN PERSIS
        dari CommunityBar Market (-mt-1 mb-2) agar gap kartu→judul 1:1. */}
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2">
      <PediaServiceCards />
    </div>

    <div className="pb-4">

    {/* Katalog: struktur header DISALIN PERSIS dari Market — judul kiri +
        counter kanan ("N layanan"), agar balance atas-bawah 1:1. */}
    <section aria-labelledby="pedia-catalog-heading" id="pedia-catalog" className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-2 scroll-mt-20">
      <div className="flex items-center justify-between gap-4">
        <h2 id="pedia-catalog-heading" className="font-display font-bold text-[20px] sm:text-[24px] text-white tracking-[-0.02em]">{browsingAll ? "Semua layanan" : featured.length ? "Pilihan AXVARA" : "Jelajahi layanan"}</h2>
        <span className="text-xs text-white/40">{filtered.length} layanan</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter platform">
        <button type="button" aria-pressed={!platform} onClick={() => setPlatform("")} className={`min-h-11 rounded-lg border px-3 text-sm ${!platform ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}>Semua</button>
        {PEDIA_PLATFORMS.filter((p) => products.some((product) => product.platform === p.id)).map((p) => <button key={p.id} type="button" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${platform === p.id ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}><PlatformIcon id={p.id} size={18} />{p.label}</button>)}
      </div>
      <p role="status" className="sr-only">{filtered.length} layanan</p>
      {filtered.length ? <div className="mt-6 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">{filtered.map((p) => <ProductCard key={p.slug} p={catalogCard(p)} />)}</div> : <div className="mt-6 rounded-xl border border-white/15 p-6 text-sm text-white/70"><p>{products.length ? "Tidak ada layanan yang sesuai pencarian." : "Layanan belum tersedia. Coba kembali nanti atau hubungi bantuan."}</p>{products.length > 0 && <button type="button" onClick={() => { setQuery(""); setPlatform(""); setShowAll(true); }} className="mt-3 min-h-11 text-[#00E5FF]">Reset pencarian</button>}</div>}
      {!browsingAll && products.length > filtered.length && <button type="button" onClick={() => setShowAll(true)} className="mt-5 min-h-11 w-full rounded-xl border border-[#00E5FF]/25 bg-[#00E5FF]/5 px-4 text-sm font-medium text-[#00E5FF] transition-colors hover:bg-[#00E5FF]/10">Tampilkan semua layanan <span className="ml-2 text-white/60">({products.length})</span></button>}
    </section>
    {/* 2026-10-12 (owner): section Cara pemesanan + Sebelum memesan (FAQ)
        DIHAPUS dari beranda — setelah layanan langsung footer 1:1 Market.
        Info bantuan tetap ada di /pedia/bantuan + footer. */}
    </div>
  </>;
}
