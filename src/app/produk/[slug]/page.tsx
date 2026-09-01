
"use client";
export const runtime = "edge";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { products, type Product } from "@/lib/products";
import { formatRupiah } from "@/lib/utils";
import { useCart } from "@/stores/cart";
import { ProductCard } from "@/components/storefront/ProductCard";

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const add = useCart((s) => s.add);

  const [catalogProducts, setCatalogProducts] = useState<Product[]>(products);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [activeImg, setActiveImg] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setDetailLoading(true);
    setDetailError(null);
    fetch("/api/products?active=1")
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (Array.isArray(data.products)) {
          setCatalogProducts(data.products);
          // Find the current product and build gallery
          const found = data.products.find((p: Product) => p.slug === slug);
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
        }
      })
      .catch((e) => setDetailError(e instanceof Error ? e.message : "Gagal memuat produk"))
      .finally(()=> setDetailLoading(false));
  }, [slug]);

  // Also build gallery from seed data on first render
  useEffect(() => {
    const found = products.find((p) => p.slug === slug);
    if (found) {
      const imgs: string[] = [];
      if (found.image) imgs.push(found.image);
      if (Array.isArray(found.images)) {
        for (const img of found.images) {
          if (img && !imgs.includes(img)) imgs.push(img);
        }
      }
      if (imgs.length > 0 && galleryImages.length === 0) setGalleryImages(imgs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const product =
    catalogProducts.find((p) => p.slug === slug) ??
    products.find((p) => p.slug === slug);

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
          <div className="ax-glass rounded-[24px] p-3">
            <div className="aspect-[4/3] rounded-2xl bg-white/10 animate-pulse" />
            <div className="mt-3 flex gap-2"><div className="w-[90px] h-[68px] rounded-xl bg-white/10 animate-pulse" /><div className="w-[90px] h-[68px] rounded-xl bg-white/10 animate-pulse" /></div>
          </div>
          <div className="ax-glass rounded-[24px] p-8 space-y-4">
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
          <Link href="/" className="h-9 px-4 rounded-full ax-glass text-sm inline-flex items-center">Kembali</Link>
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

  const discount = product.comparePrice
    ? Math.round((1 - product.price / product.comparePrice) * 100)
    : 0;

  const related = (() => {
    const sameCat = catalogProducts.filter(
      (p) => p.categorySlug === product.categorySlug && p.id !== product.id
    );
    const others = catalogProducts.filter(
      (p) => p.categorySlug !== product.categorySlug && p.id !== product.id
    );
    return [...sameCat, ...others].slice(0, 8);
  })();

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
        {/* ===== IMAGE GALLERY ===== */}
        <div className="ax-glass rounded-[24px] p-2 sm:p-3">
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

        {/* ===== PRODUCT INFO — sticky, self-sizing ===== */}
        <div className="ax-glass rounded-[24px] p-6 sm:p-8 lg:sticky lg:top-24 flex flex-col">
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
          <p className="mt-2 text-sm text-white/55 leading-relaxed">{product.description}</p>

          {/* Divider */}
          <div className="mt-5 border-t border-white/8" />

          {/* Price block */}
          <div className="mt-5 flex items-baseline gap-3 flex-wrap">
            <span className="font-display font-bold text-[26px] text-white">
              {formatRupiah(product.price)}
            </span>
            {product.comparePrice && (
              <>
                <span className="text-sm line-through text-white/30">
                  {formatRupiah(product.comparePrice)}
                </span>
                <span className="rounded-full bg-[#FFB800] text-[#080C1E] text-xs font-bold px-2 py-1">
                  -{discount}%
                </span>
              </>
            )}
          </div>

          {/* Social proof: sold count + stock */}
          {(product.soldCount || product.stock) && (
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

          {/* Divider */}
          <div className="mt-5 border-t border-white/8" />

          {/* Trust badges */}
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/shield-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} />
              Garansi full
            </span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)" }} />
              Aktivasi instan
            </span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#00E5FF]/70" fill="none" stroke="currentColor" strokeWidth={1.5}><path d="M8 1v6l3.5 2M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" strokeLinecap="round"/></svg>
              Support 24 jam
            </span>
          </div>

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
              Garansi replace jika kendala dari sistem
            </li>
          </ul>

          {/* Spacer — pushes buttons down when content is short */}
          <div className="flex-1 min-h-[16px]" />

          {/* CTA buttons */}
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => router.push(`/checkout?buy=${product.slug}`)}
              className="w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold flex items-center justify-center gap-2 hover:bg-[#00D0E8] transition active:scale-[0.98]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> Beli Langsung
            </button>
            <button
              onClick={() => add(product)}
              className="w-full h-[48px] rounded-xl ax-glass font-semibold text-white text-sm flex items-center justify-center gap-2 hover:bg-white/10 transition"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/shopping-bag-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> Tambah ke Keranjang
            </button>
          </div>
        </div>
      </div>

      {/* Produk Serupa */}
      <div className="mt-10 sm:mt-12">
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
