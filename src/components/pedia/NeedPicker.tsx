"use client";

import { useEffect, useRef, useState } from "react";
import { MetricIcon } from "@/components/pedia/MetricIcon";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export function NeedPicker({ products, slug, platform, locked, onChange }: {
  products: PediaCatalogProduct[]; slug: string; platform: string; locked: boolean; onChange: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active && nav.current && !expanded) {
      nav.current.scrollLeft = Math.max(0, active.offsetLeft - nav.current.offsetLeft - 8);
    }
  }, [slug, expanded]);

  return <div className="mt-3">
    <nav ref={nav} aria-label={`Jenis layanan ${platform}`} className={`pedia-needs relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 xl:flex-wrap ${expanded ? "flex-wrap" : "flex-nowrap"}`}>
      {products.map((product) => <button type="button" key={product.slug} aria-pressed={product.slug === slug} disabled={locked} onClick={() => onChange(product.slug)} className={`flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold transition disabled:opacity-40 ${product.slug === slug ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/20 bg-white/[0.025] text-white/75 hover:border-white/40 hover:text-white"}`}>
          <MetricIcon metric={product.metric} size={15} tint={product.slug === slug ? "#00E5FF" : "white"} />
          {product.name.replace(new RegExp(`\\s*${platform}\\s*`, "ig"), " ").trim() || product.name}
      </button>)}
    </nav>
    {products.length > 3 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="min-h-11 whitespace-nowrap text-[13px] font-medium text-[#00E5FF] xl:hidden">{expanded ? "Ringkas kebutuhan" : `Semua kebutuhan (${products.length})`}</button>}
  </div>;
}
