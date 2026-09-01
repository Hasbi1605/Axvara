
"use client";
export const runtime = "edge";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
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
  useEffect(() => {
    fetch("/api/products?active=1")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => { if (Array.isArray(data.products)) setCatalogProducts(data.products); })
      .catch(() => {});
  }, []);
  const product = catalogProducts.find((p) => p.slug === slug) ?? products.find((p) => p.slug === slug);

  // Gallery: merge image + images, deduplicate — must be before early return (hooks rules)
  // Use product?.images?.length as extra dep to re-compute when API data arrives
  const allImages = useMemo(() => {
    if (!product) return [""];
    const imgs: string[] = [];
    if (product.image) imgs.push(product.image);
    if (product.images && Array.isArray(product.images)) {
      for (const img of product.images) {
        if (img && !imgs.includes(img)) imgs.push(img);
      }
    }
    return imgs.length ? imgs : [product.image || ""];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.slug, product?.image, product?.images?.length]);

  const [activeImg, setActiveImg] = useState(0);

  // Reset active image when product changes
  useEffect(() => { setActiveImg(0); }, [product?.id]);

  if (!product) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="text-white/60">Produk tidak ditemukan</p>
        <Link href="/" className="text-[#00E5FF] text-sm mt-3 inline-block">← Kembali ke katalog</Link>
      </div>
    );
  }

  const discount = product.comparePrice ? Math.round((1 - product.price / product.comparePrice) * 100) : 0;

  const related = (() => {
    const sameCat = catalogProducts.filter((p) => p.categorySlug === product.categorySlug && p.id !== product.id);
    const others = catalogProducts.filter((p) => p.categorySlug !== product.categorySlug && p.id !== product.id);
    return [...sameCat, ...others].slice(0, 8);
  })();

  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
        <img src="/icons/ios11/back-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} /> Kembali
      </button>

      <div className="mt-6 grid lg:grid-cols-2 gap-6 lg:gap-8">
        <div className="ax-glass rounded-[24px] p-2">
          {/* Main image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={allImages[activeImg] || product.image}
            alt={product.name}
            className="w-full aspect-[4/3] object-cover rounded-2xl"
          />
          {/* Thumbnail strip — only show if >1 image */}
          {allImages.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
              {allImages.map((img, i) => (
                <button
                  key={img}
                  onClick={() => setActiveImg(i)}
                  className={`shrink-0 w-[60px] h-[46px] rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                    i === activeImg
                      ? "border-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.3)] scale-[1.02]"
                      : "border-white/10 opacity-60 hover:opacity-90 hover:border-white/25"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt={`${product.name} ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ax-glass rounded-[24px] p-6 sm:p-7">
          <p className="text-xs tracking-[0.08em] text-[#00E5FF]/80 font-semibold uppercase">{product.categorySlug.replace("-", " ")}</p>
          <h1 className="mt-2 font-display font-bold text-[24px] sm:text-[28px] leading-tight text-white">{product.name}</h1>
          <p className="mt-2 text-sm text-white/55">{product.description}</p>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="font-display font-bold text-[28px] text-white">{formatRupiah(product.price)}</span>
            {product.comparePrice && (
              <>
                <span className="text-sm line-through text-white/30">{formatRupiah(product.comparePrice)}</span>
                <span className="rounded-full bg-[#FFB800] text-[#080C1E] text-xs font-bold px-2 py-1">-{discount}%</span>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70"><img src="/icons/ios11/shield-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} /> Garansi full</span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5 text-white/70"><img src="/icons/ios11/lightning-bolt-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-70" draggable={false} style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)" }} /> Stok tersedia</span>
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
              <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> Beli Langsung
            </button>
            <button onClick={() => add(product)} className="flex-1 h-[52px] rounded-xl ax-glass font-semibold text-white flex items-center justify-center gap-2 hover:bg-white/10">
              <img src="/icons/ios11/shopping-bag-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> Tambah ke Keranjang
            </button>
          </div>
        </div>
      </div>

      {/* Produk Serupa — scrollable */}
      <div className="mt-10 sm:mt-12">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[18px] sm:text-[20px] text-white tracking-[-0.02em]">Produk Serupa</h2>
          <Link href="/#katalog" className="text-xs text-[#00E5FF] hover:text-white transition shrink-0">Lihat semua →</Link>
        </div>
        <div className="mt-4 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
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
