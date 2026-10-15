"use client";

import { PediaOrbit } from "@/components/pedia/PediaOrbit";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { Typewriter } from "@/components/pedia/Typewriter";
import { PlatformCatalog } from "@/components/pedia/PlatformCatalog";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export function PediaHomeClient({ products }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  return <>
    <section className="relative mx-auto max-w-[1280px] px-4 pb-2 pt-7 sm:px-6 sm:pt-10 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,229,255,0.08),transparent_65%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div className="max-w-2xl">
          <h1 className="font-display text-[30px] font-bold leading-[1.08] tracking-[-0.025em] text-white sm:text-[46px] lg:text-[52px]"><span className="block">Satu tempat untuk</span><span className="block">Layanan sosial media</span><Typewriter /></h1>
          <p className="mt-3 max-w-[46ch] text-sm leading-6 text-white/60 sm:text-[15px]">Followers, likes, views, dan layanan digital lainnya. Pilih kebutuhanmu, lihat harga, lalu pesan tanpa login.</p>
          <div className="mt-5 flex flex-wrap gap-3"><a href="#pedia-catalog" className="inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-[#080C1E]">Lihat layanan</a><PediaWhatsAppLink className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium text-white/85">Hubungi admin</PediaWhatsAppLink></div>
          <p className="mt-4 text-xs leading-5 text-white/45">Tanpa login · Harga sesuai jumlah · Refill mengikuti layanan</p>
        </div>
        <div className="hidden justify-end lg:flex"><PediaOrbit /></div>
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] px-4 pt-4 sm:px-6 lg:px-8"><PediaServiceCards /></div>
    <PlatformCatalog products={products} />
  </>;
}
