"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Zap } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "@/components/admin/ui";
import { SupplierTabs, type SupplierTabId } from "@/components/admin/SupplierTabs";
import { AdminStatusSwitch } from "./AdminStatusSwitch";
import { TUNVN_BUFF_MARKUP_PERCENT, TUNVN_CHATGPT_MARKUP_PERCENT } from "@/lib/tunvn/pricing";
import { TUNVN_ERROR_LABEL } from "./SupplierLinkActions";

type Item = {
  supplier_product_id: number; name: string; price_vnd: number; price_usdt: number | null;
  stock: number; visible: number; axvara_product_id: number | null;
  markup_percent: number; sell_price_idr: number | null; fx_idr_per_usdt: number | null;
  synced_at: string | null; admin_name: string | null; admin_description: string | null;
  publish_requested: number; axvara_name: string | null; axvara_description: string | null;
  axvara_is_active: number | null; variant_price: number | null; variant_is_active: number | null;
};
type ProductsData = {
  ok: boolean; configured: boolean; items: Item[];
  counts: { total: number; published: number; requested: number; in_stock: number };
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
  muse_product: { id: number; is_active: number } | null;
};
type Row = Record<string, unknown>;
type DispatchLink = { id:number; order_code:string; item_index:number; kind:string; quantity:number; cost_usdt:number; status:string; provider_order_group:string|null; provider_batch_id:string|null; provider_order_code:string|null; last_error:string|null; receipt_json:string|null; has_receipt:number; can_retry?:number; purchase_disabled?:number; request_sent_at?:string|null; completed_at?:string|null };

const TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkas" },
  { id: "antrean", label: "Antrean" },
  { id: "markup", label: "Markup" },
  { id: "alat", label: "Alat" },
];
const PUBLISHABLE = [86, 83];
/** Label status pengiriman yang manusiawi (D5) — kode mentah hanya di receipt. */
const LINK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu", ordering: "Antre dikirim", submitted: "Diproses supplier", processing: "Diproses supplier",
  completed: "Selesai", failed: "Gagal", needs_admin: "Perlu tindakan", retry: "Dicoba ulang", canceled: "Dibatalkan",
};
const linkStatusLabel = (status: string) => LINK_STATUS_LABEL[status] ?? "Status lain";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as (Row & { error?: string; message?: string }) | null;
  if (!data) throw new Error("Permintaan gagal. Coba lagi.");
  if (!response.ok && data.error !== "not_configured") throw new Error(String(data.message || data.error || "Permintaan gagal. Coba lagi."));
  return data as T;
}

