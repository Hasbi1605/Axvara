"use client";
// Baris harga varian supplier (TUNVN/AIVault) — satu varian satu baris.
// Simpan eksplisit per baris: tombol hanya aktif bila ada perubahan, draf
// tidak hilang saat baris lain disimpan (sinkron ulang hanya bila nilai server
// baris ini berubah) dan tidak ada simpanan yang dibuang diam-diam.
import { useEffect, useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Input } from "./ui";
import { AdminStatusSwitch } from "./AdminStatusSwitch";

export type SupplierPriceSave = { markup_percent?: number; admin_price_idr?: number | null };

/** Header kolom untuk daftar baris (desktop saja). */
export function SupplierPriceHeader() {
  return <div aria-hidden="true" className="hidden gap-3 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-admin-muted md:grid md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem] md:items-end">
    <span>Varian</span><span>Markup %</span><span>Harga manual</span><span className="text-right">Harga jual</span><span /><span className="text-right">Aktif</span>
  </div>;
}

export function SupplierPriceRow({ id, title, meta, badges, markup, manual, price, active, canEdit, locked, busy, notice, onToggle, onSave }: {
  id: string; title: ReactNode; meta: ReactNode; badges?: ReactNode;
  markup: number; manual: number | null; price: number | null; active: boolean;
  canEdit: boolean; locked: boolean; busy: boolean; notice?: ReactNode;
  onToggle: () => void; onSave: (body: SupplierPriceSave) => Promise<void>;
}) {
  const [markupDraft, setMarkupDraft] = useState(String(markup));
  const [manualDraft, setManualDraft] = useState(manual == null ? "" : String(manual));
  const [error, setError] = useState("");
  // Hanya nilai server baris ini yang memicu reset draf.
  useEffect(() => { setMarkupDraft(String(markup)); setError(""); }, [markup]);
  useEffect(() => { setManualDraft(manual == null ? "" : String(manual)); setError(""); }, [manual]);

  const markupChanged = markupDraft.trim() !== String(markup);
  const manualChanged = manualDraft.trim() !== (manual == null ? "" : String(manual));
  const dirty = markupChanged || manualChanged;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || locked) return;
    const body: SupplierPriceSave = {};
    if (markupChanged) {
      const value = Number(markupDraft);
      if (markupDraft.trim() === "" || !Number.isFinite(value) || value < 0 || value > 1000) { setError("Markup harus 0–1000%."); return; }
      body.markup_percent = value;
    }
    if (manualChanged) {
      const raw = manualDraft.trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isInteger(value) || value < 1)) { setError("Harga manual harus bilangan bulat ≥ 1, atau kosong untuk rumus."); return; }
      body.admin_price_idr = value;
    }
    setError("");
    void onSave(body);
  }

  const inputDisabled = !canEdit || locked;
  return <form noValidate onSubmit={submit} aria-label={typeof title === "string" ? `Harga ${title}` : undefined}
    className="grid gap-3 rounded-lg border border-admin-border bg-admin-subtle/40 p-3 md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem] md:items-center">
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <p className="truncate font-medium text-admin-fg">{title}</p>
        {badges}
      </div>
      <p className="mt-0.5 break-words text-xs text-admin-muted md:truncate">{meta}</p>
    </div>
    <div className="grid grid-cols-2 gap-3 md:contents">
      <label className="space-y-1 text-xs text-admin-muted md:space-y-0">
        <span className="md:sr-only">Markup %</span>
        <Input id={`${id}-markup`} type="number" min={0} max={1000} step="0.5" inputMode="decimal" className="h-9 tabular-nums"
          value={markupDraft} disabled={inputDisabled} onChange={e => setMarkupDraft(e.target.value)} />
      </label>
      <label className="space-y-1 text-xs text-admin-muted md:space-y-0">
        <span className="md:sr-only">Harga manual (Rp)</span>
        <Input id={`${id}-manual`} type="number" min={0} step={100} inputMode="numeric" placeholder="Rumus" className="h-9 tabular-nums"
          value={manualDraft} disabled={inputDisabled} onChange={e => setManualDraft(e.target.value)} />
      </label>
    </div>
    <div className="flex items-center gap-3 md:contents">
      <div className="mr-auto md:mr-0 md:text-right">
        <p className="font-semibold tabular-nums text-admin-fg"><span className="sr-only">Harga jual </span>{price != null ? formatRupiah(price) : "—"}</p>
        {price != null && <p className="text-[11px] text-admin-muted">{manual != null ? "manual" : "rumus"}</p>}
      </div>
      <Button type="submit" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || inputDisabled}>{busy ? "Menyimpan…" : "Simpan"}</Button>
      <div className="flex justify-end"><AdminStatusSwitch checked={active} label={`Aktif ${typeof title === "string" ? title : id}`} disabled={!canEdit || locked} busy={busy} onChange={onToggle} /></div>
    </div>
    {(notice || error || dirty) && <div className="space-y-1 text-xs md:col-span-full" aria-live="polite">
      {notice && <p className="text-admin-muted">{notice}</p>}
      {error && <p role="alert" className="text-admin-danger">{error}</p>}
      {dirty && !error && <p className="text-admin-warning">Belum disimpan.</p>}
    </div>}
  </form>;
}

export function costWithIdr(cost: string, amount: number | null | undefined, fx: number | null | undefined) {
  if (amount == null || !(Number(fx) > 0)) return cost;
  return `${cost} ≈ ${formatRupiah(Math.round(amount * Number(fx)))}`;
}

export function StatusBadges({ archived, parentInactive }: { archived?: boolean; parentInactive?: boolean }) {
  return <>
    {archived && <Badge variant="secondary">Arsip</Badge>}
    {!archived && parentInactive && <Badge variant="warning">Induk nonaktif</Badge>}
  </>;
}
