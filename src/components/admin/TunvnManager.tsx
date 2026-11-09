"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import { SupplierTabs, type SupplierTabId } from "@/components/admin/SupplierTabs";
import { TUNVN_BUFF_MARKUP_PERCENT, TUNVN_CHATGPT_MARKUP_PERCENT } from "@/lib/tunvn/pricing";

type Item = {
  supplier_product_id: number; name: string; price_vnd: number; price_usdt: number | null;
  stock: number; visible: number; axvara_product_id: number | null;
  markup_percent: number; sell_price_idr: number | null; fx_idr_per_usdt: number | null;
  synced_at: string | null;
};
type ProductsData = {
  ok: boolean; configured: boolean; items: Item[];
  counts: { total: number; published: number; in_stock: number };
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
};
type BuffData = {
  ok: boolean; variants: BuffVariant[];
  probe: { quantity_b: number; sell_price_usdt: number; cost_per_b_usdt: number; fundable: boolean } | null;
  probe_error: string | null;
};
type Row = Record<string, unknown>;

const INPUT = "mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition focus:border-[#00E5FF]/50 [color-scheme:dark]";
const BUTTON = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50";
const PRIMARY = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#00E5FF] px-4 text-sm font-bold text-[#07101f] transition hover:bg-[#00E5FF]/90 disabled:opacity-50";
const TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkasan" },
  { id: "antrean", label: "Katalog ChatGPT" },
  { id: "markup", label: "Buff Muse" },
  { id: "alat", label: "Publikasi" },
];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as (Row & { error?: string }) | null;
  if (!data) throw new Error("Permintaan gagal. Coba lagi.");
  if (!response.ok && data.error !== "not_configured") throw new Error(String(data.error || "Permintaan gagal. Coba lagi."));
  return data as T;
}

