"use client";

import { useEffect, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { PEDIA_PLATFORM_CONFIG } from "@/lib/pedia/platforms";
import { isPediaPremiumToolCandidate } from "@/lib/pedia/sales-policy";
import { Button, Checkbox, Input, Label, NativeSelect } from "@/components/admin/ui";
import { PediaCurationPanel } from "../PediaCurationPanel";
import { Field, Panel, Feedback, DataTable, Pagination, HealthLine, usePanel, type Catalog, type Row } from "./shared";

export function ServicesPanel({ catalog, compare, onCompare, onAssigned }: { catalog: Catalog; compare: boolean; onCompare: (compare: boolean) => void; onAssigned: (id: number) => Promise<void> }) {
  const [q, setQ] = useState(""), [search, setSearch] = useState(""), [platform, setPlatform] = useState(""), [page, setPage] = useState(1), [mapping, setMapping] = useState(""), [indonesia, setIndonesia] = useState(false), [refill, setRefill] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [productId, setProductId] = useState("");
  useEffect(() => { if (q === search) return; const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q, search]);
  const params = new URLSearchParams({ q: search, platform, supplier: "indosmm", compatible: "0", mapping, page: String(page), indonesia: indonesia ? "1" : "0", garansi: refill ? "1" : "0" });
  const panel = usePanel<{ rows: Row[]; total: number; diff: Record<string, string> }>(`/api/admin/pedia/services?${params}`, { rows: [], total: 0, diff: {} });
  const rows = panel.data.rows;
  const select = (r: Row) => <Button variant="link" size="sm" className="h-auto px-0 text-xs" disabled={panel.busy || panel.loading || r.supplier !== "indosmm" || isPediaPremiumToolCandidate(r.name, r.category) || Number(r.present) !== 1 || r.type !== "Default" || Number(r.rate_idr_per_1k) <= 0} onClick={() => setSelected(Number(r.service_id))} aria-label={`Tambahkan layanan ${r.service_id} ke produk`}>Tambahkan ke produk</Button>;
  const used = (r: Row) => {
    const products = catalog.products.filter(p => catalog.tiers.some(t => t.product_id === p.id && t.supplier_service_id === Number(r.service_id)));
    return products.length ? <div className="flex flex-wrap gap-x-2">{products.map(p => <Button key={p.id} variant="link" size="sm" className="h-auto px-0 text-left text-xs" onClick={() => void onAssigned(p.id)}>{p.name}</Button>)}</div> : <span>{String(r.used_in || "Belum dipakai")}</span>;
  };
  return <Panel title="Layanan IndoSMM" description="Pilih layanan untuk produk atau bandingkan kandidat sesuai kebutuhan.">
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Tampilan layanan">
      <Button variant={!compare ? "secondary" : "outline"} size="sm" aria-pressed={!compare} onClick={() => onCompare(false)}>Semua layanan</Button>
      <Button variant={compare ? "secondary" : "outline"} size="sm" aria-pressed={compare} onClick={() => onCompare(true)}>Bandingkan per kebutuhan</Button>
    </div>
    {compare ? <PediaCurationPanel products={catalog.products} onCreated={onAssigned} /> : <>
      <Feedback panel={panel} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Field label="Cari layanan"><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Nama atau ID layanan" /></Field></div>
        <div className="w-[170px]"><Field label="Platform layanan"><NativeSelect value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }}><option value="">Semua platform</option>{PEDIA_PLATFORM_CONFIG.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</NativeSelect></Field></div>
        <div className="w-[170px]"><Field label="Pemakaian layanan"><NativeSelect value={mapping} onChange={e => { setMapping(e.target.value); setPage(1); }}><option value="">Semua layanan</option><option value="mapped">Sudah dipakai</option><option value="unmapped">Belum dipakai</option></NativeSelect></Field></div>
      </div>
      <div className="mb-3 flex flex-wrap gap-5 text-sm text-admin-muted">
        <div className="flex items-center gap-2"><Checkbox id="services-indonesia" checked={indonesia} onCheckedChange={value => { setIndonesia(value === true); setPage(1); }} /><Label htmlFor="services-indonesia" className="font-normal">Indonesia</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="services-refill" checked={refill} onCheckedChange={value => { setRefill(value === true); setPage(1); }} /><Label htmlFor="services-refill" className="font-normal">Refill disebut di nama</Label></div>
      </div>
      <p className="mb-4 text-xs text-admin-muted">{panel.data.total} layanan · Diperbarui {formatWibDateTime(panel.data.diff.pedia_indosmm_diff_last_at) ?? "belum tersedia"}</p>
      {selected !== null && <form aria-label="Hubungkan layanan" className="mb-4 space-y-3 rounded-md border border-admin-accent/30 bg-admin-accent/5 p-4" onSubmit={async e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const result = await panel.write("/api/admin/pedia/products", { kind: "tier", id: Number(f.get("tier_id")), supplier: "indosmm", supplier_service_id: selected, backup_service_id: null }, "Layanan utama diperbarui.");
        if (result && !result.saved) { setSelected(null); await onAssigned(Number(productId)); }
      }}>
        <h4 className="text-sm font-semibold text-admin-fg">Tambahkan IndoSMM #{selected} ke produk</h4>
        <p className="text-xs text-admin-muted">Layanan varian diganti, cadangan dihapus, dan harga dihitung ulang. Pesanan lama tidak berubah. Buat produk dan varian di tab Produk bila belum ada.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Produk tujuan"><NativeSelect required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Pilih produk</option>{catalog.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
          <Field label="Varian tujuan"><NativeSelect key={productId} name="tier_id" required defaultValue=""><option value="">Pilih varian</option>{catalog.tiers.filter(t => t.product_id === Number(productId)).map(t => <option key={t.id} value={t.id}>{t.public_name || t.tier}</option>)}</NativeSelect></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={panel.busy}>Hubungkan layanan</Button>
          <Button type="button" size="sm" variant="outline" disabled={panel.busy} onClick={() => setSelected(null)}>Batal</Button>
        </div>
      </form>}
      {!!rows.length && <>
        <div className="hidden md:block"><DataTable title="Layanan IndoSMM" columns={["Layanan", "Biaya / 1.000", "Min–maks / refill", "Dipakai di", "Aksi"]}>{rows.map(r => <tr key={String(r.service_id)}>
          <td><p className="line-clamp-2 font-medium text-admin-fg">{String(r.name)}</p><p className="my-1 text-xs text-admin-muted">#{String(r.service_id)} · {Number(r.present) === 1 ? "Tersedia" : "Tidak tersedia"}</p><HealthLine row={r} /></td>
          <td className="text-xs font-semibold text-admin-fg tabular-nums">{formatRupiah(Number(r.rate_idr_per_1k))}</td>
          <td className="text-xs">{String(r.min_qty)}–{String(r.max_qty)}<p className="mt-1 text-admin-muted">Refill API: {r.api_refill === 1 ? "Ya" : "Tidak"}</p></td>
          <td className="text-xs">{used(r)}</td>
          <td>{select(r)}</td>
        </tr>)}</DataTable></div>
        <div className="space-y-3 md:hidden" aria-label="Kartu layanan IndoSMM">{rows.map(r => <article key={String(r.service_id)} className="space-y-3 rounded-md border border-admin-border p-4">
          <div><h4 className="line-clamp-2 break-words text-sm font-medium text-admin-fg">{String(r.name)}</h4><p className="mt-1 text-xs text-admin-muted">IndoSMM #{String(r.service_id)}</p></div>
          <p className="text-xs text-admin-muted">{formatRupiah(Number(r.rate_idr_per_1k))} / 1.000 · {String(r.min_qty)}–{String(r.max_qty)} · Refill API: {r.api_refill === 1 ? "Ya" : "Tidak"}</p>
          <HealthLine row={r} />
          <div className="text-xs text-admin-muted">Dipakai di: {used(r)}</div>
          {select(r)}
        </article>)}</div>
      </>}
      {!panel.loading && !panel.error && !rows.length && <p className="py-6 text-sm text-admin-muted">Tidak ada layanan yang cocok dengan filter ini.</p>}
      <Pagination page={page} total={panel.data.total} size={50} loading={panel.loading} onPage={setPage} />
    </>}
  </Panel>;
}
