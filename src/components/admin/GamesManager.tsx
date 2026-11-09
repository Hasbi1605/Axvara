"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IosIcon } from "@/components/ui/IosIcon";
import { AdminStatusSwitch } from "./AdminStatusSwitch";

type Margin = {
  cost: number; sell: number; floor: number; margin_rp: number; margin_pct: number;
  source: "reference" | "floor"; competitive: boolean | null;
};
type Group = "special" | "bestseller" | "all";
type Item = {
  id: number; buyer_sku_code: string; product_name: string; game_brand: string; product_type: string;
  cost: number; reference_price: number | null; sell_price: number;
  seller_active: number; backup_seller_active: number; backup_sku_code: string | null;
  enabled: number; display_group: "special" | "bestseller" | null; display_order: number | null;
  synced_at: string | null; margin: Margin; effectiveGroup: Group;
};
type Sync = {
  last_sync_at: string | null;
  counts: { total: number; enabled: number; seller_active: number; with_reference: number };
};
type List = { items: Item[]; total: number; brands: string[]; sync: Sync; limit: number; offset: number;
  nickname_checks?: { today: { count: number; cost: number }; week: { count: number; cost: number } } };
type Row = Record<string, unknown>;
type Wave = { eligible: number; enabled_now: number; skipped_unhealthy: number };

const EMPTY_SYNC: Sync = { last_sync_at: null, counts: { total: 0, enabled: 0, seller_active: 0, with_reference: 0 } };
const PAGE_SIZE = 50;
const INPUT = "mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition focus:border-[#00E5FF]/50 [color-scheme:dark]";
const BUTTON = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50";
const PRIMARY = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#00E5FF] px-4 text-sm font-bold text-[#07101f] transition hover:bg-[#00E5FF]/90 disabled:opacity-50";
const GROUP_LABEL: Record<Group, string> = { special: "Spesial", bestseller: "Terlaris", all: "Semua" };
const MESSAGES: Record<string, string> = {
  unauthorized: "Sesi admin berakhir. Masuk kembali.", load_failed: "Data games gagal dimuat. Coba lagi.",
  save_failed: "Perubahan gagal disimpan.", not_found: "SKU tidak ditemukan. Muat ulang daftar.",
  not_sellable: "SKU utilitas atau tanpa seller aktif/modal tidak bisa dijual.",
  database_unavailable: "Database sementara tidak tersedia.",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as (Row & { error?: string; message?: string }) | null;
  if (!response.ok || !data) {
    const error = new Error(MESSAGES[String(data?.error)] || String(data?.message) || "Permintaan gagal. Coba lagi.");
    throw error;
  }
  return data as T;
}