const usdt = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${value} USDT`);

/** Panel admin TUNVN PREHUB: saldo, katalog mirror, Buff Muse, publikasi. */
export function TunvnManager() {
  const [tab, setTab] = useState<SupplierTabId>("ringkas");
  const [products, setProducts] = useState<ProductsData | null>(null);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [buff, setBuff] = useState<BuffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [q, setQ] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const [nextProducts, nextBalance, nextBuff] = await Promise.all([
        request<ProductsData>("/api/admin/tunvn/products"),
        request<BalanceData>("/api/admin/tunvn/balance"),
        request<BuffData>("/api/admin/tunvn/buff"),
      ]);
      if (current !== generation.current) return;
      setProducts(nextProducts); setBalance(nextBalance); setBuff(nextBuff);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Data TUNVN gagal dimuat.");
    } finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); const pending = generation; return () => { pending.current++; }; }, [load]);

  async function publish() {
    if (busy) return;
    setBusy("publish"); setError(""); setSuccess("");
    try {
      const result = await request<Row & { chatgpt?: number; buff_variants?: number; idr_per_usdt?: number; error?: string }>(
        "/api/admin/tunvn/publish", { method: "POST" },
      );
      if (result.error) throw new Error(String(result.error));
      await load();
      setSuccess(`Katalog diterbitkan ulang: ${result.chatgpt ?? 0} produk ChatGPT, ${result.buff_variants ?? 0} varian Buff (kurs Rp${Number(result.idr_per_usdt ?? 0).toLocaleString("id-ID")}/USDT).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Publikasi gagal."); }
    finally { setBusy(""); }
  }

  const items = (products?.items ?? []).filter((item) => !q || `${item.supplier_product_id} ${item.name}`.toLowerCase().includes(q.toLowerCase()));
  const chatgpt = items.filter((item) => /chat ?gpt/i.test(item.name));
  const counts = products?.counts ?? { total: 0, published: 0, in_stock: 0 };

  return <div className="mt-5 min-w-0 space-y-4">
    <header>
      <h2 className="font-display text-xl font-semibold text-white">TUNVN PREHUB</h2>
      <p className="mt-1 text-xs text-white/40">Reseller Telegram TUNVN: katalog ChatGPT (markup {TUNVN_CHATGPT_MARKUP_PERCENT}%) dan Buff Token Muse AI (markup {TUNVN_BUFF_MARKUP_PERCENT}%).</p>
    </header>

    <SupplierTabs tabs={TABS} active={tab} onChange={setTab} />

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-[#00E5FF]">Memproses…</p>}
      {error && <p role="alert" className="text-red-300">{error} <button type="button" className="underline" onClick={() => void load()}>Muat ulang</button></p>}
      {success && <p role="status" className="text-emerald-300">{success}</p>}
    </div>

    {loading && <p role="status" className="text-sm text-white/60">Memuat data TUNVN…</p>}

    {!loading && tab === "ringkas" && <>
      <section className="ax-glass grid gap-3 rounded-[20px] p-4 text-sm text-white/70 sm:grid-cols-2 xl:grid-cols-5" aria-label="Status TUNVN">
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Koneksi API</p><p className={`mt-1 font-semibold ${products?.configured ? "text-emerald-300" : "text-amber-300"}`}>{products?.configured ? "Terhubung" : "Belum terkonfigurasi"}</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Saldo wallet</p><p className="mt-1 font-semibold text-white">{balance?.ok ? `${usdt(balance.balance_usdt)} · ${Number(balance.balance_vnd ?? 0).toLocaleString("id-ID")} VND` : "Tidak terbaca"}</p>{balance?.username && <p className="mt-0.5 text-[11px] text-white/35">{balance.username}</p>}</div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Produk mirror</p><p className="mt-1 font-semibold text-white">{counts.total}</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Terbit di Market</p><p className="mt-1 font-semibold text-emerald-300">{counts.published}</p></div>
        <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Sinkron terakhir</p><p className="mt-1 font-semibold text-white">{formatWibDateTime(products?.last_sync_at) ?? "Belum pernah"}</p></div>
      </section>
      <section className="ax-glass rounded-[20px] p-4 text-sm text-white/65">
        <h3 className="font-semibold text-white">Cara kerja</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
          <li>Tab <b className="text-white">Publikasi</b> menyinkronkan katalog TUNVN lalu menerbitkan ulang dua produk ChatGPT + varian Buff dengan kurs USDT terbaru.</li>
          <li>Harga ChatGPT = modal USDT × kurs × 1,35; Buff Muse = modal 0,0588 USDT/1B × kurs × 1,40, dibulatkan ke atas per Rp100.</li>
          <li>Fulfillment saat ini manual (stok tidak dijamin otomatis) sampai dispatch TUNVN dibangun; isi saldo wallet sebelum menerima order.</li>
        </ul>
      </section>
    </>}

    {!loading && tab === "antrean" && <>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]">
        <label className="block min-w-0 text-xs font-medium text-white/65">Cari produk mirror<input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="chatgpt, Muse, capcut…" /></label>
        <p className="self-end text-xs text-white/50">{chatgpt.length} produk ChatGPT · {items.length} produk tampil</p>
      </div>
      {items.length === 0 && <p className="text-sm text-white/65">Belum ada produk mirror. Jalankan Publikasi untuk sinkron pertama.</p>}
      {items.length > 0 && <div className="ax-glass min-w-0 overflow-hidden rounded-[20px]">
        <div className="overflow-x-auto" role="region" aria-label="Katalog TUNVN" tabIndex={0}>
          <table className="w-full min-w-[900px] text-left text-sm text-white/60">
            <caption className="sr-only">Produk TUNVN dengan modal, harga jual, stok, dan status terbit</caption>
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.08em] text-white/40"><tr>
              {["ID / produk", "Modal USDT", "Modal VND", "Markup", "Harga jual", "Stok", "Status"].map((column) => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-white/5 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
              {items.map((item) => <tr key={item.supplier_product_id}>
                <td className="min-w-[240px]"><p className="font-semibold text-white">#{item.supplier_product_id} {item.name}</p><p className="mt-1 text-[11px] text-white/30">Sinkron {formatWibDateTime(item.synced_at) ?? "-"}</p></td>
                <td className="whitespace-nowrap tabular-nums">{usdt(item.price_usdt)}</td>
                <td className="whitespace-nowrap tabular-nums">{item.price_vnd.toLocaleString("id-ID")} VND</td>
                <td className="whitespace-nowrap">{item.visible ? `${item.markup_percent}%` : "-"}</td>
                <td className="whitespace-nowrap font-semibold text-white">{item.sell_price_idr ? formatRupiah(item.sell_price_idr) : "-"}</td>
                <td className="whitespace-nowrap">{item.stock}</td>
                <td className="whitespace-nowrap"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${item.visible ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-white/15 bg-white/[0.05] text-white/45"}`}>{item.visible ? "Terbit" : "Tersembunyi"}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>}
    </>}

    {!loading && tab === "markup" && <>
      <section className="ax-glass rounded-[20px] p-4 text-sm text-white/65">
        <h3 className="font-semibold text-white">Probe Buff live</h3>
        {buff?.probe ? <p className="mt-1 text-xs">Modal terverifikasi {buff.probe.cost_per_b_usdt.toFixed(4)} USDT/1B · status layanan {buff.probe.fundable ? <span className="text-emerald-300">bisa diproses</span> : <span className="text-amber-300">sementara tidak bisa</span>}.</p>
          : <p className="mt-1 text-xs text-amber-300">Probe tidak tersedia{buff?.probe_error ? ` (${buff.probe_error})` : ""}; harga varian memakai snapshot terakhir.</p>}
      </section>
      {(buff?.variants ?? []).length === 0 && <p className="text-sm text-white/65">Varian Buff belum terbit. Jalankan Publikasi.</p>}
      {(buff?.variants ?? []).length > 0 && <div className="ax-glass min-w-0 overflow-hidden rounded-[20px]">
        <div className="overflow-x-auto" role="region" aria-label="Varian Buff Muse" tabIndex={0}>
          <table className="w-full min-w-[760px] text-left text-sm text-white/60">
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.08em] text-white/40"><tr>
              {["Varian", "Jumlah", "Modal", "Markup", "Harga jual", "Aktif"].map((column) => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-white/5 [&_td]:px-4 [&_td]:py-3">
              {(buff?.variants ?? []).map((variant) => <tr key={variant.sku}>
                <td><p className="font-semibold text-white">{variant.label}</p><p className="mt-0.5 text-[11px] text-white/30">{variant.sku} · produk Muse AI 1 Miliar Token</p></td>
                <td className="whitespace-nowrap">{variant.tunvn_buff_quantity_b}B token</td>
                <td className="whitespace-nowrap tabular-nums">{usdt(variant.tunvn_cost_usdt)}</td>
                <td className="whitespace-nowrap">{variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT}%</td>
                <td className="whitespace-nowrap font-semibold text-white">{formatRupiah(variant.price)}</td>
                <td className="whitespace-nowrap">{variant.is_active ? <span className="text-emerald-300">Aktif</span> : <span className="text-white/40">Nonaktif</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>}
    </>}

    {!loading && tab === "alat" && <section className="ax-glass space-y-3 rounded-[20px] p-4 text-sm text-white/65">
      <h3 className="font-semibold text-white">Sinkron & terbitkan katalog</h3>
      <p className="text-xs leading-5">Menarik katalog terbaru dari TUNVN, menghitung ulang harga dengan kurs USDT dari snapshot AXVARA, lalu memperbarui produk ChatGPT TUNVN dan varian Buff Muse. Produk lain TUNVN tetap tersembunyi.</p>
      <button className={PRIMARY} disabled={busy === "publish" || !products?.configured} onClick={() => void publish()}>
        <IosIcon name="lightning-bolt" size={14} tint="black" /> {busy === "publish" ? "Menerbitkan…" : "Sinkron & terbitkan sekarang"}
      </button>
      {!products?.configured && <p className="text-xs text-amber-300">API TUNVN belum terkonfigurasi di Pages (TUNVN_ENABLED/TUNVN_API_KEY). Tombol aktif setelah env dipasang dan deployment berjalan.</p>}
      <button className={BUTTON} onClick={() => void load()}>Muat ulang data</button>
    </section>}
  </div>;
}
