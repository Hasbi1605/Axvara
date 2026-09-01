
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

  useEffect(() => {
    fetch("/api/products?active=1")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
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
      .catch(() => {});
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

      <div className="mt-6 grid lg:grid-cols-2 gap-6 lg:gap-8">
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

        {/* ===== PRODUCT INFO ===== */}
        <div className="ax-glass rounded-[24px] p-6 sm:p-7">
          <p className="text-xs tracking-[0.08em] text-[#00E5FF]/80 font-semibold uppercase">
            {product.categorySlug.replace("-", " ")}
          </p>
          <h1 className="mt-2 font-display font-bold text-[24px] sm:text-[28px] leading-tight text-white">
            {product.name}
          </h1>
          <p className="mt-2 text-sm text-white/55">{product.description}</p>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="font-display font-bold text-[28px] text-white">
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

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/shield-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} />
              Garansi full
            </span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)" }} />
              Stok tersedia
            </span>
          </div>

          <ul className="mt-6 space-y-2 text-sm text-white/60 list-disc list-inside">
            <li>Aktivasi 5–15 menit setelah pembayaran dikonfirmasi</li>
            <li>Support WA admin selama masa aktif</li>
            <li>Garansi replace jika kendala dari sistem</li>
          </ul>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => router.push(`/checkout?buy=${product.slug}`)}
              className="flex-1 h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold flex items-center justify-center gap-2 hover:bg-[#00D0E8] transition"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> Beli Langsung
            </button>
            <button
              onClick={() => add(product)}
              className="flex-1 h-[52px] rounded-xl ax-glass font-semibold text-white flex items-center justify-center gap-2 hover:bg-white/10"
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
