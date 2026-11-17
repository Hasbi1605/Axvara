"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { OrbitHero } from "@/components/storefront/OrbitHero";
import { ScrollRope } from "@/components/storefront/ScrollRope";
import { CategoryPills } from "@/components/storefront/CategoryPills";
import { ProductCard, productCardAmounts } from "@/components/storefront/ProductCard";
import { PriceNote } from "@/components/storefront/Price";
import { useDisplayPrices } from "@/hooks/useDisplayPrices";
import { catalogCopy } from "@/lib/i18n/catalog-copy";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import type { Product } from "@/lib/products";
import { resolveCategorySlug, categories as fallbackCategories } from "@/lib/products";
import { groupProductsByCategory, sortCategoriesForDisplay, sortProductsForDisplay, type OrderableCategory } from "@/lib/product-order";
import { IosIcon, categoryIcon } from "@/components/ui/IosIcon";
import { marketCategoryName } from "@/lib/i18n/market-categories";
import { category3dIcon } from "@/lib/category-3d-icons";
import { useSearch } from "@/stores/search";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { HeroTrustRow } from "@/components/storefront/HeroTrustRow";

const PER_PAGE = 16;

/**
 * `initialProducts` dirender server (page.tsx) agar katalog ada di HTML awal:
 * dulu HTML beranda berisi "0 produk" tanpa satu link produk, jadi crawler
 * tanpa JavaScript (termasuk crawler AI) melihat toko kosong. Bila server
 * gagal memuat, klien jatuh kembali ke fetch seperti sebelumnya.
 */
