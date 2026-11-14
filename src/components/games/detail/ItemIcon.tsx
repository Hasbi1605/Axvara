"use client";
import { useEffect, useRef, useState } from "react";
import { BadgePercent, Flame, Gem, Gift, Package, Sparkles, Star, Ticket } from "lucide-react";
import type { GamesDetailProduct } from "@/lib/games/catalog";
import { gamesItemIconScale } from "@/lib/games/item-icons";

const categoryIcons = { topup: Gem, pass: Ticket, first_topup: Sparkles, pack: Package, promo: BadgePercent, bestseller: Flame, special: Star, other: Gift };

export function ItemIcon({ src, category, className = "" }: { src: string; category: GamesDetailProduct["category"]; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Cached failures may finish before hydration attaches onError.
    if (image.current?.complete && image.current.naturalWidth === 0) setFailedSource(src);
  }, [src]);
  const Icon = categoryIcons[category];
  return <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 sm:h-7 sm:w-7 items-center justify-center ${className}`}>
    {failedSource === src ? <Icon data-item-icon-fallback size={20} strokeWidth={1.75} className="text-[#00E5FF]/80" />
      // eslint-disable-next-line @next/next/no-img-element
      : <img ref={image} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(src)} style={{ transform: `scale(${gamesItemIconScale(src)})` }} className="h-full w-full object-contain" />}
  </span>;
}
