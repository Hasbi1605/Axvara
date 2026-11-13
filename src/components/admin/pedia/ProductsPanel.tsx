"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { PEDIA_PLATFORM_CONFIG } from "@/lib/pedia/platforms";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect } from "@/components/admin/ui";
import { AdminStatusSwitch } from "../AdminStatusSwitch";
import { ProductEditor } from "./ProductEditor";
import { Field, Panel, Feedback, DataTable, Pagination, productStatus, parse, usablePackages, type Catalog, type PanelState, type Product } from "./shared";

export function ProductsPanel({ catalog, editing, onEdit, onBrowse }: { catalog: PanelState<Catalog>; editing: number | null; onEdit: (id: number | null) => void; onBrowse: () => void }) {
  const [query, setQuery] = useState(""), [platform, setPlatform] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(1), [creating, setCreating] = useState(false);
  const product = catalog.data.products.find(p => p.id === editing);
  const tiersFor = (id: number) => catalog.data.tiers.filter(t => t.product_id === id);
  const filtered = catalog.data.products.filter(p => {
    const tiers = tiersFor(p.id), state = productStatus(p, tiers);
    return (!platform || platform === p.platform) && (!status || (status === "attention" ? !!p.is_active && state.label !== "Siap dijual" : state.label === status)) && `${p.name} ${p.slug} ${tiers.map(t => t.supplier_service_id).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const actions = (p: Product) => <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Aksi ${p.name}`}>
    <AdminStatusSwitch checked={!!p.is_active} label={`${p.is_active ? "Nonaktifkan" : "Aktifkan"} ${p.name}`} describedBy={`product-status-${p.id}`} disabled={catalog.busy || catalog.loading} busy={catalog.busy} onChange={() => void catalog.write("/api/admin/pedia/products", { id: p.id, is_active: p.is_active ? 0 : 1 }, `${p.name} ${p.is_active ? "dinonaktifkan" : "diaktifkan"}.`)} />
    <Button size="sm" onClick={() => onEdit(p.id)} aria-label={`Edit ${p.name}`}>Edit</Button>
  </div>;
  const rows = filtered.slice((page - 1) * 50, page * 50).map(p => {
    const tiers = tiersFor(p.id), state = productStatus(p, tiers), prices = tiers.filter(t => t.is_active).flatMap(t => usablePackages(p, t).map(qty => Number(parse<Record<string, number>>(t.package_prices_json, {})[qty])));
    return { p, state, variants: `${tiers.filter(t => t.is_active).length} aktif / ${tiers.length}`, price: prices.length ? formatRupiah(Math.min(...prices)) : "Belum ada harga" };
  });
  return <Panel title={product ? `Edit ${product.name}` : creating ? "Buat produk" : "Produk"} description={product || creating ? "Simpan informasi produk dan setiap varian secara terpisah." : "Kelola produk, varian, harga, dan kesiapan penjualan."}>
    <Feedback panel={catalog} />
    {(creating || product) ? <>
      <Button variant="outline" size="sm" className="my-3" disabled={catalog.busy} onClick={() => { setCreating(false); onEdit(null); }}>Kembali ke daftar</Button>
      <ProductEditor key={product?.id ?? "new"} product={product ?? { id: 0, slug: "", platform: "instagram", metric: "followers", target_kind: "profile", name: "", tagline: "", packages_json: "[100,250,500,1000]", step: 1, sort_order: 0, is_active: 0, is_featured: 0 }} tiers={product ? tiersFor(product.id) : []} busy={catalog.busy} onError={catalog.setError} onBrowse={() => { setCreating(false); onBrowse(); }} onSave={async (body, message) => {
        if (!creating) return catalog.write("/api/admin/pedia/products", body, message);
        const { id: _id, ...fields } = body; void _id;
        const result = await catalog.write("/api/admin/pedia/products", { ...fields, is_active: 0, is_featured: 0 }, message, "POST");
        if (result?.id) { setCreating(false); onEdit(Number(result.id)); } return result;
      }} onCreateTier={body => catalog.write("/api/admin/pedia/products", body, "Varian dibuat. Periksa harga sebelum aktivasi.", "POST")} />
    </> : <>
      <Card className="my-4">
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Filter</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_150px_170px_auto]">
          <Field label="Cari produk"><Input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Nama, slug, atau ID layanan" /></Field>
          <Field label="Platform"><NativeSelect value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }}><option value="">Semua platform</option>{PEDIA_PLATFORM_CONFIG.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</NativeSelect></Field>
          <Field label="Status produk"><NativeSelect value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Semua status</option><option>Siap dijual</option><option value="attention">Perlu perhatian</option><option>Nonaktif</option></NativeSelect></Field>
          <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
            <Button disabled={catalog.busy} onClick={() => setCreating(true)} className="w-full xl:w-auto">Buat produk</Button>
          </div>
          {(query || platform || status) && <div className="sm:col-span-2 xl:col-span-4">
            <Button variant="outline" size="sm" onClick={() => { setQuery(""); setPlatform(""); setStatus(""); setPage(1); }}>Hapus filter</Button>
          </div>}
        </CardContent>
      </Card>
      {!catalog.loading && !catalog.error && !catalog.data.products.length && <div className="space-y-3"><p className="text-sm text-admin-muted">Belum ada produk. Mulai dengan produk nonaktif atau kurasi awal.</p><Button disabled={catalog.busy} onClick={() => void catalog.write("/api/admin/pedia/products", { action: "seed" }, "Kurasi awal dimuat.", "POST")}>Muat kurasi awal</Button></div>}
      {!catalog.loading && !catalog.error && !!catalog.data.products.length && !filtered.length && <p className="py-6 text-sm text-admin-muted">Tidak ada produk yang cocok dengan filter.</p>}
      {!!rows.length && <>
        <div className="hidden md:block"><DataTable title="Produk Pedia" columns={["Produk", "Varian", "Harga mulai", "Status", "Aksi"]}>{rows.map(({ p, state, variants, price }) => <tr key={p.id}>
          <td><p className="font-semibold text-admin-fg">{p.name}</p><p className="mt-1 break-all text-xs text-admin-muted">/{p.slug}</p><p className="mt-2 flex items-center gap-2 text-xs capitalize text-admin-muted"><PlatformIcon id={p.platform} size={16} />{p.platform}</p></td>
          <td className="text-xs">{variants}</td>
          <td className="text-xs font-semibold text-admin-fg">{price}</td>
          <td><div id={`product-status-${p.id}`}><Badge variant={state.variant}>{state.label}</Badge>{state.reason && <p className="mt-1 text-xs leading-5 text-admin-muted">{state.reason}</p>}</div></td>
          <td>{actions(p)}</td>
        </tr>)}</DataTable></div>
        <div className="space-y-3 md:hidden" aria-label="Kartu produk Pedia">{rows.map(({ p, state, variants, price }) => <article key={p.id} className="space-y-3 rounded-md border border-admin-border p-4">
          <div><h4 className="break-words text-sm font-semibold text-admin-fg">{p.name}</h4><p className="mt-1 break-all text-xs text-admin-muted">/{p.slug} · {p.platform}</p></div>
          <div className="flex justify-between gap-3 text-xs text-admin-muted"><span>{variants}</span><strong className="text-admin-fg">{price}</strong></div>
          <div className="space-y-1"><Badge variant={state.variant}>{state.label}</Badge>{state.reason && <p className="text-xs text-admin-muted">{state.reason}</p>}</div>
          {actions(p)}
        </article>)}</div>
      </>}
      <Pagination page={page} total={filtered.length} size={50} loading={catalog.loading} onPage={setPage} />
    </>}
  </Panel>;
}
