"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
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
type DispatchLink = { id:number; order_code:string; item_index:number; kind:string; quantity:number; cost_usdt:number; status:string; provider_order_group:string|null; provider_batch_id:string|null; provider_order_code:string|null; last_error:string|null; receipt_json:string|null; has_receipt:number; can_retry?:number; purchase_disabled?:number };

const INPUT = "mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition focus:border-[#00E5FF]/50 [color-scheme:dark]";
const TEXTAREA = `${INPUT} min-h-24`;
const BUTTON = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50";
const PRIMARY = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#00E5FF] px-4 text-sm font-bold text-[#07101f] transition hover:bg-[#00E5FF]/90 disabled:opacity-50";
const TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkasan" },
  { id: "antrean", label: "Katalog & Terbit" },
  { id: "markup", label: "Buff Muse" },
  { id: "alat", label: "Publikasi" },
];
const PUBLISHABLE = [86, 83];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as (Row & { error?: string; message?: string }) | null;
  if (!data) throw new Error("Permintaan gagal. Coba lagi.");
  if (!response.ok && data.error !== "not_configured") throw new Error(String(data.message || data.error || "Permintaan gagal. Coba lagi."));
  return data as T;
}

const usdt = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${value} USDT`);

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

  return <div className="mt-5 min-w-0 space-y-4">
    <header>
      <h2 className="font-display text-xl font-semibold text-white">TUNVN PREHUB</h2>
      <p className="mt-1 text-xs text-white/40">Reseller Telegram TUNVN. Semua produk mulai nonaktif; tampil publik hanya bila permintaan terbit + produk aktif dinyalakan di sini.</p>
    </header>

    <SupplierTabs tabs={TABS} active={tab} onChange={setTab} />

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-[#00E5FF]">Memproses…</p>}
      {error && <p role="alert" className="text-red-300">{error} <button type="button" className="underline" onClick={() => void load()}>Muat ulang</button></p>}
      {success && <p role="status" className="text-emerald-300">{success}</p>}
    </div>

    {loading && <p role="status" className="text-sm text-white/60">Memuat data TUNVN…</p>}

    {!loading && tab === "ringkas" && <>
      <section className="ax-glass space-y-3 rounded-[20px] p-4" aria-label="Pengiriman otomatis">
        <h3 className="text-sm font-semibold text-white">Pengiriman otomatis</h3>
        <p className="text-xs text-white/50">100 baris terbaru. Rekonsiliasi hanya membaca batch Buff yang diketahui; tidak membeli ulang. Receipt tambahan hanya untuk admin.</p>
        {!links.length && <p className="text-xs text-white/50">Belum ada pesanan otomatis.</p>}
        {links.map(link=><div key={link.id} className="min-w-0 space-y-1 border-t border-white/10 pt-3 text-xs text-white/70">
          <p className="break-all font-semibold text-white">{link.order_code} · item {link.item_index+1} · {link.status}</p>
          <p>{link.kind} ×{link.quantity} · snapshot biaya {usdt(link.cost_usdt)}</p>
          <p className="break-all">{[link.provider_order_group,link.provider_batch_id,link.provider_order_code].filter(Boolean).join(" · ") || "Belum ada ID penyedia"}</p>
          {link.receipt_json && <p className="break-all">{link.receipt_json}</p>}
          {link.purchase_disabled ? <p className="text-amber-300">Pembelian otomatis dinonaktifkan · penanganan manual</p> : link.last_error && <p className="text-amber-300">{TUNVN_ERROR_LABEL[link.last_error] ?? link.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            {Boolean(link.can_retry) && <button type="button" className={`${PRIMARY} min-h-12`} disabled={!!busy} onClick={()=>void dispatchAction(link.id,"retry")}>Retry</button>}
            {link.kind==="buff" && link.provider_batch_id && ["processing","needs_admin"].includes(link.status) && <button type="button" className={BUTTON} disabled={!!busy} onClick={()=>void dispatchAction(link.id,"reconcile")}>Periksa status batch</button>}
            {Boolean(link.has_receipt) && <button type="button" className={BUTTON} disabled={!!busy} onClick={()=>void dispatchAction(link.id,"reveal")}>Buka receipt privat</button>}
          </div>
        </div>)}
        {receipt && <div><button type="button" className={BUTTON} onClick={()=>setReceipt("")}>Tutup receipt</button><pre className="mt-2 whitespace-pre-wrap break-all text-xs text-white/70">{receipt}</pre></div>}
      </section>
      <section className="ax-glass grid gap-3 rounded-[20px] p-4 text-sm text-white/70 sm:grid-cols-2 xl:grid-cols-5" aria-label="Status TUNVN">
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Koneksi API</p><p className={`mt-1 font-semibold ${products?.configured ? "text-emerald-300" : "text-amber-300"}`}>{products?.configured ? "Terhubung" : "Belum terkonfigurasi"}</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Saldo wallet</p><p className="mt-1 font-semibold text-white">{balance?.ok ? `${usdt(balance.balance_usdt)} · ${Number(balance.balance_vnd ?? 0).toLocaleString("id-ID")} VND` : "Tidak terbaca"}</p>{balance?.username && <p className="mt-0.5 text-[11px] text-white/35">{balance.username}</p>}</div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Produk mirror</p><p className="mt-1 font-semibold text-white">{counts.total}</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Tampil publik</p><p className="mt-1 font-semibold text-emerald-300">{counts.published}</p><p className="mt-0.5 text-[11px] text-white/35">{counts.requested} diminta terbit</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Sinkron terakhir</p><p className="mt-1 font-semibold text-white">{formatWibDateTime(products?.last_sync_at) ?? "Belum pernah"}</p></div>
      </section>
      <section className="ax-glass rounded-[20px] p-4 text-sm text-white/65">
        <h3 className="font-semibold text-white">Kontrol publikasi</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
          <li>Tab <b className="text-white">Katalog &amp; Terbit</b>: atur markup, nama, dan deskripsi tiap produk; nyalakan <b className="text-white">Diminta terbit</b> lalu <b className="text-white">Produk aktif</b> untuk menampilkannya.</li>
          <li>Harga jual dihitung ulang otomatis dari modal USDT × kurs tersimpan × (1 + markup). Tombol Publikasi menyegarkan kurs + stok dari TUNVN.</li>
          <li>Tab <b className="text-white">Buff Muse</b>: markup per varian, harga manual opsional, dan saklar aktif per varian pada produk Muse AI.</li>
          <li>Order eligible diproses otomatis setelah lunas. Jika saldo kurang, top up TUNVN lalu Retry; pembelian ambigu tidak boleh diulang.</li>
        </ul>
      </section>
    </>}

    {!loading && tab === "antrean" && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
        <label className="block min-w-0 text-xs font-medium text-white/65">Cari produk mirror<input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="chatgpt, Muse, capcut…" /></label>
        <p className="self-end text-xs text-white/50">{items.length} produk tampil</p>
      </div>
      {items.length === 0 && <p className="text-sm text-white/65">Belum ada produk mirror. Jalankan Publikasi untuk sinkron pertama.</p>}
      <div className="space-y-3">
        {items.map((item) => {
          const publishable = PUBLISHABLE.includes(item.supplier_product_id);
          const live = item.visible === 1;
          const expanded = openId === item.supplier_product_id;
          return <section key={item.supplier_product_id} className="ax-glass rounded-[20px] p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">#{item.supplier_product_id} {item.admin_name || item.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/35">{item.name} · stok {item.stock} · sinkron {formatWibDateTime(item.synced_at) ?? "-"}</p>
                <p className="mt-1 text-xs text-white/55">Modal {usdt(item.price_usdt)} ({item.price_vnd.toLocaleString("id-ID")} VND) · Harga {item.sell_price_idr ? formatRupiah(item.sell_price_idr) : "-"} · Kurs {item.fx_idr_per_usdt ? `Rp${Math.round(item.fx_idr_per_usdt).toLocaleString("id-ID")}` : "-"}</p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${live ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-white/15 bg-white/[0.05] text-white/45"}`}>{live ? "Tampil publik" : "Tersembunyi"}</span>
              <button type="button" className={BUTTON} aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : item.supplier_product_id)}>{expanded ? "Tutup" : "Atur"}</button>
            </div>

            {expanded && <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 lg:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs font-medium text-white/65">Markup % (0–1000)
                  <input className={INPUT} type="number" min={0} max={1000} step="0.5" inputMode="decimal"
                    value={draft(`m${item.supplier_product_id}`, String(item.markup_percent))}
                    onChange={(e) => setDraft(`m${item.supplier_product_id}`, e.target.value)}
                    onBlur={() => saveMarkup(item)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMarkup(item); } }} />
                </label>
                <label className="block text-xs font-medium text-white/65">Nama publik (kosong = bawaan)
                  <input className={INPUT} maxLength={160}
                    value={draft(`n${item.supplier_product_id}`, item.admin_name ?? "")}
                    placeholder={item.axvara_name ?? item.name}
                    onChange={(e) => setDraft(`n${item.supplier_product_id}`, e.target.value)} />
                </label>
                <label className="block text-xs font-medium text-white/65">Deskripsi publik (kosong = bawaan)
                  <textarea className={TEXTAREA} maxLength={4000}
                    value={draft(`d${item.supplier_product_id}`, item.admin_description ?? "")}
                    placeholder={item.axvara_description ?? ""}
                    onChange={(e) => setDraft(`d${item.supplier_product_id}`, e.target.value)} />
                </label>
                <button type="button" className={BUTTON} disabled={busy === `p${item.supplier_product_id}`} onClick={() => saveText(item)}>Simpan nama &amp; deskripsi</button>
                <p className="text-[11px] text-white/35">Markup bawaan: ChatGPT {TUNVN_CHATGPT_MARKUP_PERCENT}%. Mengubah markup langsung menghitung ulang harga dari kurs tersimpan.</p>
              </div>
              <div className="space-y-3">
                {publishable ? <>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <span className="text-xs text-white/70">Diminta terbit</span>
                    <AdminStatusSwitch checked={item.publish_requested === 1} label={`Permintaan terbit ${item.name}`} disabled={busy === `p${item.supplier_product_id}`} busy={busy === `p${item.supplier_product_id}`}
                      onChange={() => void patchProduct(item.supplier_product_id, { publish_requested: item.publish_requested !== 1 }, `Permintaan terbit ${item.name} ${item.publish_requested === 1 ? "dimatikan" : "dinyalakan"}.`)} />
                  </div>
                  {item.supplier_product_id === 86 && <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <span className="text-xs text-white/70">ChatGPT Private aktif di Market</span>
                    <AdminStatusSwitch checked={item.axvara_is_active === 1} label="ChatGPT Private aktif" disabled={busy === `p${item.supplier_product_id}`} busy={busy === `p${item.supplier_product_id}`}
                      onChange={() => void patchProduct(item.supplier_product_id, { axvara_is_active: item.axvara_is_active !== 1 }, `${item.name} ${item.axvara_is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
                  </div>}
                  <p className="text-[11px] leading-4 text-white/35">Satu produk ChatGPT Private, dua varian. Diminta terbit mengatur varian ini saja; saklar produk bersama ada di Business. Mematikan GPay tidak menyembunyikan Business. Aktifkan minimal satu varian sebelum produk.</p>
                </> : <p className="text-xs leading-5 text-amber-200/80">Produk ini belum punya pemetaan terbit AXVARA, jadi hanya bisa diatur markup/nama/deskripsinya dan tetap tersembunyi. Pemetaan terbit baru ditambah lewat rilis katalog berikutnya.</p>}
              </div>
            </div>}
          </section>;
        })}
      </div>
    </>}

    {!loading && tab === "markup" && <>
      <section className="ax-glass rounded-[20px] p-4 text-sm text-white/65">
        <h3 className="font-semibold text-white">Probe Buff live</h3>
        {buff?.probe ? <p className="mt-1 text-xs">Modal terverifikasi {buff.probe.cost_per_b_usdt.toFixed(4)} USDT/1B · status layanan {buff.probe.fundable ? <span className="text-emerald-300">bisa diproses</span> : <span className="text-amber-300">sementara tidak bisa</span>} · Produk Muse {buff.muse_product?.is_active ? <span className="text-emerald-300">aktif</span> : <span className="text-amber-300">nonaktif</span>}.</p>
          : <p className="mt-1 text-xs text-amber-300">Probe tidak tersedia{buff?.probe_error ? ` (${buff.probe_error})` : ""}; harga varian memakai snapshot terakhir.</p>}
      </section>
      {(buff?.variants ?? []).length === 0 && <p className="text-sm text-white/65">Varian Buff belum dibuat. Jalankan Publikasi sekali untuk membuatnya (tetap nonaktif).</p>}
      <div className="space-y-3">
        {(buff?.variants ?? []).map((variant) => <section key={variant.sku} className="ax-glass rounded-[20px] p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{variant.label}</p>
              <p className="mt-0.5 text-[11px] text-white/35">{variant.sku} · {variant.tunvn_buff_quantity_b}B token · modal {usdt(variant.tunvn_cost_usdt)} · kurs {variant.tunvn_fx_idr_per_usdt ? `Rp${Math.round(variant.tunvn_fx_idr_per_usdt).toLocaleString("id-ID")}` : "-"}</p>
              <p className="mt-1 text-sm font-semibold text-white">{formatRupiah(variant.price)}</p>
            </div>
            <AdminStatusSwitch checked={variant.is_active === 1} label={`Aktif ${variant.label}`} disabled={busy === variant.sku} busy={busy === variant.sku}
              onChange={() => void patchBuff(variant.sku, { is_active: variant.is_active !== 1 }, `${variant.label} ${variant.is_active === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-white/65">Markup %
              <input className={INPUT} type="number" min={0} max={1000} step="0.5" inputMode="decimal"
                value={draft(`bm${variant.sku}`, String(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT))}
                onChange={(e) => setDraft(`bm${variant.sku}`, e.target.value)}
                onBlur={() => {
                  const raw = drafts[`bm${variant.sku}`]; if (raw === undefined) return;
                  const value = Number(raw);
                  if (!Number.isFinite(value) || value < 0 || value > 1000) { setError("Markup harus 0–1000%."); return; }
                  if (value !== (variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT)) void patchBuff(variant.sku, { markup_percent: value }, `Markup ${variant.label} disimpan ${value}%.`);
                }} />
            </label>
            <label className="block text-xs font-medium text-white/65">Harga manual Rp (kosong = rumus)
              <input className={INPUT} type="number" min={0} step={100} inputMode="numeric"
                value={draft(`bp${variant.sku}`, variant.tunvn_admin_price_idr === null ? "" : String(variant.tunvn_admin_price_idr))}
                onChange={(e) => setDraft(`bp${variant.sku}`, e.target.value)}
                onBlur={() => {
                  const raw = drafts[`bp${variant.sku}`]; if (raw === undefined) return;
                  const value = raw.trim() === "" ? null : Number(raw);
                  if (value !== null && (!Number.isInteger(value) || value < 0)) { setError("Harga manual harus bilangan bulat ≥ 0."); return; }
                  void patchBuff(variant.sku, { admin_price_idr: value }, `Harga ${variant.label} disimpan.`);
                }} />
            </label>
            <label className="block text-xs font-medium text-white/65">Label varian
              <input className={INPUT} maxLength={120}
                value={draft(`bl${variant.sku}`, variant.label)}
                onChange={(e) => setDraft(`bl${variant.sku}`, e.target.value)}
                onBlur={() => {
                  const raw = drafts[`bl${variant.sku}`]; if (raw === undefined || raw.trim() === "" || raw === variant.label) return;
                  void patchBuff(variant.sku, { label: raw.trim() }, `Label ${variant.sku} disimpan.`);
                }} />
            </label>
          </div>
        </section>)}
      </div>
    </>}

    {!loading && tab === "alat" && <section className="ax-glass space-y-3 rounded-[20px] p-4 text-sm text-white/65">
      <h3 className="font-semibold text-white">Sinkron &amp; perbarui katalog</h3>
      <p className="text-xs leading-5">Menarik katalog terbaru dari TUNVN dan menghitung ulang harga dengan kurs USDT dari snapshot AXVARA. Status terbit, markup, nama, dan deskripsi yang diatur admin tidak ditimpa; produk yang tidak diminta terbit tetap tersembunyi.</p>
      <button className={PRIMARY} disabled={busy === "publish" || !products?.configured} onClick={() => void publish()}>
        <IosIcon name="lightning-bolt" size={14} tint="black" /> {busy === "publish" ? "Menyinkronkan…" : "Sinkron & perbarui sekarang"}
      </button>
      {!products?.configured && <p className="text-xs text-amber-300">API TUNVN belum terkonfigurasi di Pages (TUNVN_ENABLED/TUNVN_API_KEY). Tombol aktif setelah env dipasang dan deployment berjalan.</p>}
      <button className={BUTTON} onClick={() => void load()}>Muat ulang data</button>
    </section>}
  </div>;
}
