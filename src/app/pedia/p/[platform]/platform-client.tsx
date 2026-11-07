"use client";
import { isPaymentMaintenanceEnabled } from "@/lib/payment-maintenance";
import { ManualOrderPanel } from "@/components/shared/PaymentMaintenanceNotice";

import { useEffect, useRef, useState } from "react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { IosIcon } from "@/components/ui/IosIcon";
import { OrderClient, type PediaOrderDraft } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { pediaPlatform } from "@/lib/pedia/platforms";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { pediaCopy } from "@/lib/pedia/copy";

export function PlatformPageClient({ platform, name, products, initialSlug = "", initialTarget = "", ordersEnabled = false }: {
  platform: string; name: string; products: PediaCatalogProduct[]; initialSlug?: string; initialTarget?: string; ordersEnabled?: boolean;
}) {
  const [slug, setSlug] = useState(initialSlug || products[0]?.slug || "");
  const [locked, setLocked] = useState(false);
  const drafts = useRef(new Map<string, PediaOrderDraft>());
  const firstSlug = useRef(initialSlug || products[0]?.slug || "");
  const previousSlug = useRef(slug);
  const container = useRef<HTMLDivElement>(null);
  const product = products.find((p) => p.slug === slug);
  const color = pediaPlatform(platform)?.color ?? "#00E5FF";
  const t = pediaCopy(useDisplayLocale());
  useEffect(() => {
    if (previousSlug.current !== slug) {
      container.current?.querySelector<HTMLButtonElement>('.pedia-needs [aria-pressed="true"]')?.focus({ preventScroll: true });
      previousSlug.current = slug;
    }
  }, [slug]);

  return <div ref={container} className="mx-auto max-w-[1280px] px-4 pb-8 pt-3 sm:px-6 sm:pt-5 lg:px-8">
    <a href="/pedia#pedia-catalog" className="hidden min-h-11 items-center gap-2 text-sm text-white/55 transition hover:text-white sm:inline-flex">
      <span aria-hidden="true"><IosIcon name="chevron-left" size={14} tint="white" /></span> {t.platformBack}
    </a>
    <header className="ax-glass-card ax-liquid relative flex flex-wrap items-center gap-x-3 gap-y-3 overflow-hidden rounded-[20px] p-2.5 sm:mt-2 sm:gap-x-4 sm:px-5 sm:py-3" style={{ background: `linear-gradient(115deg, ${color}26, #0F143080 70%)` }}>
      <a href="/pedia#pedia-catalog" aria-label={t.platformBack} className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center sm:hidden"><span aria-hidden="true"><IosIcon name="chevron-left" size={16} tint="white" /></span></a>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] sm:h-12 sm:w-12">
        <PlatformIcon id={platform} size={24} className="sm:!h-7 sm:!w-7" />
      </span>
      <div className="min-w-0 flex-1"><h1 className="font-display text-lg font-semibold tracking-tight text-white sm:text-[22px]">{name}</h1></div>
    </header>
    {products.length ? <>
      {product && (isPaymentMaintenanceEnabled() ? <ManualOrderPanel /> : <OrderClient key={product.slug} product={product} initialTarget={product.slug === firstSlug.current ? initialTarget : ""} initialDraft={drafts.current.get(product.slug)} ordersEnabled={ordersEnabled} withinPlatform onLockedChange={setLocked} products={products} onProductChange={(next, draft) => {
        if (locked || next === slug || !products.some((p) => p.slug === next)) return;
        drafts.current.set(slug, draft);
        setSlug(next);
      }} />)}
    </> : <p className="my-8 rounded-2xl border border-white/10 p-5 text-sm text-white/60">{t.platformEmpty} <a href="/pedia" className="text-[#00E5FF]">{t.platformOther}</a></p>}
  </div>;
}
