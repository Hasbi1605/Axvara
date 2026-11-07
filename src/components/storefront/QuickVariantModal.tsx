"use client";

import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Price, PriceNote } from "@/components/storefront/Price";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { productDisplayName } from "@/lib/i18n/product-name";
import { catalogCopy, catalogDeliveryBadge, catalogWarranty } from "@/lib/i18n/catalog-copy";
import type { VariantSummary } from "@/lib/catalog";
import { formatVariantLabel, buyerDeliveryKind, effectiveVariantStock } from "@/lib/catalog";
import { IosIcon } from "@/components/ui/IosIcon";
import type { Product } from "@/lib/products";
import { useCart } from "@/stores/cart";
import { useModalA11y } from "@/hooks/useModalA11y";
import { usePendingNavigation } from "@/hooks/usePendingNavigation";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { Bone, InlineSpinner } from "@/components/storefront/Skeletons";
import { BulkPriceTiers } from "@/components/storefront/BulkPriceTiers";
import { bulkCopy, bulkUnitEstimate, usableBulkTiers, type BulkVariantFields } from "@/lib/bulk-display";

export type VariantOption = VariantSummary & BulkVariantFields;

/** Di atas angka ini kartu varian menjadi baris ringkas satu kolom. */
export const COMPACT_VARIANTS_AFTER = 6;
/** Di atas angka ini panel menampilkan kotak cari varian. */
export const SEARCH_VARIANTS_AFTER = 10;

type Props = {
  product: Product;
  /**
   * `select` (PDP mobile, 2026-09-25): mengetuk varian langsung memilihnya
   * untuk halaman lalu menutup panel, tanpa stepper dan tanpa ke checkout.
   */
  mode: "cart" | "checkout" | "select";
  onClose: () => void;
  /** Varian yang sudah dimuat halaman (PDP): panel tidak fetch ulang. */
  variants?: VariantOption[];
  /** Varian yang sedang terpilih di halaman saat panel dibuka. */
  initialVariantId?: number | null;
  /** Dipanggil hanya saat pembeli MENGETUK varian, bukan pilihan otomatis. */
  onVariantChange?: (variantId: number) => void;
};

