// src/components/pedia/OrderTicker.tsx — Ticker "baru saja dipesan" (PD-15).
// Satu baris, fade tiap 4 dtk; statis bila reduced-motion; sembunyi bila < 5 order/24 jam.
"use client";

import { useEffect, useState } from "react";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

type Tick = { text: string };

export function OrderTicker({ items }: { items: Tick[] }) {
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const prefix = useDisplayLocale() === "en" ? "Just now:" : "baru saja:";
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reducedMotion);
    if (reducedMotion || items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items.length]);
  if (items.length === 0) return null;
  if (reduced) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-white/55" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        {prefix} {items[0]?.text}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-white/55" aria-hidden="true">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
      <span key={index} className="animate-[fadeInUp_300ms_var(--ease-out)]">{prefix} {items[index % items.length]?.text}</span>
    </p>
  );
}