export function HomeClient({ initialProducts, initialCategories }: { initialProducts?: Product[]; initialCategories?: OrderableCategory[] }) {
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
  const [categories, setCategories] = useState<OrderableCategory[]>(initialCategories ?? fallbackCategories.filter(category => category.slug !== "semua").map((category, index) => ({ ...category, sort_order: index })));
  const grouped = activeCat === "semua" && !q.trim();
  const groups = useMemo(() => groupProductsByCategory(catalogProducts, categories), [catalogProducts, categories]);
  const sections = useRef<HTMLDivElement>(null);
  const pills = useRef<HTMLDivElement>(null);
  const [navbarHeight, setNavbarHeight] = useState(64);
  const [inView, setInView] = useState<string>();

  useEffect(() => {
    if (initialCategories) return;
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("categories"); return response.json(); }).then(body => {
      if (Array.isArray(body.categories)) setCategories(body.categories);
    }).catch(() => {});
    return () => controller.abort();
  }, [initialCategories]);

  useEffect(() => {
    const navbar = document.querySelector("[data-store-navbar]");
    if (!navbar) return;
    const measure = () => setNavbarHeight(navbar.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(navbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setInView(undefined);
    if (!grouped || !sections.current || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
          (entry.target as HTMLElement).dataset.revealed = "true";
        }
        else visible.delete(entry.target);
      }
      const first = [...visible].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] as HTMLElement | undefined;
      if (first) setInView(first.dataset.catalogCategory);
    }, { rootMargin: `-${navbarHeight + (pills.current?.offsetHeight ?? 60)}px 0px -55% 0px`, threshold: 0 });
    sections.current.querySelectorAll("[data-catalog-category]").forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [grouped, groups, navbarHeight]);

  const selectCategory = (slug: string) => {
    setActiveCat(slug);
    setShowAll(false);
    document.getElementById("katalog")?.scrollIntoView?.({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

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
          setCatalogError(e instanceof Error ? e.message : "load_failed");
        })
        .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [hasInitial]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = catalogProducts.filter((p) => {
      const catOk = activeCat === "semua" || (activeCat === "__other" ? !categories.some(category => category.slug === p.categorySlug) : p.categorySlug === activeCat);
      if (!needle) return catOk;
      const hay = `${p.name} ${p.nameEn ?? ""} ${p.description} ${p.descriptionEn ?? ""} ${p.categorySlug} ${p.badge ?? ""}`.toLowerCase();
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
  }, [activeCat, q, catalogProducts, categories]);

  // Filter baru = daftar baru: kembali ke 16 awal.
  useEffect(() => { setShowAll(false); }, [q, activeCat]);
  const paged = grouped ? groups.flatMap(group => group.products.slice(0, 8)) : showAll ? filtered : filtered.slice(0, PER_PAGE);
  const remaining = grouped ? 0 : Math.max(0, filtered.length - paged.length);
  // Satu pemilik harga untuk seluruh koleksi tampil (<= 64 per request).
  const prices = useDisplayPrices(paged.flatMap(productCardAmounts), { debounce: true });
  const t = catalogCopy(prices.locale);

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
                {t.heroLine1}
                <br />
                {t.heroLine2}
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-white/60 max-w-[46ch]">
                {t.heroBody}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#katalog" className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]">{t.seeCatalog}</a>
                <StoreWhatsAppLink className="h-11 px-6 rounded-full border border-white/14 bg-white/[0.06] text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 hover:bg-white/10 transition active:scale-[0.98]">
                  <img src="/icons/ios11/chat-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} /> {t.contactAdmin}
                </StoreWhatsAppLink>
              </div>
              <HeroTrustRow items={[t.trustFast, t.trustWarranty, t.trustSupport]} />
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
      <section id="katalog" className="scroll-mt-36 lg:scroll-mt-20 mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-2 pb-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[20px] sm:text-[24px] text-white tracking-[-0.02em]">{t.catalogTitle}</h2>
          <span className="text-xs text-white/40">
            {grouped ? <><span className="lg:hidden">{t.productCount(filtered.length, groups.reduce((count, group) => count + Math.min(4, group.products.length), 0))}</span><span className="hidden lg:inline">{t.productCount(filtered.length, paged.length)}</span></> : t.productCount(filtered.length, paged.length)}
          </span>
        </div>
        <div ref={pills} className={grouped ? "sticky z-40 mt-4 -mx-4 border-b border-white/[0.06] bg-[#080C1E]/85 px-4 py-1 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" : "mt-4"} style={grouped ? { top: navbarHeight } : undefined}>
          <CategoryPills categories={sortCategoriesForDisplay(categories)} active={activeCat} inView={grouped ? inView : undefined} onChange={selectCategory} />
        </div>
        {catalogError && (
          <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3">
            <span>{t.catalogLoadFailed(catalogError === "load_failed" ? t.catalogLoadError : catalogError)}</span>
            <button onClick={() => location.reload()} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">{t.reload}</button>
          </div>
        )}
        {catalogLoading ? (
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5" aria-label={t.catalogLoadingAria}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="aspect-[3/4] rounded-[16px] sm:rounded-[22px] bg-white/[0.05] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 ax-glass-card rounded-[20px] p-10 text-center">
            <p className="text-white font-medium">{t.emptyTitle}</p>
            <p className="text-sm text-white/50 mt-1">{t.emptyBody}</p>
          </div>
        ) : (
          <>
          <PriceNote prices={prices} className="mt-3 text-[11px] text-white/45" />
          {grouped ? <div ref={sections}>
            {groups.map(({ category, products }, groupIndex) => {
              const icon = category3dIcon(category?.slug ?? "");
              return <section key={category?.slug ?? "unknown"} data-catalog-category={category?.slug} aria-labelledby={`category-${category?.slug ?? "unknown"}`} className="catalog-category-section mt-10 scroll-mt-40 sm:mt-14">
              <div className="mb-5 flex items-center gap-2 sm:gap-3">
                <span aria-hidden="true" className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center sm:h-10 sm:w-10">
                  {icon ? <>
                    <span className="pointer-events-none absolute -inset-[5px] rounded-full opacity-50 blur-[7px]" style={{ background: `radial-gradient(circle, ${icon.glow}, transparent 70%)` }} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={icon.src} alt="" width={40} height={40} decoding="async" loading={groupIndex === 0 ? "eager" : "lazy"} className="catalog-category-icon relative h-8 w-8 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,.25)] sm:h-10 sm:w-10" />
                  </> : <IosIcon name={categoryIcon(category?.slug ?? "", category?.icon)} size={24} tint="white" alt="" className="opacity-80" />}
                </span>
                <h2 id={`category-${category?.slug ?? "unknown"}`} className="min-w-0 font-display text-sm font-semibold text-white sm:text-lg">{category ? marketCategoryName(category.slug, prices.locale, category.name) : t.uncategorized}</h2>
                <span className="shrink-0 text-xs text-white/40">· {products.length}</span>
                <div aria-hidden className="h-px min-w-2 flex-1" style={{ background: "linear-gradient(90deg, rgba(0,229,255,.35), transparent)" }} />
                {products.length > 4 && <button onClick={() => selectCategory(category?.slug ?? "__other")} className="min-h-11 shrink-0 rounded text-xs font-medium text-[#00E5FF]/85 hover:text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]">{t.seeAllCategory} <span aria-hidden>→</span><span className="sr-only"> {category ? marketCategoryName(category.slug, prices.locale, category.name) : t.uncategorized}</span></button>}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
                {products.slice(0, 8).map((product, index) => <div key={product.id} className={index >= 4 ? "hidden lg:block" : undefined}>
                  <ProductCard product={product} index={groupIndex * 8 + index} prices={prices} hideCategory />
                </div>)}
              </div>
            </section>;
            })}
          </div> :
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {paged.map((p, i) => (
              <div
                key={p.id}
                {...(i >= 8 ? { style: { contentVisibility: "auto" as const, containIntrinsicSize: "auto 420px" } } : {})}
              >
                <ProductCard product={p} index={i} prices={prices} />
              </div>
            ))}
          </div>}
          </>
        )}

        {/* Tampilkan semua — satu ekspansi + ciutkan (bukan infinite
            scroll agar footer tetap terjangkau). */}
        {remaining > 0 && !showAll && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={() => setShowAll(true)}
              className="h-11 px-6 rounded-full bg-white text-[#080C1E] font-semibold text-sm inline-flex items-center justify-center hover:bg-white/90 transition active:scale-[0.98]"
            >
              {t.showAll(remaining)}
            </button>
            <span className="text-xs text-white/35">{t.totalProducts(filtered.length)}</span>
          </div>
        )}
        {!grouped && showAll && filtered.length > PER_PAGE && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={() => setShowAll(false)}
              className="h-9 px-5 rounded-full border border-white/15 bg-white/[0.06] text-white/70 font-medium text-xs inline-flex items-center justify-center hover:bg-white/10 transition active:scale-[0.98]"
            >
              {t.collapse(PER_PAGE)}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
