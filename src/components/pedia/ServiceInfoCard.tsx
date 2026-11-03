"use client";

// src/components/pedia/ServiceInfoCard.tsx — Info layanan terpilih untuk pembeli (2026-11-01).
import type { PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { DROP_LABEL, DROP_MEANING, PEDIA_TERMS, hasInstantStart, refillLabel, refillPromise, serviceTermNames } from "@/lib/pedia/terms";

const fmt = (n: number) => n.toLocaleString("id-ID");
// Only omit exact generated duplicates; custom refill conditions must survive.
const DUPLICATE_TERMS = new Set([
  "No Refill: jumlah yang drop tidak diisi ulang.",
  "No Drop: saat ini belum terlihat drop, tetapi drop tetap bisa terjadi.",
  "Less Drop: bisa drop sedikit, dan masih mungkin drop lebih banyak nanti.",
  "High Drop: drop besar. Pilih hanya bila menerima risikonya.",
  "Belum ada label drop; anggap drop bisa terjadi.",
  // Sudah tampil sebagai caption estimasi di bawah angka layanan.
  "Start time dan speed dapat berubah mengikuti antrean.",
  "Jumlah dapat diisi sendiri dalam batas layanan.",
  "Estimasi mulai dan kecepatan dapat berubah mengikuti antrean.",
  "Estimasi dapat berubah mengikuti antrean.",
]);
const BOTH_ANCHORS = ["created", "completed"] as const;
// Baris refill hasil generator untuk tier INI PERSIS (label + N + mode saat
// ini); isinya sudah ada di paragraf Refill kartu ini. N tak cocok, mode tak
// cocok, atau Lifetime tak cocok TETAP TAMPIL (bisa jadi konflik nyata).
// refill_days<=0 tak punya kalimat generated (No Refill lama ditangani
// DUPLICATE_TERMS bila generik, syarat kustom tetap tampil).

export function ServiceInfoCard({ t, productDescription, productName = "" }: { t: PediaCatalogTier; productDescription?: string; productName?: string }) {
  const drop = t.drop_label ?? "unknown";
  const refillPct = t.refill_days > 0 && t.refill_pct != null && Number.isFinite(t.refill_pct) && t.refill_pct >= 0 && t.refill_pct <= 100 ? t.refill_pct : null;
  const fullName = t.public_name ?? t.label_note ?? productName;
  const featureNames = serviceTermNames(fullName, t.quality);
  const instant = hasInstantStart(fullName);
  const range = `Jumlah per pesanan ${fmt(t.min_qty ?? 1)}–${fmt(t.max_qty ?? 1)}.`;
  // Hanya bila N persis sama dengan masa refill layanan; N lain/kustom tetap tampil.
  const sameRefill = t.refill_days > 0 ? BOTH_ANCHORS.flatMap((a) => [`Refill ${t.refill_days} hari sejak pesanan dibuat, sesuai syarat layanan.`, refillPromise(t.refill_days, a)]) : [];
  // Kalimat generated persis untuk tier ini (Inggris, bentuk generator).
  const generatedRefill = t.refill_days > 0
    ? `${refillLabel(t.refill_days)}: ajukan refill di halaman Refill Pedia selama masa refill sejak pesanan dibuat, 1× per 24 jam. ${t.refill_mode === "manual" ? "Refill diproses admin, biasanya dalam 1×24 jam." : "Refill diproses otomatis."}`
    : null;
  const conditions = [...new Set((t.terms ?? "").split(/\n+/).map((line) => line.trim()).filter((line) => line && line !== range && !sameRefill.includes(line) && line !== generatedRefill && !DUPLICATE_TERMS.has(line)))];
  const descriptions = [...new Set([t.description, productDescription].map((text) => text?.trim()).filter(Boolean))];
  const refill = t.refill_days > 0
    ? `${refillPromise(t.refill_days, t.refill_anchor)} Bisa diajukan 1× per 24 jam dari halaman pesanan, ${t.refill_mode === "manual" ? "diproses admin, biasanya dalam 1×24 jam." : "diproses otomatis."}`
    : "Tanpa refill: jumlah yang drop tidak diisi ulang.";
  // 2026-11-03 (owner): rata-rata terukur menang atas klaim speed supplier yang bisa
  // bertentangan (mis. "100K/hari" vs "8 jam per 1.000"); Speed hanya tampil tanpa avg_time.
  const showSpeed = !!t.speed_per_day && !t.avg_time;
  const rows: [string, string][] = [
    ["Start time", t.eta_start || (instant ? "Instant Start" : t.speed_note?.replace(/^Mulai\s*/i, "") || "Mengikuti antrean")],
    ...(showSpeed ? [["Speed", t.speed_per_day as string] as [string, string]] : []),
    ...(t.avg_time ? [["Avg time", `${t.avg_time} per 1.000`] as [string, string]] : []),
    ["Min / Max", `${fmt(t.min_qty ?? 1)} – ${fmt(t.max_qty ?? 1)}`],
    ...(t.success_pct != null ? [["Success rate", `${Math.round(t.success_pct)}% (7 hari)`] as [string, string]] : []),
  ];
  // Hanya istilah yang muncul pada layanan ini; daftar lengkap ada di halaman Refill.
  const want = new Set(["Drop", ...featureNames, t.refill_days <= 0 ? "No Refill" : t.refill_days >= 3650 ? "Refill Lifetime" : "Refill", ...(drop !== "unknown" ? [DROP_LABEL[drop]] : []), ...(refillPct != null ? ["Pengajuan Refill"] : []), "Start time", ...(showSpeed ? ["Speed"] : []), "Min / Max", ...(t.success_pct != null ? ["Success rate"] : []), ...(t.avg_time ? ["Avg time"] : [])]);
  const terms = PEDIA_TERMS.filter(({ term }) => want.has(term));
  // 2026-11-03 (owner): lembar spesifikasi yang tenang; label bagian satu gaya.
  const sectionLabel = "text-[11px] font-medium uppercase tracking-[0.08em] text-white/45";
  const stats: [string, string][] = [...rows, ...(refillPct != null ? [["Pengajuan Refill · 7 hari", `${Math.round(refillPct)}%`] as [string, string]] : [])];
  return <section aria-label="Info layanan" className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 text-[13px] leading-5 sm:px-5">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-flow-col sm:auto-cols-fr sm:gap-0 sm:divide-x sm:divide-white/[0.08]">
      {stats.map(([k, v]) => <div key={k} className="min-w-0 sm:px-4 sm:first:pl-0"><dt className="text-[11px] text-white/45">{k}</dt><dd className="mt-0.5 break-words text-[15px] font-medium tabular-nums text-white">{v}</dd></div>)}
    </dl>
    <p className="mt-2 text-[11px] text-white/40">Estimasi; start time dan speed dapat berubah mengikuti antrean.</p>
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <h3 className={sectionLabel}>Info layanan</h3>
      {descriptions.map((text) => <p key={text} className="mt-1.5 max-w-[65ch] whitespace-pre-line break-words text-[14px] leading-6 text-white/85">{text}</p>)}
      <dl className="mt-3 grid gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(0,9rem)_1fr] sm:gap-y-2">
        <dt className="font-medium text-white/90">{refillLabel(t.refill_days)}</dt><dd className="mb-2 text-white/65 sm:mb-0">{refill}</dd>
        <dt className="font-medium text-white/90">{DROP_LABEL[drop]}</dt><dd className="text-white/65">{DROP_MEANING[drop]}</dd>
      </dl>
      {conditions.length > 0 && <div className="mt-4"><h4 className={sectionLabel}>Syarat khusus</h4><ul className="mt-1.5 space-y-1 break-words">{conditions.map((line) => <li key={line} className="relative pl-3.5 text-white/70 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-white/30">{line}</li>)}</ul></div>}
    </div>
    <details className="mt-4 border-t border-white/[0.06] pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md text-[13px] font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] [&::-webkit-details-marker]:hidden">Arti istilah</summary>
      <dl className="mt-1 space-y-2">{terms.map(({ term, meaning }) => <div key={term}><dt className="font-semibold text-white">{term}</dt><dd className="text-white/60">{meaning}</dd></div>)}</dl>
      <a href="/pedia/refill#istilah" className="mt-2 inline-flex min-h-11 items-center font-semibold text-[#00E5FF] underline underline-offset-4">Semua istilah & cara kerja refill</a>
    </details>
  </section>;
}
