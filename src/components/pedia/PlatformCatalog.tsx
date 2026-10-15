"use client";
/* eslint-disable @next/next/no-img-element -- WebP R2 sudah dioptimalkan dan dilayani langsung CDN. */

import { useState } from "react";
import Link from "next/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PEDIA_GROUPS, PEDIA_PLATFORM_CONFIG, pediaMatches } from "@/lib/pedia/platforms";
import { PLATFORM_CARD_IMAGE, PlatformIcon } from "./PlatformGrid";
import { usePediaSearch } from "@/stores/pedia-search";

export function PlatformCatalog({ products }: { products: PediaCatalogProduct[] }) {
  const [group, setGroup] = useState("");
  const query = usePediaSearch((s) => s.q);
  const setQuery = usePediaSearch((s) => s.setQ);
  const available = PEDIA_PLATFORM_CONFIG.filter((p) => products.some((product) => product.platform === p.id));
  const platforms = available.filter((p) => !group || p.group === group);
  const results = products.filter((p) => pediaMatches(query, `${p.name} ${p.platform} ${p.metric} ${p.tiers.map((t) => `${t.public_name ?? ""} ${t.region === "indonesia" ? "Indonesia" : "Global"}`).join(" ")}`));
  return <section id="pedia-catalog" aria-labelledby="pedia-catalog-heading" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-6 sm:px-6 lg:px-8">
    <div className="flex items-center justify-between gap-3">
      <div><h2 id="pedia-catalog-heading" className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">{query.trim() ? "Hasil pencarian" : "Pilih platform"}</h2><p className="mt-1 text-sm text-white/55">{query.trim() ? `Layanan untuk “${query.trim()}”` : "Buka platform, lalu pilih layanan yang kamu butuhkan."}</p></div>
      <span className="shrink-0 text-xs text-white/45">{query.trim() ? `${results.length} layanan` : `${available.length} platform`}</span>
    </div>
    {!query.trim() && <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Kelompok platform">{PEDIA_GROUPS.filter((g) => !g.id || available.some((p) => p.group === g.id)).map((g) => <button key={g.id} type="button" onClick={() => setGroup(g.id)} aria-pressed={group === g.id} className={`min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition ${group === g.id ? "border-[#00E5FF]/50 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 bg-white/[0.03] text-white/65 hover:bg-white/[0.06]"}`}>{g.label}</button>)}</div>}
    {query.trim() ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{results.map((p) => <Link key={p.slug} prefetch={false} href={`/pedia/o/${p.slug}`} className="ax-glass-card flex min-h-24 items-center gap-3 rounded-2xl p-4 transition hover:border-[#00E5FF]/40"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5"><PlatformIcon id={p.platform} size={25} /></span><span className="min-w-0"><span className="block text-sm font-semibold text-white">{p.name}</span><span className="mt-1 block text-xs text-white/55">{p.tiers.length} pilihan layanan</span></span><span aria-hidden className="ml-auto text-[#00E5FF]">→</span></Link>)}</div>
      : <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{platforms.map((p, i) => <Link key={p.id} prefetch={false} href={`/pedia/p/${p.id}`} className="group ax-glass-card overflow-hidden rounded-[18px] transition hover:-translate-y-0.5 hover:border-[#00E5FF]/40" aria-label={`Layanan ${p.label}`}>
        <div className="relative m-1.5 flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${p.color}20, #0F1430)` }}>
          {PLATFORM_CARD_IMAGE[p.id] ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={PLATFORM_CARD_IMAGE[p.id]} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading={i < 4 ? "eager" : "lazy"} /> : <PlatformIcon id={p.id} size={48} />}
        </div>
        <div className="px-3 pb-3 pt-1 sm:px-4 sm:pb-4"><h3 className="text-base font-semibold text-white">{p.label}</h3><p className="mt-1 min-h-9 text-xs leading-[18px] text-white/55">{p.summary}</p><span className="mt-3 inline-flex min-h-6 items-center gap-2 text-xs font-medium text-[#00E5FF]">Lihat layanan <span aria-hidden>→</span></span></div>
      </Link>)}</div>}
    {(!products.length || (query.trim() && !results.length)) && <div role="status" className="mt-5 rounded-2xl border border-white/10 p-5 text-sm text-white/65"><p>{products.length ? "Belum ada layanan yang cocok. Coba nama platform atau jenis layanan lain." : "Katalog belum tersedia. Coba kembali nanti atau hubungi bantuan."}</p>{query.trim() && <button type="button" className="mt-2 min-h-11 text-[#00E5FF]" onClick={() => setQuery("")}>Reset pencarian</button>}</div>}
  </section>;
}
