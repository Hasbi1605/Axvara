"use client";

import { PediaOrbit } from "@/components/pedia/PediaOrbit";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { Typewriter } from "@/components/pedia/Typewriter";
import { PlatformCatalog } from "@/components/pedia/PlatformCatalog";
import { ScrollRope } from "@/components/storefront/ScrollRope";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export function PediaHomeClient({ products }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  return <>
    <ScrollRope />
    <section className="relative mx-auto max-w-[1280px] px-4 pb-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,229,255,0.08),transparent_65%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-display text-[clamp(32px,9.3vw,40px)] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[clamp(48px,4.85vw,62px)]"><span className="block">Satu tempat untuk</span><span className="block">optimasi media sosial</span><Typewriter /></h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-white/60">Followers, likes, views, dan layanan digital lainnya. Pilih kebutuhanmu, lihat harga, lalu pesan tanpa login.</p>
          <div className="mt-6 flex flex-wrap gap-3"><a href="#pedia-catalog" className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#080C1E]">Lihat layanan</a><PediaWhatsAppLink className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-6 text-sm font-medium text-white/85">Hubungi admin</PediaWhatsAppLink></div>
          <p className="mt-5 text-xs leading-5 text-white/45">Order cepat tanpa login • Garansi refill • Support WA admin</p>
        </div>
        <div className="hidden justify-end lg:flex"><PediaOrbit /></div>
      </div>
    </section>
    <div className="mx-auto -mt-1 mb-2 max-w-[1280px] px-4 sm:px-6 lg:px-8"><PediaServiceCards /></div>
    <PlatformCatalog products={products} />
  </>;
}