/** Satu panel admin: status sinkron, filter, tabel SKU, aktivasi gelombang 1. */
export function GamesManager() {
  const [list, setList] = useState<List>({ items: [], total: 0, brands: [], sync: EMPTY_SYNC, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [enabled, setEnabled] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [wave, setWave] = useState<Wave | null>(null);
  const generation = useRef(0);

  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    const params = new URLSearchParams({ brand, q: search, enabled, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    try {
      const next = await request<List>(`/api/admin/games/products?${params}`);
      if (current === generation.current) setList(next);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : MESSAGES.load_failed);
    } finally { if (current === generation.current) setLoading(false); }
  }, [brand, search, enabled, page]);
  useEffect(() => { void load(); const pending = generation; return () => { pending.current++; }; }, [load]);

  async function patch(body: Row, message: string) {
    if (busy) return;
    setBusy(String(body.buyer_sku_code)); setError(""); setSuccess("");
    try {
      await request("/api/admin/games/products", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await load();
      setSuccess(message);
    } catch (e) { setError(e instanceof Error ? e.message : MESSAGES.save_failed); }
    finally { setBusy(""); }
  }

  function saveReference(item: Item) {
    const raw = drafts[item.buyer_sku_code];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (item.reference_price === null) { setDrafts((d) => { const next = { ...d }; delete next[item.buyer_sku_code]; return next; }); return; }
      void patch({ buyer_sku_code: item.buyer_sku_code, reference_price: null }, `Harga Oura ${item.buyer_sku_code} dihapus.`);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value <= 0) { setError("Harga Oura harus bilangan bulat lebih dari 0."); return; }
    if (value === item.reference_price) return;
    void patch({ buyer_sku_code: item.buyer_sku_code, reference_price: value }, `Harga Oura ${item.buyer_sku_code} disimpan.`);
  }

  async function dryRun() {
    if (busy) return;
    setBusy("wave"); setError(""); setSuccess("");
    try { setWave(await request<Wave>("/api/admin/games/products/enable-wave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dry_run: true }) })); }
    catch (e) { setError(e instanceof Error ? e.message : MESSAGES.save_failed); }
    finally { setBusy(""); }
  }

  async function applyWave() {
    setBusy("wave"); setError(""); setSuccess("");
    try {
      const result = await request<Wave>("/api/admin/games/products/enable-wave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      setWave(null);
      await load();
      setSuccess(`Gelombang 1: ${result.enabled_now} SKU diaktifkan, ${result.skipped_unhealthy} belum sehat.`);
    } catch (e) { setError(e instanceof Error ? e.message : MESSAGES.save_failed); }
    finally { setBusy(""); }
  }

  const counts = list.sync.counts;
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  return <div className="mt-5 min-w-0 space-y-4">
    <header><h2 className="font-display text-xl font-semibold text-white">Games</h2><p className="mt-1 text-xs text-white/40">Kelola SKU Digiflazz, harga Oura, grup nominal, dan aktivasi gelombang 1.</p></header>
    {list.nickname_checks && <p className="text-xs text-white/65" role="status">Cek nickname (UTC): hari ini {list.nickname_checks.today.count} cek / {formatRupiah(list.nickname_checks.today.cost)}; 7 hari {list.nickname_checks.week.count} cek / {formatRupiah(list.nickname_checks.week.cost)} (batas modal, bukan tagihan final).</p>}

    <section className="ax-glass grid gap-3 rounded-[20px] p-4 text-sm text-white/70 sm:grid-cols-2 xl:grid-cols-5" aria-label="Status sinkron Games">
      <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Sinkron terakhir</p><p className="mt-1 font-semibold text-white">{formatWibDateTime(list.sync.last_sync_at) ?? "Belum pernah"}</p></div>
      <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Total SKU</p><p className="mt-1 font-semibold text-white">{counts.total}</p></div>
      <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Aktif dijual</p><p className="mt-1 font-semibold text-emerald-300">{counts.enabled}</p></div>
      <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Seller aktif</p><p className="mt-1 font-semibold text-white">{counts.seller_active}</p></div>
      <div><p className="text-[11px] uppercase tracking-[0.08em] text-white/35">Punya harga Oura</p><p className="mt-1 font-semibold text-white">{counts.with_reference}</p></div>
    </section>

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-[#00E5FF]">Menyimpan perubahan…</p>}
      {error && <p role="alert" className="text-red-300">{error} <button type="button" className="underline" onClick={() => void load()}>Muat ulang</button></p>}
      {success && <p role="status" className="text-emerald-300">{success}</p>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_200px_160px_auto]">
      <label className="block min-w-0 text-xs font-medium text-white/65">Cari kode atau nama<input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ml86, Diamond, Weekly…" /></label>
      <label className="block min-w-0 text-xs font-medium text-white/65">Brand<select className={INPUT} value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }}><option value="">Semua brand</option>{["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"].map((b) => <option key={b} value={b}>{b}</option>)}{list.brands.filter((b) => !["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"].includes(b)).map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
      <label className="block min-w-0 text-xs font-medium text-white/65">Status jual<select className={INPUT} value={enabled} onChange={(e) => { setEnabled(e.target.value); setPage(1); }}><option value="">Semua</option><option value="1">Aktif</option><option value="0">Belum aktif</option></select></label>
      <button className={`${PRIMARY} self-end`} disabled={busy === "wave" || loading} onClick={() => void dryRun()}><IosIcon name="lightning-bolt" size={14} tint="black" />Aktifkan gelombang 1 (sehat)</button>
    </div>
    {(q || brand || enabled) && <button className={BUTTON} onClick={() => { setQ(""); setBrand(""); setEnabled(""); setPage(1); }}>Hapus filter</button>}

    <p className="text-xs text-white/60">{list.total} SKU cocok · halaman {page} dari {totalPages}</p>
    {loading && <p role="status" className="text-sm text-white/60">Memuat SKU Games…</p>}
    {!loading && !error && list.items.length === 0 && <p className="text-sm text-white/65">Belum ada SKU yang cocok. Sinkron katalog berjalan lewat cron; harga Oura bisa diisi setelah SKU muncul.</p>}

    {list.items.length > 0 && <div className="ax-glass min-w-0 overflow-hidden rounded-[20px]">
      <div className="overflow-x-auto" role="region" aria-label="SKU Games" tabIndex={0}>
        <table className="w-full min-w-[1180px] text-left text-sm text-white/60">
          <caption className="sr-only">SKU Games dengan modal, harga Oura, harga jual, margin, dan status</caption>
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.08em] text-white/40"><tr>
            {["Kode / produk", "Brand", "Modal", "Harga Oura", "Harga jual", "Margin", "Sumber harga", "Seller", "Grup", "Aktif"].map((column) => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-white/5 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
            {list.items.map((item) => {
              const margin = item.margin;
              const unhealthy = item.seller_active !== 1 || margin.cost <= 0 || margin.sell < margin.floor;
              return <tr key={item.buyer_sku_code}>
                <td className="min-w-[220px]"><p className="font-semibold text-white">{item.buyer_sku_code}</p><p className="mt-1 text-xs text-white/45">{item.product_name || "Tanpa nama"}</p><p className="mt-1 text-[11px] text-white/30">{item.product_type || "Tipe belum tersedia"}</p></td>
                <td className="text-xs">{item.game_brand || "-"}</td>
                <td className="whitespace-nowrap text-xs tabular-nums">{margin.cost > 0 ? formatRupiah(margin.cost) : "Belum ada"}</td>
                <td className="min-w-[150px]">
                  <input
                    className={`${INPUT} max-w-[130px] tabular-nums`}
                    type="number" min={1} step={1} inputMode="numeric"
                    value={drafts[item.buyer_sku_code] ?? (item.reference_price === null ? "" : String(item.reference_price))}
                    placeholder="Belum diisi"
                    aria-label={`Harga Oura ${item.buyer_sku_code}`}
                    disabled={busy === item.buyer_sku_code}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.buyer_sku_code]: e.target.value }))}
                    onBlur={() => saveReference(item)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveReference(item); } }}
                  />
                </td>
                <td className="whitespace-nowrap font-semibold text-white">{margin.sell > 0 ? formatRupiah(margin.sell) : "Belum dihitung"}</td>
                <td className="whitespace-nowrap text-xs"><p className={margin.margin_rp <= 0 ? "text-red-300" : "text-emerald-300"}>{formatRupiah(margin.margin_rp)}</p><p className="mt-1">{margin.margin_pct}%</p></td>
                <td className="whitespace-nowrap text-xs"><p>{margin.source === "reference" ? "Oura −2%" : "Batas bawah"}</p><p className={`mt-1 ${margin.competitive === false ? "text-amber-300" : "text-white/40"}`}>{margin.competitive === null ? "Tanpa pembanding" : margin.competitive ? "Kompetitif" : "Di atas Oura"}</p></td>
                <td className="whitespace-nowrap text-xs"><p className={item.seller_active === 1 ? "text-emerald-300" : "text-red-300"}>{item.seller_active === 1 ? "Aktif" : "Tidak aktif"}</p><p className="mt-1 text-white/40">{item.backup_sku_code ? `Cadangan ${item.backup_seller_active === 1 ? "aktif" : "mati"}` : "Tanpa cadangan"}</p></td>
                <td className="min-w-[150px]">
                  <select
                    className={INPUT} value={item.display_group ?? ""}
                    aria-label={`Grup ${item.buyer_sku_code}`}
                    disabled={busy === item.buyer_sku_code}
                    onChange={(e) => void patch({ buyer_sku_code: item.buyer_sku_code, display_group: e.target.value === "" ? null : e.target.value }, `Grup ${item.buyer_sku_code} disimpan.`)}
                  >
                    <option value="">Otomatis ({GROUP_LABEL[item.effectiveGroup]})</option>
                    <option value="special">Spesial</option>
                    <option value="bestseller">Terlaris</option>
                  </select>
                </td>
                <td className="whitespace-nowrap"><AdminStatusSwitch checked={item.enabled === 1} label={`${item.enabled === 1 ? "Nonaktifkan" : "Aktifkan"} ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code} busy={busy === item.buyer_sku_code} onChange={() => void patch({ buyer_sku_code: item.buyer_sku_code, enabled: item.enabled !== 1 }, `${item.buyer_sku_code} ${item.enabled === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />{unhealthy && item.enabled === 1 && <p className="mt-1 text-[11px] text-amber-300">Perlu diperiksa</p>}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>}

    <div className="flex items-center gap-3">
      <button className={BUTTON} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Sebelumnya</button>
      <span className="text-xs text-white/60">Halaman {page} / {totalPages}</span>
      <button className={BUTTON} disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Berikutnya</button>
    </div>

    <ConfirmDialog
      open={wave !== null}
      title="Aktifkan gelombang 1?"
      description={wave ? `${wave.eligible} SKU gelombang 1 sehat akan diaktifkan (${wave.skipped_unhealthy} dilewati karena belum sehat). SKU yang sudah aktif tidak dinonaktifkan.` : ""}
      confirmLabel="Aktifkan sekarang"
      cancelLabel="Batal"
      variant="default"
      loading={busy === "wave"}
      onClose={() => { if (busy !== "wave") setWave(null); }}
      onConfirm={() => void applyWave()}
    />
  </div>;
}
