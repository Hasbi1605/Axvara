"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Product } from "@/lib/products";
import { formatRupiah } from "@/lib/utils";
import type { VariantSummary } from "@/lib/catalog";
import { formatWarranty } from "@/lib/catalog";
import { useCart } from "@/stores/cart";
import { ProductCard } from "@/components/storefront/ProductCard";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";

type VariantItem = VariantSummary;

type CatalogDetail = {
  id: number;
  name: string;
  slug: string;
  variants: VariantItem[];
};

// Interaktivitas PDP (varian/keranjang/checkout). Dipisah dari page.tsx
// server component (issue #11) agar metadata + JSON-LD + h1 awal tetap
// server-rendered untuk crawler/preview, tanpa mengubah flow pembelian.
export default function ProductDetailClient({ slug: slugProp }: { slug?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = slugProp ?? params.slug;
  const router = useRouter();
  const add = useCart((s) => s.add);

  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [activeImg, setActiveImg] = useState(0);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [catalogDetail, setCatalogDetail] = useState<CatalogDetail | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [variantsEnabled, setVariantsEnabled] = useState(false);
  const [variantLoading, setVariantLoading] = useState(true);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [variantModal, setVariantModal] = useState<"cart" | "checkout" | null>(null);

  useEffect(() => {
    setDetailLoading(true);
    setDetailError(null);
    setCatalogProducts([]);
    setGalleryImages([]);
    setActiveImg(0);
    // Exact slug (issue #14): sebelumnya fetch SELURUH katalog
    // (/api/products?active=1 tanpa filter) hanya untuk 1 PDP + galeri.
    // Kini 1 produk via slug — galeri dibangun dari produk itu sendiri.
    // Related di bawah memakai daftar kecil ini (fallback: kosong).
    fetch(`/api/products?active=1&slug=${encodeURIComponent(slug)}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const list: Product[] = Array.isArray(data.products) ? data.products : [];
        setCatalogProducts(list);
        const found = list[0];
        if (found) {
          const imgs: string[] = [];
          if (found.image) imgs.push(found.image);
          if (Array.isArray(found.images)) {
            for (const img of found.images) {
              if (img && !imgs.includes(img)) imgs.push(img);
            }
          }
          if (imgs.length > 0) setGalleryImages(imgs);
        }
      })
      .catch((e) => setDetailError(e instanceof Error ? e.message : "Gagal memuat produk"))
      .finally(()=> setDetailLoading(false));
  }, [slug]);

  // Fetch variant-aware catalog detail
  useEffect(() => {
    setCatalogDetail(null);
    setSelectedVariantId(null);
    setVariantsEnabled(false);
    setVariantError(null);
    setVariantLoading(true);
    fetch(`/api/catalog?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`variant_catalog_unavailable:${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data?.product) throw new Error("variant_catalog_unavailable:not_found");
        setCatalogDetail(data.product);
        setVariantsEnabled(data.variantsEnabled === true);
        // Auto-select if only one active, in-stock variant.
        const activeVars = (data.product.variants || []).filter((v: VariantItem) => v.is_active && v.stock !== 0);
        if (activeVars.length === 1) {
          setSelectedVariantId(activeVars[0].id);
        }
      })
      .catch(() => setVariantError("Pilihan varian gagal dimuat. Muat ulang halaman."))
      .finally(() => setVariantLoading(false));
  }, [slug]);

  const product = catalogProducts.find((p) => p.slug === slug);
  const [related, setRelated] = useState<Product[]>([]);

  useEffect(() => {
    const current = catalogProducts.find((p) => p.slug === slug);
    if (!current) { setRelated([]); return; }
    // Related dibatasi server (issue #14): 8 produk kategori sama — bukan
    // seluruh katalog. Abort bila slug berpindah sebelum respons tiba.
    const controller = new AbortController();
    fetch(`/api/products?active=1&cat=${encodeURIComponent(current.categorySlug)}`, { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const list: Product[] = Array.isArray(data.products) ? data.products : [];
        setRelated(list.filter((p) => p.slug !== slug).slice(0, 8));
      })
      .catch(() => setRelated([]));
    return () => controller.abort();
  }, [catalogProducts, slug]);

  const goPrev = useCallback(() => {
    setActiveImg((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
  }, [galleryImages.length]);

  const goNext = useCallback(() => {
    setActiveImg((prev) => (prev + 1) % galleryImages.length);
  }, [galleryImages.length]);

  if (detailLoading) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-10">
        <div className="h-6 w-24 rounded-full bg-white/10 animate-pulse" />
        <div className="mt-6 grid lg:grid-cols-[1fr_38%] gap-6">
          <div className="ax-glass-card rounded-[24px] p-3">
            <div className="aspect-[4/3] rounded-2xl bg-white/10 animate-pulse" />
            <div className="mt-3 flex gap-2"><div className="w-[90px] h-[68px] rounded-xl bg-white/10 animate-pulse" /><div className="w-[90px] h-[68px] rounded-xl bg-white/10 animate-pulse" /></div>
          </div>
          <div className="ax-glass-card rounded-[24px] p-8 space-y-4">
            <div className="h-4 w-32 rounded-full bg-white/10 animate-pulse" />
            <div className="h-7 w-[80%] rounded-xl bg-white/10 animate-pulse" />
            <div className="h-4 w-full rounded-full bg-white/10 animate-pulse" />
            <div className="h-12 rounded-xl bg-white/10 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (detailError) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 inline-block">Gagal memuat: {detailError}</p>
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={()=> location.reload()} className="h-9 px-4 rounded-full bg-white text-[#070a1e] text-sm font-bold">Muat ulang</button>
          <Link href="/" className="h-9 px-4 rounded-full ax-glass-card text-sm inline-flex items-center">Kembali</Link>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="text-white/60">Produk tidak ditemukan</p>
        <Link href="/" className="text-[#00E5FF] text-sm mt-3 inline-block">
          ← Kembali ke katalog
        </Link>
      </div>
    );
  }

  // In variant mode, product.stock is legacy metadata; purchasability is
  // determined exclusively from the selected/active variants below.
  const outOfStock = !variantsEnabled
    && product.stock !== undefined
    && product.stock !== null
    && product.stock !== -1
    && product.stock <= 0;

  // Variant-aware derived values
  const variants = catalogDetail?.variants || [];
  const activeVariants = variants.filter((v: VariantItem) => v.is_active);
  const selectedVariant = selectedVariantId ? activeVariants.find((v: VariantItem) => v.id === selectedVariantId) : null;
  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const displayComparePrice = selectedVariant ? selectedVariant.compare_price : product.comparePrice;
  const variantOutOfStock = variantsEnabled && activeVariants.length > 0
    ? activeVariants.every((variant) => variant.stock === 0)
    : selectedVariant ? selectedVariant.stock === 0 : false;
  const needsVariantSelection = variantsEnabled && !selectedVariant;
  const variantCatalogUnavailable = variantLoading || Boolean(variantError) || (variantsEnabled && activeVariants.length === 0);

  // Determine the display image — from gallery state or product.image fallback
  const displayImage =
    galleryImages.length > 0
      ? galleryImages[activeImg] || galleryImages[0]
      : product.image;
  const hasMultipleImages = galleryImages.length > 1;

  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/ios11/back-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} /> Kembali
      </button>

      {/* Dynamic grid: card kiri greedy (1fr), card kanan responsive fit-content */}
      <div className="mt-6 grid lg:grid-cols-[1fr_38%] xl:grid-cols-[1fr_minmax(360px,420px)] gap-6 lg:gap-8 items-start">
        {/* ===== LEFT COLUMN: IMAGE GALLERY + DESKTOP DESCRIPTION ===== */}
        <div className="flex flex-col gap-6">
          <div className="ax-glass-card rounded-[24px] p-2 sm:p-3">
            <div className="relative">
              {/* Main image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayImage}
                alt={product.name}
                className="w-full aspect-[4/3] object-cover rounded-2xl"
              />

              {/* Arrows — always rendered when >1 image */}
              {hasMultipleImages && (
                <>
                  <button
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition active:scale-90"
                    aria-label="Foto sebelumnya"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <button
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition active:scale-90"
                    aria-label="Foto berikutnya"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                  <span className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full">
                    {activeImg + 1} / {galleryImages.length}
                  </span>
                </>
              )}
            </div>

            {/* Thumbnails — always rendered when >1 image */}
            {hasMultipleImages && (
              <div className="mt-3 flex gap-2 sm:gap-3 px-1 pb-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {galleryImages.map((img, i) => (
                  <button
                    key={`thumb-${i}-${img.slice(-12)}`}
                    onClick={() => setActiveImg(i)}
                    className={`shrink-0 w-[72px] h-[56px] sm:w-[90px] sm:h-[68px] rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                      i === activeImg
                        ? "border-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.35)]"
                        : "border-white/15 opacity-50 hover:opacity-100 hover:border-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt={`${product.name} foto ${i + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Deskripsi Produk — Kolom Kiri di Desktop (Lega & Rapi) */}
          {product.description && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#00E5FF]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Deskripsi Produk
              </h2>
              <div className="mt-4 border-t border-white/8 pt-5 text-sm text-white/75 leading-relaxed whitespace-pre-line">
                {product.description}
              </div>
            </div>
          )}
        </div>

        {/* ===== PRODUCT INFO — sticky, self-sizing ===== */}
        <div className="ax-glass-card rounded-[24px] p-6 sm:p-8 lg:sticky lg:top-24 flex flex-col">
          {/* Badge produk (Terlaris / Baru / Bundle / dll) */}
          {product.badge && (
            <span className="self-start rounded-full bg-[#FFB800]/15 text-[#FFB800] text-[11px] font-bold px-3 py-1 tracking-wide uppercase border border-[#FFB800]/25">
              {product.badge}
            </span>
          )}

          <p className={`text-xs tracking-[0.08em] text-[#00E5FF]/80 font-semibold uppercase ${product.badge ? "mt-3" : ""}`}>
            {product.categorySlug.replace("-", " ")}
          </p>
          <h1 className="mt-2 font-display font-bold text-[22px] sm:text-[26px] leading-tight text-white">
            {product.name}
          </h1>

          {/* Divider */}
          <div className="mt-4 border-t border-white/8" />

          {/* Price block */}
          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <span className="font-display font-bold text-[26px] text-white">
              {formatRupiah(displayPrice)}
            </span>
            {displayComparePrice && (
              <>
                <span className="text-sm line-through text-white/30">
                  {formatRupiah(displayComparePrice)}
                </span>
                <span className="rounded-full bg-[#FFB800] text-[#080C1E] text-xs font-bold px-2 py-1">
                  -{Math.round((1 - displayPrice / displayComparePrice) * 100)}%
                </span>
              </>
            )}
          </div>

          {/* Social proof: sold count + stock */}
          {((product.soldCount != null && product.soldCount > 0) || (product.stock != null && product.stock > 0)) && (
            <div className="mt-3 flex items-center gap-3 text-xs text-white/50">
              {product.soldCount != null && product.soldCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#FFB800]" fill="currentColor"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>
                  {product.soldCount.toLocaleString("id-ID")} terjual
                </span>
              )}
              {product.soldCount && product.stock ? <span className="text-white/20">·</span> : null}
              {product.stock != null && product.stock > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${product.stock > 10 ? "bg-emerald-400" : "bg-[#FFB800]"}`} />
                  Stok: {product.stock}
                </span>
              )}
            </div>
          )}

          {/* Variant selector — Desktop: inline picker. Mobile: hint only (Shopee-style). */}
          {variantsEnabled && activeVariants.length > 0 && (
            <>
              {/* Desktop inline variant picker */}
              <div className="mt-4 space-y-2 hidden lg:block">
                <h3 className="text-sm font-medium text-white/60">Pilih Varian</h3>
                <div className="grid gap-2">
                  {activeVariants.map((v: VariantItem) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariantId(v.id)}
                      className={`text-left p-3 rounded-xl border transition ${
                        selectedVariantId === v.id
                          ? "border-[#00E5FF]/50 bg-[#00E5FF]/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      } ${v.stock === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                      disabled={v.stock === 0}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-sm font-medium text-white">{v.label}</span>
                          {v.warranty_type !== 'none' && formatWarranty(v) && (
                            <div className="text-xs text-[#00E5FF]/80 font-medium mt-1">
                              {formatWarranty(v)}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold text-[#00E5FF]">
                            Rp{v.price.toLocaleString("id-ID")}
                          </span>
                          {v.compare_price && v.compare_price > v.price && (
                            <div className="flex items-center gap-1.5 justify-end mt-0.5">
                              <span className="text-[11px] text-white/30 line-through">Rp{v.compare_price.toLocaleString("id-ID")}</span>
                              <span className="text-[10px] font-bold text-[#FFB800]">-{Math.round((1 - v.price / v.compare_price) * 100)}%</span>
                            </div>
                          )}
                          <div className="mt-0.5">
                            {v.stock === 0 ? (
                              <span className="text-[11px] font-semibold text-red-400">HABIS</span>
                            ) : (
                              <span className="text-[11px] text-white/45">
                                Sisa {v.stock === -1 ? "∞" : v.stock}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Mobile: compact variant hint (Shopee-style) — tap to open bottom-sheet */}
              <button
                type="button"
                onClick={() => setVariantModal("checkout")}
                className="mt-4 lg:hidden w-full flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white/70">Varian</span>
                  <span className="text-xs font-semibold text-[#00E5FF]">
                    Tersedia {activeVariants.length} varian
                  </span>
                </div>
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </>
          )}

          {/* Divider */}
          <div className="mt-5 border-t border-white/8" />

          {/* Feature list */}
          <ul className="mt-5 space-y-2.5 text-[13px] text-white/60">
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Aktivasi 5–15 menit setelah pembayaran dikonfirmasi
            </li>
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Support WA admin selama masa aktif
            </li>
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Garansi replace sesuai ketentuan di deskripsi produk ini
            </li>
          </ul>

          {/* Deskripsi Produk — Khusus Mobile ala Shopee (Expandable Accordion) */}
          {product.description && (
            <div className="mt-6 lg:hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Deskripsi Produk</span>
              </h3>
              <div
                className={`mt-2.5 text-xs text-white/70 leading-relaxed whitespace-pre-line ${
                  descExpanded ? "" : "line-clamp-4"
                }`}
              >
                {product.description}
              </div>
              <button
                type="button"
                onClick={() => setDescExpanded(!descExpanded)}
                className="mt-2 text-xs font-semibold text-[#00E5FF] hover:underline flex items-center gap-1"
              >
                {descExpanded ? "Tutup Deskripsi ∧" : "Lihat Selengkapnya ∨"}
              </button>
            </div>
          )}

          {/* Spacer — pushes buttons down when content is short */}
          <div className="flex-1 min-h-[16px]" />

          {/* CTA buttons — Desktop only. Mobile uses sticky bottom bar. */}
          <div className="hidden lg:block">
          {outOfStock || variantOutOfStock ? (
            <div className="mt-6">
              <span className="w-full h-[52px] rounded-xl bg-white/[0.06] border border-white/10 text-white/40 font-bold flex items-center justify-center gap-2">
                Stok Habis
              </span>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {needsVariantSelection && (
                <p className="text-xs text-[#FFB800]/80 text-center">Pilih varian terlebih dahulu</p>
              )}
              {variantCatalogUnavailable && (
                <p className="text-xs text-red-300/80 text-center">{variantError || "Pilihan varian sedang dimuat…"}</p>
              )}
              <button
                onClick={() => {
                  const buyUrl = selectedVariantId
                    ? `/checkout?buy=${product.slug}&variant=${selectedVariantId}`
                    : `/checkout?buy=${product.slug}`;
                  router.push(buyUrl);
                }}
                disabled={needsVariantSelection || variantCatalogUnavailable}
                className={`w-full h-[52px] rounded-xl font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] ${
                  needsVariantSelection || variantCatalogUnavailable
                    ? "bg-[#00E5FF]/30 text-[#080C1E]/50 cursor-not-allowed"
                    : "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> Beli Langsung
              </button>
              <button
                onClick={() => {
                  const cartProduct = selectedVariant
                    ? { ...product, price: selectedVariant.price, stock: selectedVariant.stock === -1 ? undefined : selectedVariant.stock, variantId: selectedVariant.id, variantLabel: selectedVariant.label }
                    : product;
                  add(cartProduct);
                }}
                disabled={needsVariantSelection || variantCatalogUnavailable}
                className={`w-full h-[48px] rounded-xl ax-glass-card font-semibold text-sm flex items-center justify-center gap-2 transition ${
                  needsVariantSelection || variantCatalogUnavailable
                    ? "text-white/30 cursor-not-allowed"
                    : "text-white hover:bg-white/10"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/shopping-bag-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> Tambah ke Keranjang
              </button>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Floating Sticky Bottom Action Bar — Mobile Shopee-style: always enabled */}
      {!outOfStock && !variantOutOfStock && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080C1E]/90 backdrop-blur-xl border-t border-white/10 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.5)] flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (needsVariantSelection) { setVariantModal("cart"); return; }
              const cartProduct = selectedVariant
                ? { ...product, price: selectedVariant.price, stock: selectedVariant.stock === -1 ? undefined : selectedVariant.stock, variantId: selectedVariant.id, variantLabel: selectedVariant.label }
                : product;
              add(cartProduct);
            }}
            className="flex-1 h-11 rounded-xl ax-glass-card font-semibold text-xs flex items-center justify-center gap-1.5 transition text-white hover:bg-white/10 active:scale-95"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/shopping-bag-32.png" alt="" width={15} height={15} className="w-3.5 h-3.5 object-contain brightness-0 invert" draggable={false} /> Keranjang
          </button>
          <button
            type="button"
            onClick={() => {
              if (needsVariantSelection) { setVariantModal("checkout"); return; }
              const buyUrl = selectedVariantId
                ? `/checkout?buy=${product.slug}&variant=${selectedVariantId}`
                : `/checkout?buy=${product.slug}`;
              router.push(buyUrl);
            }}
            className="flex-[1.5] h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_2px_12px_rgba(0,229,255,0.25)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={15} height={15} className="w-3.5 h-3.5 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> Beli Sekarang · {formatRupiah(displayPrice)}
          </button>
        </div>
      )}

      {/* QuickVariantModal — triggered from mobile sticky bar or variant hint */}
      {variantModal && product && (
        <QuickVariantModal
          product={product}
          mode={variantModal}
          onClose={() => setVariantModal(null)}
        />
      )}

      {/* Produk Serupa */}
      <div className="mt-10 sm:mt-12 pb-16 lg:pb-0">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[18px] sm:text-[20px] text-white tracking-[-0.02em]">
            Produk Serupa
          </h2>
          <Link href="/#katalog" className="text-xs text-[#00E5FF] hover:text-white transition shrink-0">
            Lihat semua →
          </Link>
        </div>
        <div
          className="mt-4 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex gap-3 sm:gap-5 pb-3 pr-4 sm:pr-0" style={{ minWidth: "min-content" }}>
            {related.map((p, i) => (
              <div key={p.id} className="snap-start shrink-0 w-[156px] sm:w-[300px]">
                <ProductCard product={p} index={i} compact />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
