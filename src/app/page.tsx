"use client";
import { useState, useMemo, useEffect } from "react";
import { OrbitHero } from "@/components/storefront/OrbitHero";
import { ScrollRope } from "@/components/storefront/ScrollRope";
import { CategoryPills } from "@/components/storefront/CategoryPills";
import { ProductCard } from "@/components/storefront/ProductCard";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import { products, type Product } from "@/lib/products";
import { useSearch } from "@/stores/search";
// TRY: iOS chevron — rollback: cp /tmp/page.lucide.bak src/app/page.tsx

const PER_PAGE = 8;

export default function HomePage() {
  const [activeCat, setActiveCat] = useState("semua");
  const [page, setPage] = useState(1);
  const q = useSearch((s) => s.q);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(products);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingCatalog(true);
    fetch("/api/products?active=1")
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { if (Array.isArray(data.products)) setCatalogProducts(data.products); setCatalogError(null); })
      .catch((e) => setCatalogError(e instanceof Error ? e.message : "Gagal memuat katalog"))
      .finally(() => setLoadingCatalog(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalogProducts.filter((p) => {
      const catOk = activeCat === "semua" || p.categorySlug === activeCat;
      if (!needle) return catOk;
      const hay = `${p.name} ${p.description} ${p.categorySlug} ${p.badge ?? ""}`.toLowerCase();
      return catOk && hay.includes(needle);
    });
  }, [activeCat, q, catalogProducts]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const goPage = (n: number) => {
    setPage(n);
    document.getElementById("katalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <ScrollRope />
      {/* Hero with orbit on right */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full opacity-60 blur-[80px]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.18), transparent 70%)" }} />
          <div className="absolute top-24 right-[10%] w-[420px] h-[420px] rounded-full opacity-30 blur-[60px]" style={{ background: "radial-gradient(ellipse at center, rgba(255,184,0,0.15), transparent 70%)" }} />
        </div>
        <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-4">
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-center">
            <div className="flex-1 max-w-3xl w-full">
              <h1 className="font-display font-[700] tracking-[-0.045em] leading-[0.88] text-[42px] sm:text-[56px] lg:text-[62px] text-white">
                Satu tempat untuk
                <br />
                semua tools premium.
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-white/60 max-w-[46ch]">
                Berbagai tools AI dan aplikasi premium dengan harga jauh lebih hemat dari official. Bergaransi.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#katalog" className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]">Lihat Katalog</a>
                <a href="https://wa.me/6282135277434?text=Halo%20AXVARA" target="_blank" className="h-11 px-6 rounded-full border border-white/14 bg-white/[0.06] text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white/10 transition active:scale-[0.98]">
                  <img src="/icons/ios11/chat-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} /> Hubungi Admin
                </a>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-white/40">
                <span>1.200+ aktivasi</span>
                <span className="opacity-30">•</span>
                <span>Rata-rata 8 menit</span>
                <span className="opacity-30">•</span>
                <span className="inline-flex items-center gap-1"><img src="/icons/ios11/star-32.png" alt="" width={11} height={11} className="w-[11px] h-[11px] object-contain brightness-0 invert opacity-50" draggable={false} /> 4.9/5</span>
              </div>
            </div>
            <div className="hidden lg:flex shrink-0">
              <OrbitHero />
            </div>
          </div>
          {/* orbit on mobile below text */}
          <div className="flex lg:hidden justify-center mt-6">
            <OrbitHero />
          </div>
        </div>
      </section>

      <CommunityBar />

      {/* Katalog with pagination */}
      <section id="katalog" className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-2 pb-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[20px] sm:text-[24px] text-white tracking-[-0.02em]">Katalog Premium</h2>
          <span className="text-xs text-white/40">{filtered.length} produk • Hal {safePage}/{totalPages}</span>
        </div>
        <div className="mt-4">
          <CategoryPills active={activeCat} onChange={(c) => { setActiveCat(c); setPage(1); }} />
        </div>
        {catalogError && (
          <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3">
            <span>Gagal memuat katalog: {catalogError}</span>
            <button onClick={() => location.reload()} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">Muat ulang</button>
          </div>
        )}
        {loadingCatalog ? (
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="ax-glass rounded-[20px] p-3 animate-pulse">
                <div className="aspect-[4/3] rounded-2xl bg-white/10" />
                <div className="mt-3 h-4 rounded-full bg-white/10 w-[78%]" />
                <div className="mt-2 h-3 rounded-full bg-white/10 w-[46%]" />
                <div className="mt-3 h-8 rounded-full bg-white/5" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 ax-glass rounded-[20px] p-10 text-center">
            <p className="text-white font-medium">Tidak ada produk yang cocok</p>
            <p className="text-sm text-white/50 mt-1">Coba ubah kata kunci atau kategori.</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {paged.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            <button
              onClick={() => safePage > 1 && goPage(safePage - 1)}
              disabled={safePage === 1}
              className="w-9 h-9 rounded-full ax-glass flex items-center justify-center text-white/70 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition active:scale-95"
              aria-label="Prev"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/chevron-left-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => goPage(n)}
                className={`min-w-9 h-9 px-3 rounded-full text-sm font-semibold transition active:scale-95 ${n === safePage ? "bg-white text-[#080C1E] shadow" : "ax-glass text-white/70 hover:text-white hover:bg-white/10"}`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => safePage < totalPages && goPage(safePage + 1)}
              disabled={safePage === totalPages}
              className="w-9 h-9 rounded-full ax-glass flex items-center justify-center text-white/70 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition active:scale-95"
              aria-label="Next"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/chevron-right-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
