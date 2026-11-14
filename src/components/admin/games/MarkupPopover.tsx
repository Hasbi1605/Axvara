"use client";
import { useState } from "react";
import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger } from "@/components/admin/ui";
import { fixedValid, markupValid, type Item } from "./shared";

export function MarkupPopover({ item, busy, onSave }: { item: Item; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false), [percent, setPercent] = useState(""), [fixed, setFixed] = useState(""), [error, setError] = useState("");
  async function save(reset = false) {
    if (!reset && (!markupValid(percent, true) || !fixedValid(fixed))) { setError("Markup harus 0–100% (maksimal 2 desimal), Rp tetap 0–1.000.000 (bilangan bulat)."); return; }
    if (await onSave({ buyer_sku_code: item.buyer_sku_code, markup_percent: reset || percent.trim() === "" ? null : Number(percent), markup_fixed: reset || fixed.trim() === "" ? null : Number(fixed) })) setOpen(false);
    else setError("Markup belum tersimpan. Periksa koneksi lalu coba lagi.");
  }
  return <Popover open={open} onOpenChange={value => { if (!busy) { setOpen(value); setPercent(item.markup_percent == null ? "" : String(item.markup_percent)); setFixed(String(item.markup_fixed ?? 0)); setError(""); } }}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label={`Atur markup ${item.buyer_sku_code}`}>Atur markup</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]"><form className="space-y-4" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <p className="text-sm font-semibold">Markup varian</p>
      <Label className="grid gap-2">Markup khusus %<Input value={percent} inputMode="decimal" placeholder="Ikut game / default" onChange={e => setPercent(e.target.value)} /></Label>
      <Label className="grid gap-2">Rp tetap<Input value={fixed} inputMode="numeric" onChange={e => setFixed(e.target.value)} /></Label>
      <p className="text-xs text-admin-muted">Kosongkan persen untuk mengikuti markup game atau default.</p>
      {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>Simpan</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Reset ke default</Button></div>
    </form></PopoverContent>
  </Popover>;
}
