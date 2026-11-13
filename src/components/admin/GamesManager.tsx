"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Badge, Button, Card, Input, Label, NativeSelect, PageHeader, Skeleton, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
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
  sellable?: boolean;
};
type Sync = {
  last_sync_at: string | null;
  counts: { total: number; enabled: number; supplier_active: number; seller_active: number; with_reference: number; contract_supported: number; sellable?: number };
};
type List = { items: Item[]; total: number; brands: string[]; sync: Sync; limit: number; offset: number };
type Row = Record<string, unknown>;

const EMPTY_SYNC: Sync = { last_sync_at: null, counts: { total: 0, enabled: 0, supplier_active: 0, seller_active: 0, with_reference: 0, contract_supported: 0, sellable: 0 } };
const PAGE_SIZE = 50;
const GROUP_LABEL: Record<Group, string> = { special: "Spesial", bestseller: "Terlaris", all: "Semua" };
const REASON_LABEL: Record<string, string> = {
  admin_disabled: "Dinonaktifkan admin", supplier_off: "Supplier nonaktif", stock_empty: "Stok habis",
  min_order: "Min. order lebih dari 1", no_price: "Harga kosong", invalid_contract: "Kontrak belum didukung",
  open_denom: "Denominasi terbuka", unknown_field: "Field tidak dikenal", missing_note: "Target belum diisi",
  missing_zone: "Zone wajib hilang", invalid_min_order: "Min. order rusak", order_process: "Bukan H2H",
};
const MESSAGES: Record<string, string> = {
  unauthorized: "Sesi admin berakhir. Masuk kembali.", load_failed: "Data game gagal dimuat. Coba lagi.",
  save_failed: "Perubahan gagal disimpan.", not_found: "SKU tidak ditemukan. Muat ulang daftar.",
  not_sellable: "SKU belum aman dijual: supplier nonaktif, modal kosong, atau kontrak tidak didukung.",
  legacy_parked: "SKU lama tidak dapat diubah dari panel katalog ini.",
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

/** Deskripsi supplier dibersihkan dari emoji/centang agar tabel tetap tenang (D5). */
export function plainSupplierDescription(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const compactSync = (value: string | null) => value ? formatWibDateTime(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) ?? String(value) : "Belum pernah";

/** Panel admin Games: katalog SK, grup, urutan, aktif/nonaktif. */
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
  const [sellable, setSellable] = useState("");
  const [page, setPage] = useState(1);
  const generation = useRef(0);

  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    // Default: SKU yang benar-benar bisa dijual tampil lebih dulu.
    const params = new URLSearchParams({ brand, q: search, enabled, sellable, sort: "sellable", limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    try {
      const next = await request<List>(`/api/admin/games/products?${params}`);
      if (current === generation.current) setList(next);
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : MESSAGES.load_failed);
    } finally { if (current === generation.current) setLoading(false); }
  }, [brand, search, enabled, sellable, page]);
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

  const counts = list.sync.counts;
  const sellableCount = counts.sellable ?? list.items.filter(item => item.sellable).length;
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return <div className="min-w-0 space-y-6">
    <PageHeader title="Games" description="Katalog top up game dari Sekalipay: harga, stok, kontrak, dan status jual." />

    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Ringkasan Games">
      <StatCard label="Sinkron terakhir" value={loading ? <Skeleton className="h-8 w-28" /> : error ? "—" : compactSync(list.sync.last_sync_at)} />
      <StatCard label="Total varian" value={loading ? <Skeleton className="h-8 w-16" /> : error ? "—" : counts.total} hint="Varian SK di katalog" />
      <StatCard label="Bisa dijual" value={loading ? <Skeleton className="h-8 w-16" /> : error ? "—" : sellableCount} hint="Aktif, supplier aktif, stok tersedia" />
      <StatCard label="Supplier aktif" value={loading ? <Skeleton className="h-8 w-16" /> : error ? "—" : counts.supplier_active} hint={`${counts.contract_supported} varian kontraknya didukung`} />
    </section>

    <div aria-live="polite" className="space-y-2 text-sm">
      {busy && <p role="status" className="text-admin-muted">Menyimpan perubahan…</p>}
      {error && <div role="alert" className="rounded-xl border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-admin-danger">
        <p>{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>Coba lagi</Button>
      </div>}
      {success && <p role="status" className="text-admin-success">{success}</p>}
    </div>

    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode atau nama varian…" aria-label="Cari kode atau nama varian" /></div>
        <NativeSelect value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} aria-label="Game" className="w-full sm:w-48">
          <option value="">Semua game</option>
          {list.brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </NativeSelect>
        <NativeSelect value={sellable} onChange={(e) => { setSellable(e.target.value); setPage(1); }} aria-label="Filter bisa dijual" className="w-full sm:w-40">
          <option value="">Semua SKU</option>
          <option value="1">Bisa dijual</option>
        </NativeSelect>
        <NativeSelect value={enabled} onChange={(e) => { setEnabled(e.target.value); setPage(1); }} aria-label="Status jual" className="w-full sm:w-40">
          <option value="">Semua status</option>
          <option value="1">Aktif</option>
          <option value="0">Belum aktif</option>
        </NativeSelect>
        {(q || brand || enabled || sellable) && <Button variant="outline" size="sm" onClick={() => { setQ(""); setBrand(""); setEnabled(""); setSellable(""); setPage(1); }}>Hapus filter</Button>}
      </div>

      <p className="text-xs text-admin-muted">{list.total} varian cocok · halaman {page} dari {totalPages}</p>

      <Card className="overflow-hidden">
        {loading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div>
          : !list.items.length ? <p className="p-8 text-center text-sm text-admin-muted">Belum ada varian yang cocok. Sinkron katalog berjalan otomatis.</p>
          : <>
            <div className="divide-y divide-admin-border md:hidden" aria-label="Kartu varian game">
              {list.items.map((item) => {
                const canEnable = item.supplier_active === 1 && item.margin.cost > 0 && item.contract_supported;
                return <article key={item.buyer_sku_code} aria-label={`Varian ${item.product_name || item.buyer_sku_code}`} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-admin-fg">{item.product_name || item.buyer_sku_code}</p>
                    <p className="mt-0.5 text-xs text-admin-muted">{item.sk_product_name || item.game_brand || "Game belum terbaca"} · {item.buyer_sku_code}</p>
                  </div>
                  <AdminStatusSwitch checked={item.enabled === 1} label={`${item.enabled === 1 ? "Nonaktifkan" : "Aktifkan"} ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code || (item.enabled !== 1 && !canEnable)} busy={busy === item.buyer_sku_code} onChange={() => void patch({ buyer_sku_code: item.buyer_sku_code, enabled: item.enabled !== 1 }, `${item.buyer_sku_code} ${item.enabled === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-admin-muted">
                  <Badge variant={item.sellable ? "success" : item.availability.available ? "warning" : "secondary"}>{item.sellable ? "Bisa dijual" : "Belum bisa dijual"}</Badge>
                  <span className="tabular-nums">{item.margin.sell > 0 ? formatRupiah(item.margin.sell) : "Harga belum dihitung"}</span>
                  <span>· modal {item.margin.cost > 0 ? formatRupiah(item.margin.cost) : "belum ada"}</span>
                  <span>· stok {item.stock < 0 ? "tak terbatas" : item.stock}</span>
                </div>
                {!item.availability.available && <p className="text-xs text-admin-muted">{REASON_LABEL[item.availability.reason ?? ""] ?? "Menunggu data supplier"}</p>}
                {item.enabled !== 1 && !canEnable && <p className="text-xs text-admin-warning">Belum bisa diaktifkan: supplier nonaktif, modal kosong, atau kontrak belum didukung.</p>}
                <Label className="block space-y-2 text-xs font-medium text-admin-muted">
                  <span className="block">Grup tampilan</span>
                  <NativeSelect value={item.display_group ?? ""} aria-label={`Grup ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code}
                    onChange={(e) => void patch({ buyer_sku_code: item.buyer_sku_code, display_group: e.target.value === "" ? null : e.target.value }, `Grup ${item.buyer_sku_code} disimpan.`)}>
                    <option value="">Otomatis ({GROUP_LABEL[item.effectiveGroup]})</option>
                    <option value="special">Spesial</option>
                    <option value="bestseller">Terlaris</option>
                  </NativeSelect>
                </Label>
                {plainSupplierDescription(item.description) && <p className="line-clamp-2 text-xs leading-5 text-admin-muted">{plainSupplierDescription(item.description)}</p>}
              </article>;
              })}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <caption className="sr-only">Varian game dengan game, supplier, stok, harga, margin, grup, dan status</caption>
                <TableHeader>
                  <TableRow>
                    {["Varian", "Stok", "Status", "Harga jual", "Margin", "Grup", "Aktif"].map((column) => <TableHead key={column} className="whitespace-nowrap">{column}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.map((item) => {
                    const margin = item.margin;
                    const canEnable = item.supplier_active === 1 && margin.cost > 0 && item.contract_supported;
                    const unhealthy = !item.contract_supported || item.supplier_active !== 1 || margin.cost <= 0 || margin.sell < margin.floor;
                    return <TableRow key={item.buyer_sku_code}>
                      {/* Lebar dibatasi (bukan min-width) agar TOTAL tabel + kontrol
                          muat di kontainer 1280 tanpa kolom Aktif terpotong; teks
                          panjang terpotong dengan tooltip. */}
                      <TableCell className="w-[32%] min-w-0">
                        <p className="truncate font-medium text-admin-fg" title={item.product_name || item.buyer_sku_code}>{item.product_name || item.buyer_sku_code}</p>
                        <p className="mt-1 truncate text-xs text-admin-muted">{item.sk_product_name || item.game_brand || "Game belum terbaca"} · {item.buyer_sku_code}</p>
                        {plainSupplierDescription(item.description) && <p className="mt-1 line-clamp-1 text-xs leading-4 text-admin-muted">{plainSupplierDescription(item.description)}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        <p>{item.stock < 0 ? "Tak terbatas" : item.stock}</p>
                        <p className="mt-1 text-admin-muted">min. {item.min_order}</p>
                      </TableCell>
                      <TableCell className="w-[13%] text-xs">
                        <Badge variant={item.sellable ? "success" : item.availability.available ? "warning" : "secondary"}>
                          {item.sellable ? "Bisa dijual" : "Belum bisa dijual"}
                        </Badge>
                        <p className="mt-1 text-admin-muted">{item.availability.available ? "Siap dibeli" : REASON_LABEL[item.availability.reason ?? ""] ?? "Menunggu data supplier"}</p>
                        {unhealthy && item.enabled === 1 && <p className="mt-1 text-admin-warning">Perlu diperiksa</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        <p className="font-medium text-admin-fg">{margin.sell > 0 ? formatRupiah(margin.sell) : "Belum dihitung"}</p>
                        <p className="mt-1 text-admin-muted">modal {margin.cost > 0 ? formatRupiah(margin.cost) : "belum ada"}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
                        <p>{formatRupiah(margin.margin_rp)}</p>
                        <p className="mt-1 text-admin-muted">{margin.margin_pct}%</p>
                      </TableCell>
                      <TableCell className="w-[150px]">
                        <NativeSelect className="w-full max-w-[150px] text-xs" value={item.display_group ?? ""} aria-label={`Grup ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code}
                          onChange={(e) => void patch({ buyer_sku_code: item.buyer_sku_code, display_group: e.target.value === "" ? null : e.target.value }, `Grup ${item.buyer_sku_code} disimpan.`)}>
                          <option value="">Otomatis ({GROUP_LABEL[item.effectiveGroup]})</option>
                          <option value="special">Spesial</option>
                          <option value="bestseller">Terlaris</option>
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <AdminStatusSwitch checked={item.enabled === 1} label={`${item.enabled === 1 ? "Nonaktifkan" : "Aktifkan"} ${item.buyer_sku_code}`} disabled={busy === item.buyer_sku_code || (item.enabled !== 1 && !canEnable)} busy={busy === item.buyer_sku_code} onChange={() => void patch({ buyer_sku_code: item.buyer_sku_code, enabled: item.enabled !== 1 }, `${item.buyer_sku_code} ${item.enabled === 1 ? "dinonaktifkan" : "diaktifkan"}.`)} />
                      </TableCell>
                    </TableRow>;
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
              <span className="text-xs text-admin-muted">Halaman {page} / {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Berikutnya</Button>
              </div>
            </div>
          </>}
      </Card>
    </div>
  </div>;
}
