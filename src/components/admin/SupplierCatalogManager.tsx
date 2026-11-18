"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatWibDateTime } from "@/lib/utils";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, PageHeader, StatCard } from "./ui";
import { SupplierTabs, type SupplierTabId } from "./SupplierTabs";
import { SupplierPriceHeader, SupplierPriceRow, StatusBadges, costWithIdr } from "./SupplierPriceRow";
import { SupplierBadge } from "./supplier-style";

type Item = {
  id?: number;
  package_code?: string;
  name: string;
  stock: number;
  delivery_type?: string;
  price_usd?: number;
  cost_usdt?: number;
  fx_idr_per_usd?: number | null;
  fx_idr_per_usdt?: number | null;
  markup_percent: number;
  admin_price_idr: number | null;
  variant_id: number | null;
  variant_price: number | null;
  variant_active: number | null;
  product_active: number | null;
  product_archived: number;
  product_name?: string | null;
  label: string | null;
  family: { key: string; name: string; label?: string };
};
type Catalog = {
  configured: boolean;
  dispatch_enabled: boolean;
  sync_enabled: boolean;
  items: Item[];
  last_sync_at: string | number | null;
  last_error: { at: string | null; error: string } | null;
};
type OrderLink = {
  id: number;
  order_code: string;
  storebat_product_id?: number;
  package_code?: string;
  quantity: number;
  kind?: string;
  cost_usd?: number | null;
  cost_usdt?: number | null;
  status: string;
  attempt_count: number;
  last_error: string | null;
  has_receipt: number;
  can_retry: number;
};
const sections = [{ id: "ringkas", label: "Ringkas" }, { id: "antrean", label: "Antrean" }, { id: "markup", label: "Markup" }, { id: "alat", label: "Alat" }] satisfies { id: SupplierTabId; label: string }[];
const statusLabels: Record<string, string> = {
  pending: "Menunggu", claimed: "Memproses", processing: "Menunggu supplier", completed: "Siap dikirim",
  needs_admin: "Perlu diperiksa", blocked_balance: "Saldo tidak cukup", failed: "Gagal", cancelled: "Dibatalkan",
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const usdt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 });
const balanceFmt = { USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }), USDT: new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };

function syncTime(value: Catalog["last_sync_at"]) {
  if (!value) return null;
  const date = new Date(Number.isFinite(Number(value)) ? Number(value) : String(value));
  return Number.isFinite(date.getTime()) ? formatWibDateTime(date.toISOString()) : null;
}

