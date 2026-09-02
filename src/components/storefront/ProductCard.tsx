"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatRupiah } from "@/lib/utils";
import type { Product } from "@/lib/products";
import { useCart } from "@/stores/cart";
import { IosIcon } from "@/components/ui/IosIcon";

/**
 * Responsive image helper — for Unsplash URLs, generates srcset with
 * multiple widths. For other URLs, returns the original src.
 */
function responsiveImg(url: string) {
  if (!url.includes("unsplash.com")) {
    return { src: url, srcSet: undefined, sizes: undefined };
  }
  const parsed = new URL(url);
  ["w", "h", "fit", "crop", "fm", "q"].forEach((key) => parsed.searchParams.delete(key));
  const variant = (w: number) => {
    const next = new URL(parsed);
    next.searchParams.set("w", String(w));
    next.searchParams.set("h", String(Math.round(w * 0.75)));
    next.searchParams.set("fit", "crop");
    next.searchParams.set("fm", "webp");
    next.searchParams.set("q", "75");
    return next.toString();
  };
  const variants = [180, 360, 600];
  const srcSet = variants.map((w) => `${variant(w)} ${w}w`).join(", ");
  const sizes = "(max-width: 640px) calc((100vw - 44px) / 2), (max-width: 1023px) calc((100vw - 52px) / 2), 300px";
  const src = variant(360);
  return { src, srcSet, sizes };
}

