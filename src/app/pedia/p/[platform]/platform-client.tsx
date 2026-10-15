"use client";

import { useState } from "react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PEDIA_METRIC_LABEL } from "@/lib/pedia/platforms";

export function PlatformPageClient({ platform, name, products, initialSlug = "", initialTarget = "", ordersEnabled = false }: {
  platform: string; name: string; products: PediaCatalogProduct[]; initialSlug?: string; initialTarget?: string; ordersEnabled?: boolean;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [locked, setLocked] = useState(false);
  const product = products.find((p) => p.slug === slug);
  return <div className="mx-auto max-w-[1280px] px-4 pt-5 sm:px-6 lg:px-8">
    <a href="/pedia#pedia-catalog" className="inline-flex min-h-10 items-center text-sm text-white/55 hover:text-white">← Pilih platform</a>
    <div className="mt-2 flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5"><PlatformIcon id={platform} size={28} /></span><div><h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{name}</h1><p className="mt-1 text-xs text-white/50">Pilih kebutuhanmu, lalu bandingkan layanan dan harganya.</p></div></div>
    {products.length ? <>
      <div className="mt-6"><h2 className="text-sm font-semibold text-white/85">Mau tambah apa?</h2><div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label={`Jenis layanan ${name}`}>{products.map((p) => <button key={p.slug} type="button" aria-pressed={slug === p.slug} disabled={locked} onClick={() => setSlug(p.slug)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-xl border px-4 text-sm transition disabled:opacity-40 ${slug === p.slug ? "border-[#00E5FF]/50 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/12 bg-white/[0.03] text-white/70 hover:border-white/30"}`}>{p.name.replace(new RegExp(`\\s*${name}\\s*`, "ig"), " ").trim() || PEDIA_METRIC_LABEL[p.metric] || p.name}<span className="ml-2 text-[10px] opacity-50">{p.tiers.length}</span></button>)}</div></div>
      {product ? <OrderClient key={product.slug} product={product} initialTarget={initialTarget} ordersEnabled={ordersEnabled} withinPlatform onLockedChange={setLocked} /> : <div className="mb-8 mt-5 rounded-2xl border border-dashed border-white/15 px-5 py-8 text-sm leading-6 text-white/55">Pilih jenis layanan di atas untuk melihat pilihan, harga, dan cara pemesanannya.</div>}
    </> : <p className="my-8 rounded-2xl border border-white/10 p-5 text-sm text-white/60">Belum ada layanan tersedia untuk platform ini. <a href="/pedia" className="text-[#00E5FF]">Lihat platform lain</a></p>}
  </div>;
}
