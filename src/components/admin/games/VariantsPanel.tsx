"use client";
import { useState } from "react";
import { Badge, Button, Card, Checkbox, Label, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { GAMES_CATEGORY_SECTIONS, gamesAutoCategory, gamesCategoryLabel } from "@/lib/games/variant-kind";
import { formatRupiah } from "@/lib/utils";
import { AdminStatusSwitch } from "../AdminStatusSwitch";
import { BulkMarkupToolbar } from "../BulkMarkupToolbar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MarkupPopover } from "./MarkupPopover";
import type { Item } from "./shared";

const SOURCE = { global: "Default", game: "Game", variant: "Varian" };
const REASONS: Record<string, string> = { admin_disabled: "Dinonaktifkan admin", stock_empty: "Stok habis", no_price: "Harga belum tersedia", min_order: "Minimum pembelian lebih dari satu", invalid_contract: "Data akun belum didukung", open_denom: "Nominal terbuka belum didukung", order_process: "Proses belum didukung" };
export function plainSupplierDescription(value: string | null | undefined): string {
  return String(value ?? "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
}

export function VariantsPanel({ items, total, busy, onPatch, onBulk }: { items: Item[]; total: number; busy: boolean; onPatch: (body: Record<string, unknown>) => Promise<boolean>; onBulk: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()), [category, setCategory] = useState(""), [confirm, setConfirm] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null), [categoryConfirm, setCategoryConfirm] = useState(false), [bulkError, setBulkError] = useState("");
  const ids = items.map(item => item.buyer_sku_code);
  const toggle = (id: string) => setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  function categorySelect(item: Item) {
    const automatic = gamesCategoryLabel(gamesAutoCategory({ productName: item.product_name, productTypeName: item.product_type_name }));
    return <NativeSelect className="w-full text-xs" aria-label={`Kategori ${item.buyer_sku_code}`} value={item.display_group ?? ""} disabled={busy} onChange={e => void onPatch({ buyer_sku_code: item.buyer_sku_code, display_group: e.target.value || null })}>
      <option value="">Otomatis ({automatic})</option>{GAMES_CATEGORY_SECTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
    </NativeSelect>;
  }
  function status(item: Item) {
    if (item.supplier_active !== 1) return <Badge variant="secondary">Supplier nonaktif</Badge>;
    return <><Badge variant={item.sellable ? "success" : "secondary"}>{item.sellable ? "Bisa dijual" : "Belum bisa dijual"}</Badge>{!item.sellable && <p className="mt-1 text-xs text-admin-muted">{REASONS[item.availability.reason ?? ""] ?? "Periksa data varian"}</p>}</>;
  }
  function active(item: Item) {
    const canEnable = item.supplier_active === 1 && item.cost > 0 && item.contract_supported;
    return <div title={item.enabled !== 1 && !canEnable ? "Belum bisa diaktifkan: supplier nonaktif, modal kosong, atau kontrak belum didukung." : undefined}><AdminStatusSwitch checked={item.enabled === 1} label={`${item.enabled === 1 ? "Nonaktifkan" : "Aktifkan"} ${item.buyer_sku_code}`} disabled={busy || (item.enabled !== 1 && !canEnable)} onChange={() => void onPatch({ buyer_sku_code: item.buyer_sku_code, enabled: item.enabled !== 1 })} />{item.enabled !== 1 && !canEnable && <p className="mt-1 text-xs text-admin-muted md:hidden">Belum bisa diaktifkan: supplier nonaktif, modal kosong, atau kontrak belum didukung.</p>}</div>;
  }
  const markup = (item: Item) => <div className="space-y-1"><p className="whitespace-nowrap tabular-nums">{item.effective_markup_percent} %{item.markup_fixed > 0 && ` +${formatRupiah(item.markup_fixed)}`}</p><Badge variant="secondary">{SOURCE[item.markup_source] ?? "Default"}</Badge></div>;
  const select = (item: Item) => <Checkbox aria-label={`Pilih ${item.buyer_sku_code}`} checked={selected.has(item.buyer_sku_code)} disabled={busy} onCheckedChange={() => toggle(item.buyer_sku_code)} />;
  const action = (item: Item) => <MarkupPopover item={item} busy={busy} onSave={onPatch} />;
  return <div className="space-y-4">
    <BulkMarkupToolbar visibleIds={ids} totalCount={total} selected={selected} onToggleOne={toggle} onToggleAllVisible={checked => setSelected(checked ? new Set(ids) : new Set())} onClear={() => setSelected(new Set())} presets={[3, 5, 8, 10]} maxPercent={100} disabled={busy}
      confirmApply={message => new Promise(resolve => setConfirm({ message, resolve }))} onError={error => setBulkError(error instanceof Error ? error.message : "Markup belum tersimpan.")}
      onApply={async ({ variantIds, percent, resetFixed }) => {
        setBulkError("");
        if (!await onBulk({ skus: variantIds, markup_percent: percent, ...(resetFixed ? { markup_fixed: 0 } : {}) })) throw new Error("Markup belum tersimpan. Coba lagi.");
      }} />
    {bulkError && <p role="alert" className="text-sm text-admin-danger">{bulkError}</p>}
    <div className="flex flex-wrap items-end gap-3"><Label className="grid w-full gap-2 sm:w-72">Kategori pilihan<NativeSelect aria-label="Kategori pilihan" value={category} disabled={busy} onChange={e => setCategory(e.target.value)}><option value="">Otomatis</option>{GAMES_CATEGORY_SECTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Label><Button variant="outline" disabled={busy || !selected.size} onClick={() => setCategoryConfirm(true)}>Set kategori ({selected.size})</Button>{selected.size > 0 && <Button variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>Batal pilihan</Button>}</div>
    <Card className="overflow-hidden">
      <div className="divide-y divide-admin-border md:hidden" aria-label="Kartu varian game">{items.map(item => <article key={item.buyer_sku_code} className="space-y-4 p-4">
        <div className="flex items-start gap-3">{select(item)}<div className="min-w-0 flex-1"><p className="break-words font-medium">{item.product_name}</p><p className="mt-1 text-xs text-admin-muted">{item.sk_product_name || item.game_brand} · {item.buyer_sku_code}</p></div></div>
        <div>{status(item)}</div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-admin-muted">Modal</dt><dd className="tabular-nums">{item.cost > 0 ? formatRupiah(item.cost) : "Belum tersedia"}</dd></div><div><dt className="text-xs text-admin-muted">Harga jual</dt><dd className="tabular-nums">{item.sell_price > 0 ? formatRupiah(item.sell_price) : "Belum dihitung"}</dd></div><div><dt className="text-xs text-admin-muted">Markup</dt><dd>{markup(item)}</dd></div><div><dt className="text-xs text-admin-muted">Margin</dt><dd className="tabular-nums">{item.cost > 0 && item.sell_price > 0 ? formatRupiah(item.sell_price - item.cost) : "—"}</dd></div></dl>
        <p className="text-xs text-admin-muted">Stok: {item.unlimited_stock === 1 || item.stock < 0 ? "Tak terbatas" : item.stock} · minimum {item.min_order}</p>
        <Label className="grid gap-2">Kategori{categorySelect(item)}</Label><div className="flex flex-wrap items-center justify-between gap-3">{action(item)}{active(item)}</div>{plainSupplierDescription(item.description) && <p className="text-xs text-admin-muted">{plainSupplierDescription(item.description)}</p>}
      </article>)}</div>
      <div className="hidden overflow-x-auto md:block [&>div]:overflow-visible" role="region" aria-label="Tabel varian game" tabIndex={0}><Table><caption className="sr-only">Varian game, modal, markup, harga jual, margin, kategori, dan status</caption><TableHeader><TableRow>{["Pilih", "Varian", "Stok", "Status", "Modal", "Markup", "Harga jual", "Margin", "Kategori", "Aktif", "Aksi"].map(label => <TableHead key={label} className="whitespace-nowrap">{label}</TableHead>)}</TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.buyer_sku_code}>
        <TableCell>{select(item)}</TableCell><TableCell className="w-64"><p className="w-48 break-words font-medium">{item.product_name}</p><p className="mt-1 text-xs text-admin-muted">{item.sk_product_name || item.game_brand} · {item.buyer_sku_code}</p>{plainSupplierDescription(item.description) && <p className="mt-1 line-clamp-2 text-xs text-admin-muted">{plainSupplierDescription(item.description)}</p>}</TableCell>
        <TableCell className="text-xs tabular-nums">{item.unlimited_stock === 1 || item.stock < 0 ? "Tak terbatas" : item.stock}<p className="text-admin-muted">min. {item.min_order}</p></TableCell><TableCell>{status(item)}</TableCell><TableCell className="whitespace-nowrap tabular-nums">{item.cost > 0 ? formatRupiah(item.cost) : "Belum tersedia"}</TableCell><TableCell>{markup(item)}</TableCell><TableCell className="whitespace-nowrap tabular-nums">{item.sell_price > 0 ? formatRupiah(item.sell_price) : "Belum dihitung"}</TableCell><TableCell className="whitespace-nowrap tabular-nums">{item.cost > 0 && item.sell_price > 0 ? formatRupiah(item.sell_price - item.cost) : "—"}</TableCell><TableCell><div className="w-72">{categorySelect(item)}</div></TableCell><TableCell>{active(item)}</TableCell><TableCell>{action(item)}</TableCell>
      </TableRow>)}</TableBody></Table></div>
      {!items.length && <p className="p-8 text-center text-sm text-admin-muted">Belum ada varian yang cocok. Coba ubah filter.</p>}
    </Card>
    <ConfirmDialog open={!!confirm} title="Terapkan markup pilihan?" description={confirm?.message ?? ""} variant="default" confirmLabel="Terapkan markup" onClose={() => { confirm?.resolve(false); setConfirm(null); }} onConfirm={() => { confirm?.resolve(true); setConfirm(null); }} />
    <ConfirmDialog open={categoryConfirm} title="Set kategori pilihan?" description={`${selected.size} varian akan memakai ${category ? GAMES_CATEGORY_SECTIONS.find(section => section.key === category)?.label : "kategori otomatis"}.`} variant="default" confirmLabel="Set kategori" loading={busy} onClose={() => setCategoryConfirm(false)} onConfirm={() => void onBulk({ skus: [...selected], display_group: category || null }).then(ok => { setCategoryConfirm(false); if (ok) setSelected(new Set()); })} />
  </div>;
}