const usdt = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${value} USDT`);
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const [nextProducts, nextBalance, nextBuff, nextOrders] = await Promise.all([
        request<ProductsData>("/api/admin/tunvn/products"),
        request<BalanceData>("/api/admin/tunvn/balance"),
        request<BuffData>("/api/admin/tunvn/buff"),
        request<{items:DispatchLink[]}>("/api/admin/tunvn/orders"),
      ]);
      if (current !== generation.current) return;
      setProducts(nextProducts); setBalance(nextBalance); setBuff(nextBuff);
      setLinks(nextOrders.items ?? []);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Data TUNVN gagal dimuat.");
    } finally { if (current === generation.current) setLoading(false); }
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
      const result = await request<Row & { chatgpt?: number; buff_variants?: number; idr_per_usdt?: number; activated?: number; error?: string }>(
        "/api/admin/tunvn/publish", { method: "POST" },
      );
      if (result.error) throw new Error(String(result.error));
      await load();
      setSuccess(`Sinkron selesai: ${result.chatgpt ?? 0} produk ChatGPT diperbarui, ${result.buff_variants ?? 0} varian Buff, ${result.activated ?? 0} tampil publik (kurs Rp${Number(result.idr_per_usdt ?? 0).toLocaleString("id-ID")}/USDT).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Publikasi gagal."); }
    finally { setBusy(""); }
  }

  const draft = (key: string, fallback: string) => drafts[key] ?? fallback;
  const setDraft = (key: string, value: string) => setDrafts((d) => ({ ...d, [key]: value }));

  function saveMarkup(item: Item) {
    const raw = drafts[`m${item.supplier_product_id}`];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1000) { setError("Markup harus 0–1000%."); return; }
    if (value === item.markup_percent) return;
    void patchProduct(item.supplier_product_id, { markup_percent: value }, `Markup ${item.name} disimpan ${value}%.`);
  }

  function saveText(item: Item) {
    const name = drafts[`n${item.supplier_product_id}`];
    const desc = drafts[`d${item.supplier_product_id}`];
    if (name === undefined && desc === undefined) return;
    void patchProduct(item.supplier_product_id, {
      ...(name !== undefined ? { admin_name: name.trim() || null } : {}),
      ...(desc !== undefined ? { admin_description: desc.trim() || null } : {}),
    }, `Nama/deskripsi ${item.name} disimpan.`);
  }

  const items = (products?.items ?? []).filter((item) => !q || `${item.supplier_product_id} ${item.name} ${item.admin_name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const counts = products?.counts ?? { total: 0, published: 0, requested: 0, in_stock: 0 };
  // Satu baris pendek: nominal USDT (mata uang wallet), VND hanya sebagai hint.
  const walletUsdt = balance?.ok && balance.balance_usdt != null
    ? `${Number(balance.balance_usdt).toLocaleString("id-ID", { maximumFractionDigits: 4 })} USDT`
    : balance?.error === "not_configured" ? "Belum terkonfigurasi" : "Belum terbaca";
  const walletVnd = balance?.ok && balance.balance_vnd != null ? `${Number(balance.balance_vnd).toLocaleString("id-ID")} VND` : null;
  const syncOneLine = compactTunvnTime(products?.last_sync_at);

  return <div className="min-w-0 space-y-6">
    <PageHeader title="Saldo TUNVN" description="Reseller Telegram TUNVN: katalog, markup, dan pengiriman otomatis." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}>Muat ulang</Button>} />

    <SupplierTabs tabs={TABS} active={tab} onChange={setTab} />

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-admin-muted">Memproses…</p>}
      {error && <div role="alert" className="rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-admin-danger">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}
      {success && <p role="status" className="text-admin-success">{success}</p>}
    </div>

    {loading && <p role="status" className="text-sm text-admin-muted">Memuat data TUNVN…</p>}

    {!loading && tab === "ringkas" && <>
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Status TUNVN">
        <StatCard label="Saldo wallet" value={<span className="block truncate">{walletUsdt}</span>} hint={[walletVnd, balance?.username ? `akun ${balance.username}` : null].filter(Boolean).join(" · ") || "Diambil dari API TUNVN"} />
        <StatCard label="Produk tampil" value={counts.published} hint={`${counts.total} produk mirror · ${counts.requested} diminta terbit`} />
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
            <li>Tab <b className="text-admin-fg">Antrean</b>: atur markup, nama, dan deskripsi tiap produk; nyalakan <b className="text-admin-fg">Diminta terbit</b> lalu <b className="text-admin-fg">Produk aktif</b> untuk menampilkannya.</li>
            <li>Harga jual dihitung ulang otomatis dari modal USDT dikali kurs tersimpan dan markup. Tab Alat menyegarkan kurs + stok dari TUNVN.</li>
            <li>Tab <b className="text-admin-fg">Markup</b>: markup per varian, harga manual opsional, dan saklar aktif per varian pada produk Muse AI.</li>
            <li>Order eligible diproses otomatis setelah lunas. Jika saldo kurang, top up TUNVN lalu Coba lagi; pembelian ambigu tidak boleh diulang.</li>
          </ul>
        </CardContent>
      </Card>
    </>}

    {!loading && tab === "antrean" && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk mirror…" aria-label="Cari produk mirror" />
        <p className="self-end text-xs text-admin-muted">{items.length} produk tampil</p>
      </div>
      {items.length === 0 && <p className="text-sm text-admin-muted">Belum ada produk mirror. Jalankan Publikasi untuk sinkron pertama.</p>}
      <div className="space-y-3">
        {items.map((item) => {
          const publishable = PUBLISHABLE.includes(item.supplier_product_id);
          const live = item.visible === 1;
          const expanded = openId === item.supplier_product_id;
          return <Card key={item.supplier_product_id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-admin-fg">#{item.supplier_product_id} {item.admin_name || item.name}</p>
                  <p className="mt-0.5 truncate text-xs text-admin-muted">{item.name} · stok {item.stock} · sinkron {compactTunvnTime(item.synced_at)}</p>
                  <p className="mt-1 text-xs text-admin-muted">Modal {usdt(item.price_usdt)} ({item.price_vnd.toLocaleString("id-ID")} VND) · Harga {item.sell_price_idr ? formatRupiah(item.sell_price_idr) : "-"} · Kurs {item.fx_idr_per_usdt ? `Rp${Math.round(item.fx_idr_per_usdt).toLocaleString("id-ID")}` : "-"}</p>
                </div>
                <Badge variant={live ? "success" : "secondary"}>{live ? "Tampil publik" : "Tersembunyi"}</Badge>
                <Button type="button" variant="outline" size="sm" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : item.supplier_product_id)}>{expanded ? "Tutup" : "Atur"}</Button>
              </div>

              {expanded && <div className="mt-4 grid gap-4 border-t border-admin-border pt-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label htmlFor={`tunvn-markup-${item.supplier_product_id}`} className="text-xs font-medium text-admin-muted">Markup (0–1000%)</label>
                    <Input id={`tunvn-markup-${item.supplier_product_id}`} type="number" min={0} max={1000} step="0.5" inputMode="decimal"
                      value={draft(`m${item.supplier_product_id}`, String(item.markup_percent))}
                      onChange={(e) => setDraft(`m${item.supplier_product_id}`, e.target.value)}
                      onBlur={() => saveMarkup(item)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMarkup(item); } }} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`tunvn-name-${item.supplier_product_id}`} className="text-xs font-medium text-admin-muted">Nama publik (kosong = bawaan)</label>
                    <Input id={`tunvn-name-${item.supplier_product_id}`} maxLength={160}
                      value={draft(`n${item.supplier_product_id}`, item.admin_name ?? "")}
                      placeholder={item.axvara_name ?? item.name}
                      onChange={(e) => setDraft(`n${item.supplier_product_id}`, e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`tunvn-desc-${item.supplier_product_id}`} className="text-xs font-medium text-admin-muted">Deskripsi publik (kosong = bawaan)</label>
                    <Textarea id={`tunvn-desc-${item.supplier_product_id}`} className="min-h-24" maxLength={4000}
                      value={draft(`d${item.supplier_product_id}`, item.admin_description ?? "")}
                      placeholder={item.axvara_description ?? ""}
                      onChange={(e) => setDraft(`d${item.supplier_product_id}`, e.target.value)} />
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={busy === `p${item.supplier_product_id}`} onClick={() => saveText(item)}>Simpan nama &amp; deskripsi</Button>
                  <p className="text-xs text-admin-muted">Markup bawaan: ChatGPT {TUNVN_CHATGPT_MARKUP_PERCENT}%. Mengubah markup langsung menghitung ulang harga dari kurs tersimpan.</p>
                </div>
                <div className="space-y-3">
                  {publishable ? <>
                    <div className="flex items-center justify-between gap-3 rounded-md border border-admin-border bg-admin-subtle/60 px-3 py-2">
                      <span className="text-xs text-admin-muted">Diminta terbit</span>
                      <AdminStatusSwitch checked={item.publish_requested === 1} label={`Permintaan terbit ${item.name}`} disabled={busy === `p${item.supplier_product_id}`} busy={busy === `p${item.supplier_product_id}`}
                        onChange={() => void patchProduct(item.supplier_product_id, { publish_requested: item.publish_requested !== 1 }, `Permintaan terbit ${item.name} ${item.publish_requested === 1 ? "dimatikan" : "dinyalakan"}.`)} />
                    </div>
                    {item.supplier_product_id === 86 && <div className="flex items-center justify-between gap-3 rounded-md border border-admin-border bg-admin-subtle/60 px-3 py-2">
                      <span className="text-xs text-admin-muted">ChatGPT Private aktif di Market</span>
                      <AdminStatusSwitch checked={item.axvara_is_active === 1} label="ChatGPT Private aktif" disabled={busy === `p${item.supplier_product_id}`} busy={busy === `p${item.supplier_product_id}`}
                        onChange={() => void patchProduct(item.supplier_product_id, { axvara_is_active: item.axvara_is_active !== 1 }, `${item.name} ${item.axvara_is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
                    </div>}
                    <p className="text-xs leading-4 text-admin-muted">Satu produk ChatGPT Private, dua varian. Diminta terbit mengatur varian ini saja; saklar produk bersama ada di Business. Mematikan GPay tidak menyembunyikan Business. Aktifkan minimal satu varian sebelum produk.</p>
                  </> : <p className="text-xs leading-5 text-admin-warning">Produk ini belum punya pemetaan terbit AXVARA, jadi hanya bisa diatur markup/nama/deskripsinya dan tetap tersembunyi. Pemetaan terbit baru ditambah lewat rilis katalog berikutnya.</p>}
                </div>
              </div>}
            </CardContent>
          </Card>;
        })}
      </div>
    </>}

    {!loading && tab === "markup" && <>
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Probe Buff live</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {buff?.probe ? <p className="text-xs text-admin-muted">Modal terverifikasi {buff.probe.cost_per_b_usdt.toFixed(4)} USDT/1B · status layanan {buff.probe.fundable ? <span className="text-admin-success">bisa diproses</span> : <span className="text-admin-warning">sementara tidak bisa</span>} · Produk Muse {buff.muse_product?.is_active ? <span className="text-admin-success">aktif</span> : <span className="text-admin-warning">nonaktif</span>}.</p>
            : <p className="text-xs text-admin-warning">Probe tidak tersedia{buff?.probe_error ? ` (${buff.probe_error})` : ""}; harga varian memakai snapshot terakhir.</p>}
        </CardContent>
      </Card>
      {(buff?.variants ?? []).length === 0 && <p className="text-sm text-admin-muted">Varian Buff belum dibuat. Jalankan Publikasi sekali untuk membuatnya (tetap nonaktif).</p>}
      <div className="space-y-3">
        {(buff?.variants ?? []).map((variant) => <Card key={variant.sku}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-admin-fg">{variant.label}</p>
                <p className="mt-0.5 text-xs text-admin-muted">{variant.sku} · {variant.tunvn_buff_quantity_b}B token · modal {usdt(variant.tunvn_cost_usdt)} · kurs {variant.tunvn_fx_idr_per_usdt ? `Rp${Math.round(variant.tunvn_fx_idr_per_usdt).toLocaleString("id-ID")}` : "-"}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-admin-fg">{formatRupiah(variant.price)}</p>
              </div>
              <AdminStatusSwitch checked={variant.is_active === 1} label={`Aktif ${variant.label}`} disabled={busy === variant.sku} busy={busy === variant.sku}
                onChange={() => void patchBuff(variant.sku, { is_active: variant.is_active !== 1 }, `${variant.label} ${variant.is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor={`buff-markup-${variant.sku}`} className="text-xs font-medium text-admin-muted">Markup %</label>
                <Input id={`buff-markup-${variant.sku}`} type="number" min={0} max={1000} step="0.5" inputMode="decimal"
                  value={draft(`bm${variant.sku}`, String(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT))}
                  onChange={(e) => setDraft(`bm${variant.sku}`, e.target.value)}
                  onBlur={() => {
                    const raw = drafts[`bm${variant.sku}`]; if (raw === undefined) return;
                    const value = Number(raw);
                    if (!Number.isFinite(value) || value < 0 || value > 1000) { setError("Markup harus 0–1000%."); return; }
                    if (value !== (variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT)) void patchBuff(variant.sku, { markup_percent: value }, `Markup ${variant.label} disimpan ${value}%.`);
                  }} />
              </div>
              <div className="space-y-2">
                <label htmlFor={`buff-price-${variant.sku}`} className="text-xs font-medium text-admin-muted">Harga manual Rp (kosong = rumus)</label>
                <Input id={`buff-price-${variant.sku}`} type="number" min={0} step={100} inputMode="numeric"
                  value={draft(`bp${variant.sku}`, variant.tunvn_admin_price_idr === null ? "" : String(variant.tunvn_admin_price_idr))}
                  onChange={(e) => setDraft(`bp${variant.sku}`, e.target.value)}
                  onBlur={() => {
                    const raw = drafts[`bp${variant.sku}`]; if (raw === undefined) return;
                    const value = raw.trim() === "" ? null : Number(raw);
                    if (value !== null && (!Number.isInteger(value) || value < 0)) { setError("Harga manual harus bilangan bulat ≥ 0."); return; }
                    void patchBuff(variant.sku, { admin_price_idr: value }, `Harga ${variant.label} disimpan.`);
                  }} />
              </div>
              <div className="space-y-2">
                <label htmlFor={`buff-label-${variant.sku}`} className="text-xs font-medium text-admin-muted">Label varian</label>
                <Input id={`buff-label-${variant.sku}`} maxLength={120}
                  value={draft(`bl${variant.sku}`, variant.label)}
                  onChange={(e) => setDraft(`bl${variant.sku}`, e.target.value)}
                  onBlur={() => {
                    const raw = drafts[`bl${variant.sku}`]; if (raw === undefined || raw.trim() === "" || raw === variant.label) return;
                    void patchBuff(variant.sku, { label: raw.trim() }, `Label ${variant.sku} disimpan.`);
                  }} />
              </div>
            </div>
          </CardContent>
        </Card>)}
      </div>
    </>}

    {!loading && tab === "alat" && <Card>
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron &amp; perbarui katalog</CardTitle></CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm leading-5 text-admin-muted">Menarik katalog terbaru dari TUNVN dan menghitung ulang harga dengan kurs USDT dari snapshot AXVARA. Status terbit, markup, nama, dan deskripsi yang diatur admin tidak ditimpa; produk yang tidak diminta terbit tetap tersembunyi.</p>
        <Button disabled={busy === "publish" || !products?.configured} onClick={() => void publish()}>
          <Zap /> {busy === "publish" ? "Menyinkronkan…" : "Sinkron & perbarui sekarang"}
        </Button>
        {!products?.configured && <p className="text-xs text-admin-warning">API TUNVN belum terkonfigurasi di Pages (TUNVN_ENABLED/TUNVN_API_KEY). Tombol aktif setelah env dipasang dan deployment berjalan.</p>}
        <Button variant="outline" onClick={() => void load()}>Muat ulang data</Button>
      </CardContent>
    </Card>}
  </div>;
}
