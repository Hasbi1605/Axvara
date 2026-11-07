"use client";

import { PediaOrbit } from "@/components/pedia/PediaOrbit";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { Typewriter } from "@/components/pedia/Typewriter";
import { PlatformCatalog } from "@/components/pedia/PlatformCatalog";
import { ScrollRope } from "@/components/storefront/ScrollRope";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { pediaCopy } from "@/lib/pedia/copy";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export function PediaHomeClient({ products }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  return <>
    <ScrollRope />
    <section className="relative overflow-hidden mx-auto max-w-[1280px] px-4 pb-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,229,255,0.08),transparent_65%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-display text-[clamp(32px,9.3vw,40px)] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[clamp(48px,4.85vw,62px)]"><span className="block">{t.heroLine1}</span><span className="block">{t.heroLine2}</span><Typewriter locale={locale} /></h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-white/60">{t.heroBody}</p>
          <div className="mt-6 flex flex-wrap gap-3"><a href="#pedia-catalog" className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#080C1E]">{t.browse}</a><PediaWhatsAppLink className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-6 text-sm font-medium text-white/85">{t.contactAdmin}</PediaWhatsAppLink></div>
          <p className="mt-5 text-xs leading-5 text-white/45">{t.heroTrust}</p>
        </div>
        <div className="flex min-w-0 justify-center lg:justify-end shrink-0 mt-6 lg:mt-0"><PediaOrbit /></div>
      </div>
    </section>
    <div className="mx-auto -mt-1 mb-2 max-w-[1280px] px-4 sm:px-6 lg:px-8"><PediaServiceCards /></div>
    <PlatformCatalog products={products} />
  </>;
}
