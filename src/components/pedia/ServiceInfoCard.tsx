"use client";

// src/components/pedia/ServiceInfoCard.tsx — Info layanan terpilih untuk pembeli (2026-11-01).
import type { PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { DROP_LABEL, DROP_MEANING, PEDIA_TERMS, refillLabel } from "@/lib/pedia/terms";

const fmt = (n: number) => n.toLocaleString("id-ID");
// Only omit exact generated duplicates; custom refill conditions must survive.
const DUPLICATE_TERMS = new Set([
  "No Refill: jumlah yang drop tidak diisi ulang.",
  "No Drop: saat ini belum terlihat drop, tetapi drop tetap bisa terjadi.",
  "Less Drop: bisa drop sedikit, dan masih mungkin drop lebih banyak nanti.",
  "High Drop: drop besar. Pilih hanya bila menerima risikonya.",
  "Belum ada label drop; anggap drop bisa terjadi.",
]);

export function ServiceInfoCard({ t, productDescription }: { t: PediaCatalogTier; productDescription?: string }) {
  const drop = t.drop_label ?? "unknown";
  const refillPct = t.refill_days > 0 && t.refill_pct != null && Number.isFinite(t.refill_pct) && t.refill_pct >= 0 && t.refill_pct <= 100 ? t.refill_pct : null;
  const quality = PEDIA_TERMS.find(({ term }) => term === (t.quality === "hq" ? "HQ" : t.quality === "real" ? "Real" : ""));
  const conditions = [...new Set((t.terms ?? "").split(/\n+/).map((line) => line.trim()).filter((line) => line && !DUPLICATE_TERMS.has(line)))];
  const descriptions = [...new Set([t.description, productDescription].map((text) => text?.trim()).filter(Boolean))];
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
  // Hanya istilah yang muncul pada layanan ini; daftar lengkap ada di halaman Refill.
  const want = new Set(["Drop", ...(quality ? [quality.term] : []), t.refill_days <= 0 ? "No Refill" : t.refill_days >= 3650 ? "Refill Lifetime" : "Refill", ...(drop !== "unknown" ? [DROP_LABEL[drop]] : []), ...(refillPct != null ? ["Pengajuan Refill"] : []), "Start time", ...(t.speed_per_day ? ["Speed"] : []), "Min / Max", ...(t.success_pct != null ? ["Success rate"] : []), ...(t.avg_time ? ["Avg time"] : [])]);
  const terms = PEDIA_TERMS.filter(({ term }) => want.has(term));
  return <section aria-label="Info layanan" className="rounded-2xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.03] p-3.5 text-[13px] leading-5">
    <h3 className="text-sm font-bold text-white">Info layanan</h3>
    {descriptions.map((text) => <p key={text} className="mt-2 whitespace-pre-line break-words text-white/85">{text}</p>)}
    {quality && <p className="mt-2 text-white/70"><span className="font-semibold text-white">{quality.term}</span> — {quality.meaning}</p>}
    {conditions.length > 0 && <div className="mt-3"><h4 className="font-semibold text-white">Syarat khusus</h4><ul className="mt-1 list-disc space-y-1 break-words pl-4 text-white/70">{conditions.map((line) => <li key={line}>{line}</li>)}</ul></div>}
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-white/70">
      <p><span className={`font-semibold ${t.refill_days > 0 ? "text-[#00E5FF]" : "text-white"}`}>{refillLabel(t.refill_days)}</span> — {refill}</p>
      <p><span className="font-semibold text-white">{DROP_LABEL[drop]}</span> — {DROP_MEANING[drop]}</p>
    </div>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-white/10 pt-3 sm:grid-cols-3">
      {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] text-white/65">{k}</dt><dd className="break-words font-medium text-white">{v}</dd></div>)}
    </dl>
    {refillPct != null && <p className="mt-3 text-white/70"><span className="font-semibold text-white">Pengajuan Refill · 7 hari: {Math.round(refillPct)}%</span> — Persentase pesanan yang diajukan Refill, bukan persentase jumlah yang hilang.</p>}
    <details className="mt-3 border-t border-white/10 pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md text-[13px] font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] [&::-webkit-details-marker]:hidden">Arti istilah</summary>
      <dl className="mt-1 space-y-2">{terms.map(({ term, meaning }) => <div key={term}><dt className="font-semibold text-white">{term}</dt><dd className="text-white/60">{meaning}</dd></div>)}</dl>
      <a href="/pedia/refill#istilah" className="mt-2 inline-flex min-h-11 items-center font-semibold text-[#00E5FF] underline underline-offset-4">Semua istilah & cara kerja refill</a>
    </details>
  </section>;
}
