"use client";
import { aggregatedVariantQty, cartActiveTier, cartBulkHint, estimatedUnitPrice, useCart } from "@/stores/cart";
import { bulkCopy } from "@/lib/bulk-display";
import { Price, PriceNote } from "@/components/storefront/Price";
import { useDisplayPrices } from "@/hooks/useDisplayPrices";
import { catalogCopy } from "@/lib/i18n/catalog-copy";
import { translateVariantLabel } from "@/lib/i18n/variant-copy";
import { productDisplayName } from "@/lib/i18n/product-name";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef } from "react";
import { useModalA11y } from "@/hooks/useModalA11y";
// TRY: iOS glyph — rollback: cp /tmp/CartDrawer.lucide.bak src/components/storefront/CartDrawer.tsx

export function CartDrawer() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const { items, drawerOpen, setDrawer, setQty, remove, subtotal, lineCount } = useCart();
  const total = subtotal();
  // Satu pemilik harga untuk drawer: subtotal, total baris, satuan efektif,
  // harga dasar coret dan petunjuk tier — masing-masing masukan IDR sendiri
  // (tidak pernah USD satuan x qty).
  const amounts = !drawerOpen ? [] : [total, ...items.flatMap((it) => {
    const unit = estimatedUnitPrice(items, it);
    const hint = cartBulkHint(items, it);
    return [unit, unit * it.qty, it.price, ...(hint ? [hint.unitPrice] : [])];
  })];
  const prices = useDisplayPrices(amounts, { debounce: true });
  const t = catalogCopy(prices.locale);
  const copy = bulkCopy(prices.locale);
  // Estimasi tampilan dari tier per varian yang tersimpan di baris; total final
  // dikonfirmasi quote server di checkout.
  const anyTier = items.some((it) => estimatedUnitPrice(items, it) < it.price);
  // Judul = jumlah BARIS varian, bukan sum qty (pola marketplace).
  const totalLines = lineCount();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Identitas stabil: hook memakai onClose sebagai dependency effect, closure
  // inline akan memasang/melepas listener tiap render.
  const closeDrawer = useCallback(() => setDrawer(false), [setDrawer]);

  useModalA11y({
    active: drawerOpen && !isAdmin,
    containerRef: panelRef,
    onClose: closeDrawer,
    initialFocusRef: closeRef,
  });

  if (isAdmin) return null;
  if (!drawerOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={t.cartDialogAria}>
      <div aria-hidden="true" className="absolute inset-0 bg-[#080C1E]/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-[420px] h-full ax-glass-strong flex flex-col rounded-l-[24px] sm:rounded-l-[28px] overflow-hidden motion-safe:animate-[slideInRight_0.26s_var(--ease-apple)]">
        <div className="h-[64px] flex items-center justify-between px-5 border-b border-white/10 shrink-0">
          <h2 className="font-display font-bold text-white">{t.cartTitle(totalLines)}</h2>
          <button ref={closeRef} onClick={() => setDrawer(false)} className="relative w-8 h-8 shrink-0 before:absolute before:-inset-1.5 before:content-[''] rounded-full ax-glass flex items-center justify-center text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" aria-label={t.closeCart}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/close-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl ax-glass flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/shopping-bag-32.png" alt="" width={28} height={28} className="w-7 h-7 object-contain brightness-0 invert opacity-30" draggable={false} />
              </div>
              <p className="mt-4 text-sm text-white/60">{t.cartEmpty}</p>
              <button onClick={() => setDrawer(false)} className="mt-3 text-sm text-[#00E5FF] font-medium">{t.browse}</button>
            </div>
          ) : (
            items.map((it) => {
              const itemKey = it.variantId ? `${it.id}:${it.variantId}` : it.id;
              const unit = estimatedUnitPrice(items, it);
              const tierApplied = unit < it.price;
              const tier = tierApplied ? cartActiveTier(items, it) : null;
              const hint = cartBulkHint(items, it);
              const groupQty = aggregatedVariantQty(items, it);
              return (
                <div key={itemKey} className="ax-glass rounded-2xl p-3 flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image} alt={productDisplayName(it, prices.locale)} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    {it.slug ? (
                      <Link
                        prefetch={false}
                        href={`/produk/${it.slug}`}
                        onClick={() => setDrawer(false)}
                        className="block text-sm font-medium text-white leading-4 line-clamp-2 hover:text-[#00E5FF] transition"
                      >
                        {productDisplayName(it, prices.locale)}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-white leading-4 line-clamp-2">{productDisplayName(it, prices.locale)}</p>
                    )}
                    {translateVariantLabel(it.variantLabel, prices.locale) && (
                      <p className="text-[11px] text-[#00E5FF]/80 font-medium mt-0.5">
                        {translateVariantLabel(it.variantLabel, prices.locale)}
                      </p>
                    )}
                    <p className="text-xs text-[#00E5FF] font-semibold mt-1">
                      <Price idr={unit} prices={prices} />
                      {tierApplied && (
                        <>
                          {" "}<span className="text-[11px] font-normal text-white/35 line-through"><Price idr={it.price} prices={prices} /></span>
                          {tier && <span className="ml-1 text-[11px] font-normal text-white/50">{t.bulkTag(tier.min_qty)}</span>}
                        </>
                      )}
                    </p>
                    {((it.minQty ?? 1) > 1 || tierApplied) && (
                      <p className="mt-0.5 text-[11px] font-semibold text-[#FFD66B]">
                        {(it.minQty ?? 1) > 1 ? `${t.minShort(it.minQty ?? 1)} · ` : ""}<Price idr={unit * it.qty} prices={prices} />
                      </p>
                    )}
                    {tierApplied && groupQty > it.qty && (
                      <p className="mt-0.5 text-[11px] text-white/45">{copy.aggregated(groupQty)}</p>
                    )}
                    {hint && (
                      <p className="mt-0.5 text-[11px] text-white/55">{copy.nextCart(hint.need, prices.text(hint.unitPrice))}</p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => setQty(it.id, it.qty - 1, it.variantId)} className="relative w-8 h-8 shrink-0 before:absolute before:-inset-1.5 before:content-[''] rounded-full ax-glass flex items-center justify-center text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" aria-label={t.decAria(productDisplayName(it, prices.locale), translateVariantLabel(it.variantLabel, prices.locale))}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/icons/ios11/minus-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-70" draggable={false} />
                      </button>
                      <span className="text-sm font-semibold text-white min-w-7 text-center">{it.qty}</span>
                      <button onClick={() => setQty(it.id, it.qty + 1, it.variantId)} className="relative w-8 h-8 shrink-0 before:absolute before:-inset-1.5 before:content-[''] rounded-full ax-glass flex items-center justify-center text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" aria-label={t.incAria(productDisplayName(it, prices.locale), translateVariantLabel(it.variantLabel, prices.locale))}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/icons/ios11/plus-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-70" draggable={false} />
                      </button>
                      <button onClick={() => remove(it.id, it.variantId)} className="ml-auto relative w-8 h-8 shrink-0 before:absolute before:-inset-1.5 before:content-[''] rounded-full flex items-center justify-center text-white/65 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" aria-label={t.removeAria(productDisplayName(it, prices.locale), translateVariantLabel(it.variantLabel, prices.locale))}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/icons/ios11/trash-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-60" draggable={false} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {items.length > 0 && (
          <div className="p-4 border-t border-white/10 ax-glass-strong">
            <div className="flex justify-between text-sm text-white/60">
              <span>{t.subtotal}</span>
              <Price idr={total} prices={prices} className="font-display font-bold text-white text-base" />
            </div>
            <PriceNote prices={prices} className="mt-1 text-[11px] text-white/45" />
            {anyTier && <p className="mt-1 text-[11px] text-white/45">{copy.cartFootnote}</p>}
            <Link prefetch={false}
              href="/checkout"
              onClick={() => setDrawer(false)}
              className="mt-3 w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold flex items-center justify-center gap-2 hover:bg-[#00D0E8] transition"
            >
              {t.checkoutTotal(prices.text(total))}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
