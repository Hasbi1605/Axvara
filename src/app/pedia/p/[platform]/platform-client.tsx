"use client";
import { isPaymentMaintenanceEnabled } from "@/lib/payment-maintenance";
import { ManualOrderPanel } from "@/components/shared/PaymentMaintenanceNotice";

import { useState } from "react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { IosIcon } from "@/components/ui/IosIcon";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PEDIA_METRIC_LABEL, pediaPlatform } from "@/lib/pedia/platforms";

export function PlatformPageClient({ platform, name, products, initialSlug = "", initialTarget = "", ordersEnabled = false }: {
  platform: string; name: string; products: PediaCatalogProduct[]; initialSlug?: string; initialTarget?: string; ordersEnabled?: boolean;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [locked, setLocked] = useState(false);
  const product = products.find((p) => p.slug === slug);
  const color = pediaPlatform(platform)?.color ?? "#00E5FF";
  const label = (p: PediaCatalogProduct) => p.name.replace(new RegExp(`\\s*${name}\\s*`, "ig"), " ").trim() || PEDIA_METRIC_LABEL[p.metric] || p.name;

  return <div className="mx-auto max-w-[1280px] px-4 pb-8 pt-5 sm:px-6 lg:px-8">
    <a href="/pedia#pedia-catalog" className="inline-flex min-h-11 items-center gap-2 text-sm text-white/55 transition hover:text-white">
      <span aria-hidden="true"><IosIcon name="chevron-left" size={14} tint="white" /></span> Pilih platform
    </a>
    <header className="mt-3 flex items-center gap-4 rounded-[24px] border border-white/10 p-5 sm:gap-5 sm:p-7" style={{ background: `linear-gradient(115deg, ${color}20, #0F143080 75%)` }}>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.04] sm:h-20 sm:w-20">
        <PlatformIcon id={platform} size={36} className="sm:!h-11 sm:!w-11" />
      </span>
      <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45 sm:text-xs">AXVARA Pedia</p><h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">{name}</h1><p className="mt-2 text-xs leading-5 text-white/60 sm:text-sm">Pilih kebutuhanmu. Atur jumlah dan tujuan dalam satu tempat.</p></div>
    </header>
    {products.length ? <>
      {product ? <nav className="mt-6 flex gap-2 overflow-x-auto pb-2" aria-label={`Jenis layanan ${name}`}>
        {products.map((p) => <button key={p.slug} type="button" aria-pressed={slug === p.slug} disabled={locked} onClick={() => setSlug(p.slug)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition disabled:opacity-40 ${slug === p.slug ? "border-[#00E5FF]/40 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 bg-white/[0.025] text-white/60 hover:border-white/25 hover:text-white"}`}>{label(p)}</button>)}
      </nav> : <section className="pb-4 pt-8 sm:pt-10" aria-labelledby="pedia-needs-heading">
        <h2 id="pedia-needs-heading" className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">Apa yang ingin ditingkatkan?</h2>
        <p className="mt-2 text-sm leading-6 text-white/55">Mulai dari jenis layanan yang kamu butuhkan, lalu pilih layanan yang sesuai.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Jenis layanan ${name}`}>
          {products.map((p) => <button key={p.slug} type="button" aria-pressed={false} onClick={() => setSlug(p.slug)} className="group ax-glass-card flex min-h-28 min-w-0 items-center gap-4 rounded-[20px] p-5 text-left transition hover:border-[#00E5FF]/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10" style={{ background: `${color}18` }}><IosIcon name={p.metric === "traffic" ? "globe" : p.metric === "views" || p.metric === "plays" ? "lightning-bolt" : p.metric === "followers" || p.metric === "members" || p.metric === "subscribers" ? "chat" : "star"} size={20} tint="white" /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-semibold leading-6 text-white">{label(p)}</span><span className="mt-1 block text-xs text-white/50">{p.tiers.length} pilihan layanan</span></span>
            <span className="text-white/35 transition group-hover:text-[#00E5FF]" aria-hidden="true">↗</span>
          </button>)}
        </div>
      </section>}
      {product && (isPaymentMaintenanceEnabled() ? <ManualOrderPanel /> : <OrderClient key={product.slug} product={product} initialTarget={initialTarget} ordersEnabled={ordersEnabled} withinPlatform onLockedChange={setLocked} />)}
    </> : <p className="my-8 rounded-2xl border border-white/10 p-5 text-sm text-white/60">Belum ada layanan tersedia untuk platform ini. <a href="/pedia" className="text-[#00E5FF]">Lihat platform lain</a></p>}
  </div>;
}
