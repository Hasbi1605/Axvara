"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatRupiah } from "@/lib/utils";
import type { VariantSummary } from "@/lib/catalog";
import { formatWarranty } from "@/lib/catalog";
import { IosIcon } from "@/components/ui/IosIcon";
import type { Product } from "@/lib/products";
import { useCart } from "@/stores/cart";
import { useRouter } from "next/navigation";
import { useModalA11y } from "@/hooks/useModalA11y";

export type VariantOption = VariantSummary;

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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape, focus trap, scroll lock, dan restore fokus — sebelumnya modal ini
  // tidak punya satu pun sehingga pengguna keyboard terjebak di latar.
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });

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
  // Minimum pembelian varian terpilih (migrasi 0034): stepper dibuka di min.
  const selectedMinQty = selected ? Math.max(1, Number(selected.min_qty ?? 1) || 1) : 1;
  const selectedMaxQty = selected
    ? Math.max(selectedMinQty, selected.stock === -1 ? 100 : Math.max(selectedMinQty, Math.min(100, selected.stock)))
    : 100;
  const [modalQty, setModalQty] = useState(selectedMinQty);
  // Draft ketikan manual (pola marketplace): string terpisah agar mengetik
  // "5"→"50" tidak dipaksa jadi min di tiap keystroke; commit saat blur/Enter.
  const [modalQtyDraft, setModalQtyDraft] = useState<string | null>(null);
  // Reset qty + draft ke min tiap ganti varian (pola marketplace).
  useEffect(() => {
    setModalQty(selectedMinQty);
    setModalQtyDraft(null);
  }, [selectedId, selectedMinQty]);
  const safeModalQty = Math.min(Math.max(modalQty, selectedMinQty), selectedMaxQty);
  const commitModalQtyDraft = (raw: string | null) => {
    setModalQtyDraft(null);
    if (raw == null) return;
    const digits = raw.replace(/[^\d]/g, "");
    const n = Math.floor(Number(digits));
    if (!digits || !Number.isFinite(n)) return;
    setModalQty(Math.min(Math.max(n, selectedMinQty), selectedMaxQty));
  };

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
        minQty: selectedMinQty,
      }, safeModalQty);
      onClose();
    } else {
      router.push(`/checkout?buy=${encodeURIComponent(product.slug)}&variant=${selected.id}&qty=${safeModalQty}`);
      onClose();
    }
  };

  // Portal to body so `position:fixed` escapes any parent transform/overflow.
  // Panel SOLID (#0B1025) seperti modal admin (ConfirmDialog/ProductEditor),
  // bukan glass transparan — isi modal harus terbaca di atas backdrop blur.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-variant-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        // Mobile = bottom-sheet 480px (dikunci, sudah pas). Desktop (sm+) =
        // panel tengah yang dilebarkan (620→660px) + napas lebih lega agar
        // kartu varian 2 kolom tidak sempit dan scroll internal muncul belakangan.
        className="w-full max-w-[480px] sm:max-w-[620px] lg:max-w-[660px] rounded-t-[24px] sm:rounded-[24px] border border-white/10 p-5 sm:p-7 shadow-[0_24px_64px_rgba(0,0,0,0.6)] animate-[fadeInUp_0.25s_var(--ease-apple)] text-left"
        style={{ background: "#0B1025" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image || "/brand/axvara-ribbon-mark.png"}
              alt={product.name}
              className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0"
            />
            <div className="min-w-0">
              <h3 id="quick-variant-title" className="font-semibold text-white text-sm line-clamp-1 leading-snug">
                {product.name}
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display font-bold text-[#00E5FF] text-base">
                  {formatRupiah(currentPrice)}
                </span>
                {currentCompare && currentCompare > currentPrice && (
                  <>
                    <span className="text-xs text-white/30 line-through">
                      {formatRupiah(currentCompare)}
                    </span>
                    <span className="rounded-full bg-[#FFB800] text-[#080C1E] text-[10px] font-bold px-1.5 py-0.5 leading-none">
                      -{Math.round((1 - currentPrice / currentCompare) * 100)}%
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup pilihan varian"
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
            <div role="radiogroup" aria-label="Pilih paket atau varian" className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 max-h-[260px] sm:max-h-[340px] overflow-y-auto pr-1">
              {variants.map((v) => {
                const active = v.id === selectedId;
                const outStock = v.stock === 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${v.label} — ${formatRupiah(v.price)}${outStock ? " — stok habis" : ""}${Number(v.min_qty ?? 1) > 1 ? ` — minimal ${Number(v.min_qty)}` : ""}`}
                    disabled={outStock}
                    onClick={() => setSelectedId(v.id)}
                    className={`flex flex-col items-start p-3 sm:p-4 rounded-xl border text-left transition relative ${
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
                    <span className="mt-1.5 inline-flex">
                      {v.wr_delivery_class === "restock" ? (
                        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">Kirim otomatis</span>
                      ) : (
                        <span className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[9px] font-bold text-[#FFD66B]">Dikirim admin</span>
                      )}
                    </span>
                    <span className="mt-1 text-xs font-semibold text-[#00E5FF]">
                      {formatRupiah(v.price)}
                      {v.compare_price && v.compare_price > v.price && (
                        <>
                          {" "}
                          <span className="text-[10px] text-white/30 line-through font-normal">{formatRupiah(v.compare_price)}</span>
                          {" "}
                          <span className="text-[9px] font-bold text-[#FFB800]">-{Math.round((1 - v.price / v.compare_price) * 100)}%</span>
                        </>
                      )}
                    </span>
                    <div className="mt-0.5 flex items-center justify-between w-full text-[10.5px]">
                      {v.warranty_type && v.warranty_type !== "none" && formatWarranty(v) ? (
                        <span className="text-white/50 font-medium truncate pr-1 inline-flex items-center gap-1">
                          <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                          {formatWarranty(v)}
                        </span>
                      ) : <span />}
                      {outStock ? (
                        <span className="text-red-400 font-semibold shrink-0">Habis</span>
                      ) : (
                        <span className="text-white/40 shrink-0">
                          Sisa {v.stock === -1 ? "∞" : v.stock}
                        </span>
                      )}
                    </div>
                    {active && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Jumlah ala marketplace: stepper dibuka di minimum, floor = min.
            Satu-satunya tempat info "Min. N" di modal — tidak di tiap kartu
            varian agar tidak menumpuk. */}
        {selected && !isOutOfStock && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">Jumlah</p>
              {selectedMinQty > 1 ? (
                <p className="mt-0.5 text-[11px] font-semibold text-[#FFD66B]">Min. pembelian {selectedMinQty}</p>
              ) : (
                <p className="mt-0.5 text-[11px] text-white/40">Total {formatRupiah(currentPrice * modalQty)}</p>
              )}
            </div>
            <div className="inline-flex shrink-0 items-center rounded-xl border border-white/10 bg-white/[0.04]">
              <button
                type="button"
                onClick={() => { commitModalQtyDraft(null); setModalQty((q) => Math.max(selectedMinQty, Math.min(selectedMaxQty, q) - 1)); }}
                disabled={safeModalQty <= selectedMinQty}
                aria-label="Kurangi jumlah"
                className="flex h-9 w-9 items-center justify-center rounded-l-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14" /></svg>
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={modalQtyDraft ?? String(safeModalQty)}
                onChange={(e) => setModalQtyDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                onBlur={(e) => commitModalQtyDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                aria-live="polite"
                aria-label={`Jumlah pembelian, minimal ${selectedMinQty}`}
                className="w-12 bg-transparent text-center text-sm font-bold tabular-nums text-white outline-none"
              />
              <button
                type="button"
                onClick={() => { commitModalQtyDraft(null); setModalQty((q) => Math.min(selectedMaxQty, Math.max(selectedMinQty, q) + 1)); }}
                disabled={safeModalQty >= selectedMaxQty}
                aria-label="Tambah jumlah"
                className="flex h-9 w-9 items-center justify-center rounded-r-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
          </div>
        )}
        {selected && selectedMinQty > 1 && !isOutOfStock && (
          <p className="mt-2 text-[11px] text-white/40">Total {formatRupiah(currentPrice * safeModalQty)} untuk {safeModalQty} · harga satuan {formatRupiah(currentPrice)}</p>
        )}

        <div className="pt-2">
          <button
            type="button"
            disabled={!selected || isOutOfStock || loading}
            onClick={handleConfirm}
            className={`w-full h-11 sm:h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] ${
              mode === "checkout"
                ? "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_4px_16px_rgba(0,229,255,0.3)]"
                : "bg-white text-[#080C1E] hover:bg-white/90"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {mode === "checkout" ? (
              <>
                <IosIcon name="lightning-bolt" size={14} tint="black" /> Beli Sekarang · {formatRupiah(currentPrice * safeModalQty)}
              </>
            ) : (
              <>
                <IosIcon name="shopping-bag" size={14} tint="black" /> Tambah ke Keranjang · {formatRupiah(currentPrice * safeModalQty)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
