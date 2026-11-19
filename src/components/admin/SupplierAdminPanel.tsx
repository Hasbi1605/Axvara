"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Zap } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { TUNVN_BUFF_MARKUP_PERCENT } from "@/lib/tunvn/pricing";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, PageHeader, StatCard, TabsContent } from "./ui";
import { SupplierTabs, type SupplierTabId } from "./SupplierTabs";
import { SupplierPriceHeader, SupplierPriceRow, StatusBadges, costWithIdr } from "./SupplierPriceRow";
import { BulkMarkupDialog } from "./BulkMarkupDialog";
import { SupplierOrderQueue, supplierOrderError } from "./SupplierOrderQueue";
import { SUPPLIERS, catalogItems, supplierMoney, supplierRequest, supplierTime, SupplierRequestError, type Balance, type BuffData, type Catalog, type CatalogItem, type OrderLink, type Supplier } from "./supplier-admin-data";

const tabs = [{ id: "ringkas", label: "Ringkas" }, { id: "antrean", label: "Antrean" }, { id: "markup", label: "Markup" }, { id: "alat", label: "Alat" }] satisfies { id: SupplierTabId; label: string }[];

function FamilyCard({ title, description, archived, parentInactive, children }: {
  title: string; description: ReactNode; archived?: boolean; parentInactive?: boolean; children: ReactNode;
}) {
  return <Card>
    <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
      <CardTitle className="min-w-0 break-words text-base">{title}</CardTitle>
      <StatusBadges archived={archived} parentInactive={parentInactive} />
      <CardDescription className="w-full break-words text-xs">{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-2 p-4 pt-0"><SupplierPriceHeader />{children}</CardContent>
  </Card>;
}

function SupplierDescription({ text }: { text: string }) {
  return <details className="text-xs">
    <summary className="min-h-11 cursor-pointer py-2 text-admin-muted hover:text-admin-fg md:min-h-0 md:py-0">Deskripsi supplier (rujukan admin, bukan untuk pembeli)</summary>
    <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-admin-border bg-admin-subtle/60 p-2.5 leading-5 text-admin-muted">{text}</p>
  </details>;
}

export function SupplierAdminPanel({ supplier }: { supplier: Supplier }) {
  const config = SUPPLIERS[supplier];
  const { name, currency } = config;
  const [tab, setTab] = useState<SupplierTabId>("ringkas");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [links, setLinks] = useState<OrderLink[] | null>(null);
  const [buff, setBuff] = useState<BuffData | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ item: CatalogItem; trigger: HTMLButtonElement } | null>(null);
  const [bulkError, setBulkError] = useState("");
  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);
  const actionPending = useRef(false);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled([
      supplierRequest<Catalog>(supplier, "products", undefined, body => Array.isArray(body.items)),
      supplierRequest<Balance>(supplier, "balance", undefined, body => Number.isFinite(body.balance ?? (config.buff ? body.balance_usdt : undefined)) && (body.currency == null || body.currency === currency)),
      supplierRequest<{ items: OrderLink[] }>(supplier, "orders", undefined, body => Array.isArray(body.items)),
      config.buff ? supplierRequest<BuffData>(supplier, "buff", undefined, body => Array.isArray(body.variants)) : Promise.resolve(null),
    ] as const);
    if (generation.current !== current) return;
    // Keep the last good snapshot on a refresh failure so other rows' drafts are not lost.
    if (results[0].status === "fulfilled") setCatalog(results[0].value);
    if (results[1].status === "fulfilled") setBalance(results[1].value);
    if (results[2].status === "fulfilled") setLinks(results[2].value.items.filter(link => !config.buff || !isTunvnExcludedProduct(Number(link.source_product_id))).slice(0, 100));
    if (results[3].status === "fulfilled") setBuff(results[3].value);
    const sections = ["Katalog", "Saldo", "Antrean", "Probe Buff"];
    setLoadErrors(results.flatMap((result, i) => result.status === "rejected"
      ? [`${sections[i]}: ${result.reason instanceof SupplierRequestError ? result.reason.message : "Koneksi tidak tersedia."}`] : []));
    setLoading(false);
  }, [config.buff, currency, supplier]);
  useEffect(() => {
    const token = generation;
    void load();
    return () => { token.current++; };
  }, [load]);

  async function mutate(section: string, path: string, body: object, message: string, options: { patch?: boolean; bulk?: boolean } = {}) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(path);
    setActionError("");
    setBulkError("");
    setSuccess("");
    const version = generation.current;
    try {
      const result = await supplierRequest<{ receipt?: string; link?: { status?: string; last_error?: string }; status?: string }>(supplier, path, {
        method: options.patch ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (generation.current !== version) return false;
      if ("action" in body && body.action === "reveal") {
        if (!result.receipt) { setActionError("Receipt: Data tidak tersedia."); return false; }
        setReceipt(result.receipt);
        return true;
      }
      await load();
      if (generation.current !== version + 1) return false;
      if ((result.link?.status ?? result.status) === "needs_admin") setActionError(`Antrean: ${supplierOrderError(result.link?.last_error, config.buff) ?? "Pesanan masih perlu diperiksa."}`);
      else setSuccess(message);
      return true;
    } catch (error) {
      if (generation.current === version) {
        if (options.bulk) setBulkError(error instanceof SupplierRequestError ? error.detail : "Gagal menyimpan harga grosir.");
        else setActionError(`${section}: ${error instanceof SupplierRequestError ? error.message : "Koneksi tidak tersedia."}`);
      }
      return false;
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  const items = catalogItems(catalog?.items ?? [], config);
  const families = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const rows = families.get(item.family.key);
    if (rows) rows.push(item);
    else families.set(item.family.key, [item]);
  }
  const needle = query.trim().toLowerCase();
  const groups = [...families].map(([key, rows]) => ({
    key, rows: rows.filter(item => !needle || [item.id, item.name, item.label, item.productName, item.productSlug, item.family.name, item.family.slug].join(" ").toLowerCase().includes(needle)),
    name: rows.find(item => item.productName)?.productName || rows[0].family.name,
    slug: rows.find(item => item.productSlug)?.productSlug || rows[0].family.slug,
    archived: rows.some(item => item.product_archived === 1), inactive: !rows.some(item => item.productActive),
  })).filter(group => group.rows.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  const buffRows = (buff?.variants ?? []).filter(row => !needle || `${row.sku} ${row.label} Buff Token Muse`.toLowerCase().includes(needle));
  const active = items.filter(item => item.variantActive && item.productActive && item.product_archived !== 1).length;
  const mapped = items.filter(item => item.variant_id != null).length;
  const locked = loading || busy !== null;
  const syncEnabled = catalog?.sync_enabled ?? catalog?.configured;
  const dispatchEnabled = catalog?.dispatch_enabled ?? catalog?.configured;
  const syncDisabled = catalog != null && (!catalog.configured || !syncEnabled);
  const lastErrorAt = supplierTime(catalog?.last_error?.at);

  function priceRow(row: { id: string; path: string; title: string; meta: ReactNode; badges?: ReactNode; details?: ReactNode;
    active: boolean; canEdit: boolean; manual: number | null; price: number | null; markup: number }) {
    const { path, ...props } = row;
    return <SupplierPriceRow key={path} {...props} locked={locked} busy={busy === path}
      onToggle={() => void mutate("Markup", path, { is_active: !row.active }, `${row.title} ${row.active ? "dinonaktifkan" : "diaktifkan"}.`, { patch: true })}
      onSave={async body => { await mutate("Markup", path, body, `Harga ${row.title} disimpan.`, { patch: true }); }} />;
  }

  return <div className="min-w-0 space-y-6 [&_[role=tab]]:min-h-11 md:[&_[role=tab]]:min-h-9">
    <PageHeader title={name} description={`Katalog, harga, dan pengiriman otomatis ${name}.`} actions={<Button variant="outline" className="min-h-11 md:min-h-0" disabled={locked} onClick={() => { setActionError(""); setSuccess(""); void load(); }}>Muat ulang</Button>} />
    <SupplierTabs tabs={tabs} active={tab} onChange={setTab}>
      <div aria-live="polite" className="space-y-1 text-sm empty:hidden [&:not(:empty)]:my-3">
        {loading && <p role="status" className="text-admin-muted">Memuat data {name}…</p>}
        {busy && !loading && <p role="status" className="text-admin-muted">Memproses…</p>}
        {loadErrors.map(error => <p role="alert" key={error} className="break-words text-admin-danger">{error}</p>)}
        {actionError && <p role="alert" className="break-words text-admin-danger">{actionError}</p>}
        {success && <p role="status" className="text-admin-success">{success}</p>}
      </div>
      <TabsContent value="ringkas" className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Saldo wallet" value={<span className="break-words">{supplierMoney(currency, balance?.balance ?? balance?.balance_usdt, true)}</span>} hint={balance?.username ? `akun ${balance.username}` : `Saldo ${currency}`} />
          <StatCard label="Varian aktif" value={catalog ? active : "—"} hint={catalog ? `${mapped} dipetakan · ${items.length} di katalog` : undefined} />
          <StatCard label="Keluarga produk" value={catalog ? families.size : "—"} hint="Produk terpisah dari supplier lain" />
          <StatCard label="Sinkron terakhir" value={supplierTime(catalog?.last_sync_at) ?? (catalog ? "Belum pernah" : "—")} hint="Sinkron katalog yang berhasil" />
        </div>
        {catalog && <div className="flex flex-wrap gap-2" aria-label={`Status ${name}`}>
          <Badge variant={catalog.configured ? "success" : "secondary"}>{catalog.configured ? "Konfigurasi tersedia" : "Belum dikonfigurasi"}</Badge>
          <Badge variant={dispatchEnabled ? "success" : "secondary"}>Pengiriman otomatis {dispatchEnabled ? "aktif" : "nonaktif"}</Badge>
          <Badge variant={syncEnabled ? "success" : "secondary"}>Sinkron otomatis {syncEnabled ? "aktif" : "nonaktif"}</Badge>
        </div>}
        {catalog?.last_error && <p role="alert" className="break-words text-sm text-admin-danger">Sinkron gagal{lastErrorAt ? ` (${lastErrorAt})` : ""}. Coba sinkronkan kembali dari tab Alat.</p>}
      </TabsContent>
      <TabsContent value="antrean" className="mt-4">
        <SupplierOrderQueue links={links} config={config} labels={new Map(items.map(item => [item.id, item.label]))} locked={locked} onAction={(link, action, trigger) => {
          if (action === "reveal") receiptTrigger.current = trigger;
          void mutate(action === "reveal" ? "Receipt" : "Antrean", "orders", { id: link.id, action }, action === "reconcile" ? "Status pesanan diperiksa." : "Pesanan diproses ulang.");
        }} />
      </TabsContent>
      <TabsContent value="markup" className="mt-4 space-y-4">
        <Input className="max-w-sm" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari varian…" aria-label="Cari varian" />
        {catalog && !items.length && !buff?.variants.length && <p className="text-sm text-admin-muted">Sinkronkan katalog dari tab Alat untuk memulai.</p>}
        {needle && (items.length > 0 || Boolean(buff?.variants.length)) && !groups.length && !buffRows.length && <p className="text-sm text-admin-muted">Tidak ada varian yang cocok.</p>}
        {groups.map(group => <FamilyCard key={group.key} title={group.name} description={`${group.slug ?? "Belum dipetakan"} · ${group.rows.length} varian`} archived={group.archived} parentInactive={group.inactive}>
          {group.rows.map(item => {
            const canEdit = item.variant_id != null && item.product_archived !== 1;
            const { cost, fx, label } = item;
            const price = item.variant_price ?? item.manual ?? (cost != null && cost > 0 && fx != null && fx > 0 ? Math.ceil(cost * fx * (1 + item.markup_percent / 100) / 100) * 100 : null);
            return priceRow({ id: `${supplier}-${item.id}`, path: `products/${encodeURIComponent(item.id)}`, title: label,
              meta: <>{item.name} · modal {costWithIdr(supplierMoney(currency, cost), cost, fx)}{item.delivery_type === "muse_buff" ? " per 1 miliar token" : ""} · stok {item.stock === -1 ? "∞" : item.stock}
                {config.bulk && !!item.bulk_tiers_preview?.length && <span className="mt-1 block">Grosir: {item.bulk_tiers_preview.map(t => `${t.min_qty}+ ${formatRupiah(t.unit_price)}`).join(" · ")}</span>}
              </>,
              badges: item.variant_id == null ? <Badge variant="warning">Belum dipetakan</Badge> : config.bulk && canEdit
                ? <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={locked} onClick={event => { setBulkError(""); setBulk({ item, trigger: event.currentTarget }); }}>Grosir</Button> : undefined,
              details: config.disclosure && item.supplier_description?.trim() ? <SupplierDescription text={item.supplier_description} /> : undefined,
              markup: Number(item.markup_percent), manual: item.manual, price, active: item.variantActive, canEdit });
          })}
        </FamilyCard>)}
        {config.buff && buffRows.length > 0 && <FamilyCard title="Buff Token Muse" archived={buff?.muse_product?.archived === 1}
          parentInactive={buff?.muse_product?.is_active === 0} description={buff?.probe
            ? <>Modal terverifikasi {supplierMoney("USDT", buff.probe.cost_per_b_usdt)}/1B · layanan <span className={buff.probe.fundable ? "text-admin-success" : "text-admin-warning"}>{buff.probe.fundable ? "bisa diproses" : "sementara tidak bisa"}</span></>
            : <span className="text-admin-warning">Probe tidak tersedia; harga memakai snapshot terakhir.</span>}>
          {buffRows.map(variant => priceRow({ id: `buff-${variant.sku}`, path: `buff/${encodeURIComponent(variant.sku)}`, title: variant.label,
            meta: <>Per {variant.tunvn_buff_quantity_b} miliar token · modal {costWithIdr(supplierMoney("USDT", variant.tunvn_cost_usdt), variant.tunvn_cost_usdt, variant.tunvn_fx_idr_per_usdt)}</>,
            markup: Number(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT), manual: variant.tunvn_admin_price_idr, price: variant.price,
            active: variant.is_active === 1, canEdit: buff?.muse_product?.archived !== 1 }))}
        </FamilyCard>}
      </TabsContent>
      <TabsContent value="alat" className="mt-4">
        <Card><CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron katalog</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <p className="text-sm leading-5 text-admin-muted">Tarik katalog terbaru dan hitung ulang harga dengan kurs {currency} dari snapshot AXVARA. Produk dan varian baru selalu nonaktif. Nama, gambar, label, dan status produk dikelola dari Produk.</p>
            <Button className="min-h-11 md:min-h-0" disabled={locked || syncDisabled} onClick={() => void mutate("Sinkron", "publish", {}, "Sinkron katalog selesai.")}><Zap aria-hidden="true" />{busy === "publish" ? "Menyinkronkan…" : "Sinkronkan katalog"}</Button>
            {syncDisabled && <p className="text-xs text-admin-muted">{catalog.configured ? "Sinkronisasi dinonaktifkan." : `${name} belum dikonfigurasi.`}</p>}
          </CardContent>
        </Card>
      </TabsContent>
    </SupplierTabs>
    <Dialog open={receipt !== null} onOpenChange={open => { if (!open) setReceipt(null); }}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); receiptTrigger.current?.focus(); receiptTrigger.current = null; }}>
        <DialogHeader><DialogTitle>Receipt {name}</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader>
        <pre className="min-w-0 whitespace-pre-wrap break-all rounded-lg border border-admin-border bg-admin-subtle p-3 text-xs text-admin-muted">{receipt}</pre>
      </DialogContent>
    </Dialog>
    {bulk && <BulkMarkupDialog item={bulk.item} trigger={bulk.trigger} busy={locked} failure={bulkError} onClose={() => setBulk(null)}
      onSave={tiers => mutate("Markup", `products/${encodeURIComponent(bulk.item.id)}`, { bulk_markup_tiers: tiers }, `Harga grosir ${bulk.item.label} disimpan.`, { patch: true, bulk: true })} />}
  </div>;
}
