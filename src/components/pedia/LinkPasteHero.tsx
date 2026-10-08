// src/components/pedia/LinkPasteHero.tsx — Hero "Tempel link" (PD-01/02).
// Input 56px + tombol Tempel (Clipboard API + fallback) + deteksi debounce
// 150ms + DetectChip + ServiceSuggestion (2–4 kartu mini).
"use client";

import { useEffect, useRef, useState } from "react";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, type PediaLinkDetect } from "@/lib/pedia/link";

type Suggestion = { slug: string; name: string; minPrice: number | null; target: string };

export function LinkPasteHero({ suggestionsFor }: { suggestionsFor?: (d: PediaLinkDetect) => Suggestion[] }) {
  const [value, setValue] = useState("");
  const [detected, setDetected] = useState<PediaLinkDetect | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) { setDetected(null); setUnknown(false); setSuggestions([]); return; }
    timer.current = setTimeout(() => {
      const d = detectPediaLink(value);
      setDetected(d);
      setUnknown(value.trim().length > 3 && !d);
      setSuggestions(d && suggestionsFor ? suggestionsFor(d).slice(0, 4) : []);
    }, 150);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, suggestionsFor]);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setValue(text); return; }
    } catch { /* fallback di bawah */ }
    document.getElementById("pedia-link-input")?.focus();
  };

  return (
    <div>
      {/* 2026-10-08 (owner): focus ring violet halus mengikuti rounded.
          Akar bug: *:focus-visible global (box-shadow cyan mengotak 3px)
          menimpa input (focus:outline-none mematikan outline TAPI tidak
          mematikan box-shadow global) → kotak biru di luar rounded. */}
      <style>{`.pedia-link-input:focus-visible{box-shadow:0 0 0 3px rgba(139,92,246,.35)!important;border-radius:14px}`}</style>
      <div className="ax-glass-card flex h-14 items-center gap-2 rounded-2xl border border-white/10 px-3 focus-within:border-[var(--px-violet)]" style={{ boxShadow: "0 0 0 0 transparent" }}>
        <span aria-hidden="true" className="text-lg">🔗</span>
        <input
          id="pedia-link-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Tempel link profil atau postingan…"
          inputMode="url"
          autoComplete="off"
          className="pedia-link-input h-full flex-1 bg-transparent text-[16px] text-white placeholder:text-white/35 focus:outline-none"
        />
        <button
          onClick={paste}
          className="h-10 shrink-0 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#070a1e] transition active:scale-[0.98]"
        >
          Tempel
        </button>
      </div>
      <div aria-live="polite" className="mt-2">
        {detected && (
          <div className="animate-[fadeInUp_200ms_var(--ease-out)]">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[13px] font-semibold text-white">
              {PEDIA_PLATFORM_LABEL[detected.platform]} · {PEDIA_TARGET_KIND_LABEL[detected.targetKind]}
              {detected.displayUser && <span className="text-white/60">{detected.displayUser}</span>}
              <span aria-hidden="true" className="text-emerald-300">✓</span>
            </span>
            {suggestions.length > 0 && (
              <div className="mt-2 grid gap-2">
                {suggestions.map((s) => (
                  <a
                    key={s.slug}
                    href={`/pedia/o/${s.slug}?t=${encodeURIComponent(detected.normalized)}`}
                    className="ax-glass-card flex items-center justify-between rounded-2xl p-3 text-left transition hover:border-[var(--px-violet)]"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-white">{s.name}</span>
                      <span className="block text-xs text-white/55">
                        {s.minPrice != null ? `mulai ${formatRp(s.minPrice)}` : "Lihat harga"}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-white/40">→</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
        {unknown && (
          <p className="mt-2 text-[13px] text-white/60">Kami belum mengenali link ini. Pilih platformnya di bawah.</p>
        )}
      </div>
    </div>
  );
}

function formatRp(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}
