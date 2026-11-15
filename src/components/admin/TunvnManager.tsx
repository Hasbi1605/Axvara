"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Zap } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { SupplierTabs, type SupplierTabId } from "@/components/admin/SupplierTabs";
import { AdminStatusSwitch } from "./AdminStatusSwitch";
import { TUNVN_BUFF_MARKUP_PERCENT } from "@/lib/tunvn/pricing";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import { SupplierPriceHeader, SupplierPriceRow, StatusBadges, costWithIdr } from "./SupplierPriceRow";
import { TUNVN_ERROR_LABEL } from "./SupplierLinkActions";

type Item = {
  supplier_product_id: number; name: string; price_vnd: number; price_usdt: number | null;
  stock: number; visible: number; axvara_product_id: number | null;
  markup_percent: number; sell_price_idr: number | null; fx_idr_per_usdt: number | null;
  synced_at: string | null; admin_name: string | null; admin_description: string | null;
  publish_requested: number; axvara_name: string | null; axvara_description: string | null;
  axvara_is_active: number | null; variant_price: number | null; variant_is_active: number | null;
  axvara_slug: string | null; family: string | null; family_key: string;
  variant_id: number | null; variant_sku: string | null; variant_label: string | null;
  tunvn_admin_price_idr: number | null;
  excluded?: number; product_archived?: number; supplier_description?: string | null;
};
type ProductsData = {
  ok: boolean; configured: boolean; items: Item[];
  counts: { total: number; published: number; requested: number; in_stock: number; mapped: number; active_variants: number };
  last_sync_at: string | null;
};
type BalanceData = {
  ok: boolean; configured: boolean; username?: string;
  balance_vnd?: number; balance_usdt?: number; usdt_vnd?: number | null; error?: string;
};
type BuffVariant = {
  id: number; sku: string; label: string; price: number; is_active: number;
  tunvn_buff_quantity_b: number; tunvn_cost_usdt: number | null;
  tunvn_markup_percent: number | null; tunvn_fx_idr_per_usdt: number | null;
  tunvn_admin_price_idr: number | null;
};
type BuffData = {
  ok: boolean; variants: BuffVariant[];
  probe: { quantity_b: number; sell_price_usdt: number; cost_per_b_usdt: number; fundable: boolean } | null;
  probe_error: string | null;
  muse_product: { id: number; is_active: number; archived?: number } | null;
};
type Row = Record<string, unknown>;
type DispatchLink = { id:number; order_code:string; item_index:number; kind:string; quantity:number; cost_usdt:number; status:string; provider_order_group:string|null; provider_batch_id:string|null; provider_order_code:string|null; last_error:string|null; receipt_json:string|null; has_receipt:number; can_retry?:number; purchase_disabled?:number; request_sent_at?:string|null; completed_at?:string|null };

const TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkas" },
  { id: "antrean", label: "Katalog" },
  { id: "markup", label: "Markup" },
  { id: "alat", label: "Alat" },
];
/** Label status pengiriman yang manusiawi (D5) — kode mentah hanya di receipt. */
const LINK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu", ordering: "Antre dikirim", submitted: "Diproses supplier", processing: "Diproses supplier",
  completed: "Selesai", failed: "Gagal", needs_admin: "Perlu tindakan", retry: "Dicoba ulang", canceled: "Dibatalkan",
};
const linkStatusLabel = (status: string) => LINK_STATUS_LABEL[status] ?? "Status lain";

async function request<T>(url: string, init?: RequestInit, label = "Permintaan"): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  // Respons non-JSON (mis. HTML 502 dari edge/timeout) dulu menjadi pesan
  // generik tanpa nama bagian yang gagal. Sekarang sebut bagian + status.
  const data = await response.json().catch(() => null) as (Row & { error?: string; message?: string }) | null;
  if (!data) throw new Error(`${label} gagal dimuat (HTTP ${response.status}).`);
  if (!response.ok && data.error !== "not_configured") throw new Error(`${label}: ${String(data.message || data.error || `HTTP ${response.status}`)}`);
  return data as T;
}

