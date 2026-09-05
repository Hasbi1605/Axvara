"use client";

import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import type { Product } from "@/lib/products";
import { useCart } from "@/stores/cart";
import { useRouter } from "next/navigation";

export type VariantOption = {
  id: number;
  product_id: number;
  sku: string;
  label: string;
  price: number;
  compare_price: number | null;
  stock: number;
  duration_label?: string | null;
  warranty_label?: string | null;
  is_active: number;
};

type Props = {
  product: Product;
  mode: "cart" | "checkout";
  onClose: () => void;
};

export function QuickVariantModal({ product, mode, onClose }: Props) {
  const router = useRouter();
  const add = useCart((s) => s.add);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/catalog?slug=${encodeURIComponent(product.slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Gagal mengambil varian produk.");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = ((data.product?.variants || []) as VariantOption[]).filter(
          (v) => (v.is_active ?? 1) !== 0
        );
        setVariants(list);
        if (list.length > 0) {
          const firstInStock = list.find((v) => v.stock !== 0) || list[0];
          setSelectedId(firstInStock.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat varian.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [product.slug]);

  const selected = variants.find((v) => v.id === selectedId) || null;
  const currentPrice = selected ? selected.price : (product.minPrice ?? product.price);
  const currentCompare = selected ? selected.compare_price : product.comparePrice;
  const isOutOfStock = selected ? selected.stock === 0 : false;

  const handleConfirm = () => {
    if (!selected || isOutOfStock) return;
    if (mode === "cart") {
      add({
        ...product,
        price: selected.price,
        comparePrice: selected.compare_price ?? undefined,
        stock: selected.stock,
        variantId: selected.id,
        variantLabel: selected.label,
      });
      onClose();
    } else {
      router.push(`/checkout?buy=${encodeURIComponent(product.slug)}&variant=${selected.id}`);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-t-[24px] sm:rounded-[24px] ax-glass-strong border border-white/10 p-5 sm:p-6 shadow-2xl animate-[fadeInUp_0.25s_var(--ease-apple)] text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image || "/brand/axvara-ribbon-mark.png"}
              alt={product.name}
              className="h-14 w-14 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0"
            />
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm line-clamp-1 leading-snug">
                {product.name}
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display font-bold text-[#00E5FF] text-base">
                  {formatRupiah(currentPrice)}
                </span>
                {currentCompare && currentCompare > currentPrice && (
                  <span className="text-xs text-white/30 line-through">
                    {formatRupiah(currentCompare)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white"
          >
            <IosIcon name="close" size={14} tint="white" />
          </button>
        </div>

        <div className="py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">
            Pilih Paket / Varian
          </p>

          {loading ? (
            <div className="py-8 text-center text-xs text-white/40 animate-pulse">
              Memuat pilihan paket...
            </div>
          ) : error ? (
            <div className="py-4 text-center text-xs text-red-300 bg-red-500/10 rounded-xl border border-red-500/20">
              {error}
            </div>
          ) : variants.length === 0 ? (
            <div className="py-4 text-center text-xs text-white/40">
              Tidak ada varian tersedia.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
              {variants.map((v) => {
                const active = v.id === selectedId;
                const outStock = v.stock === 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={outStock}
                    onClick={() => setSelectedId(v.id)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition relative ${
                      outStock
                        ? "opacity-35 bg-white/[0.02] border-white/5 cursor-not-allowed"
                        : active
                        ? "border-[#00E5FF] bg-[#00E5FF]/10 text-white shadow-[0_0_15px_rgba(0,229,255,0.15)]"
                        : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-bold leading-tight truncate w-full">
                      {v.label}
                    </span>
                    <span className="mt-1 text-xs font-semibold text-[#00E5FF]">
                      {formatRupiah(v.price)}
                    </span>
                    {outStock && (
                      <span className="mt-1 text-[10px] text-red-400 font-semibold">
                        Habis
                      </span>
                    )}
                    {active && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            type="button"
            disabled={!selected || isOutOfStock || loading}
            onClick={handleConfirm}
            className={`w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] ${
              mode === "checkout"
                ? "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_4px_16px_rgba(0,229,255,0.3)]"
                : "bg-white text-[#080C1E] hover:bg-white/90"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {mode === "checkout" ? (
              <>
                <IosIcon name="lightning-bolt" size={14} tint="black" /> Beli Sekarang · {formatRupiah(currentPrice)}
              </>
            ) : (
              <>
                <IosIcon name="shopping-bag" size={14} tint="black" /> Tambah ke Keranjang · {formatRupiah(currentPrice)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
