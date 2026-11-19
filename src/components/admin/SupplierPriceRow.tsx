"use client";
// Baris harga varian supplier — satu varian satu baris.
// Mendukung dua mode:
// - "manual" (AIVault/TUNVN/StoreBat/Mirai): Markup % + Harga manual (Rp) + saklar Aktif.
// - "fixed" (WR/SK): Markup % (0..500 int) + Markup nominal (Rp) tanpa saklar Aktif.
// Simpan eksplisit per baris: tombol hanya aktif bila ada perubahan, draf
// tidak hilang saat baris lain disimpan (sinkron ulang hanya bila nilai server
// baris ini berubah) dan tidak ada simpanan yang dibuang diam-diam.
import { useEffect, useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Checkbox, Input } from "./ui";
import { AdminStatusSwitch } from "./AdminStatusSwitch";

export type SupplierPriceSave = { markup_percent?: number; admin_price_idr?: number | null; markup_fixed?: number };

/** Header kolom untuk daftar baris (desktop saja). */
export function SupplierPriceHeader({ mode = "manual", selectable = false }: { mode?: "manual" | "fixed"; selectable?: boolean }) {
  const grid = mode === "fixed"
    ? selectable
      ? "md:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem]"
      : "md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem]"
    : selectable
      ? "md:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem]"
      : "md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem]";
  return <div aria-hidden="true" className={`hidden gap-3 px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-admin-muted md:grid md:items-end ${grid}`}>
    {selectable && <span />}
    <span>Varian</span>
    <span>Markup %</span>
    <span>{mode === "fixed" ? "Markup nominal" : "Harga manual"}</span>
    <span className="text-right">Harga jual</span>
    <span />
    {mode === "manual" && <span className="text-right">Aktif</span>}
  </div>;
}

