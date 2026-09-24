"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Product } from "@/lib/products";
import { formatRupiah } from "@/lib/utils";
import type { VariantSummary } from "@/lib/catalog";
import { formatWarranty } from "@/lib/catalog";
import { formatVariantLabel } from "@/lib/catalog";
import { buyerDeliveryBadge, buyerDeliveryEtaNonWr, buyerDeliveryKind } from "@/lib/catalog";
import { deliveryEtaForBuyer } from "@/lib/warung-rebahan/delivery-class";
import { useCart } from "@/stores/cart";
import { ProductCard } from "@/components/storefront/ProductCard";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { ActivationBody, DescriptionBody, MobileCollapsible, TermsBody, activationStepCount } from "@/components/storefront/ProductCopy";
import { isLongDescription, mergeProductCopy, parseProductDescription, type VariantCopy } from "@/lib/product-copy/format";

// /api/catalog mengganti teks mentah WR (terms/delivery_terms) dengan `copy`
// siap tampil — versi Axvara atau teks pemasok yang dirapikan.
type VariantItem = VariantSummary & { copy?: VariantCopy | null };

const DESC_FADE = {
  WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent)",
  maskImage: "linear-gradient(to bottom, #000 55%, transparent)",
};

const ShieldIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const StepsIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
);

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
  // Qty stepper PDP ala marketplace — state di atas (sebelum early return)
  // agar urutan hooks stabil. Nilai valid (min..max) dihitung di bawah dan
  // dipakai render; effect sinkronisasi ada setelah selectedMinQty dihitung.
  const [pdpQty, setPdpQty] = useState(1);

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
        const found = list.find((p) => p.slug === slug) ?? list[0];
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
        const activeVars = (data.product.variants || []).filter((v: VariantItem) => v.is_active && v.stock !== 0 && !(v.stock !== -1 && v.stock < Math.max(1, Number(v.min_qty ?? 1) || 1)));
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

  // Draft ketikan manual ala marketplace (Shopee/Tokopedia): string terpisah
  // agar "5" + ketik "0" (="50") tidak dipaksa jadi min di tiap keystroke.
  // Commit (clamp min..max) hanya saat blur/Enter. Hook di atas (sebelum
  // early return) agar urutan hooks stabil; reset tiap ganti varian.
  const [pdpQtyDraft, setPdpQtyDraft] = useState<string | null>(null);
  useEffect(() => {
    setPdpQtyDraft(null);
  }, [selectedVariantId, slug]);

  // Commit ketikan manual: kosong/non-angka = kembali ke nilai aman;
  // angka di-clamp ke [min, max] (min TIDAK bisa ditembus ke bawah).
  const commitPdpQtyDraft = (raw: string | null) => {
    setPdpQtyDraft(null);
    if (raw == null) return;
    const digits = raw.replace(/[^\d]/g, "");
    const n = Math.floor(Number(digits));
    if (!digits || !Number.isFinite(n)) return;
    setPdpQty(Math.min(Math.max(n, selectedMinQty), selectedMaxQty));
  };

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
  // Varian yang stoknya di bawah minimum (stock < min, stock !== -1) TIDAK
  // BISA dibeli dalam jumlah berapa pun (lihat QuickVariantModal + cart):
  // qty berapa pun pasti gagal di quote. Perlakukan sama dengan habis agar
  // tidak jadi dead-end di checkout.
  const variantMinQtyOf = (v: VariantItem): number => Math.max(1, Number(v.min_qty ?? 1) || 1);
  const isBelowMinimum = (v: VariantItem): boolean =>
    v.stock !== -1 && v.stock < variantMinQtyOf(v);
  const isPurchasable = (v: VariantItem): boolean => v.stock !== 0 && !isBelowMinimum(v);
  const selectedVariant = selectedVariantId ? activeVariants.find((v: VariantItem) => v.id === selectedVariantId) : null;
  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const displayComparePrice = selectedVariant ? selectedVariant.compare_price : product.comparePrice;
  // Minimum pembelian varian terpilih (migrasi 0034): GSuite = 50.
  const selectedMinQty = selectedVariant ? Math.max(1, Number(selectedVariant.min_qty ?? 1) || 1) : 1;
  // Qty terpilih ala marketplace (Shopee/Tokopedia): stepper dibuka di min,
  // tidak turun di bawah min, plafon 100. Direset ke min tiap ganti varian.
  const selectedMaxQty = selectedVariant
    ? Math.max(selectedMinQty, selectedVariant.stock === -1 ? 100 : Math.max(selectedMinQty, Math.min(100, selectedVariant.stock)))
    : 100;
  // Clamp render-time (bukan effect): qty selalu dalam [min, max] varian
  // aktif tanpa useEffect di bawah early-return (Rules of Hooks). Naik bila
  // min varian baru lebih besar, turun bila max menyusut.
  const safePdpQty = Math.min(Math.max(pdpQty, selectedMinQty), selectedMaxQty);
  const variantOutOfStock = variantsEnabled && activeVariants.length > 0
    ? activeVariants.every((variant) => !isPurchasable(variant))
    : selectedVariant ? !isPurchasable(selectedVariant) : false;
  const needsVariantSelection = variantsEnabled && !selectedVariant;
  const variantCatalogUnavailable = variantLoading || Boolean(variantError) || (variantsEnabled && activeVariants.length === 0);

  // Determine the display image — from gallery state or product.image fallback
  const displayImage =
    galleryImages.length > 0
      ? galleryImages[activeImg] || galleryImages[0]
      : product.image;
  const hasMultipleImages = galleryImages.length > 1;

  // S&K per varian dari WR (read-only, ikut varian terpilih; fallback ke
  // varian aktif pertama bila pembeli belum memilih — meniru panel WR yang
  // berganti isi tiap varian dipilih).
  const termsVariant = selectedVariant ?? activeVariants[0] ?? null;
  // Deskripsi + S&K + cara aktivasi dalam satu format untuk WR dan non-WR:
  // S&K varian (WR) digabung dengan bagian "Syarat & Ketentuan:" / "Cara
  // Aktivasi:" di deskripsi (produk non-WR); tiap baris tampil sekali.
  const parsedDescription = parseProductDescription(product.description);
  const productCopy = mergeProductCopy(termsVariant?.copy ?? null, parsedDescription);
  const hasDescription = parsedDescription.blocks.length > 0 || parsedDescription.sections.length > 0;
  const descCollapsible = isLongDescription(parsedDescription);
  const hasTerms = productCopy.sections.length > 0;
  const activationSteps = activationStepCount(productCopy.activation);
  const hasActivation = activationSteps > 0 || productCopy.notes.length > 0;
  const termsLabel = productCopy.fromVariant && termsVariant ? formatVariantLabel(termsVariant) : null;

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
          {hasDescription && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#00E5FF]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Deskripsi Produk
              </h2>
              <div className="mt-4 border-t border-white/10 pt-5 text-sm text-white/75 leading-relaxed">
                <DescriptionBody parsed={parsedDescription} />
              </div>
            </div>
          )}

          {/* Syarat & Ketentuan + Cara Aktivasi (Kolom Kiri Desktop) */}
          {(hasTerms || hasActivation) && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <ShieldIcon className="w-5 h-5 text-[#00E5FF]" />
                {hasTerms ? <>Syarat &amp; Ketentuan</> : "Cara Aktivasi"}
                {termsLabel && <span className="text-xs font-semibold text-[#00E5FF]/80 tracking-normal">{termsLabel}</span>}
              </h2>
              {hasTerms && (
                <div className="mt-4 border-t border-white/10 pt-5 text-sm text-white/75 leading-relaxed">
                  <TermsBody sections={productCopy.sections} />
                </div>
              )}
              {hasActivation && (
                <div className={`${hasTerms ? "mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5" : "mt-4 border-t border-white/10 pt-5"} text-sm text-white/75 leading-relaxed`}>
                  {hasTerms && (
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-bold text-white/80 uppercase tracking-wide">
                      <StepsIcon className="w-4 h-4 text-[#00E5FF]" />
                      Cara Aktivasi
                    </h3>
                  )}
                  <ActivationBody groups={productCopy.activation} notes={productCopy.notes} />
                </div>
              )}
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
                      } ${!isPurchasable(v) ? "opacity-50 cursor-not-allowed" : ""}`}
                      disabled={!isPurchasable(v)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-white">{formatVariantLabel(v)}</span>
                          <span className="mt-1.5 inline-flex">
                            {buyerDeliveryKind(v) === "instant" ? (
                              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Kirim otomatis</span>
                            ) : (
                              <span className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">Made By Order</span>
                            )}
                          </span>
                          {v.warranty_type !== 'none' && formatWarranty(v) && (
                            <div className="text-xs text-[#00E5FF]/80 font-medium mt-1 flex items-center gap-1">
                              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
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
                            ) : isBelowMinimum(v) ? (
                              <span className="text-[11px] font-semibold text-red-400">STOK &lt; MIN</span>
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

          {/* Jumlah pembelian ala marketplace (Shopee/Tokopedia): stepper di
              bawah varian, dibuka di minimum, floor = min. Satu-satunya
              tempat info "Min. N" tampil — tidak di tiap kartu varian agar
              tidak menumpuk. */}
          {variantsEnabled && selectedVariant && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-white/60">Jumlah</h3>
                {selectedMinQty > 1 && (
                  <span className="text-[11px] font-semibold text-[#FFD66B]">Min. pembelian {selectedMinQty}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => { commitPdpQtyDraft(null); setPdpQty((q) => Math.max(selectedMinQty, Math.min(selectedMaxQty, q) - 1)); }}
                    disabled={safePdpQty <= selectedMinQty}
                    aria-label="Kurangi jumlah"
                    className="flex h-10 w-10 items-center justify-center rounded-l-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14" /></svg>
                  </button>
                  {/* Ketik manual ala marketplace: draft string, commit clamp
                      min..max saat blur/Enter. Tidak bisa di bawah min. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pdpQtyDraft ?? String(safePdpQty)}
                    onChange={(e) => setPdpQtyDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                    onBlur={(e) => commitPdpQtyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    aria-live="polite"
                    aria-label={`Jumlah pembelian, minimal ${selectedMinQty}`}
                    className="w-14 bg-transparent text-center text-sm font-bold tabular-nums text-white outline-none [appearance:textfield]"
                  />
                  <button
                    type="button"
                    onClick={() => { commitPdpQtyDraft(null); setPdpQty((q) => Math.min(selectedMaxQty, Math.max(selectedMinQty, q) + 1)); }}
                    disabled={safePdpQty >= selectedMaxQty}
                    aria-label="Tambah jumlah"
                    className="flex h-10 w-10 items-center justify-center rounded-r-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
                <p className="text-xs text-white/40">
                  {selectedVariant.stock === -1 ? "Stok tersedia" : `Sisa ${selectedVariant.stock}`}
                  {selectedMinQty > 1 && <> · total {formatRupiah(displayPrice * safePdpQty)}</>}
                </p>
              </div>
            </div>
          )}

          {/* Badge pengiriman — satu sinyal, tanpa ikon checklist ganda.
              Mengikuti varian terpilih via buyerDeliveryKind: WR ikut
              wr_delivery_class, non-WR ikut fulfillment_mode (shared/unique =
              instan, manual = antrean admin). Non-WR manual memakai kalimat
              ETA admin (tanpa angka supplier 6–12 jam). */}
          <div className="mt-5">
            {buyerDeliveryKind(termsVariant ?? { fulfillment_mode: "manual" }) === "instant" ? (
              <span className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">Kirim otomatis</span>
            ) : (
              <span className="inline-flex rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-1 text-[11px] font-bold text-[#FFD66B]">{buyerDeliveryBadge(termsVariant ?? { fulfillment_mode: "manual" })}</span>
            )}
            <p className="mt-2 text-[12px] leading-5 text-white/50">
              {(() => {
                const tv = termsVariant;
                if (!tv) return deliveryEtaForBuyer(null);
                if (buyerDeliveryKind(tv) === "instant") return "Kirim otomatis setelah pembayaran dikonfirmasi";
                const wrId = tv.wr_variant_id == null ? "" : String(tv.wr_variant_id).trim();
                return wrId ? deliveryEtaForBuyer(tv.wr_delivery_class) : buyerDeliveryEtaNonWr();
              })()}
            </p>
          </div>
          <ul className="mt-3 space-y-2.5 text-[13px] text-white/60">
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Support WA admin selama masa aktif
            </li>
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Garansi sesuai Syarat &amp; Ketentuan produk ini
            </li>
          </ul>

          {/* Deskripsi Produk — Khusus Mobile ala Shopee (Expandable Accordion) */}
          {hasDescription && (
            <div className="mt-6 lg:hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Deskripsi Produk</span>
              </h3>
              <div
                id="pdp-description-mobile"
                className={`mt-2.5 text-xs text-white/70 leading-relaxed ${descCollapsible && !descExpanded ? "max-h-32 overflow-hidden" : ""}`}
                style={descCollapsible && !descExpanded ? DESC_FADE : undefined}
              >
                <DescriptionBody parsed={parsedDescription} size="xs" />
              </div>
              {descCollapsible && (
                <button
                  type="button"
                  aria-expanded={descExpanded}
                  aria-controls="pdp-description-mobile"
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="mt-2 text-xs font-semibold text-[#00E5FF] hover:underline flex items-center gap-1"
                >
                  {descExpanded ? "Tutup Deskripsi ∧" : "Lihat Selengkapnya ∨"}
                </button>
              )}
            </div>
          )}

          {/* S&K + Cara Aktivasi — Khusus Mobile, terlipat (permintaan owner) */}
          {(hasTerms || hasActivation) && (
            <div className="mt-4 lg:hidden space-y-3" data-testid="pdp-mobile-copy">
              {hasTerms && (
                <MobileCollapsible title="Syarat & Ketentuan" meta={termsLabel} icon={<ShieldIcon className="w-4 h-4 shrink-0 text-[#00E5FF]" />}>
                  <TermsBody sections={productCopy.sections} size="xs" />
                </MobileCollapsible>
              )}
              {hasActivation && (
                <MobileCollapsible
                  title="Cara Aktivasi"
                  meta={activationSteps > 0 ? `${activationSteps} langkah` : null}
                  icon={<StepsIcon className="w-4 h-4 shrink-0 text-[#00E5FF]" />}
                >
                  <ActivationBody groups={productCopy.activation} notes={productCopy.notes} size="xs" />
                </MobileCollapsible>
              )}
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
                  // Beli Langsung membawa qty stepper (bukan selalu 1):
                  // varian min>1 (GSuite 50) langsung lolos quote tanpa
                  // dead-end "kembali belanja".
                  const buyUrl = selectedVariantId
                    ? `/checkout?buy=${product.slug}&variant=${selectedVariantId}&qty=${safePdpQty}`
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
                    ? { ...product, price: selectedVariant.price, stock: selectedVariant.stock === -1 ? undefined : selectedVariant.stock, variantId: selectedVariant.id, variantLabel: selectedVariant.label, minQty: selectedMinQty }
                    : product;
                  add(cartProduct, safePdpQty);
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
                ? { ...product, price: selectedVariant.price, stock: selectedVariant.stock === -1 ? undefined : selectedVariant.stock, variantId: selectedVariant.id, variantLabel: selectedVariant.label, minQty: selectedMinQty }
                : product;
              add(cartProduct, safePdpQty);
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
                ? `/checkout?buy=${product.slug}&variant=${selectedVariantId}&qty=${safePdpQty}`
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
