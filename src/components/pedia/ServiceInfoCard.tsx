"use client";

// src/components/pedia/ServiceInfoCard.tsx — Info layanan terpilih untuk pembeli (2026-11-01).
import type { PediaCatalogTier } from "@/app/api/pedia/catalog/route";
import { hasInstantStart, pediaDropLabel, pediaDropMeaning, pediaTerms, refillLabel, refillPromise, serviceTermNames } from "@/lib/pedia/terms";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy, pediaNumber, pediaServiceName, pediaServiceText } from "@/lib/pedia/copy";

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
  const locale = useDisplayLocale();
  const copy = pediaCopy(locale);
  const fmt = (n: number) => pediaNumber(n, locale);
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
  const descriptions = [...new Set([t.description, productDescription].map((text) => text?.trim()).filter(Boolean))].map((text) => pediaServiceText(text as string, locale));
  const refill = t.refill_days > 0
    ? `${refillPromise(t.refill_days, t.refill_anchor, locale)} ${fill(copy.infoRefillApply, { mode: t.refill_mode === "manual" ? copy.infoRefillManual : copy.infoRefillAuto })}`
    : copy.infoNoRefill;
  const rows: [string, string][] = [
    ["Start time", t.eta_start || (instant ? "Instant Start" : t.speed_note?.replace(/^Mulai\s*/i, "") || copy.infoStartQueue)],
    ...(t.speed_per_day ? [["Speed", t.speed_per_day] as [string, string]] : []),
    ...(t.avg_time ? [["Avg time", `${t.avg_time} ${copy.statsPer1k}`] as [string, string]] : []),
    ["Min / Max", `${fmt(t.min_qty ?? 1)} – ${fmt(t.max_qty ?? 1)}`],
    ...(t.success_pct != null ? [["Success rate", `${Math.round(t.success_pct)}% ${copy.statsSuccessWindow}`] as [string, string]] : []),
  ];
  // Hanya istilah yang muncul pada layanan ini; daftar lengkap ada di halaman Refill.
  const want = new Set(["Drop", ...featureNames, t.refill_days <= 0 ? "No Refill" : t.refill_days >= 3650 ? "Refill Lifetime" : "Refill", ...(drop !== "unknown" ? [DROP_TERM_NAME[drop]] : []), ...(refillPct != null ? ["Pengajuan Refill"] : []), "Start time", ...(t.speed_per_day ? ["Speed"] : []), "Min / Max", ...(t.success_pct != null ? ["Success rate"] : []), ...(t.avg_time ? ["Avg time"] : [])]);
  const terms = pediaTerms(locale).filter(({ term }) => want.has(term));
  // 2026-11-03 (owner): lembar spesifikasi yang tenang; label bagian satu gaya.
  const sectionLabel = "text-[11px] font-medium uppercase tracking-[0.08em] text-white/45";
  const stats: [string, string][] = [...rows, ...(refillPct != null ? [[copy.statsRefillReq, `${Math.round(refillPct)}%`] as [string, string]] : [])];
  return <section aria-label={copy.infoAria} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 text-[13px] leading-5 sm:px-5 sm:py-4">
    {/* Baris label–nilai ringkas: satu kolom di mobile, dua kolom di sm+ (owner 2026-11-03). */}
    <dl className="divide-y divide-white/[0.06] sm:grid sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
      {stats.map(([label, value]) => <div key={label} className="flex min-w-0 items-baseline justify-between gap-3 py-1 first:pt-0 sm:py-1.5 sm:first:pt-1.5"><dt className="shrink-0 text-[12px] text-white/50">{label}</dt><dd className="min-w-0 break-words text-right text-[13px] font-medium tabular-nums text-white sm:text-[14px]">{value}</dd></div>)}
    </dl>
    <p className="mt-1.5 text-[11px] leading-4 text-white/40 sm:mt-2">{copy.infoEstimateNote}</p>
    <div className="mt-3 border-t border-white/[0.06] pt-3 sm:mt-4 sm:pt-4">
      <h3 className={sectionLabel}>{copy.infoTitle}</h3>
      <p className="mt-1 break-words font-medium text-white/90">{pediaServiceName(fullName, locale)}</p>
      {descriptions.map((text) => <p key={text} className="mt-1 max-w-[65ch] whitespace-pre-line break-words text-[13px] leading-5 text-white/85 sm:mt-1.5 sm:text-[14px] sm:leading-6">{text}</p>)}
      <dl className="mt-2 grid gap-x-4 sm:mt-3 sm:grid-cols-[minmax(0,9rem)_1fr] sm:gap-y-2">
        <dt className="font-medium text-white/90">{refillLabel(t.refill_days)}</dt><dd className="mb-1.5 text-[12.5px] text-white/65 sm:mb-0 sm:text-[13px]">{refill}</dd>
        <dt className="font-medium text-white/90">{pediaDropLabel(drop, locale)}</dt><dd className="text-[12.5px] text-white/65 sm:text-[13px]">{pediaDropMeaning(drop, locale)}</dd>
      </dl>
      {conditions.length > 0 && <div className="mt-3 sm:mt-4"><h4 className={sectionLabel}>{copy.infoConditions}</h4><ul className="mt-1 space-y-0.5 break-words text-[12.5px] sm:mt-1.5 sm:space-y-1 sm:text-[13px]">{conditions.map((line) => <li key={line} className="relative pl-3.5 text-white/70 before:absolute before:left-0 before:top-[0.6em] before:h-1 before:w-1 before:rounded-full before:bg-white/30">{pediaServiceText(line, locale)}</li>)}</ul></div>}
    </div>
    <details className="mt-3 border-t border-white/[0.06] pt-1 sm:mt-4 sm:pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md text-[13px] font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] [&::-webkit-details-marker]:hidden">{copy.infoTerms}</summary>
      <dl className="mt-1 space-y-2">{terms.map(({ term, meaning }) => <div key={term}><dt className="font-semibold text-white">{term}</dt><dd className="text-white/60">{meaning}</dd></div>)}</dl>
      <a href="/pedia/refill#istilah" className="mt-2 inline-flex min-h-11 items-center font-semibold text-[#00E5FF] underline underline-offset-4">{copy.allTerms}</a>
    </details>
  </section>;
}

/** Nama istilah untuk label drop (kunci PEDIA_TERMS/PEDIA_TERMS_EN). */
const DROP_TERM_NAME: Record<string, string> = { no_drop: "No Drop", less_drop: "Less Drop", high_drop: "High Drop", unknown: "Drop" };
