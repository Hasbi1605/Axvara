"use client";
import { useEffect, useState } from "react";

export function usePediaPrices(slug: string, quantity: number | null, enabled: boolean) {
  const key = `${slug}:${quantity}`;
  const [result, setResult] = useState<{ key: string; prices: Record<number, number>; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !quantity || !Number.isSafeInteger(quantity) || quantity > 100_000_000) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/pedia/prices?product_slug=${encodeURIComponent(slug)}&quantity=${quantity}`, { signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || data.product_slug !== slug || data.quantity !== quantity || !Array.isArray(data.prices)) throw new Error("invalid_prices");
        const prices: Record<number, number> = {};
        for (const p of data.prices) if (Number.isSafeInteger(p.tier_id) && Number.isSafeInteger(p.total) && p.total > 0) prices[p.tier_id] = p.total;
        setResult({ key, prices });
      } catch { if (!controller.signal.aborted) setResult({ key, prices: {}, failed: true }); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [slug, quantity, enabled, key]);
  return result?.key === key ? result : null;
}
