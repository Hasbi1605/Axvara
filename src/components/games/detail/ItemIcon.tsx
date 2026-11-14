"use client";
import { useEffect, useRef, useState } from "react";
import { BadgePercent, Flame, Gem, Gift, Package, Sparkles, Star, Ticket } from "lucide-react";
import type { GamesDetailProduct } from "@/lib/games/catalog";

const categoryIcons = { topup: Gem, pass: Ticket, first_topup: Sparkles, pack: Package, promo: BadgePercent, bestseller: Flame, special: Star, other: Gift };

export function ItemIcon({ src, category }: { src: string; category: GamesDetailProduct["category"] }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Cached failures may finish before hydration attaches onError.
    if (image.current?.complete && image.current.naturalWidth === 0) setFailedSource(src);
  }, [src]);
  const Icon = categoryIcons[category];
  return <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center sm:h-9 sm:w-9">
    {failedSource === src ? <Icon data-item-icon-fallback size={24} strokeWidth={1.75} className="text-[#00E5FF]/80" />
      // eslint-disable-next-line @next/next/no-img-element
      : <img ref={image} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} className="h-full w-full object-contain" />}
  </span>;
}
