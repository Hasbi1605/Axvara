// src/components/pedia/OrderTicker.tsx — Ticker "baru saja dipesan" (PD-15).
// Satu baris, fade tiap 4 dtk; statis bila reduced-motion; sembunyi bila < 5 order/24 jam.
"use client";

import { useEffect, useState } from "react";

type Tick = { text: string };

export function OrderTicker({ items }: { items: Tick[] }) {
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (items.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items.length]);
  if (items.length === 0) return null;
  if (reduced) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-white/55">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        baru saja: {items[0]?.text}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-white/55" aria-live="off">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
      <span key={index} className="animate-[fadeInUp_300ms_var(--ease-out)]">baru saja: {items[index]?.text}</span>
    </p>
  );
}