export function SupplierCatalogManager({ supplier }: { supplier: "storebat" | "mirai" }) {
  const isMirai = supplier === "mirai";
  const name = isMirai ? "Mirai" : "StoreBat";
  const currency = isMirai ? "USDT" : "USD";
  const amount = (n: number) => isMirai ? `${usdt.format(n)} USDT` : usd.format(n);
  const [tab, setTab] = useState<SupplierTabId>("ringkas");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [links, setLinks] = useState<OrderLink[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const generation = useRef(0);
  const actionPending = useRef(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit, valid?: (body: T) => boolean): Promise<T> => {
    const response = await fetch(`/api/admin/${supplier}/${path}`, { ...init, cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false || typeof body?.error === "string") {
      const detail = body?.skipped === "not_configured" ? "Supplier belum dikonfigurasi atau sinkronisasi nonaktif."
        : body?.skipped === "claimed_elsewhere" ? "Sinkron sedang berjalan di proses lain."
        : body?.error === "save_failed_or_stale" ? "Data berubah atau gagal disimpan. Muat ulang lalu coba lagi."
        : body?.error === "no_safe_retry" ? "Pesanan ini tidak dapat dicoba ulang dengan aman."
        : body?.error ?? "Permintaan gagal.";
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    if (!body || typeof body !== "object" || (valid && !valid(body))) throw new Error(`HTTP ${response.status}: respons tidak valid`);
    return body as T;
  }, [supplier]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled([
      request<Catalog>("products", undefined, body => Array.isArray(body.items)),
      request<{ balance: number; currency: string }>("balance", undefined, body => Number.isFinite(body.balance) && body.currency === currency),
      request<{ items: OrderLink[] }>("orders", undefined, body => Array.isArray(body.items)),
    ]);
    if (current !== generation.current) return;
    setCatalog(results[0].status === "fulfilled" ? results[0].value : null);
    setBalance(results[1].status === "fulfilled" ? results[1].value.balance : null);
    setLinks(results[2].status === "fulfilled" ? results[2].value.items.slice(0, 100) : null);
    const labels = ["Katalog", "Saldo", "Antrean"];
    setLoadErrors(results.flatMap((result, i) => result.status === "rejected" ? [`${labels[i]}: ${result.reason instanceof Error ? result.reason.message : "Gagal memuat data."}`] : []));
    setLoading(false);
  }, [request, currency]);
  useEffect(() => {
    const token = generation;
    void load();
    return () => { token.current++; };
  }, [load]);

  async function mutate(section: string, path: string, body: object, message: string, method = "POST") {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setActionError("");
    setSuccess("");
    const version = generation.current;
    try {
      const result = await request<{ receipt?: string; skipped?: string; link?: { status?: string } }>(path, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (generation.current !== version) return;
      if ("action" in body && body.action === "reveal") {
        if (typeof result.receipt !== "string") throw new Error("Receipt tidak tersedia.");
        setReceipt(result.receipt);
        return;
      }
      await load();
      if (generation.current !== version + 1) return;
      if (result.link?.status === "needs_admin") setActionError("Antrean: Pesanan masih perlu diperiksa.");
      else setSuccess(result.skipped ? "Sinkron belum dijalankan." : message);
    } catch (error) {
      if (generation.current === version) setActionError(`${section}: ${error instanceof Error ? error.message : "Permintaan gagal."}`);
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  const items = catalog?.items ?? [];
  const families = new Set(items.map(item => item.family.key));
  const groups = new Map<string, Item[]>();
  const needle = query.trim().toLowerCase();
  for (const item of items) {
    const searchText = `${(isMirai ? item.package_code : item.id) ?? ""} ${item.name} ${item.label ?? item.family.label ?? ""} ${item.product_name ?? ""} ${item.family.name}`;
    if (needle && !searchText.toLowerCase().includes(needle)) continue;
    const rows = groups.get(item.family.key);
    if (rows) rows.push(item);
    else groups.set(item.family.key, [item]);
  }
  const grouped = Array.from(groups, ([key, rows]) => ({ key, rows, name: rows.find(item => item.product_name)?.product_name || rows[0].family.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const active = items.filter(item => item.variant_active === 1 && item.product_active === 1 && item.product_archived !== 1).length;
  const mapped = items.filter(item => item.variant_id != null).length;
  const locked = loading || busy;
  const syncDisabled = catalog !== null && (!catalog.configured || !catalog.sync_enabled);

  return <div className="space-y-6">
    <PageHeader title={name} description={`Katalog, harga, dan pengiriman otomatis ${name}.`} actions={<Button variant="outline" disabled={locked} onClick={() => { setActionError(""); setSuccess(""); void load(); }}>Muat ulang</Button>} />
    <SupplierTabs tabs={sections} active={tab} onChange={setTab} />
    {(loading || busy || loadErrors.length > 0 || actionError || success) && <div aria-live="polite" className="space-y-1 text-sm">
      {loading && <p role="status" className="text-admin-muted">Memuat data {name}…</p>}
      {busy && !loading && <p role="status" className="text-admin-muted">Memproses…</p>}
      {loadErrors.map(error => <p role="alert" key={error} className="break-words text-admin-danger">{error}</p>)}
      {actionError && <p role="alert" className="break-words text-admin-danger">{actionError}</p>}
      {success && <p role="status" className="text-admin-success">{success}</p>}
    </div>}
    {tab === "ringkas" && <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saldo wallet" value={balance == null ? "—" : <span className="break-words">{isMirai ? `${balanceFmt.USDT.format(balance)} USDT` : balanceFmt.USD.format(balance)}</span>} hint={`Saldo ${currency}`} />
        <StatCard label="Varian aktif" value={catalog ? active : "—"} hint={catalog ? `${mapped} dipetakan · ${items.length} di katalog` : undefined} />
        <StatCard label="Keluarga produk" value={catalog ? families.size : "—"} hint="Produk terpisah dari supplier lain" />
        <StatCard label="Sinkron terakhir" value={syncTime(catalog?.last_sync_at ?? null) ?? (catalog ? "Belum pernah" : "—")} hint="Sinkron katalog yang berhasil" />
      </div>
      {catalog && <div className="flex flex-wrap gap-2" aria-label={`Status ${name}`}>
        <Badge variant={catalog.configured ? "success" : "secondary"}>{catalog.configured ? "Konfigurasi tersedia" : "Belum dikonfigurasi"}</Badge>
        <Badge variant={catalog.dispatch_enabled ? "success" : "secondary"}>Pengiriman otomatis {catalog.dispatch_enabled ? "aktif" : "nonaktif"}</Badge>
        <Badge variant={catalog.sync_enabled ? "success" : "secondary"}>Sinkron otomatis {catalog.sync_enabled ? "aktif" : "nonaktif"}</Badge>
      </div>}
      {catalog?.last_error && <p role="alert" className="break-words text-sm text-admin-danger">Sinkron gagal{syncTime(catalog.last_error.at) ? ` (${syncTime(catalog.last_error.at)})` : ""}: {catalog.last_error.error}</p>}
    </div>}
    {tab === "antrean" && <div className="space-y-3">
      {!loading && links?.length === 0 && <Card><CardContent className="p-6 text-sm text-admin-muted">Belum ada pesanan {name}.</CardContent></Card>}
      {links?.map(link => {
        const cost = isMirai ? link.cost_usdt : link.cost_usd;
        return <Card key={link.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><p className="break-all font-medium text-admin-fg">{link.order_code}</p><SupplierBadge supplier={name} /></div>
            <p className="break-words text-sm text-admin-muted">{(isMirai ? link.package_code : link.storebat_product_id) ?? "—"} · {link.quantity} {link.kind === "muse_buff" ? "miliar token" : "unit"} · {link.attempt_count}/3 upaya{cost != null ? ` · modal ${amount(cost)}` : ""}</p>
            {link.last_error && <p className="break-words text-sm text-admin-muted">{link.last_error}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={link.status === "needs_admin" || link.status === "blocked_balance" ? "warning" : link.status === "completed" ? "success" : "secondary"}>{statusLabels[link.status] ?? "Status belum diketahui"}</Badge>
            {link.status === "needs_admin" && link.can_retry === 1 && <Button variant="outline" disabled={locked} onClick={() => void mutate("Antrean", "orders", { id: link.id, action: "retry" }, "Pesanan diproses ulang.")}>Coba lagi</Button>}
            {link.has_receipt === 1 && <Button variant="outline" disabled={locked} onClick={() => void mutate("Receipt", "orders", { id: link.id, action: "reveal" }, "")}>Lihat receipt</Button>}
          </div>
        </CardContent></Card>;
      })}
    </div>}
    {tab === "markup" && <>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari varian…" aria-label="Cari varian" />
        <p className="text-xs text-admin-muted">Harga jual = modal {currency} dikali kurs tersimpan dikali (1 + markup), dibulatkan ke atas ke Rp100. Harga manual mengalahkan rumus; kosongkan untuk kembali ke rumus.</p>
      </div>
      {!loading && catalog && !items.length && <p className="text-sm text-admin-muted">Sinkronkan katalog dari tab Alat untuk memulai.</p>}
      {!loading && items.length > 0 && groups.size === 0 && <p className="text-sm text-admin-muted">Tidak ada varian yang cocok.</p>}
      <div className="space-y-4">{grouped.map(group => <Card key={group.key}>
        <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
          <CardTitle className="break-words text-base">{group.name}</CardTitle>
          <StatusBadges archived={group.rows.some(item => item.product_archived === 1)} parentInactive={!group.rows.some(item => item.product_active === 1)} />
          <CardDescription className="w-full text-xs">{group.rows.length} varian</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0"><SupplierPriceHeader />
          {group.rows.map(item => {
            const title = item.label || item.family.label || item.name;
            const cost = isMirai ? item.cost_usdt : item.price_usd;
            const fx = isMirai ? item.fx_idr_per_usdt : item.fx_idr_per_usd;
            const perBillion = !isMirai && item.delivery_type === "muse_buff";
            const price = item.variant_price ?? item.admin_price_idr ?? (cost != null && cost > 0 && fx != null && fx > 0 ? Math.ceil(cost * fx * (1 + item.markup_percent / 100) / 100) * 100 : null);
            const id = isMirai ? item.package_code : item.id;
            const path = `products/${encodeURIComponent(id ?? "")}`;
            return <SupplierPriceRow key={id} id={`${supplier}-${id}`} title={title}
              meta={<>{item.name} · modal {cost == null ? "—" : costWithIdr(amount(cost), cost, fx)}{perBillion ? " per 1 miliar token" : ""} · stok {item.stock === -1 ? "∞" : item.stock}</>}
              badges={item.variant_id == null ? <Badge variant="warning">Belum dipetakan</Badge> : undefined}
              markup={item.markup_percent} manual={item.admin_price_idr} price={price} active={item.variant_active === 1}
              canEdit={id != null && item.variant_id != null && item.product_archived !== 1} locked={locked} busy={false}
              onToggle={() => void mutate("Markup", path, { is_active: item.variant_active !== 1 }, `${title} ${item.variant_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`, "PATCH")}
              onSave={body => mutate("Markup", path, body, `Harga ${title} disimpan.`, "PATCH")} />;
          })}
        </CardContent>
      </Card>)}</div>
    </>}
    {tab === "alat" && <Card><CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron katalog</CardTitle></CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm leading-5 text-admin-muted">Tarik katalog terbaru dan hitung ulang harga dengan kurs {currency} dari snapshot AXVARA. Produk dan varian baru selalu nonaktif. Nama, gambar, label, dan status produk dikelola dari Produk.</p>
        <Button disabled={locked || syncDisabled} onClick={() => void mutate("Sinkron", "publish", {}, "Sinkron katalog selesai.")}>Sinkronkan katalog</Button>
        {syncDisabled && <p className="text-xs text-admin-muted">{catalog.configured ? "Sinkronisasi dinonaktifkan." : `${name} belum dikonfigurasi.`}</p>}
      </CardContent>
    </Card>}
    <Dialog open={receipt !== null} onOpenChange={open => { if (!open) setReceipt(null); }}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Receipt {name}</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader>
        <pre className="min-w-0 whitespace-pre-wrap break-all text-xs">{receipt}</pre>
      </DialogContent>
    </Dialog>
  </div>;
}