export function SupplierPriceRow({
  id, title, meta, badges, markup, manual = null, fixed = 0, price, active = true,
  canEdit, locked, busy, notice, details, mode = "manual",
  selectable = false, selected = false, selectLabel, onSelectChange, onToggle, onSave,
}: {
  id: string; title: ReactNode; meta: ReactNode; badges?: ReactNode;
  markup: number; manual?: number | null; fixed?: number; price: number | null; active?: boolean;
  canEdit: boolean; locked: boolean; busy: boolean; notice?: ReactNode; details?: ReactNode;
  mode?: "manual" | "fixed";
  selectable?: boolean; selected?: boolean; selectLabel?: string; onSelectChange?: (checked: boolean) => void;
  onToggle?: () => void; onSave: (body: SupplierPriceSave) => Promise<void>;
}) {
  const isFixed = mode === "fixed";
  const initialSecondary = isFixed ? String(fixed) : (manual == null ? "" : String(manual));
  const [markupDraft, setMarkupDraft] = useState(String(markup));
  const [secondaryDraft, setSecondaryDraft] = useState(initialSecondary);
  const [error, setError] = useState("");
  // Hanya nilai server baris ini yang memicu reset draf.
  useEffect(() => { setMarkupDraft(String(markup)); setError(""); }, [markup]);
  useEffect(() => { setSecondaryDraft(isFixed ? String(fixed) : (manual == null ? "" : String(manual))); setError(""); }, [fixed, isFixed, manual]);

  const markupChanged = markupDraft.trim() !== String(markup);
  const secondaryChanged = secondaryDraft.trim() !== (isFixed ? String(fixed) : (manual == null ? "" : String(manual)));
  const dirty = markupChanged || secondaryChanged;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || locked || !canEdit) return;
    if (isFixed) {
      const pct = Number(markupDraft);
      const fix = Number(secondaryDraft);
      if (markupDraft.trim() === "" || !Number.isInteger(pct) || pct < 0 || pct > 500) {
        setError("Markup harus bilangan bulat 0–500%.");
        return;
      }
      if (secondaryDraft.trim() === "" || !Number.isInteger(fix) || fix < 0) {
        setError("Markup nominal harus bilangan bulat ≥ 0.");
        return;
      }
      setError("");
      void onSave({ markup_percent: pct, markup_fixed: fix });
      return;
    }
    const body: SupplierPriceSave = {};
    if (markupChanged) {
      const value = Number(markupDraft);
      if (markupDraft.trim() === "" || !Number.isFinite(value) || value < 0 || value > 1000) { setError("Markup harus 0–1000%."); return; }
      body.markup_percent = value;
    }
    if (secondaryChanged) {
      const raw = secondaryDraft.trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isInteger(value) || value < 1)) { setError("Harga manual harus bilangan bulat ≥ 1, atau kosong untuk rumus."); return; }
      body.admin_price_idr = value;
    }
    setError("");
    void onSave(body);
  }

  const titleText = typeof title === "string" ? title : id;
  const checkboxLabel = selectLabel || titleText;
  const inputDisabled = !canEdit || locked;
  const grid = isFixed
    ? selectable
      ? "md:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem]"
      : "md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem]"
    : selectable
      ? "md:grid-cols-[1.5rem_minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem]"
      : "md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_7.5rem_4.75rem_2.75rem]";

  return <form noValidate onSubmit={submit} aria-label={typeof title === "string" ? `Harga ${title}` : undefined}
    className={`grid gap-3 rounded-lg border border-admin-border bg-admin-subtle/40 p-3 md:items-center ${grid}`}>
    <div className="flex min-w-0 items-start gap-2.5 md:contents">
      {selectable && <div className="pt-0.5 md:pt-0">
        <Checkbox checked={selected} disabled={locked}
          onCheckedChange={checked => onSelectChange?.(checked === true)}
          aria-label={`Pilih ${checkboxLabel} untuk bulk markup`} />
      </div>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="min-w-0 break-words font-medium text-admin-fg">{title}</p>
          {badges}
        </div>
        <p className="mt-0.5 break-words text-xs text-admin-muted">{meta}</p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 md:contents">
      <label className="space-y-1 text-xs text-admin-muted md:space-y-0">
        <span className="md:sr-only">Markup %</span>
        <Input id={`${id}-markup`} type="number" min={0} max={isFixed ? 500 : 1000} step={isFixed ? 1 : "0.5"} inputMode={isFixed ? "numeric" : "decimal"} className="h-9 tabular-nums"
          value={markupDraft} disabled={inputDisabled} onChange={e => setMarkupDraft(e.target.value)} />
      </label>
      <label className="space-y-1 text-xs text-admin-muted md:space-y-0">
        <span className="md:sr-only">{isFixed ? "Markup nominal (Rp)" : "Harga manual (Rp)"}</span>
        <Input id={`${id}-secondary`} type="number" min={0} step={isFixed ? 500 : 100} inputMode="numeric" placeholder={isFixed ? "0" : "Rumus"} className="h-9 tabular-nums"
          value={secondaryDraft} disabled={inputDisabled} onChange={e => setSecondaryDraft(e.target.value)} />
      </label>
    </div>
    <div className="flex items-center gap-3 md:contents">
      <div className="mr-auto md:mr-0 md:text-right">
        <p className="font-semibold tabular-nums text-admin-fg"><span className="sr-only">Harga jual </span>{price != null ? formatRupiah(price) : "—"}</p>
        {price != null && <p className="text-[11px] text-admin-muted">
          {isFixed ? (fixed > 0 ? `+${formatRupiah(fixed)}` : "kelipatan Rp500") : (manual != null ? "manual" : "rumus")}
        </p>}
      </div>
      <Button type="submit" size="sm" className="min-h-11 md:min-h-0" variant={dirty ? "default" : "outline"} disabled={!dirty || inputDisabled}>{busy ? "Menyimpan…" : "Simpan"}</Button>
      {!isFixed && onToggle && <div className="flex justify-end"><AdminStatusSwitch checked={active} label={`Aktif ${titleText}`} disabled={!canEdit || locked} busy={busy} onChange={onToggle} /></div>}
    </div>
    {details && <div className="min-w-0 md:col-span-full">{details}</div>}
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
