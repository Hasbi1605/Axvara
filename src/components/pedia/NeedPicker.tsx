"use client";

import { useEffect, useRef, useState } from "react";
import { MetricIcon } from "@/components/pedia/MetricIcon";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy, pediaNumber, pediaServiceName } from "@/lib/pedia/copy";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

// "Tayangan Reels"/"Tayangan Story" → "Reels"/"Story": ikon mata sudah membawa makna tayangan.
const short = (n: string) => n.replace(/^Tayangan\s+(Reels|Story)$/i, "$1").replace(/^Views\s+(Reels|Story)$/i, "$1");

export function NeedPicker({ products, slug, platform, locked, onChange }: {
  products: PediaCatalogProduct[]; slug: string; platform: string; locked: boolean; onChange: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  useEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active && nav.current && !expanded) {
      nav.current.scrollLeft = Math.max(0, active.offsetLeft - nav.current.offsetLeft - 8);
    }
  }, [slug, expanded]);

  return <div className="mt-3">
    <nav ref={nav} aria-label={fill(t.needsAria, { platform })} className={`pedia-needs relative -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:flex-wrap ${expanded ? "flex-wrap" : "flex-nowrap"}`}>
      {products.map((product) => <button type="button" key={product.slug} aria-pressed={product.slug === slug} disabled={locked} onClick={() => onChange(product.slug)} className={`flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold transition sm:min-h-9 disabled:opacity-40 ${product.slug === slug ? "pedia-pill-active text-[#00E5FF]" : "ax-glass-card border-white/10 text-white/75 hover:bg-white/10 hover:text-white"}`}>
          <MetricIcon metric={product.metric} size={14} tint={product.slug === slug ? "#00E5FF" : "white"} />
          {short(pediaServiceName(product.name, locale).replace(new RegExp(`\\s*${platform}\\s*`, "ig"), " ").trim() || pediaServiceName(product.name, locale))}
      </button>)}
    </nav>
    {products.length > 3 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="-mb-2 min-h-11 whitespace-nowrap text-[13px] font-medium text-[#00E5FF] xl:hidden">{expanded ? t.needsLess : fill(t.needsMore, { count: pediaNumber(products.length, locale) })}</button>}
  </div>;
}
