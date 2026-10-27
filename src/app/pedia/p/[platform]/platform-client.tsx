"use client";
import { isPaymentMaintenanceEnabled } from "@/lib/payment-maintenance";
import { ManualOrderPanel } from "@/components/shared/PaymentMaintenanceNotice";

import { useEffect, useRef, useState } from "react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { IosIcon } from "@/components/ui/IosIcon";
import { OrderClient, type PediaOrderDraft } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { pediaPlatform } from "@/lib/pedia/platforms";

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
  useEffect(() => {
    if (previousSlug.current !== slug) {
      container.current?.querySelector<HTMLButtonElement>('.pedia-needs [aria-pressed="true"]')?.focus({ preventScroll: true });
      previousSlug.current = slug;
    }
  }, [slug]);

  return <div ref={container} className="mx-auto max-w-[1280px] px-4 pb-8 pt-5 sm:px-6 lg:px-8">
    <a href="/pedia#pedia-catalog" className="inline-flex min-h-11 items-center gap-2 text-sm text-white/55 transition hover:text-white">
      <span aria-hidden="true"><IosIcon name="chevron-left" size={14} tint="white" /></span> Pilih platform
    </a>
    <header className="mt-3 flex items-center gap-4 rounded-[24px] border border-white/10 p-5 sm:gap-5 sm:p-7" style={{ background: `linear-gradient(115deg, ${color}20, #0F143080 75%)` }}>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.04] sm:h-20 sm:w-20">
        <PlatformIcon id={platform} size={36} className="sm:!h-11 sm:!w-11" />
      </span>
      <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/65 sm:text-xs">AXVARA Pedia</p><h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">{name}</h1><p className="mt-2 text-xs leading-5 text-white/60 sm:text-sm">Pilih kebutuhanmu. Atur jumlah dan tujuan dalam satu tempat.</p></div>
    </header>
    {products.length ? <>
      {product && (isPaymentMaintenanceEnabled() ? <ManualOrderPanel /> : <OrderClient key={product.slug} product={product} initialTarget={product.slug === firstSlug.current ? initialTarget : ""} initialDraft={drafts.current.get(product.slug)} ordersEnabled={ordersEnabled} withinPlatform onLockedChange={setLocked} products={products} onProductChange={(next, draft) => {
        if (locked || next === slug || !products.some((p) => p.slug === next)) return;
        drafts.current.set(slug, draft);
        setSlug(next);
      }} />)}
    </> : <p className="my-8 rounded-2xl border border-white/10 p-5 text-sm text-white/60">Belum ada layanan tersedia untuk platform ini. <a href="/pedia" className="text-[#00E5FF]">Lihat platform lain</a></p>}
  </div>;
}
