"use client";

import { useEffect, useState } from "react";

/** Ambang standar "koneksi lambat" (8 dtk) dan "macet" (20 dtk) di storefront. */
export const SLOW_MS = 8_000;
export const STUCK_MS = 20_000;

/**
 * Tahap tunggu selama `active`: 0 sebelum ambang pertama, 1 setelah
 * `thresholds[0]`, dst. Kembali ke 0 begitu `active` false. Dipakai agar
 * proses yang lama tidak diam: label berganti ("Menyiapkan QRIS…",
 * "Koneksi lambat…") alih-alih spinner yang sama selamanya.
 */
export function useLoadingStage(active: boolean, thresholds: readonly number[] = [SLOW_MS, STUCK_MS]): number {
  const [stage, setStage] = useState(0);
  const key = thresholds.join(",");
  useEffect(() => {
    setStage(0);
    if (!active) return;
    const timers = key.split(",").map((ms, index) => setTimeout(() => setStage(index + 1), Number(ms)));
    return () => timers.forEach(clearTimeout);
  }, [active, key]);
  return active ? stage : 0;
}
