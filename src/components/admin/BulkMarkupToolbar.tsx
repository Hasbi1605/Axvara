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
import { Button, Checkbox, Input, Label } from "@/components/admin/ui";

import { useState } from "react";
import { Spinner } from "@/components/ui/Loading";

const PRESETS = [20, 30, 50];

export function BulkMarkupToolbar({
  visibleIds,
  totalCount,
  selected,
  onToggleAllVisible,
  onClear,
  onApply,
  presets,
  maxPercent = 500,
  allowDecimal,
  percentStep,
  resetLabel = "reset Rp ke 0",
  resetTitle = "Bila dicentang, Rp per varian ikut direset ke 0. Bila mati, Rp dipertahankan.",
  resetConfirmText = " + reset Rp ke 0",
  confirmPriceEffect = "Harga katalog ikut berubah.",
  selectionOnly = false,
  confirmApply,
  onError,
  disabled = false,
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
  /** Optional Games/shared-panel controls; omitted props preserve Market/WR/SK defaults. */
  presets?: readonly number[];
  maxPercent?: number;
  allowDecimal?: boolean;
  percentStep?: number;
  resetLabel?: string;
  resetTitle?: string;
  resetConfirmText?: string;
  confirmPriceEffect?: string;
  selectionOnly?: boolean;
  confirmApply?: (message: string) => Promise<boolean>;
  onError?: (error: unknown) => void;
  disabled?: boolean;
}) {
  const [percent, setPercent] = useState(String(presets?.[0] ?? 20));
  const [resetFixed, setResetFixed] = useState(false);
  const [useAllVisible, setUseAllVisible] = useState(false);
  const [applying, setApplying] = useState(false);

  const decimalAllowed = allowDecimal ?? Boolean(presets);
  const effectiveIds = useAllVisible ? visibleIds : visibleIds.filter((id) => selected.has(id));
  const showEditor = !selectionOnly || effectiveIds.length > 0;
  const pct = decimalAllowed ? Number(percent) : Math.floor(Number(percent));
  const stepValid = percentStep === 0.5
    ? Math.abs(pct * 2 - Math.round(pct * 2)) < 1e-6
    : decimalAllowed
      ? Math.abs(pct * 100 - Math.round(pct * 100)) < 1e-6
      : Number.isInteger(pct);
  const pctValid = percent.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= maxPercent && stepValid;
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));
  const activePreset = selectionOnly ? "bg-admin-primary text-admin-inverse"
    : presets ? "bg-admin-subtle text-admin-fg" : "bg-admin-warning text-admin-inverse";

  const apply = async () => {
    if (!pctValid || !effectiveIds.length || applying || disabled) return;
    const scope = useAllVisible ? "semua yang tampil" : `${effectiveIds.length} dipilih`;
    const msg = `Terapkan markup ${pct}% ke ${scope}${totalCount != null && useAllVisible ? ` (total hasil ${totalCount})` : ""}${resetFixed ? resetConfirmText : ""}? ${confirmPriceEffect}`;
    if (!(confirmApply ? await confirmApply(msg) : window.confirm(msg))) return;
    setApplying(true);
    try {
      await onApply({ variantIds: effectiveIds, percent: pct, resetFixed });
      onClear();
      setUseAllVisible(false);
    } catch (error) {
      if (onError) onError(error); else throw error;
    } finally {
      setApplying(false);
    }
  };

  return (
    <fieldset disabled={disabled || applying} className={selectionOnly
      ? "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-admin-border px-3"
      : "flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-admin-border bg-admin-subtle/15 px-3 py-2"}>
      <Label className={`flex items-center gap-2 text-xs text-admin-muted ${selectionOnly ? "min-h-11 cursor-pointer md:min-h-9" : ""}`}>
        <Checkbox
          checked={someChecked && !allChecked ? "indeterminate" : allChecked}
          onCheckedChange={(checked) => { setUseAllVisible(false); onToggleAllVisible((checked === true)); }}
          className="h-4 w-4 accent-admin-accent"
        />
        {selectionOnly ? "Pilih halaman ini" : `Pilih tampil (${selected.size})`}
      </Label>
      {!selectionOnly && <Button variant={presets ? "outline" : "default"} size="sm"
        type="button"
        onClick={() => setUseAllVisible((v) => !v)}
        title="Pakai semua yang tampil (abaikan checklist)"
        aria-pressed={useAllVisible}
        className={`h-8 rounded-lg px-2.5 text-xs font-semibold transition ${useAllVisible ? "bg-admin-primary text-admin-inverse" : "bg-admin-subtle text-admin-muted hover:bg-admin-subtle hover:text-admin-fg"}`}
      >
        Set semua tampil
      </Button>}
      {showEditor && <div className={`flex min-w-0 flex-wrap items-center gap-2 ${selectionOnly ? "w-full border-t border-admin-border py-2 lg:w-auto lg:flex-1 lg:border-t-0 lg:py-1" : "contents"}`}>
        <div className="flex items-center gap-1" role="group" aria-label="Preset markup">
          {(presets ?? PRESETS).map((p) => (
            <Button variant="outline" size="sm"
              key={p}
              type="button"
              onClick={() => setPercent(String(p))}
              aria-pressed={pct === p}
              className={`${selectionOnly ? "min-h-11 md:min-h-8" : "h-8"} rounded-lg px-2.5 text-xs font-semibold transition ${pct === p ? activePreset : "bg-admin-subtle text-admin-muted hover:bg-admin-subtle hover:text-admin-fg"}`}
            >
              {p}%
            </Button>
          ))}
        </div>
        <Label className="flex items-center gap-1.5 text-xs text-admin-muted">
          %
          <Input
            value={percent}
            onChange={(e) => setPercent(decimalAllowed ? e.target.value : e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            inputMode={decimalAllowed ? "decimal" : "numeric"}
            aria-label="Markup persen bulk"
            className={`${selectionOnly ? "min-h-11 md:min-h-8" : "h-8"} w-16 rounded-lg border border-admin-border bg-admin-subtle/20 px-2 text-right text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none`}
          />
        </Label>
        <Label className={`flex items-center gap-1.5 text-xs text-admin-muted ${selectionOnly ? "min-h-11 cursor-pointer md:min-h-8" : ""}`} title={resetTitle}>
          <Checkbox checked={resetFixed} onCheckedChange={(checked) => setResetFixed((checked === true))} className="h-4 w-4 accent-admin-accent" />
          {resetLabel}
        </Label>
        <Button variant="default" size="sm"
          type="button"
          onClick={() => void apply()}
          disabled={applying || !effectiveIds.length || !pctValid}
          className={`inline-flex ${selectionOnly ? "min-h-11 md:min-h-8" : "h-8"} items-center gap-1.5 rounded-lg bg-admin-primary px-3 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-40`}
        >
          {applying ? <Spinner size={12} /> : null}
          Terapkan ke {effectiveIds.length} varian
        </Button>
      </div>}
    </fieldset>
  );
}