const usdt = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${value} USDT`);
const messageOf = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message : fallback;
const compactTunvnTime = (value: string | null | undefined) => value ? formatWibDateTime(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) ?? String(value) : "Belum pernah";

/** Panel admin TUNVN PREHUB: saldo, katalog, kontrol terbit/markup/deskripsi, Buff, publikasi. */
export function TunvnManager() {
  const [tab, setTab] = useState<SupplierTabId>("ringkas");
  const [products, setProducts] = useState<ProductsData | null>(null);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [buff, setBuff] = useState<BuffData | null>(null);
  const [links, setLinks] = useState<DispatchLink[]>([]);
  const [receipt, setReceipt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [q, setQ] = useState("");
    const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    // allSettled: satu endpoint lambat/gagal (mis. probe Buff 502) tidak boleh
    // mengosongkan seluruh panel — dulu Promise.all membuat tab Markup kosong
    // dengan pesan generik "Permintaan gagal".
    const [nextProducts, nextBalance, nextBuff, nextOrders] = await Promise.allSettled([
      request<ProductsData>("/api/admin/tunvn/products", undefined, "Katalog TUNVN"),
      request<BalanceData>("/api/admin/tunvn/balance", undefined, "Saldo TUNVN"),
      request<BuffData>("/api/admin/tunvn/buff", undefined, "Probe Buff"),
      request<{items:DispatchLink[]}>("/api/admin/tunvn/orders", undefined, "Pesanan TUNVN"),
    ]);
    if (current !== generation.current) return;
    const failures: string[] = [];
    if (nextProducts.status === "fulfilled") setProducts(nextProducts.value);
    else failures.push(messageOf(nextProducts.reason, "Katalog TUNVN gagal dimuat."));
    if (nextBalance.status === "fulfilled") setBalance(nextBalance.value);
    else failures.push(messageOf(nextBalance.reason, "Saldo TUNVN gagal dimuat."));
    if (nextBuff.status === "fulfilled") setBuff(nextBuff.value);
    else failures.push(messageOf(nextBuff.reason, "Probe Buff gagal dimuat."));
    if (nextOrders.status === "fulfilled") setLinks(nextOrders.value.items ?? []);
    else failures.push(messageOf(nextOrders.reason, "Pesanan TUNVN gagal dimuat."));
    if (failures.length) setError(failures.join(" "));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); const pending = generation; return () => { pending.current++; }; }, [load]);

  async function dispatchAction(id:number,action:"retry"|"reconcile"|"reveal") {
    if (busy) return;
    setBusy(`order${id}`); setError(""); setReceipt("");
    try {
      const result=await request<{receipt?:string;link?:{status:string;last_error:string|null}}>("/api/admin/tunvn/orders",{ method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action}) });
      if (action==="reveal") setReceipt(result.receipt ?? "");
      else {
        await load();
        if (result.link?.status==="needs_admin") setError(TUNVN_ERROR_LABEL[result.link.last_error ?? ""] ?? "TUNVN masih perlu diperiksa.");
      }
    } catch { setError("Tindakan pesanan belum dapat diselesaikan."); }
    finally { setBusy(""); }
  }

  async function patchProduct(id: number, body: Row, message: string) {
    if (busy) return;
    setBusy(`p${id}`); setError(""); setSuccess("");
    try {
      await request(`/api/admin/tunvn/products/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await load();
      setSuccess(message);
    } catch (e) { setError(e instanceof Error ? e.message : "Perubahan gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function patchBuff(sku: string, body: Row, message: string) {
    if (busy) return;
    setBusy(sku); setError(""); setSuccess("");
    try {
      await request(`/api/admin/tunvn/buff/${sku}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await load();
      setSuccess(message);
    } catch (e) { setError(e instanceof Error ? e.message : "Perubahan gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function publish() {
    if (busy) return;
    setBusy("publish"); setError(""); setSuccess("");
    try {
      const result = await request<Row & { families?: number; variants?: number; buff_variants?: number; idr_per_usdt?: number; activated?: number; error?: string }>(
        "/api/admin/tunvn/publish", { method: "POST" }, "Sinkron TUNVN",
      );
      if (result.error) throw new Error(String(result.error));
      await load();
      setSuccess(`Sinkron selesai: ${result.families ?? 0} produk induk, ${result.variants ?? 0} varian akun, ${result.buff_variants ?? 0} varian Buff, ${result.activated ?? 0} tampil publik (kurs Rp${Number(result.idr_per_usdt ?? 0).toLocaleString("id-ID")}/USDT).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Publikasi gagal."); }
    finally { setBusy(""); }
  }

  const query = q.trim().toLowerCase();
  const matches = (item: Item) => !query || `${item.supplier_product_id} ${item.name} ${item.axvara_name ?? ""} ${item.variant_label ?? ""}`.toLowerCase().includes(query);
  // #60 API TEST dikecualikan server (PATCH 409) — jangan tampil sebagai baris yang bisa diatur.
  const visibleItems = (products?.items ?? []).filter((item) => item.excluded !== 1 && !isTunvnExcludedProduct(item.supplier_product_id));
  const catalogItems = visibleItems.filter(matches);
  const buffVariants = buff?.variants ?? [];
  // Kelompokkan per produk induk AXVARA untuk tab Markup: satu kartu per
  // produk, satu baris per varian. Buff memakai kartu dengan baris yang sama.
  const familyGroups = (() => {
    const map = new Map<string, { key: string; name: string; slug: string; active: boolean; archived: boolean; items: Item[] }>();
    for (const item of catalogItems) {
      const key = item.family_key || `p${item.supplier_product_id}`;
      const group = map.get(key) ?? {
        key,
        name: item.axvara_name ?? item.name,
        slug: item.axvara_slug ?? "belum diterbitkan",
        active: item.axvara_is_active === 1,
        archived: item.product_archived === 1,
        items: [],
      };
      group.items.push(item);
      map.set(key, group);
    }
    return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
  })();
  const counts = products?.counts ?? { total: 0, published: 0, requested: 0, in_stock: 0, mapped: 0, active_variants: 0 };
  // Saldo wallet hanya dalam USDT (mata uang wallet); VND tidak ditampilkan.
  const walletUsdt = balance?.ok && balance.balance_usdt != null
    ? `${Number(balance.balance_usdt).toLocaleString("id-ID", { maximumFractionDigits: 4 })} USDT`
    : balance?.error === "not_configured" ? "Belum terkonfigurasi" : "Belum terbaca";
  const syncOneLine = compactTunvnTime(products?.last_sync_at);
  // Muat ulang setelah simpan tidak boleh melepas isi tab (draf baris lain & posisi scroll).
  const initialLoading = loading && !products;

  return <div className="min-w-0 space-y-6">
    <PageHeader title="TUNVN" description="Reseller Telegram TUNVN: katalog, markup, dan pengiriman otomatis." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}>Muat ulang</Button>} />

    <SupplierTabs tabs={TABS} active={tab} onChange={setTab} />

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-admin-muted">Memproses…</p>}
      {error && <div role="alert" className="rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-admin-danger">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}
      {success && <p role="status" className="text-admin-success">{success}</p>}
    </div>

    {initialLoading && <p role="status" className="text-sm text-admin-muted">Memuat data TUNVN…</p>}

    {!initialLoading && tab === "ringkas" && <>
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Status TUNVN">
        <StatCard label="Saldo wallet" value={<span className="block truncate">{walletUsdt}</span>} hint={balance?.username ? `akun ${balance.username}` : "Diambil dari API TUNVN"} />
        <StatCard label="Produk tampil" value={counts.published} hint={`${counts.active_variants} varian aktif · ${counts.mapped} varian terpetakan · ${counts.total} mirror`} />
        <StatCard label="Sinkron terakhir" value={syncOneLine} hint="Katalog ditarik lewat tab Alat" />
      </div>
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Pengiriman otomatis</CardTitle><CardDescription className="mt-1 text-xs">100 pesanan terbaru. Rekonsiliasi hanya membaca batch yang diketahui; tidak membeli ulang.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {!links.length ? <p className="p-6 text-sm text-admin-muted">Belum ada pesanan otomatis.</p> : <>
            {/* Desktop tabel HANYA >=md; di 390 hanya kartu (jangan render dua-duanya). */}
            <div className="hidden overflow-x-auto md:block"><Table>
              <caption className="sr-only">Pengiriman otomatis TUNVN</caption>
              <TableHeader><TableRow>
                <TableHead>Pesanan</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Biaya</TableHead><TableHead>Status</TableHead><TableHead>Waktu</TableHead><TableHead className="text-right">Aksi</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {links.map(link => <TableRow key={link.id}>
                  <TableCell className="whitespace-nowrap">
                    <p className="font-medium text-admin-fg">{link.order_code}</p>
                    <p className="mt-1 text-xs text-admin-muted">item {link.item_index + 1}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-admin-muted">{link.kind} · {link.quantity} unit</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{usdt(link.cost_usdt)}</TableCell>
                  <TableCell className="min-w-[150px] text-xs">
                    <Badge variant={link.purchase_disabled ? "warning" : link.status === "completed" ? "success" : link.status === "needs_admin" ? "warning" : link.status === "failed" ? "destructive" : "secondary"}>{linkStatusLabel(link.status)}</Badge>
                    {link.purchase_disabled ? <p className="mt-1 text-admin-muted">Penanganan manual</p> : link.last_error && <p className="mt-1 text-admin-warning">{TUNVN_ERROR_LABEL[link.last_error] ?? "Perlu diperiksa"}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-admin-muted">{formatWibDateTime(String(link.completed_at ?? link.request_sent_at ?? "")) ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {Boolean(link.can_retry) && <Button variant="outline" size="sm" className="whitespace-nowrap" disabled={!!busy} onClick={() => void dispatchAction(link.id, "retry")}>Coba lagi</Button>}
                      {link.kind === "buff" && link.provider_batch_id && ["processing", "needs_admin"].includes(link.status) && <Button variant="outline" size="sm" className="whitespace-nowrap" disabled={!!busy} onClick={() => void dispatchAction(link.id, "reconcile")}>Periksa status</Button>}
                      {Boolean(link.has_receipt) && <Button variant="ghost" size="sm" className="whitespace-nowrap" disabled={!!busy} onClick={() => void dispatchAction(link.id, "reveal")}>Lihat receipt</Button>}
                    </div>
                  </TableCell>
                </TableRow>)}
              </TableBody>
            </Table></div>
            <div className="space-y-3 p-4 md:hidden" aria-label="Kartu pengiriman TUNVN">
              {links.map(link => <article key={link.id} className="space-y-2 rounded-xl border border-admin-border p-4 text-xs text-admin-muted">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-admin-fg">{link.order_code} · item {link.item_index + 1}</p>
                  <Badge variant={link.status === "completed" ? "success" : link.status === "needs_admin" ? "warning" : link.status === "failed" ? "destructive" : "secondary"}>{linkStatusLabel(link.status)}</Badge>
                </div>
                <p>{link.kind} · {link.quantity} unit · {usdt(link.cost_usdt)}</p>
                <p>{formatWibDateTime(String(link.completed_at ?? link.request_sent_at ?? "")) ?? "-"}</p>
                {link.purchase_disabled ? <p className="text-admin-warning">Pembelian otomatis dinonaktifkan · penanganan manual</p> : link.last_error && <p className="text-admin-warning">{TUNVN_ERROR_LABEL[link.last_error] ?? "Perlu diperiksa"}</p>}
                <div className="flex flex-wrap gap-2">
                  {Boolean(link.can_retry) && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void dispatchAction(link.id, "retry")}>Coba lagi</Button>}
                  {link.kind === "buff" && link.provider_batch_id && ["processing", "needs_admin"].includes(link.status) && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void dispatchAction(link.id, "reconcile")}>Periksa status</Button>}
                  {Boolean(link.has_receipt) && <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void dispatchAction(link.id, "reveal")}>Lihat receipt</Button>}
                </div>
              </article>)}
            </div>
          </>}
        </CardContent>
      </Card>
      <Dialog open={!!receipt} onOpenChange={open => { if (!open) setReceipt(""); }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Receipt pengiriman TUNVN</DialogTitle><DialogDescription>Data mentah hanya untuk admin; jangan dibagikan ke pembeli.</DialogDescription></DialogHeader>
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-admin-border bg-admin-subtle p-3 text-xs text-admin-muted">{receipt || "Receipt tidak tersedia."}</pre>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Kontrol publikasi</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-5 text-admin-muted">
            <li>Tab <b className="text-admin-fg">Katalog</b>: nyalakan <b className="text-admin-fg">Diminta terbit</b> per varian lalu <b className="text-admin-fg">Produk induk aktif</b> agar tampil di Market.</li>
            <li>Tab <b className="text-admin-fg">Markup</b>: markup, harga manual opsional, dan saklar aktif per varian (termasuk Buff Muse). Tekan Simpan per baris.</li>
            <li>Nama, deskripsi, gambar, dan label varian diatur di menu <b className="text-admin-fg">Produk</b>.</li>
            <li>Tab <b className="text-admin-fg">Alat</b> menyegarkan kurs + stok dari TUNVN. Order eligible diproses otomatis setelah lunas; jika saldo kurang, top up lalu Coba lagi. Pembelian ambigu tidak boleh diulang.</li>
          </ul>
        </CardContent>
      </Card>
    </>}

    {!initialLoading && tab === "antrean" && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk katalog…" aria-label="Cari produk katalog" />
        <p className="self-center text-xs text-admin-muted">{catalogItems.length} produk</p>
      </div>
      <p className="text-xs leading-5 text-admin-muted">Nama, deskripsi, gambar, dan label diatur di menu Produk. Di sini hanya permintaan terbit dan status produk induk.</p>
      {catalogItems.length === 0 && <p className="text-sm text-admin-muted">Belum ada produk katalog. Jalankan Sinkron di tab Alat.</p>}
      <div className="space-y-2">
        {catalogItems.map((item) => {
          const publishable = item.variant_id != null;
          const live = item.visible === 1;
          const archived = item.product_archived === 1;
          const key = `p${item.supplier_product_id}`;
          return <div key={item.supplier_product_id} className="grid gap-3 rounded-lg border border-admin-border bg-admin-card p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <p className="truncate font-medium text-admin-fg">{item.axvara_name ?? item.name}{item.variant_label ? ` · ${item.variant_label}` : ""}</p>
                <Badge variant={live ? "success" : "secondary"}>{live ? "Tampil publik" : "Tersembunyi"}</Badge>
                {archived && <Badge variant="secondary">Arsip</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-admin-muted">#{item.supplier_product_id} {item.name} · stok {item.stock} · {item.variant_price != null ? formatRupiah(item.variant_price) : "harga belum ada"}</p>
              {item.supplier_description?.trim() && <details className="group mt-1.5 text-xs">
                <summary className="cursor-pointer select-none text-admin-muted hover:text-admin-fg">Deskripsi supplier (rujukan admin, bukan untuk pembeli)</summary>
                <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-admin-border bg-admin-subtle/60 p-2.5 leading-5 text-admin-muted">{item.supplier_description}</p>
              </details>}
            </div>
            {publishable ? <>
              <div className="flex items-center justify-between gap-3 md:justify-start">
                <span className="text-xs text-admin-muted">Diminta terbit</span>
                <AdminStatusSwitch checked={item.publish_requested === 1} label={`Permintaan terbit ${item.name}`} disabled={!!busy || archived} busy={busy === key}
                  onChange={() => void patchProduct(item.supplier_product_id, { publish_requested: item.publish_requested !== 1 }, `Permintaan terbit ${item.name} ${item.publish_requested === 1 ? "dimatikan" : "dinyalakan"}.`)} />
              </div>
              <div className="flex items-center justify-between gap-3 md:justify-start">
                <span className="text-xs text-admin-muted">Produk induk aktif</span>
                <AdminStatusSwitch checked={item.axvara_is_active === 1} label={`${item.axvara_name ?? item.name} aktif`} disabled={!!busy || archived} busy={busy === key}
                  onChange={() => void patchProduct(item.supplier_product_id, { axvara_is_active: item.axvara_is_active !== 1 }, `${item.axvara_name ?? item.name} ${item.axvara_is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
              </div>
            </> : <p className="text-xs text-admin-warning md:col-span-2">Varian belum dibuat — jalankan Sinkron di tab Alat.</p>}
          </div>;
        })}
      </div>
      <p className="text-xs leading-5 text-admin-muted">Produk induk bisa berisi beberapa varian TUNVN. Diminta terbit mengatur varian ini saja; saklar produk induk memengaruhi semua varian. Aktifkan minimal satu varian sebelum produk.</p>
    </>}

    {!initialLoading && tab === "markup" && <>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari varian…" aria-label="Cari varian" />
        <p className="text-xs text-admin-muted">Harga jual = modal USDT dikali kurs tersimpan dikali (1 + markup). Harga manual mengalahkan rumus; kosongkan untuk kembali ke rumus.</p>
      </div>
      {familyGroups.length === 0 && <p className="text-sm text-admin-muted">Belum ada varian. Jalankan Sinkron di tab Alat sekali untuk membuatnya (tetap nonaktif).</p>}
      <div className="space-y-4">
        {familyGroups.map((group) => <Card key={group.key}>
          <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
            <CardTitle className="text-base">{group.name}</CardTitle>
            <StatusBadges archived={group.archived} parentInactive={!group.active} />
            <CardDescription className="w-full text-xs">{group.slug} · {group.items.length} varian</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            <SupplierPriceHeader />
            {group.items.map((item) => {
              const mapped = item.variant_id != null;
              const label = item.variant_label ?? item.name;
              const key = `p${item.supplier_product_id}`;
              return <SupplierPriceRow key={item.supplier_product_id} id={`tunvn-${item.supplier_product_id}`}
                title={label}
                meta={<>#{item.supplier_product_id} {item.name} · modal {costWithIdr(usdt(item.price_usdt), item.price_usdt, item.fx_idr_per_usdt)} · stok {item.stock}</>}
                badges={!mapped ? <Badge variant="warning">Belum dibuat</Badge> : undefined}
                markup={Number(item.markup_percent)} manual={item.tunvn_admin_price_idr} price={item.variant_price}
                active={item.variant_is_active === 1} canEdit={mapped && !group.archived} locked={!!busy} busy={busy === key}
                notice={!mapped ? "Varian belum dibuat — jalankan Sinkron di tab Alat." : undefined}
                onToggle={() => void patchProduct(item.supplier_product_id, { is_active: item.variant_is_active !== 1 }, `${label} ${item.variant_is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)}
                onSave={(body) => patchProduct(item.supplier_product_id, body, `Harga ${label} disimpan.`)} />;
            })}
          </CardContent>
        </Card>)}

        {buffVariants.length > 0 && <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
            <CardTitle className="text-base">Buff Token Muse</CardTitle>
            <StatusBadges archived={buff?.muse_product?.archived === 1} parentInactive={buff?.muse_product ? buff.muse_product.is_active !== 1 : false} />
            <CardDescription className="w-full text-xs">
              {buff?.probe
                ? <>Modal terverifikasi {buff.probe.cost_per_b_usdt.toFixed(4)} USDT/1B · layanan {buff.probe.fundable ? <span className="text-admin-success">bisa diproses</span> : <span className="text-admin-warning">sementara tidak bisa</span>}</>
                : <span className="text-admin-warning">Probe tidak tersedia{buff?.probe_error ? ` (${buff.probe_error})` : ""}; harga memakai snapshot terakhir.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-4 pt-0">
            <SupplierPriceHeader />
            {buffVariants.map((variant) => <SupplierPriceRow key={variant.sku} id={`buff-${variant.sku}`}
              title={variant.label}
              meta={<>{variant.tunvn_buff_quantity_b}B token · modal {costWithIdr(usdt(variant.tunvn_cost_usdt), variant.tunvn_cost_usdt, variant.tunvn_fx_idr_per_usdt)}</>}
              markup={Number(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT)} manual={variant.tunvn_admin_price_idr} price={variant.price}
              active={variant.is_active === 1} canEdit={buff?.muse_product?.archived !== 1} locked={!!busy} busy={busy === variant.sku}
              onToggle={() => void patchBuff(variant.sku, { is_active: variant.is_active !== 1 }, `${variant.label} ${variant.is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)}
              onSave={(body) => patchBuff(variant.sku, body, `Harga ${variant.label} disimpan.`)} />)}
          </CardContent>
        </Card>}
      </div>
    </>}

    {!initialLoading && tab === "alat" && <Card>
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron &amp; perbarui katalog</CardTitle></CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm leading-5 text-admin-muted">Menarik katalog terbaru dari TUNVN dan menghitung ulang harga dengan kurs USDT dari snapshot AXVARA. Status terbit, markup, harga manual, nama, dan deskripsi yang diatur admin tidak ditimpa; produk yang tidak diminta terbit tetap tersembunyi.</p>
        <Button disabled={busy === "publish" || !products?.configured} onClick={() => void publish()}>
          <Zap /> {busy === "publish" ? "Menyinkronkan…" : "Sinkron & perbarui sekarang"}
        </Button>
        {!products?.configured && <p className="text-xs text-admin-warning">API TUNVN belum terkonfigurasi di Pages (TUNVN_ENABLED/TUNVN_API_KEY). Tombol aktif setelah env dipasang dan deployment berjalan.</p>}
      </CardContent>
    </Card>}
  </div>;
}
