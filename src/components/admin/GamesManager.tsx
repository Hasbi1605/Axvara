"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { AdminStatusSwitch } from "./AdminStatusSwitch";

type Margin = {
  cost: number; sell: number; floor: number; margin_rp: number; margin_pct: number;
  source: "reference" | "floor"; competitive: boolean | null;
};
type Group = "special" | "bestseller" | "all";
type Item = {
  id: number; buyer_sku_code: string; product_name: string; game_brand: string; product_type: string;
  product_type_name: string | null; sk_variant_id: number | null; sk_sku: string | null;
  sk_product_name: string | null; game_slug: string | null; description: string;
  supplier: string; supplier_active: number; stock: number; min_order: number;
  cost: number; reference_price: number | null; sell_price: number;
  seller_active: number; backup_seller_active: number; backup_sku_code: string | null;
  enabled: number; display_group: "special" | "bestseller" | null; display_order: number | null;
  synced_at: string | null; margin: Margin; effectiveGroup: Group;
  contract_supported: boolean; availability: { available: boolean; reason: string | null };
};
type Sync = {
  last_sync_at: string | null;
  counts: { total: number; enabled: number; supplier_active: number; seller_active: number; with_reference: number; contract_supported: number };
};
type List = { items: Item[]; total: number; brands: string[]; sync: Sync; limit: number; offset: number;
  nickname_checks?: { today: { count: number; cost: number }; week: { count: number; cost: number } } };
type Row = Record<string, unknown>;

const EMPTY_SYNC: Sync = { last_sync_at: null, counts: { total: 0, enabled: 0, supplier_active: 0, seller_active: 0, with_reference: 0, contract_supported: 0 } };
const PAGE_SIZE = 50;
const GROUP_LABEL: Record<Group, string> = { special: "Spesial", bestseller: "Terlaris", all: "Semua" };
const REASON_LABEL: Record<string, string> = {
  admin_disabled: "Dinonaktifkan admin", supplier_off: "Supplier off", stock_empty: "Stok habis",
  min_order: "Min order >1", no_price: "Harga kosong", invalid_contract: "Kontrak rusak",
  open_denom: "Open denom", unknown_field: "Field tak dikenal", missing_note: "Tanpa target",
  missing_zone: "Zone wajib hilang", invalid_min_order: "Min order rusak", order_process: "Bukan H2H",
};
const MESSAGES: Record<string, string> = {
  unauthorized: "Sesi admin berakhir. Masuk kembali.", load_failed: "Data games gagal dimuat. Coba lagi.",
  save_failed: "Perubahan gagal disimpan.", not_found: "SKU tidak ditemukan. Muat ulang daftar.",
  not_sellable: "SKU belum aman dijual: supplier nonaktif, modal kosong, atau kontrak tidak didukung.",
  legacy_parked: "SKU Digiflazz legacy tidak dapat diubah dari panel katalog SK.",
  bulk_activation_retired: "Aktivasi massal gelombang 1 sudah dipensiunkan.",
  database_unavailable: "Database sementara tidak tersedia.",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as (Row & { error?: string; message?: string }) | null;
  if (!response.ok || !data) {
    throw new Error(MESSAGES[String(data?.error)] || String(data?.message) || "Permintaan gagal. Coba lagi.");
  }
  return data as T;
}

