"use client";

import { useState } from "react";
import {
  formatTermsForDisplay,
  glossaryFor,
  type DisplayTerms,
} from "@/lib/warung-rebahan/terms-display";

// TermsHighlight — S&K WR ala Axvara: tegas tapi tidak membentak.
//
// Pola tampil (keputusan owner 2026-09-18):
// - Highlight 2-3 aturan tegas SELALU terlihat (tanpa expand).
// - Full text tetap ada di accordion (tak ada pesan supplier yang hilang).
// - Cara aktivasi = langkah bernomor compact.
// - Data mentah tak disentuh: format saat render via terms-display.ts.
//
// Dipakai PDP desktop + mobile (satu komponen, styling responsif di dalam).
export function TermsHighlight({
  terms,
  deliveryTerms,
  variantLabel,
  idSuffix,
}: {
  terms: string | null;
  deliveryTerms: string | null;
  variantLabel: string;
  /** Suffix unik agar id accordion desktop/mobile tidak bentrok. */
  idSuffix: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const display: DisplayTerms | null = formatTermsForDisplay(terms, deliveryTerms);
  if (!display) return null;

  const glossary = glossaryFor([
    ...display.highlights,
    ...display.sections.flatMap((s) => s.items),
  ]);
  const panelId = `wr-terms-${idSuffix}`;

  return (
    <div>
      <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5 flex-wrap">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#00E5FF] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <span>Wajib Dipatuhi</span>
        <span className="text-xs font-semibold text-[#00E5FF]/80 tracking-normal">{variantLabel}</span>
      </h2>

      {/* Highlight — selalu terlihat, tegas tanpa membentak */}
      <ul className="mt-4 border-t border-white/8 pt-4 space-y-2.5">
        {display.highlights.map((h, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-white/80 leading-relaxed">
            <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-[#FFB800]" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span>{h}</span>
          </li>
        ))}
      </ul>
      {glossary && (
        <p className="mt-3 text-xs text-white/45 leading-relaxed">
          Istilah: {glossary}
        </p>
      )}

      {/* Full text — 1 tap, tak ada yang disembunyikan permanen */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#00E5FF] hover:underline"
      >
        {expanded ? "Tutup ketentuan" : `Lihat semua ${display.totalRules} ketentuan`}
        <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {expanded && (
        <div id={panelId} className="mt-2 space-y-4">
          {display.sections.map((sec) => (
            <div key={sec.title}>
              <h3 className="text-xs font-bold text-white/60 uppercase tracking-wide">{sec.title}</h3>
              <ol className="mt-2 space-y-2 list-none">
                {sec.items.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-white/75 leading-relaxed">
                    <span className="text-[#00E5FF] font-bold shrink-0 min-w-[20px]">{i + 1}.</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <p className="text-xs text-white/45 leading-relaxed">
            Kalau error, langsung chat admin dengan kode pesanan — kami bantu fixing 1×24 jam kerja.
          </p>
        </div>
      )}

      {/* Cara aktivasi — langkah bernomor compact */}
      {display.steps.length > 0 && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="text-xs font-bold text-white/80 uppercase tracking-wide">Cara Aktivasi</h3>
          <ol className="mt-2.5 space-y-2 list-none">
            {display.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-white/70 leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#00E5FF]/15 text-[11px] font-bold text-[#00E5FF]">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
