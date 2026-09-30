// src/components/admin/BulkMarkupToolbar.tsx — Toolbar bulk markup bersama
// WR + SK (keputusan owner 2026-10-01): 1 pola interaksi untuk kedua manager
// agar tidak menambah duplikasi cermin WR↔SK.
//
// Kontrak perilaku:
// - "Set semua tampil" = semua baris yang terlihat di daftar saat itu,
//   BUKAN diam-diam seluruh DB di luar filter/potong.
// - Bulk hanya ubah % secara default; Rp per varian dipertahankan kecuali
//   opsi reset dicentang.
// - Konfirmasi menampilkan hitungan eksplisit sebelum harga katalog berubah.

"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Loading";

const PRESETS = [20, 30, 50];

export function BulkMarkupToolbar({
  visibleIds,
  totalCount,
  selected,
  onToggleOne,
  onToggleAllVisible,
  onClear,
  onApply,
}: {
  /** Id varian yang terlihat di daftar saat ini. */
  visibleIds: string[];
  /** Total hasil filter (bisa > tampil bila daftar dipotong slice). */
  totalCount: number | null;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onClear: () => void;
  /** Eksekusi bulk (konfirmasi sudah disetujui di dalam). */
  onApply: (args: { variantIds: string[]; percent: number; resetFixed: boolean }) => Promise<void>;
}) {
  const [percent, setPercent] = useState("20");
  const [resetFixed, setResetFixed] = useState(false);
  const [useAllVisible, setUseAllVisible] = useState(false);
  const [applying, setApplying] = useState(false);

  const effectiveIds = useAllVisible ? visibleIds : visibleIds.filter((id) => selected.has(id));
  const pct = Math.floor(Number(percent));
  const pctValid = Number.isInteger(pct) && pct >= 0 && pct <= 500;
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));

  const apply = async () => {
    if (!pctValid || !effectiveIds.length || applying) return;
    const scope = useAllVisible ? "semua yang tampil" : `${effectiveIds.length} dipilih`;
    const msg = `Terapkan markup ${pct}% ke ${scope}${totalCount != null && useAllVisible ? ` (total hasil ${totalCount})` : ""}${resetFixed ? " + reset Rp ke 0" : ""}? Harga katalog ikut berubah.`;
    if (!window.confirm(msg)) return;
    setApplying(true);
    try {
      await onApply({ variantIds: effectiveIds, percent: pct, resetFixed });
      onClear();
      setUseAllVisible(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
      <label className="flex items-center gap-1.5 text-xs text-white/60" title="Pilih baris satu per satu">
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
          onChange={(e) => { setUseAllVisible(false); onToggleAllVisible(e.target.checked); }}
          className="h-4 w-4 accent-[#00E5FF]"
        />
        Pilih tampil ({selected.size})
      </label>
      <button
        type="button"
        onClick={() => setUseAllVisible((v) => !v)}
        title="Pakai semua yang tampil (abaikan checklist)"
        aria-pressed={useAllVisible}
        className={`h-8 rounded-lg px-2.5 text-[11px] font-bold transition ${useAllVisible ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/60 hover:bg-white/10 hover:text-white"}`}
      >
        Set semua tampil
      </button>
      <div className="flex items-center gap-1" role="group" aria-label="Preset markup">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPercent(String(p))}
            aria-pressed={pct === p}
            className={`h-8 rounded-lg px-2.5 text-[11px] font-bold transition ${pct === p ? "bg-[#FFB800] text-[#080C1E]" : "bg-white/[0.06] text-white/60 hover:bg-white/10 hover:text-white"}`}
          >
            {p}%
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-white/60">
        %
        <input
          value={percent}
          onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          inputMode="numeric"
          aria-label="Markup persen bulk"
          className="h-8 w-16 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-white/60" title="Bila dicentang, Rp per varian ikut direset ke 0. Bila mati, Rp dipertahankan.">
        <input type="checkbox" checked={resetFixed} onChange={(e) => setResetFixed(e.target.checked)} className="h-4 w-4 accent-[#00E5FF]" />
        reset Rp ke 0
      </label>
      <button
        type="button"
        onClick={() => void apply()}
        disabled={applying || !effectiveIds.length || !pctValid}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#00E5FF] px-3 text-[11px] font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40"
      >
        {applying ? <Spinner size={12} /> : null}
        Terapkan ke {effectiveIds.length} varian
      </button>
    </div>
  );
}