/** Panel admin Games: katalog SK, harga Oura, grup, urutan, aktif/nonaktif. */
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

  const counts = list.sync.counts;
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const stats: { label: string; value: string; hint?: string; tone?: string }[] = [
    { label: "Sinkron terakhir", value: formatWibDateTime(list.sync.last_sync_at) ?? "Belum pernah" },
    { label: "Total varian SK", value: String(counts.total) },
    { label: "Aktif dijual", value: String(counts.enabled), tone: "text-admin-success" },
    { label: "Supplier aktif", value: String(counts.supplier_active) },
    { label: "Kontrak didukung", value: String(counts.contract_supported), hint: `Oura ${counts.with_reference}` },
  ];

  return <div className="mt-5 min-w-0 space-y-6">
    <header>
      <h2 className="text-lg font-semibold text-admin-fg">Games</h2>
      <p className="mt-1 text-sm text-admin-muted">Katalog Sekalipay: supplier, varian, stok, kontrak, harga Oura, grup, urutan, dan aktif/nonaktif.</p>
    </header>
    {list.nickname_checks && <p className="text-xs text-admin-muted" role="status">Riwayat cek nickname berbayar Digiflazz (legacy, UTC): hari ini {list.nickname_checks.today.count} cek / {formatRupiah(list.nickname_checks.today.cost)}; 7 hari {list.nickname_checks.week.count} cek / {formatRupiah(list.nickname_checks.week.cost)}. Cek nickname SK baru gratis dan tidak dicatat di sini.</p>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Status sinkron Games">
      {stats.map((stat) => <Card key={stat.label}>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.08em] text-admin-muted">{stat.label}</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <p className={`text-2xl font-semibold tabular-nums ${stat.tone ?? "text-admin-fg"}`}>{stat.value}</p>
          {stat.hint && <p className="mt-1 text-xs text-admin-muted">{stat.hint}</p>}
        </CardContent>
      </Card>)}
    </section>

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-admin-accent">Menyimpan perubahan…</p>}
      {error && <div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-admin-danger">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}
      {success && <p role="status" className="text-admin-success">{success}</p>}
    </div>

    <Card>
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Katalog varian</CardTitle></CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_220px_160px_auto]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode, varian, atau game…" aria-label="Cari kode, varian, atau game" />
          <NativeSelect value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} aria-label="Game">
            <option value="">Semua game</option>
            {list.brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </NativeSelect>
          <NativeSelect value={enabled} onChange={(e) => { setEnabled(e.target.value); setPage(1); }} aria-label="Status jual">
            <option value="">Semua status</option>
            <option value="1">Aktif</option>
            <option value="0">Belum aktif</option>
          </NativeSelect>
          {(q || brand || enabled) && <Button variant="outline" size="sm" onClick={() => { setQ(""); setBrand(""); setEnabled(""); setPage(1); }}>Hapus filter</Button>}
        </div>

        <p className="text-xs text-admin-muted">{list.total} varian SK cocok · halaman {page} dari {totalPages}</p>
        {loading && <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>}
        {!loading && !error && list.items.length === 0 && <p className="text-sm text-admin-muted">Belum ada varian SK yang cocok. Sinkron katalog berjalan lewat cron; harga Oura bisa diisi setelah varian muncul.</p>}

        {list.items.length > 0 && <Card className="overflow-hidden shadow-none">
          <div className="overflow-x-auto" role="region" aria-label="Varian Games" tabIndex={0}>
            <Table className="min-w-[1500px]">
              <caption className="sr-only">Varian Games SK dengan supplier, stok, kontrak, modal, harga Oura, harga jual, margin, grup, dan status</caption>
              <TableHeader>
                <TableRow>
                  {["Kode / varian", "Game", "Supplier", "Stok", "Kontrak", "Modal", "Harga Oura", "Harga jual", "Margin", "Sumber harga", "Grup", "Aktif"].map((column) => <TableHead key={column} className="whitespace-nowrap">{column}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((item) => {
                  const margin = item.margin;
                  const canEnable = item.supplier_active === 1 && margin.cost > 0 && item.contract_supported;
                  const unhealthy = !item.contract_supported || item.supplier_active !== 1 || margin.cost <= 0 || margin.sell < margin.floor;
                  return <TableRow key={item.buyer_sku_code}>
                    <TableCell className="min-w-[240px]">
                      <p className="font-semibold text-admin-fg">{item.buyer_sku_code}</p>
                      <p className="mt-1 text-xs text-admin-muted">{item.product_name || "Tanpa nama"}</p>
                      <p className="mt-1 text-xs text-admin-muted">{item.product_type_name || item.product_type || item.sk_sku || "Tipe belum tersedia"}</p>
                      {item.description && <p className="mt-1 line-clamp-2 max-w-[260px] text-xs leading-4 text-admin-muted">{item.description}</p>}
                    </TableCell>
                    <TableCell className="min-w-[150px] text-xs">
                      <p className="text-admin-muted">{item.sk_product_name || item.game_brand || "-"}</p>
                      <p className="mt-1 text-xs text-admin-muted">{item.game_slug || "-"} · varian {item.sk_variant_id ?? "-"}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {item.supplier_active === 1 ? <Badge variant="success">Aktif</Badge> : <Badge variant="destructive">Off</Badge>}
                      <p className="mt-1 text-admin-muted">{item.supplier === "sekalipay" ? "Sekalipay" : "Digiflazz legacy"}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      <p className={item.stock === -1 || item.stock > 0 ? "" : "text-admin-danger"}>{item.stock < 0 ? "Tak terbatas" : item.stock}</p>
                      <p className="mt-1 text-admin-muted">min {item.min_order}</p>
                    </TableCell>
                    <TableCell className="min-w-[150px] text-xs">
                      {item.contract_supported ? <Badge variant="success">Didukung</Badge> : <Badge variant="destructive">Tidak</Badge>}
                      <p className={`mt-1 ${item.availability.reason && item.availability.reason !== "admin_disabled" ? "text-admin-warning" : "text-admin-muted"}`}>{item.availability.available ? "Siap dibeli" : REASON_LABEL[item.availability.reason ?? ""] ?? item.availability.reason ?? "Tidak tersedia"}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{margin.cost > 0 ? formatRupiah(margin.cost) : "Belum ada"}</TableCell>
                    <TableCell className="min-w-[150px]">
                      <Input
                        className="max-w-[130px] tabular-nums"
                        type="number" min={1} step={1} inputMode="numeric"
                        value={drafts[item.buyer_sku_code] ?? (item.reference_price === null ? "" : String(item.reference_price))}
                        placeholder="Belum diisi"
                        aria-label={`Harga Oura ${item.buyer_sku_code}`}
                        disabled={busy === item.buyer_sku_code}
                        onChange={(e) => setDrafts((d) => ({ ...d, [item.buyer_sku_code]: e.target.value }))}
                        onBlur={() => saveReference(item)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveReference(item); } }}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-semibold text-admin-fg">{margin.sell > 0 ? formatRupiah(margin.sell) : "Belum dihitung"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <p className={margin.margin_rp <= 0 ? "text-admin-danger" : "text-admin-success"}>{formatRupiah(margin.margin_rp)}</p>
                      <p className="mt-1 tabular-nums">{margin.margin_pct}%</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <p>{margin.source === "reference" ? "Oura −2%" : "Batas bawah"}</p>
                      <p className={`mt-1 ${margin.competitive === false ? "text-admin-warning" : "text-admin-muted"}`}>{margin.competitive === null ? "Tanpa pembanding" : margin.competitive ? "Kompetitif" : "Di atas Oura"}</p>
                    </TableCell>
                    <TableCell className="min-w-[150px]">
                      <NativeSelect className="min-w-[140px] text-xs" value={item.display_group ?? ""} aria-label={`Grup ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code}
                        onChange={(e) => void patch({ buyer_sku_code: item.buyer_sku_code, display_group: e.target.value === "" ? null : e.target.value }, `Grup ${item.buyer_sku_code} disimpan.`)}>
                        <option value="">Otomatis ({GROUP_LABEL[item.effectiveGroup]})</option>
                        <option value="special">Spesial</option>
                        <option value="bestseller">Terlaris</option>
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <AdminStatusSwitch checked={item.enabled === 1} label={`${item.enabled === 1 ? "Nonaktifkan" : "Aktifkan"} ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code || (item.enabled !== 1 && !canEnable)} busy={busy === item.buyer_sku_code} onChange={() => void patch({ buyer_sku_code: item.buyer_sku_code, enabled: item.enabled !== 1 }, `${item.buyer_sku_code} ${item.enabled === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
                      {unhealthy && item.enabled === 1 && <p className="mt-1 text-xs text-admin-warning">Perlu diperiksa</p>}
                    </TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
          </div>
        </Card>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-admin-muted">Halaman {page} / {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Berikutnya</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>;
}
