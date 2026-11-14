"use client";
import { useState } from "react";
import { Button, Card, Input, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAdminDraft } from "../AdminWorkspace";
import { computeGamesMarkupPrice } from "@/lib/games/pricing";
import { formatRupiah } from "@/lib/utils";
import { markupValid, type Pricing } from "./shared";

export function PricingPanel({ pricing, count, busy, onSave }: { pricing: Pricing; count: number; busy: boolean; onSave: (body: Pricing) => Promise<boolean> }) {
  const [percent, setPercent] = useState(String(pricing.markup_percent)), [rounding, setRounding] = useState(pricing.rounding), [confirm, setConfirm] = useState(false), [error, setError] = useState("");
  const valid = markupValid(percent), dirty = percent !== String(pricing.markup_percent) || rounding !== pricing.rounding;
  useAdminDraft(dirty || busy, busy);
  return <Card className="max-w-3xl p-4 sm:p-6"><form noValidate className="space-y-6" onSubmit={e => { e.preventDefault(); if (valid) { setError(""); setConfirm(true); } else setError("Markup harus 0–100%, maksimal 2 desimal."); }}>
    <div className="grid gap-4 sm:grid-cols-2"><Label className="grid gap-2">Markup default %<Input aria-label="Markup default %" inputMode="decimal" value={percent} disabled={busy} onChange={e => setPercent(e.target.value)} /><span className="text-xs text-admin-muted">Dipakai bila game atau varian tidak memiliki markup khusus.</span></Label>
      <Label className="grid content-start gap-2">Pembulatan harga<NativeSelect value={rounding} disabled={busy} onChange={e => setRounding(Number(e.target.value) as Pricing["rounding"])}>{([1, 100, 500, 1000] as const).map(value => <option key={value} value={value}>{formatRupiah(value)}</option>)}</NativeSelect></Label></div>
    {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
    <div><p className="mb-2 text-sm font-medium">Pratinjau harga</p><Table aria-label="Pratinjau harga"><TableHeader><TableRow><TableHead>Modal</TableHead><TableHead className="text-right">Harga jual</TableHead></TableRow></TableHeader><TableBody>{[1502, 50000, 321115].map(cost => <TableRow key={cost}><TableCell className="tabular-nums">{formatRupiah(cost)}</TableCell><TableCell className="text-right tabular-nums">{valid ? formatRupiah(computeGamesMarkupPrice({ cost, markupPercent: Number(percent), rounding })) : "—"}</TableCell></TableRow>)}</TableBody></Table></div>
    <p className="text-xs text-admin-muted">Markup varian dan game tetap dipertahankan saat semua harga dihitung ulang.</p>
    <Button type="submit" disabled={busy}>Simpan &amp; hitung ulang</Button>
  </form><ConfirmDialog open={confirm} title="Hitung ulang harga Games?" description={`${count} varian akan dihitung ulang dengan pengaturan baru. Markup khusus tetap dipertahankan.`} variant="default" confirmLabel="Simpan & hitung ulang" loading={busy} onClose={() => setConfirm(false)} onConfirm={() => void onSave({ markup_percent: Number(percent), rounding }).then(ok => { setConfirm(false); if (!ok) setError("Harga belum tersimpan. Coba lagi."); })} /></Card>;
}
