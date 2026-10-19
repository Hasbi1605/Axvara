"use client";

// BrandLoader — satu-satunya indikator loading modern AXVARA (2026-10-19).
// Logo diam di tengah (tidak berputar), cincin cyan berputar DI SEKELILINGNYA.
// Meniru referensi ISTA AI: disk tengah 64px mobile / 80px desktop, logo
// 40/48px, ring di luar (-12px) dengan border 3px transparan + top/right cyan,
// putar 360° linear 1 dtk infinite; logo pulse halus 2 dtk (scale 1→1.05,
// opacity 1→0.8). Latar mengikuti midnight AXVARA bila fullscreen.
// Tanpa dependensi berat — hanya <img> + CSS di globals.css.
// Reduced motion: cincin + pulse berhenti (lihat .ax-brand-* media query).
import { SITE } from "@/lib/site";

export function BrandLoader({
  mark = SITE.marketMark,
  label = "Memuat…",
  logoClassName = "",
  testId,
}: {
  mark?: string;
  label?: string;
  logoClassName?: string;
  testId?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      {...(testId ? { "data-testid": testId } : {})}
      className="inline-flex flex-col items-center justify-center gap-4"
    >
      <span className="ax-brand-disk relative flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.03] sm:h-20 sm:w-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mark}
          alt=""
          width={40}
          height={40}
          draggable={false}
          className={`ax-brand-logo h-10 w-10 object-contain sm:h-12 sm:w-12 ${logoClassName}`}
        />
        <span
          aria-hidden
          data-testid={testId ? `${testId}-ring` : "brand-loader-ring"}
          className="ax-brand-ring absolute -inset-3 rounded-full"
        />
      </span>
      <span className="max-w-[70vw] text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
        {label}
      </span>
    </span>
  );
}
