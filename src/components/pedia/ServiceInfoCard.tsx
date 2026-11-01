"use client";

// src/components/pedia/ServiceInfoCard.tsx — Info layanan terpilih untuk pembeli (2026-11-01).
// Istilah SMM tetap dalam bahasa supplier (No Drop, Less Drop, High Drop,
// Refill, No Refill, drop rate) dengan satu kalimat penjelasan. Drop rate
// diukur dari persen pesanan supplier yang diajukan refill dalam 7 hari.
import type { PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { DROP_LABEL, DROP_MEANING, PEDIA_TERMS, dropRateLevel, refillLabel } from "@/lib/pedia/terms";

const LEVEL: Record<"low" | "medium" | "high", [string, string]> = {
  low: ["Rendah", "text-emerald-200"],
  medium: ["Sedang", "text-amber-200"],
  high: ["Tinggi", "text-red-200"],
};
const fmt = (n: number) => n.toLocaleString("id-ID");

export function ServiceInfoCard({ t }: { t: PediaCatalogTier }) {
  const drop = t.drop_label ?? "unknown";
  const level = dropRateLevel(t.refill_pct);
  const refill = t.refill_days > 0
    ? `Refill gratis untuk jumlah yang drop selama masa refill, 1× per 24 jam. ${t.refill_mode === "manual" ? "Diajukan lewat AXVARA, diproses admin." : "Diajukan lewat AXVARA, diproses otomatis."}`
    : "Jumlah yang drop tidak diisi ulang. Biasanya lebih murah.";
  const rows: [string, string][] = [
    ["Start time", t.eta_start || t.speed_note?.replace(/^Mulai\s*/i, "") || "Mengikuti antrean"],
    ...(t.speed_per_day ? [["Speed", t.speed_per_day] as [string, string]] : []),
    ...(t.avg_time ? [["Avg time", `${t.avg_time} per 1.000`] as [string, string]] : []),
    ["Min / Max", `${fmt(t.min_qty ?? 1)} – ${fmt(t.max_qty ?? 1)}`],
    ...(t.success_pct != null ? [["Success rate", `${Math.round(t.success_pct)}% (7 hari)`] as [string, string]] : []),
  ];
  return <section aria-label="Info layanan" className="ax-glass-card rounded-2xl p-3.5 text-[13px] leading-5">
    <h3 className="text-sm font-bold text-white">Info layanan</h3>
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] text-white/50">{k}</dt><dd className="break-words font-medium text-white">{v}</dd></div>)}
    </dl>
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-white/70">
      <p><span className={`font-semibold ${t.refill_days > 0 ? "text-[#00E5FF]" : "text-white"}`}>{refillLabel(t.refill_days)}</span> — {refill}</p>
      <p><span className="font-semibold text-white">{DROP_LABEL[drop]}</span> — {DROP_MEANING[drop]}</p>
      {level && <p><span className="font-semibold text-white">Drop rate: <span className={LEVEL[level][1]}>{LEVEL[level][0]}</span></span> — {Math.round(t.refill_pct ?? 0)}% pesanan layanan ini diajukan refill dalam 7 hari terakhir.</p>}
    </div>
    <details className="mt-3 border-t border-white/10 pt-2">
      <summary className="flex min-h-9 cursor-pointer list-none items-center text-[13px] font-semibold text-[#00E5FF] [&::-webkit-details-marker]:hidden">Arti istilah</summary>
      <dl className="mt-1 space-y-2">{PEDIA_TERMS.map(({ term, meaning }) => <div key={term}><dt className="font-semibold text-white">{term}</dt><dd className="text-white/60">{meaning}</dd></div>)}</dl>
      <a href="/pedia/refill" className="mt-2 inline-flex min-h-9 items-center font-semibold text-[#00E5FF] underline underline-offset-4">Cara kerja refill</a>
    </details>
  </section>;
}
