"use client";
import { useState, useMemo, useEffect } from "react";
import { OrbitHero } from "@/components/storefront/OrbitHero";
import { ScrollRope } from "@/components/storefront/ScrollRope";
import { CategoryPills } from "@/components/storefront/CategoryPills";
import { ProductCard } from "@/components/storefront/ProductCard";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import type { Product } from "@/lib/products";
import { resolveCategorySlug } from "@/lib/products";
import { sortProductsForDisplay } from "@/lib/product-order";
import { useSearch } from "@/stores/search";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";

const PER_PAGE = 16;

/**
 * `initialProducts` dirender server (page.tsx) agar katalog ada di HTML awal:
 * dulu HTML beranda berisi "0 produk" tanpa satu link produk, jadi crawler
 * tanpa JavaScript (termasuk crawler AI) melihat toko kosong. Bila server
 * gagal memuat, klien jatuh kembali ke fetch seperti sebelumnya.
 */
export function HomeClient({ initialProducts }: { initialProducts?: Product[] }) {
  const hasInitial = Array.isArray(initialProducts);
  const [activeCat, setActiveCat] = useState("semua");
  // Pagination 2 tahap (keputusan owner 2026-10-01): 16 awal (grid pas —
  // 4×4 desktop, 8×2 mobile), lalu SEKALIGUS semua. Tanpa batch 12+12+…
  // berulang yang melelahkan untuk ~90 produk.
  const [showAll, setShowAll] = useState(false);
  const q = useSearch((s) => s.q);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(initialProducts ?? []);
  const [catalogLoading, setCatalogLoading] = useState(!hasInitial);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const requestedCategory = new URLSearchParams(window.location.search).get("category");
    // Slug lama (?category= bookmark pra-migrasi 0046) dipetakan ke slug baru.
    if (requestedCategory) setActiveCat(resolveCategorySlug(requestedCategory));
    // Sheet Kategori bottom nav (2026-10-03): pilih kategori dari rute mana
    // pun → filter katalog + gulir ke #katalog. Dari home: langsung terapkan;
    // dari rute lain: pindah ke / dulu, lalu terapkan setelah navigasi.
    const onCategory = (event: Event) => {
      const slug = resolveCategorySlug(String((event as CustomEvent<string>).detail ?? "semua"));
      setActiveCat(slug);
      setShowAll(false);
      if (window.location.pathname !== "/") {
        window.location.href = `/?category=${encodeURIComponent(slug)}`;
        return;
      }
      // Katalog sudah di halaman ini: cukup gulir ke daftarnya.
      window.setTimeout(() => {
        document.getElementById("katalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    };
    window.addEventListener("axvara:category", onCategory);
    return () => window.removeEventListener("axvara:category", onCategory);
  }, []);

  // D1 is authoritative. Static seeds must never resurrect inactive/deleted products.
  useEffect(() => {
    if (hasInitial) return;
    const controller = new AbortController();
    fetch("/api/products?active=1", { signal: controller.signal })
        .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => { if (Array.isArray(data.products)) setCatalogProducts(data.products); setCatalogError(null); })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setCatalogError(e instanceof Error ? e.message : "Gagal memuat katalog");
        })
        .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [hasInitial]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = catalogProducts.filter((p) => {
      const catOk = activeCat === "semua" || p.categorySlug === activeCat;
      if (!needle) return catOk;
      const hay = `${p.name} ${p.description} ${p.categorySlug} ${p.badge ?? ""}`.toLowerCase();
      return catOk && hay.includes(needle);
    });
    // Urutan stabil: ready dulu, lalu sort_order admin, lalu id. Tanpa kunci
    // terakhir, dua produk dengan sort_order sama dapat bertukar posisi antar
    // render dan katalog terlihat "loncat-loncat".
    // Cermin `globalProductOrder` admin (useProductManager) + `filtered`:
    // aktif-dulu diabaikan di sini (katalog publik hanya memuat aktif),
    // ready → sortOrder → id. Nonaktif tidak pernah sampai ke storefront
    // (?active=1), jadi cabang byActive admin tidak berlaku di sini.
    return sortProductsForDisplay(matched);
  }, [activeCat, q, catalogProducts]);

  // Filter baru = daftar baru: kembali ke 16 awal.
  useEffect(() => { setShowAll(false); }, [q, activeCat]);
  const paged = showAll ? filtered : filtered.slice(0, PER_PAGE);
  const remaining = Math.max(0, filtered.length - paged.length);

  return (
    <>
      <ScrollRope />
      {/* Hero with orbit — single instance, CSS responsive layout.
          Glow di-hemat di mobile: blur 80px pada layer 900px adalah
          repaint termahal kedua setelah orbit (GPU HP kentang). */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[300px] sm:w-[900px] sm:h-[520px] rounded-full opacity-60 blur-[44px] sm:blur-[80px]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.18), transparent 70%)" }} />
          <div className="absolute top-24 right-[10%] w-[240px] h-[240px] sm:w-[420px] sm:h-[420px] rounded-full opacity-30 blur-[36px] sm:blur-[60px] hidden sm:block" style={{ background: "radial-gradient(ellipse at center, rgba(255,184,0,0.15), transparent 70%)" }} />
        </div>
        <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-4">
          {/* Grid layout — single OrbitHero, responsive via CSS */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 lg:gap-8 items-center">
            <div className="max-w-3xl w-full">
              <h1 className="font-display font-[700] tracking-[-0.02em] leading-[0.98] text-[42px] sm:text-[56px] lg:text-[62px] text-white">
                Satu tempat untuk
                <br />
                semua tools premium.
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-white/60 max-w-[46ch]">
                Berbagai tools AI dan aplikasi premium dengan harga murah. Order cepat dan otomatis tanpa perlu login.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#katalog" className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]">Lihat Katalog</a>
                <StoreWhatsAppLink className="h-11 px-6 rounded-full border border-white/14 bg-white/[0.06] text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white/10 transition active:scale-[0.98]">
                  <img src="/icons/ios11/chat-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} /> Hubungi Admin
                </StoreWhatsAppLink>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-white/40">
                <span>Order cepat tanpa login</span>
                <span className="opacity-30">•</span>
                <span>Garansi replace</span>
                <span className="opacity-30">•</span>
                <span>Support WA admin</span>
              </div>
            </div>
            {/* Single orbit — shown at center on mobile, right on desktop */}
            <div className="flex justify-center lg:justify-end shrink-0 mt-6 lg:mt-0">
              <OrbitHero />
            </div>
          </div>
        </div>
      </section>

      <CommunityBar />

      {/* Katalog with pagination — authoritative D1 data */}
      <section id="katalog" className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-2 pb-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[20px] sm:text-[24px] text-white tracking-[-0.02em]">Katalog Premium</h2>
          <span className="text-xs text-white/40">{filtered.length} produk{filtered.length ? ` • tampil ${paged.length}` : ""}</span>
        </div>
        <div className="mt-4">
          <CategoryPills active={activeCat} onChange={(c) => { setActiveCat(c); setShowAll(false); }} />
        </div>
        {catalogError && (
          <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3">
            <span>Gagal memuat katalog: {catalogError}</span>
            <button onClick={() => location.reload()} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">Muat ulang</button>
          </div>
        )}
        {catalogLoading ? (
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5" aria-label="Memuat katalog">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="aspect-[3/4] rounded-[16px] sm:rounded-[22px] bg-white/[0.05] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 ax-glass-card rounded-[20px] p-10 text-center">
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

        {/* Tampilkan semua — satu ekspansi + ciutkan (bukan infinite
            scroll agar footer tetap terjangkau). */}
        {remaining > 0 && !showAll && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={() => setShowAll(true)}
              className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]"
            >
              Tampilkan semua ({remaining} produk lainnya)
            </button>
            <span className="text-xs text-white/35">{filtered.length} produk total</span>
          </div>
        )}
        {showAll && filtered.length > PER_PAGE && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={() => setShowAll(false)}
              className="h-9 px-5 rounded-full border border-white/15 bg-white/[0.06] text-white/70 font-medium text-xs inline-flex items-center justify-center hover:bg-white/10 transition active:scale-[0.98]"
            >
              Ciutkan ke {PER_PAGE} produk
            </button>
          </div>
        )}
      </section>
    </>
  );
}