export function QuickVariantModal({ product, mode, onClose, variants: preloadedVariants, initialVariantId = null, onVariantChange }: Props) {
  const { navigate, pending: navigating } = usePendingNavigation();
  const add = useCart((s) => s.add);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadingStage = useLoadingStage(loading, [SLOW_MS]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  // Diambil sekali saat panel dibuka: array dari halaman dibuat ulang tiap
  // render, dan memakainya sebagai dependensi effect akan mereset pilihan.
  const [preloaded] = useState<VariantOption[] | null>(() =>
    preloadedVariants?.length ? preloadedVariants.filter((v) => (v.is_active ?? 1) !== 0) : null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape, focus trap, scroll lock, dan restore fokus — sebelumnya modal ini
  // tidak punya satu pun sehingga pengguna keyboard terjebak di latar.
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });

  useEffect(() => {
    let cancelled = false;
    // Pilihan awal: varian halaman bila masih bisa dibeli; mode select tidak
    // memilih otomatis (pembeli yang menentukan); mode lain memilih varian
    // pertama yang bisa dibeli agar tombol aksi langsung bisa dipakai.
    //
    // Stok EFEKTIF (revisi sore 2026-10-02): unique memakai min(kolom,
    // inventory) — varian stock=1/available=0 di mobile = habis, bukan
    // "Sisa 1". Inilah jalur yang dilihat di HP (bottom-sheet), sedangkan
    // desktop memakai picker inline PDP yang sudah efektif duluan.
    const minOf = (v: VariantOption): number => Math.max(1, Number(v.min_qty ?? 1) || 1);
    const effOf = (v: VariantOption): number => effectiveVariantStock(v);
    const purchasable = (v: VariantOption): boolean => { const eff = effOf(v); return eff !== 0 && (eff === -1 || eff >= minOf(v)); };
    const rawBuyable = (v: VariantOption): boolean => v.stock !== 0 && (v.stock === -1 || v.stock >= minOf(v));
    const initialFor = (list: VariantOption[]): number | null => {
      const fromPage = list.find((v) => v.id === initialVariantId && purchasable(v));
      if (fromPage) return fromPage.id;
      if (mode === "select" || list.length === 0) return null;
      return (list.find(purchasable) || list.find((v) => rawBuyable(v)) || list[0]).id;
    };
    if (preloaded && attempt === 0) {
      setVariants(preloaded);
      setSelectedId(initialFor(preloaded));
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchWithTimeout(`/api/catalog?slug=${encodeURIComponent(product.slug)}`, {}, 20_000)
      .then(async (res) => {
        if (!res.ok) throw new Error("fetch_failed");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = ((data.product?.variants || []) as VariantOption[]).filter(
          (v) => (v.is_active ?? 1) !== 0
        );
        setVariants(list);
        // Varian stok<min dilewati — memilihnya pasti gagal di quote.
        setSelectedId(initialFor(list));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "load_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // initialVariantId/mode hanya dibaca saat panel dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.slug, attempt, preloaded]);

  // Daftar panjang: tampilkan varian terpilih tanpa pembeli harus menggulir.
  useEffect(() => {
    if (loading || selectedId == null) return;
    document.getElementById(`quick-variant-${selectedId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [loading, selectedId]);

  const pick = (variantId: number) => {
    setSelectedId(variantId);
    onVariantChange?.(variantId);
    if (mode === "select") onClose();
  };
  const compact = variants.length > COMPACT_VARIANTS_AFTER;
  const searchable = variants.length > SEARCH_VARIANTS_AFTER;
  const needle = query.trim().toLowerCase();
  const displayLocale = useDisplayLocale();
  const displayName = productDisplayName(product, displayLocale);
  const visibleVariants = searchable && needle
    ? variants.filter((v) => `${formatVariantLabel(v)} ${formatVariantLabel(v, displayLocale)}`.toLowerCase().includes(needle))
    : variants;

  const selected = variants.find((v) => v.id === selectedId) || null;
  const currentPrice = selected ? selected.price : (product.minPrice ?? product.price);
  const currentCompare = selected ? selected.compare_price : product.comparePrice;
  // Varian yang stoknya di bawah minimum (stock < min, stock !== -1) TIDAK
  // BISA dibeli dalam jumlah berapa pun: qty berapa pun pasti gagal di quote
  // (insufficient_stock bila >= min, below_minimum bila < min). Perlakukan
  // sama dengan habis agar tidak jadi dead-end di checkout.
  //
  // Semua memakai stok EFEKTIF (unique = min kolom vs inventory) — paritas
  // PDP desktop (revisi sore 2026-10-02, laporan owner mobile "Sisa 1").
  const variantMinQtyOf = (v: VariantOption): number => Math.max(1, Number(v.min_qty ?? 1) || 1);
  const effOf = (v: VariantOption): number => effectiveVariantStock(v);
  const isBelowMinimum = (v: VariantOption): boolean => {
    const eff = effOf(v);
    return eff !== -1 && eff < variantMinQtyOf(v);
  };
  const isOutOfStock = selected ? effOf(selected) === 0 || isBelowMinimum(selected) : false;
  // Minimum pembelian varian terpilih (migrasi 0034): stepper dibuka di min.
  const selectedMinQty = selected ? Math.max(1, Number(selected.min_qty ?? 1) || 1) : 1;
  const selectedMaxQty = selected
    ? (() => { const eff = effOf(selected); const cap = selected.fulfillment_mode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : 100; return Math.max(selectedMinQty, eff === -1 ? cap : Math.min(cap, eff)); })()
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
  // Grosir: estimasi tampilan dari tier katalog; harga final dari quote server.
  const selectedTiers = selected ? usableBulkTiers(selected, selected.price) : [];
  const modalUnit = bulkUnitEstimate(currentPrice, selectedTiers, safeModalQty);
  const modalTotal = modalUnit * safeModalQty;
  const modalSavings = (currentPrice - modalUnit) * safeModalQty;
  // Satu pemilik harga untuk modal: harga varian, tier, satuan efektif, total
  // dan hemat — tiap nominal IDR diskon adalah masukan sendiri.
  const prices = useDisplayPrices([
    currentPrice,
    ...(currentCompare ? [currentCompare] : []),
    ...variants.flatMap((v) => [v.price, ...(v.compare_price ? [v.compare_price] : [])]),
    ...selectedTiers.map((tier) => tier.unit_price),
    modalUnit, modalTotal, currentPrice * safeModalQty,
    ...(modalSavings > 0 ? [modalSavings] : []),
  ], { debounce: true });
  const t = catalogCopy(prices.locale);
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
        // Stok EFEKTIF (bukan kolom mentah): keranjang ikut menolak unique
        // yang unitnya habis — guard cart.ts (max<=0 / below-min) jadi benar.
        stock: effOf(selected) === -1 ? -1 : effOf(selected),
        variantId: selected.id,
        variantLabel: selected.label,
        minQty: selectedMinQty,
        fulfillmentMode: selected.fulfillment_mode,
        bulkTiers: selectedTiers,
      }, safeModalQty);
      onClose();
    } else {
      // Modal tetap terbuka dengan spinner sampai checkout tampil (ikut
      // unmount bersama halaman). Dulu modal langsung tertutup dan pembeli
      // kembali melihat katalog diam seolah klik tidak jalan.
      navigate(`/checkout?buy=${encodeURIComponent(product.slug)}&variant=${selected.id}&qty=${safeModalQty}`);
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
        className="w-full max-w-[480px] sm:max-w-[620px] lg:max-w-[660px] rounded-t-[24px] sm:rounded-[24px] border border-white/10 p-5 sm:p-7 shadow-[0_24px_64px_rgba(0,0,0,0.6)] motion-safe:animate-[fadeInUp_0.25s_var(--ease-apple)] text-left"
        style={{ background: "#0B1025" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image || "/brand/axvara-ribbon-mark.png"}
              alt={displayName}
              className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0"
            />
            <div className="min-w-0">
              <h3 id="quick-variant-title" className="font-semibold text-white text-sm line-clamp-1 leading-snug">
                {displayName}
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <Price idr={currentPrice} prices={prices} className="font-display font-bold text-[#00E5FF] text-base" />
                {currentCompare && currentCompare > currentPrice && (
                  <>
                    <span className="text-xs text-white/30 line-through">
                      <Price idr={currentCompare} prices={prices} />
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
            aria-label={t.closeVariantPicker}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white"
          >
            <IosIcon name="close" size={14} tint="white" />
          </button>
        </div>

        <div className="py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">
            {t.pickPackage}
          </p>
          <PriceNote prices={prices} className="mb-2 text-[11px] text-white/45" />

          {loading ? (
            <div role="status" aria-label={t.packagesLoadingAria}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3" aria-hidden>
                {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-[76px] rounded-xl" />)}
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-xs text-white/45">
                <InlineSpinner className="w-3.5 h-3.5" />
                {loadingStage >= 1 ? t.packagesSlow : t.packagesLoading}
              </p>
            </div>
          ) : error ? (
            <div className="py-4 px-3 text-center text-xs text-red-300 bg-red-500/10 rounded-xl border border-red-500/20">
              <p>{error === "fetch_failed" ? t.variantsFetchFailed : error === "load_failed" ? t.variantsLoadFailed : error}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-2 h-8 rounded-full bg-white px-4 text-xs font-bold text-[#080C1E]">{t.retry}</button>
            </div>
          ) : variants.length === 0 ? (
            <div className="py-4 text-center text-xs text-white/40">
              {t.noVariantsAvailable}
            </div>
          ) : (
            <>
            {searchable && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchVariants(variants.length)}
                aria-label={t.searchVariantsAria}
                className="mb-3 h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white placeholder:text-white/35 focus:border-[#00E5FF]/50 focus:outline-none"
              />
            )}
            {visibleVariants.length === 0 ? (
              <p className="py-4 text-center text-xs text-white/45">{t.noVariantMatch(query.trim())}</p>
            ) : (
            <div
              role="radiogroup"
              aria-label={t.pickPackageAria}
              className={`grid grid-cols-1 overflow-y-auto pr-1 ${compact ? "gap-1.5" : "sm:grid-cols-2 gap-2 sm:gap-3"} ${
                mode === "select" ? "max-h-[min(60vh,460px)]" : "max-h-[260px] sm:max-h-[340px]"
              }`}
            >
              {visibleVariants.map((v) => {
                const active = v.id === selectedId;
                const eff = effOf(v);
                const outStock = eff === 0 || isBelowMinimum(v);
                const belowMin = !!(eff !== 0 && isBelowMinimum(v));
                const ariaLabel = t.variantAria(v.label, prices.text(v.price), outStock ? (belowMin ? "below" : "out") : "ok", Number(v.min_qty ?? 1));
                const instant = buyerDeliveryKind(v) === "instant";
                if (compact) {
                  // Baris ringkas satu kolom (>6 varian, mis. GSuite): tinggi
                  // tetap ≥44px, info inti saja agar daftar tidak memanjang.
                  return (
                    <button
                      key={v.id}
                      id={`quick-variant-${v.id}`}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={ariaLabel}
                      disabled={outStock}
                      onClick={() => pick(v.id)}
                      className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                        outStock
                          ? "opacity-35 bg-white/[0.02] border-white/5 cursor-not-allowed"
                          : active
                          ? "border-[#00E5FF] bg-[#00E5FF]/10 text-white"
                          : "border-white/10 bg-white/[0.04] text-white/75 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold">{formatVariantLabel(v, displayLocale)}</span>
                        <span className={`mt-0.5 block truncate text-[10px] font-semibold ${instant ? "text-emerald-300" : "text-[#FFD66B]"}`}>
                          {catalogDeliveryBadge(v, prices.locale)}
                          {v.warranty_type && v.warranty_type !== "none" && catalogWarranty(v, prices.locale) ? <span className="font-medium text-white/45"> · {catalogWarranty(v, prices.locale)}</span> : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <Price idr={v.price} prices={prices} className="block text-xs font-semibold text-[#00E5FF]" />
                        <span className={`block text-[10px] ${outStock ? "font-semibold text-red-400" : "text-white/40"}`}>
                          {outStock ? (belowMin ? t.stockBelowMin : t.outShort) : t.remaining(eff === -1 ? "∞" : eff)}
                        </span>
                      </span>
                    </button>
                  );
                }
                return (
                  <button
                    key={v.id}
                    id={`quick-variant-${v.id}`}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={ariaLabel}
                    disabled={outStock}
                    onClick={() => pick(v.id)}
                    className={`flex flex-col items-start p-3 sm:p-4 rounded-xl border text-left transition relative ${
                      outStock
                        ? "opacity-35 bg-white/[0.02] border-white/5 cursor-not-allowed"
                        : active
                        ? "border-[#00E5FF] bg-[#00E5FF]/10 text-white shadow-[0_0_15px_rgba(0,229,255,0.15)]"
                        : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-bold leading-tight truncate w-full">
                      {formatVariantLabel(v, displayLocale)}
                    </span>
                    <span className="mt-1.5 inline-flex">
                      {instant ? (
                        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">{t.autoDelivery}</span>
                      ) : (
                        <span className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[9px] font-bold text-[#FFD66B]">{catalogDeliveryBadge(v, prices.locale)}</span>
                      )}
                    </span>
                    <span className="mt-1 text-xs font-semibold text-[#00E5FF]">
                      <Price idr={v.price} prices={prices} />
                      {v.compare_price && v.compare_price > v.price && (
                        <>
                          {" "}
                          <span className="text-[10px] text-white/30 line-through font-normal"><Price idr={v.compare_price} prices={prices} /></span>
                          {" "}
                          <span className="text-[9px] font-bold text-[#FFB800]">-{Math.round((1 - v.price / v.compare_price) * 100)}%</span>
                        </>
                      )}
                    </span>
                    <div className="mt-0.5 flex items-center justify-between w-full text-[10.5px]">
                      {v.warranty_type && v.warranty_type !== "none" && catalogWarranty(v, prices.locale) ? (
                        <span className="text-white/50 font-medium truncate pr-1 inline-flex items-center gap-1">
                          <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                          {catalogWarranty(v, prices.locale)}
                        </span>
                      ) : <span />}
                      {outStock ? (
                        <span className="text-red-400 font-semibold shrink-0">{belowMin ? t.stockBelowMin : t.outShort}</span>
                      ) : (
                        <span className="text-white/40 shrink-0">
                          {usableBulkTiers(v, v.price)[0] && <>{bulkCopy(prices.locale).variantHint(usableBulkTiers(v, v.price)[0].min_qty)} · </>}{t.remaining(eff === -1 ? "∞" : eff)}
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
            {mode === "select" && (
              <p className="mt-3 text-center text-[11px] text-white/40">{t.selectHint}</p>
            )}
            </>
          )}
        </div>

        {/* Jumlah ala marketplace: stepper dibuka di minimum, floor = min.
            Satu-satunya tempat info "Min. N" di modal — tidak di tiap kartu
            varian agar tidak menumpuk. */}
        {mode !== "select" && selected && !isOutOfStock && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">{t.quantity}</p>
              {selectedMinQty > 1 && <p className="mt-0.5 text-[11px] font-semibold text-[#FFD66B]">{t.minPurchase(selectedMinQty)}</p>}
            </div>
            <div className="inline-flex shrink-0 items-center rounded-xl border border-white/10 bg-white/[0.04]">
              <button
                type="button"
                onClick={() => { commitModalQtyDraft(null); setModalQty((q) => Math.max(selectedMinQty, Math.min(selectedMaxQty, q) - 1)); }}
                disabled={safeModalQty <= selectedMinQty}
                aria-label={t.qtyDec}
                className="flex h-11 w-11 items-center justify-center rounded-l-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
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
                id="quick-modal-qty-input"
                aria-live={selectedTiers.length > 0 ? undefined : "polite"}
                aria-label={t.qtyAria(selectedMinQty)}
                className="w-12 bg-transparent text-center text-sm font-bold tabular-nums text-white outline-none"
              />
              <button
                type="button"
                onClick={() => { commitModalQtyDraft(null); setModalQty((q) => Math.min(selectedMaxQty, Math.max(selectedMinQty, q) + 1)); }}
                disabled={safeModalQty >= selectedMaxQty}
                aria-label={t.qtyInc}
                className="flex h-11 w-11 items-center justify-center rounded-r-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
          </div>
        )}
        {mode !== "select" && selected && !isOutOfStock && selectedTiers.length > 0 && (
          <div className="mt-2">
            <BulkPriceTiers
              mode="compact"
              basePrice={currentPrice}
              tiers={selectedTiers}
              minQty={selectedMinQty}
              qty={safeModalQty}
              maxQty={selectedMaxQty}
              stockMax={effOf(selected)}
              capMax={selected.fulfillment_mode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : 100}
              qtyInputId="quick-modal-qty-input"
              locale={prices.locale}
              format={prices.text}
              onSetQty={(n) => { commitModalQtyDraft(null); setModalQty(Math.min(Math.max(n, selectedMinQty), selectedMaxQty)); }}
            />
            {modalSavings > 0 && <p className="text-[11px] text-white/40">{bulkCopy(prices.locale).saved(prices.text(modalSavings))}</p>}
          </div>
        )}
        {mode !== "select" && selected && selectedMinQty > 1 && selectedTiers.length === 0 && !isOutOfStock && (
          <p className="mt-2 text-[11px] text-white/40">{t.totalForQty(prices.text(currentPrice * safeModalQty), safeModalQty, prices.text(currentPrice))}</p>
        )}

        {/* Badge pengiriman sudah ada di tiap kartu varian (2026-09-19,
            keputusan owner): kalimat "Made By Order — dikerjakan sesuai
            antrean…" dihapus dari modal — detail ekspektasi dijelask
            di blok checkout "Made By Order", bukan di tahap pilih varian. */}
        {mode !== "select" && (
        <div className="pt-2">
          <button
            type="button"
            disabled={!selected || isOutOfStock || loading || navigating}
            onClick={handleConfirm}
            className={`w-full h-11 sm:h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] ${
              mode === "checkout"
                ? "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_4px_16px_rgba(0,229,255,0.3)]"
                : "bg-white text-[#080C1E] hover:bg-white/90"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {navigating ? (
              <>
                <InlineSpinner tone="dark" /> {t.openingCheckout}
              </>
            ) : mode === "checkout" ? (
              <>
                <IosIcon name="lightning-bolt" size={14} tint="black" /> {t.buyTotal(prices.text(modalTotal))}
              </>
            ) : (
              <>
                <IosIcon name="shopping-bag" size={14} tint="black" /> {t.addToCartTotal(prices.text(modalTotal))}
              </>
            )}
          </button>
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}
