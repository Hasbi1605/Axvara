"use client";

import { useState } from "react";
import { aivaultSellPrice } from "@/lib/aivault/families";
import { formatRupiah } from "@/lib/utils";
import { supplierMoney, type CatalogItem, type MarkupTier } from "./supplier-admin-data";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Switch } from "./ui";

const emptyTier = () => ({ qty: "", markup: "" });

export function BulkMarkupDialog({ item, busy, failure, trigger, onClose, onSave }: {
  item: CatalogItem; busy: boolean; failure: string;
  trigger: HTMLButtonElement; onClose: () => void; onSave: (tiers: MarkupTier[] | null) => Promise<boolean>;
}) {
  const [enabled, setEnabled] = useState(!!item.bulk_markup_tiers?.length);
  const [rows, setRows] = useState(() => item.bulk_markup_tiers?.map(t => ({ qty: String(t.min_qty), markup: String(t.markup_percent) })) ?? [emptyTier()]);
  const tiers = rows.map(r => ({ min_qty: Number(r.qty), markup_percent: Number(r.markup) }));
  const price = (markup: number) => {
    try { return aivaultSellPrice(Number(item.cost), Number(item.fx), markup); }
    catch { return null; }
  };
  const base = item.variant_price ?? item.manual ?? price(item.markup_percent);
  let error = "";
  if (enabled) {
    if (rows.length < 1 || rows.length > 5) error = "Isi 1–5 tier harga grosir.";
    else if (rows.some((r, i) => !r.qty.trim() || !Number.isInteger(tiers[i].min_qty) || tiers[i].min_qty < 2 || tiers[i].min_qty > 100 || (i > 0 && tiers[i].min_qty <= tiers[i - 1].min_qty))) error = "Min. qty harus bilangan bulat 2–100 dan meningkat pada setiap tier.";
    else if (rows.some((r, i) => !r.markup.trim() || !Number.isFinite(tiers[i].markup_percent) || tiers[i].markup_percent < 0 || tiers[i].markup_percent > 1000 || (i > 0 && tiers[i].markup_percent >= tiers[i - 1].markup_percent))) error = "Markup harus 0–1000% dan menurun pada setiap tier.";
    else if (item.manual == null && tiers.some(t => t.markup_percent >= item.markup_percent)) error = "Markup tier harus lebih kecil dari markup dasar.";
    else if (tiers.some(t => price(t.markup_percent) == null)) error = "Modal atau kurs belum tersedia untuk menghitung harga grosir.";
  }

  function updateRow(index: number, field: "qty" | "markup", value: string) {
    setRows(previous => previous.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={event => { event.preventDefault(); trigger.focus(); }}>
      <DialogHeader>
        <DialogTitle>Harga grosir — {item.label}</DialogTitle>
        <DialogDescription>Harga dasar {base == null ? "—" : formatRupiah(base)} (markup {item.markup_percent}%) · modal {supplierMoney("USD", item.cost)} dikali kurs {item.fx?.toLocaleString("id-ID") ?? "—"}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2 text-sm">
        <Switch id="aivault-bulk-enabled" checked={enabled} disabled={busy} onCheckedChange={checked => { setEnabled(checked); if (!rows.length) setRows([emptyTier()]); }} />
        <Label htmlFor="aivault-bulk-enabled">Aktifkan harga grosir</Label>
      </div>
      {enabled && <div className="space-y-3">
        {rows.map((row, i) => {
          const preview = row.markup.trim() ? price(Number(row.markup)) : null;
          return <div key={i} className="space-y-2 rounded-lg border border-admin-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="min-w-0 space-y-1 text-xs">Min. qty<Input aria-label={`Min. qty tier ${i + 1}`} type="number" inputMode="numeric" min={2} max={100} step={1} value={row.qty} disabled={busy} onChange={event => updateRow(i, "qty", event.target.value)} /></label>
              <label className="min-w-0 space-y-1 text-xs">Markup %<Input aria-label={`Markup % tier ${i + 1}`} type="number" inputMode="decimal" min={0} max={1000} step="any" value={row.markup} disabled={busy} onChange={event => updateRow(i, "markup", event.target.value)} /></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-xs text-admin-muted">{preview == null ? "Isi markup untuk melihat harga." : `${formatRupiah(preview)}${base && preview < base ? ` · hemat ${Math.round((1 - preview / base) * 100)}%` : ""}`}</p>
              <Button type="button" variant="outline" size="sm" aria-label={`Hapus tier ${i + 1}`} disabled={busy} onClick={() => setRows(current => current.filter((_, n) => n !== i))}>Hapus</Button>
            </div>
          </div>;
        })}
        <Button type="button" variant="outline" size="sm" disabled={busy || rows.length >= 5} onClick={() => setRows(current => [...current, emptyTier()])}>Tambah tier</Button>
      </div>}
      <p className="text-xs leading-5 text-admin-muted">Harga grosir dihitung dari modal dikali kurs dikali (1 + markup tier) dan ikut naik bila modal/kurs naik. Pembelian maks. 100 unit per item.</p>
      {(error || failure) && <p role="alert" className="text-sm text-admin-danger">{error || failure}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>Batal</Button>
        <Button disabled={busy || !!error} onClick={async () => { if (await onSave(enabled ? tiers : null)) onClose(); }}>Simpan harga grosir</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