export function ProductCard({ product, index = 0, compact = false }: { product: Product; index?: number; compact?: boolean }) {
  const add = useCart((s) => s.add);
  const router = useRouter();
  const discount = product.comparePrice ? Math.round((1 - product.price / product.comparePrice) * 100) : 0;

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    add(product);
  };
  const handleCheckout = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/checkout?buy=${product.slug}`);
  };

  const img = responsiveImg(product.image);

  if (compact) {
    return (
      <Link href={`/produk/${product.slug}`} className="group block ax-glass-card rounded-[14px] overflow-hidden hover:-translate-y-0.5 transition-all duration-300 flex flex-col">
        <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.03] m-1 rounded-[10px]">
          {product.badge && (
            <span className="absolute top-1.5 left-1.5 z-10 rounded-full bg-[#FFB800] text-[#080C1E] text-[9px] font-bold px-1.5 py-0.5 leading-none shadow">{product.badge}</span>
          )}
          {discount > 0 && (
            <span className="absolute top-1.5 right-1.5 z-10 rounded-full bg-[#00E5FF] text-[#080C1E] text-[9px] font-bold px-1.5 py-0.5 leading-none">-{discount}%</span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes={img.sizes}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            loading="lazy"
            decoding="async"
            onError={(e) => { const el = e.currentTarget as HTMLImageElement; el.style.display="none"; const ph=el.nextElementSibling as HTMLElement|null; if(ph) ph.style.display="flex"; }}
          />
          <div className="hidden w-full h-full items-center justify-center bg-gradient-to-br from-[#0F1430] to-[#161D4A] text-white/30 text-[10px] text-center p-2">{product.name}</div>
        </div>
        <div className="px-2.5 pt-2 pb-2.5 flex-1 flex flex-col">
          <p className="text-[9px] tracking-[0.07em] text-[#00E5FF]/70 font-semibold uppercase truncate">{product.categorySlug.replace("-", " ")}</p>
          <h3 className="mt-1 font-semibold text-[11.5px] leading-[1.3] text-white line-clamp-2 min-h-[30px] tracking-[-0.01em]">{product.name}</h3>
          <div className="mt-1.5 flex items-baseline gap-1 flex-wrap">
            <span className="font-bold text-[13px] text-white tracking-[-0.02em] leading-none">{formatRupiah(product.price)}</span>
            {product.comparePrice && <span className="text-[10px] text-white/30 line-through leading-none">{formatRupiah(product.comparePrice)}</span>}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-1">
            <span className="text-[10px] text-white/35 font-medium">{product.soldCount ? `${product.soldCount} terjual` : "Terjual"}</span>
            <span className="text-[10px] font-semibold text-[#00E5FF]/70 group-hover:text-[#00E5FF]">Lihat detail →</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div
      className="group relative ax-glass-card rounded-[16px] sm:rounded-[22px] overflow-hidden ax-glass-cyan ax-liquid transition-all duration-300 hover:-translate-y-1 flex flex-col"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      {product.badge && (
        <span className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 rounded-full bg-[#FFB800] text-[#080C1E] text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 shadow leading-none">{product.badge}</span>
      )}
      {discount > 0 && (
        <span className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 rounded-full bg-[#00E5FF] text-[#080C1E] text-[10px] sm:text-[11px] font-bold px-1.5 sm:px-2 py-0.5 sm:py-1 leading-none">-{discount}%</span>
      )}
      <Link href={`/produk/${product.slug}`} className="block flex-1">
        <div className="aspect-[4/3] overflow-hidden bg-white/[0.04] m-1 sm:m-1.5 rounded-[12px] sm:rounded-[16px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes={img.sizes}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.display = "none";
              const ph = el.nextElementSibling as HTMLElement | null;
              if (ph) ph.style.display = "flex";
            }}
          />
          <div className="hidden w-full h-full items-center justify-center bg-gradient-to-br from-[#0F1430] to-[#161D4A] text-white/30 text-xs text-center p-4">
            {product.name}
          </div>
        </div>
        <div className="px-2.5 sm:px-4 pt-2.5 sm:pt-3 pb-1 sm:pb-2">
          <p className="text-[10px] sm:text-[11px] tracking-[0.08em] text-[#00E5FF]/80 font-semibold uppercase truncate">{product.categorySlug.replace("-", " ")}</p>
          <h3 className="mt-1 font-semibold text-[12.5px] sm:text-[14.5px] leading-[1.25] sm:leading-5 text-white line-clamp-2 min-h-[32px] sm:min-h-[40px] tracking-[-0.01em]">{product.name}</h3>
          <p className="mt-1 text-[11px] sm:text-[12.5px] leading-[1.35] sm:leading-4 text-white/50 line-clamp-2 min-h-[30px] sm:min-h-[32px]">{product.description}</p>
          <div className="mt-2 sm:mt-3 flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
            <span className="font-bold text-[14px] sm:text-[17px] text-white tracking-[-0.02em] leading-none">{formatRupiah(product.price)}</span>
            {product.comparePrice && <span className="text-[10px] sm:text-xs text-white/35 line-through leading-none">{formatRupiah(product.comparePrice)}</span>}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/35 font-medium tracking-wide">{product.soldCount ? `${product.soldCount} terjual` : "Terjual"}</span>
            <span className="text-[11px] font-semibold text-[#00E5FF]/80 group-hover:text-[#00E5FF] transition">Lihat detail →</span>
          </div>
        </div>
      </Link>
      <div className="px-2 sm:px-3 pb-2.5 sm:pb-3 pt-1 grid grid-cols-2 gap-1.5 sm:gap-2">
        <button
          onClick={handleAdd}
          className="h-8 sm:h-9 rounded-[10px] sm:rounded-xl bg-white/[0.08] border border-white/10 text-[11px] sm:text-[13px] font-semibold text-white flex items-center justify-center gap-1 sm:gap-1.5 hover:bg-white/12 transition leading-none"
        >
          <IosIcon name="shopping-bag" size={12} tint="white" /> <span className="hidden sm:inline">Keranjang</span><span className="sm:hidden">Keranjang</span>
        </button>
        <button
          onClick={handleCheckout}
          className="h-8 sm:h-9 rounded-[10px] sm:rounded-xl bg-[#00E5FF] text-[#080C1E] text-[11px] sm:text-[13px] font-bold flex items-center justify-center gap-1 sm:gap-1.5 hover:bg-[#00D0E8] shadow-[0_4px_16px_rgba(0,229,255,0.28)] transition leading-none"
        >
          <IosIcon name="lightning-bolt" size={12} tint="black" /> Checkout
        </button>
      </div>
    </div>
  );
}
