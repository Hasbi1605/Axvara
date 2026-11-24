"use client";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Input, NativeSelect, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Switch, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { Fragment, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { Prod, Cat, SupplierFilter } from "../product-types";
import { liveProductOrder } from "../useProductManager";
import { SupplierBadge, SUPPLIER_STYLES } from "../supplier-style";

// Section "Produk" dipisah karena inilah bagian terbesar page.tsx: kartu statistik,
// pencarian, tabel/daftar responsif, dan pagination. Semua state tetap dimiliki
// page.tsx dan diturunkan lewat props eksplisit. Filter tinjauan S&K lokal
// diterapkan ke hasil pencarian/status/supplier sebelum pagination.

/** Filter asal supplier di daftar admin (keputusan owner 2026-09-30). */
export type { SupplierFilter } from "../product-types";

/** Varian aktif yang S&K-nya perlu ditinjau (teks WR belum versi Axvara / suntingan dijeda). */
function CopyReviewBadge({ count, changed, raw }: { count?: number; changed?: number; raw?: number }) {
  if (changed !== undefined && raw !== undefined) return <div className="mt-1 flex flex-wrap gap-1">
    {changed > 0 && <Badge variant="outline" title="Supplier mengubah teks sejak suntingan atau tinjauan terakhir. Buka tab Deskripsi & S&K untuk meninjau ulang." className="whitespace-normal rounded-md border-admin-danger/30 bg-admin-danger/10 text-admin-danger">Supplier mengubah S&amp;K · {changed} varian</Badge>}
    {raw > 0 && <Badge variant="outline" title="Teks supplier belum dirapikan atau ditandai sudah oke. Buka tab Deskripsi & S&K." className="whitespace-normal rounded-md border-admin-border text-admin-muted">S&amp;K belum dirapikan · {raw} varian</Badge>}
  </div>;
  if (!count) return null;
  return (
    <Badge variant="outline"
      title="Buka Edit Produk & Varian, lalu tab Deskripsi & S&K"
      className="mt-1 inline-flex rounded-md border border-admin-warning/30 bg-admin-warning/10 px-2 py-0.5 text-xs font-semibold text-admin-warning"
    >
      S&amp;K perlu ditinjau · {count} varian
    </Badge>
  );
}

/** Badge status toko — HANYA admin (keputusan owner 2026-10-01). Menjawab
 *  "mana yang live" dalam 1 detik: hijau Live, abu kalah, kuning habis,
 *  merah Off. Pecundang + habis = toggle ON tapi tidak tampil di toko. */
function LiveStatusBadge({ status, reason }: { status?: Prod["liveStatus"]; reason?: string }) {
  const s = status ?? "live";
  if (s === "live") {
    return <Badge title={reason || "Tampil di storefront"} className="rounded-md border border-admin-success/30 bg-admin-success/10 px-2 py-0.5 text-xs font-semibold text-admin-success">Live</Badge>;
  }
  if (s === "hidden_loser") {
    if (reason?.startsWith("Varian digabung")) {
      return <Badge variant="outline" title={reason} className="rounded-md border border-admin-success/35 bg-admin-success/5 px-2 py-0.5 text-xs font-medium text-admin-success">Gabung varian</Badge>;
    }
    return <Badge variant="secondary" title={reason || "Anggota grup lain dipilih — disembunyikan otomatis"}>Disembunyikan</Badge>;
  }
  if (s === "hidden_soldout") {
    return <Badge variant="warning" title={reason || "Stok habis — restok otomatis tampil"}>Stok habis</Badge>;
  }
  return <Badge variant="secondary" title={reason || "Nonaktif manual"}>Nonaktif</Badge>;
}
export function ProductsSection({
  error,
  onRetry,
  prods,
  cats = [],
  paged: basePaged,
  filtered: baseFiltered,
  q,
  safePage: baseSafePage,
  totalPages: baseTotalPages,
  perPage,
  loadingList,
  toggling,
  activeProducts,
  lowStock,
  soldProducts,
  liveProducts,
  hiddenProducts,
  offProducts,
  liveTab,
  onLiveTabChange,
  perPageAdmin,
  onPerPageChange,
  supplierFilter,
  onSupplierFilterChange,
  onQueryChange,
  onPageChange,
  onlyLowStock,
  onClearLowStock,
  onNew,
  onEdit,
  onDelete,
  onRestore,
  onToggleActive,
  reordering,
  onMove,
  onJump,
  onSoldCount,
}: {
  error?: string | null;
  onRetry?: () => void;
  prods: Prod[];
  cats?: Cat[];
  paged: Prod[];
  filtered: Prod[];
  q: string;
  safePage: number;
  totalPages: number;
  perPage: number;
  loadingList: boolean;
  toggling: string | null;
  activeProducts: number;
  lowStock: number;
  soldProducts: number;
  liveProducts: number;
  hiddenProducts: number;
  offProducts: number;
  liveTab: "live" | "hidden" | "off" | "all" | "archive";
  onLiveTabChange: (value: "live" | "hidden" | "off" | "all" | "archive") => void;
  perPageAdmin: 20 | 50 | 100;
  onPerPageChange: (value: 20 | 50 | 100) => void;
  supplierFilter: SupplierFilter;
  onSupplierFilterChange: (value: SupplierFilter) => void;
  onQueryChange: (value: string) => void;
  onPageChange: (updater: (prev: number) => number) => void;
  onlyLowStock: boolean;
  onClearLowStock: () => void;
  onNew: () => void;
  onEdit: (p: Prod) => void;
  onDelete: (p: Prod) => void;
  onRestore?: (p: Prod) => void;
  onToggleActive: (p: Prod) => void;
  reordering: string | null;
  onMove: (p: Prod, direction: -1 | 1) => void;
  /** Lompat langsung ke posisi 1..N (badge diketik) — satu request. */
  onJump: (p: Prod, targetPosition: number) => void;
  /** Edit angka Terjual inline (ketik + Enter) — SET absolut. */
  onSoldCount: (p: Prod, soldCount: number) => void;
}) {
  const [copyFilter, setCopyFilter] = useState("all");
  const matchesCopy = (p: Prod, kind: string) => kind === "changed" ? (p.copyReviewChanged ?? 0) > 0 : kind === "raw" ? (p.copyReviewRaw ?? 0) > 0 : (p.copyReview ?? 0) > 0;
  const copyFiltered = copyFilter !== "all" && liveTab !== "archive";
  const filtered = copyFiltered ? baseFiltered.filter(p => matchesCopy(p, copyFilter)) : baseFiltered;
  const totalPages = copyFiltered ? Math.max(1, Math.ceil(filtered.length / perPage)) : baseTotalPages;
  const safePage = Math.min(baseSafePage, totalPages);
  const paged = copyFiltered ? filtered.slice((safePage - 1) * perPage, safePage * perPage) : basePaged;
  const copyCount = (kind: string) => prods.filter(p => !p.archivedAt && matchesCopy(p, kind)).length;
  // Posisi storefront dihitung dari seluruh kategori, bukan hasil filter/halaman.
  const orderPosition = new Map<string, number>();
  const liveCounts = new Map<string, number>();
  for (const p of liveProductOrder(prods, cats)) {
    const position = (liveCounts.get(p.categorySlug) ?? 0) + 1;
    liveCounts.set(p.categorySlug, position);
    orderPosition.set(p.id, position);
  }
  const categorySize = (p: Prod) => liveCounts.get(p.categorySlug) ?? 0;
  const notLive = "Tidak tampil di toko — posisinya mengikuti slot yang sama saat tampil lagi";
  const copyFilterHint = "Reset tinjauan S&K untuk mengatur urutan katalog";
  const categoryHeader = (p: Prod) => `${p.categoryName || cats.find(cat => cat.slug === p.categorySlug)?.name || "Tanpa kategori"} · ${paged.filter(item => item.categorySlug === p.categorySlug).length} produk di halaman ini`;
  // Badge posisi yang bisa diketik: ketik "1" + Enter untuk lompat ke puncak
  // dalam SATU request (bukan 29x klik naik). Nilai dikunci 1..N saat commit.
  const [jumpDraft, setJumpDraft] = useState<Record<string, string>>({});
  const commitJump = (p: Prod) => {
    const raw = (jumpDraft[p.id] ?? "").trim();
    setJumpDraft((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    const current = orderPosition.get(p.id);
    if (!raw || current === undefined || copyFiltered || reordering === p.id) return;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    const target = Math.max(1, Math.min(categorySize(p), n));
    if (target === current) return;
    onJump(p, target);
  };
  // Angka Terjual yang bisa diketik: ketik + Enter untuk SET absolut.
  // Pembelian asli tetap += qty di atas angka ini (tidak ditimpa).
  const [soldDraft, setSoldDraft] = useState<Record<string, string>>({});
  const commitSold = (p: Prod) => {
    const raw = (soldDraft[p.id] ?? "").trim();
    setSoldDraft((prev) => {
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    if (!raw) return;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0 || n > 9999999) return;
    if (n === (p.soldCount ?? 0)) return;
    onSoldCount(p, n);
  };
  return (
    <Tabs value={liveTab} onValueChange={value => { onLiveTabChange(value as typeof liveTab); onPageChange(() => 1); }} className="space-y-6">
      <PageHeader title="Produk" description="Katalog, harga, stok varian, dan status tampil di toko." actions={<Button type="button" onClick={onNew}><Plus aria-hidden="true" /> Produk baru</Button>} />
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-4 py-3 text-sm text-admin-danger"><span>{error}</span><Button variant="outline" size="sm" type="button" onClick={onRetry} className="shrink-0">Coba lagi</Button></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Total produk" value={loadingList ? <Skeleton className="h-8 w-16" /> : prods.filter(p => !p.archivedAt).length} />
          <StatCard label="Live di toko" value={loadingList ? <Skeleton className="h-8 w-16" /> : liveProducts} />
          <StatCard label="Disembunyikan otomatis" value={loadingList ? <Skeleton className="h-8 w-16" /> : hiddenProducts} />
          <StatCard label="Nonaktif" value={loadingList ? <Skeleton className="h-8 w-16" /> : offProducts} />
          <StatCard label="Unit terjual" value={loadingList ? <Skeleton className="h-8 w-16" /> : soldProducts} />
      </div>

      <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-72 sm:shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" aria-hidden="true" />
              <Input value={q} onChange={e=>{ onQueryChange(e.target.value); onPageChange(()=>1); }} aria-label="Cari produk" placeholder="Cari produk, slug, badge..." className="pl-9" />
            </div>
            {/* Filter asal supplier — lokal, tanpa request. */}
            <NativeSelect
              value={supplierFilter}
              onChange={e=>{ onSupplierFilterChange(e.target.value as SupplierFilter); onPageChange(()=>1); }}
              aria-label="Filter asal supplier"
              aria-describedby="supplier-legend"
              title="Filter asal supplier"
              className="w-full sm:w-44 sm:shrink-0"
            >
              <option value="all">Semua asal</option>
              {(Object.keys(SUPPLIER_STYLES) as Array<keyof typeof SUPPLIER_STYLES>).map(supplier => (
                <option key={supplier} value={supplier}>{SUPPLIER_STYLES[supplier].label}</option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Tinjauan S&K" value={copyFilter} disabled={liveTab === "archive"} className="w-full min-w-0 sm:w-64" onChange={e => { setCopyFilter(e.target.value); onPageChange(() => 1); }}>
              <option value="all">Semua tinjauan S&amp;K</option>
              <option value="changed">Supplier mengubah teks ({copyCount("changed")})</option>
              <option value="raw">Belum dirapikan ({copyCount("raw")})</option>
              <option value="review">Semua yang perlu ditinjau ({copyCount("review")})</option>
            </NativeSelect>
            <div id="supplier-legend" role="group" aria-label="Legenda asal supplier" className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-admin-muted">Asal:</span>
              {(Object.keys(SUPPLIER_STYLES) as Array<keyof typeof SUPPLIER_STYLES>).map(supplier => <SupplierBadge key={supplier} supplier={supplier} />)}
            </div>
          </div>
          {/* Tab status toko (2026-10-01): 1 daftar mencampur 4 kondisi yang
              aturannya beda kini dipisah. Tombol naikturun hanya bermakna di tab Live
              (urutan antar yang tampil); di tab Hidden tombol dimatikan agar
              jelas urutan di sana tidak berpengaruh ke storefront. */}
          <div className="mt-3 max-w-full overflow-x-auto"><TabsList aria-label="Status tampil produk" className="justify-start">
            {([["live", `Live (${liveProducts})`], ["hidden", `Disembunyikan otomatis (${hiddenProducts})`], ["off", `Nonaktif manual (${offProducts})`], ["all", `Semua (${prods.filter(p => !p.archivedAt).length})`], ["archive", `Arsip (${prods.filter(p => p.archivedAt).length})`]] as const).map(([value, label]) => (
              <TabsTrigger value={value}
                key={value}
                title={value === "live" ? "Yang tampil di storefront — atur urutan di sini" : value === "hidden" ? "Kalah di grup / stok habis — urutan di sini tidak berpengaruh" : value === "off" ? "Yang kamu matikan sendiri" : value === "archive" ? "Produk yang diarsipkan — pulihkan atau hapus permanen di sini" : "Semua produk untuk audit"}
              >
                {label}
              </TabsTrigger>
            ))}
            </TabsList></div>

          {(onlyLowStock || copyFiltered) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-admin-muted">Filter aktif</span>
              {onlyLowStock && <Button variant="outline" size="sm" type="button" onClick={onClearLowStock}>
                Stok menipis · varian ≤ 5
                <X aria-hidden="true" />
              </Button>}
              {copyFiltered && <Button variant="outline" size="sm" type="button" aria-label="Reset tinjauan S&K" onClick={() => { setCopyFilter("all"); onPageChange(() => 1); }}>Tinjauan S&amp;K · {copyFilter === "changed" ? "Supplier mengubah teks" : copyFilter === "raw" ? "Belum dirapikan" : "Perlu ditinjau"}<X aria-hidden="true" /></Button>}
            </div>
          )}

          <Card className="mt-4 admin-surface rounded-xl overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-admin-muted"><Skeleton className="h-6 w-48" /><span className="text-sm">Memuat produk…</span></div>
            ) : liveTab === "archive" ? <div className="divide-y divide-admin-border">
              {paged.map(p => <div key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="break-words font-semibold text-admin-fg">{p.name}</p><div className="mt-1 flex flex-wrap gap-2"><SupplierBadge supplier={p.supplier} slug={p.slug} /><Badge variant="secondary">Arsip</Badge></div>
                  {p.hardDeleteReason && <p className="mt-2 text-xs text-admin-muted">{p.hardDeleteReason}</p>}</div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={toggling === p.id} onClick={() => onRestore?.(p)} aria-label={`Pulihkan ${p.name}`}>Pulihkan</Button>
                  <Button variant="outline" size="sm" className="text-admin-danger" disabled={!p.canHardDelete || toggling === p.id} title={p.hardDeleteReason || "Hapus permanen"} onClick={() => onDelete(p)} aria-label={`Hapus permanen ${p.name}`}>Hapus permanen</Button>
                </div>
              </div>)}
              {filtered.length === 0 && <p className="p-8 text-center text-sm text-admin-muted">Tidak ada produk di Arsip.</p>}
            </div> : (<>

            <div className="divide-y divide-admin-border md:hidden">
              {paged.map((p, index)=>{ const position = orderPosition.get(p.id); const canMoveUp = !copyFiltered && position !== undefined && position > 1; const canMoveDown = !copyFiltered && position !== undefined && position < categorySize(p); const busy = reordering === p.id; return (<Fragment key={p.id}>
                {(index === 0 || paged[index - 1].categorySlug !== p.categorySlug) && <h3 className="bg-admin-subtle px-4 py-3 text-xs font-semibold text-admin-muted">{categoryHeader(p)}</h3>}
                <Card className="border-0 p-4 shadow-none">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image || "/brand/axvara-mark.svg"} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-admin-subtle object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-admin-fg">{p.name}</p><div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div><p className="mt-0.5 truncate text-xs text-admin-muted">{p.categoryName || "Tanpa kategori"} · {p.variantCount ? `${p.variantCount} varian` : "produk"} · <span title={position === undefined ? notLive : undefined}>{position === undefined ? "Tidak tampil" : `#${position} dari ${categorySize(p)}`}</span></p>{p.liveStatus !== "live" && p.liveReason ? <p className="mt-0.5 truncate text-xs text-admin-muted">{p.liveReason}</p> : null}<CopyReviewBadge count={p.copyReview} changed={p.copyReviewChanged} raw={p.copyReviewRaw} /></div><Switch checked={p.isActive} onCheckedChange={() => onToggleActive(p)} disabled={toggling === p.id} aria-label={`Toggle aktif ${p.name}`} title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} /></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-admin-fg">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-1 text-admin-muted">Stok {p.stock === -1 ? "∞" : p.stock}</Badge><span className="text-admin-muted">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={position === undefined ? notLive : copyFiltered ? copyFilterHint : canMoveUp ? "Naik satu posisi" : "Sudah paling atas di kategori ini"} size="icon"><ArrowUp size={16} aria-hidden="true" /></Button>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={position === undefined ? notLive : copyFiltered ? copyFilterHint : canMoveDown ? "Turun satu posisi" : "Sudah paling bawah di kategori ini"} size="icon"><ArrowDown size={16} aria-hidden="true" /></Button>
                  </div>
                  <Button variant="outline" size="sm" type="button" onClick={()=>onEdit(p)}><Pencil aria-hidden="true" /> Edit Produk & Varian</Button><Button variant="outline" size="icon" type="button" onClick={()=>onDelete(p)} className="size-8 text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><Trash2 aria-hidden="true" /></Button>
                </div>
              </Card></Fragment>);})}
            </div>
            <div className="hidden overflow-x-auto md:block" role="region" aria-label="Daftar produk" tabIndex={0}>
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="">Produk</TableHead><TableHead className="hidden px-2 xl:table-cell">Kategori</TableHead><TableHead className="px-2 text-right">Harga</TableHead><TableHead className="px-2 text-center">Stok</TableHead><TableHead className="px-2 text-center">Terjual</TableHead><TableHead className="px-2 text-center">Urutan</TableHead><TableHead className="px-2 text-center">Aktif</TableHead><TableHead className=" text-right">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((p, index)=>{ const position = orderPosition.get(p.id); const canMoveUp = !copyFiltered && position !== undefined && position > 1; const canMoveDown = !copyFiltered && position !== undefined && position < categorySize(p); const busy = reordering === p.id; return (
                    <Fragment key={p.id}>
                    {(index === 0 || paged[index - 1].categorySlug !== p.categorySlug) && <TableRow className="bg-admin-subtle"><TableCell colSpan={8} className="py-2 text-xs font-semibold text-admin-muted">{categoryHeader(p)}</TableCell></TableRow>}
                    <TableRow>
                      <TableCell className="py-3 ">
                        <div className="flex min-w-[180px] items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-mark.svg"} alt="" className="size-10 shrink-0 rounded-md bg-admin-subtle object-cover" />
                          <div className="min-w-0">
                            <p className="max-w-[11rem] truncate font-medium 2xl:max-w-[16rem] leading-tight text-admin-fg" title={p.name}>{p.name}</p>
                            <div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div>
                            <p className="text-xs text-admin-muted line-clamp-1">/{p.slug} {p.badge? `· ${p.badge}`:""}</p>
                            {p.liveStatus !== "live" && p.liveReason ? <p className="text-xs text-admin-muted line-clamp-1">{p.liveReason}</p> : null}
                            <CopyReviewBadge count={p.copyReview} changed={p.copyReviewChanged} raw={p.copyReviewRaw} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-2 py-3 text-xs text-admin-muted xl:table-cell">{p.categoryName || "Tanpa kategori"}</TableCell>
                      <TableCell className="px-2 py-3 text-right"><span className="font-semibold text-admin-fg">{formatRupiah(p.price)}</span>{p.comparePrice? <span className="block text-xs text-admin-muted line-through">{formatRupiah(p.comparePrice)}</span>:null}</TableCell>
                      <TableCell className="px-2 py-3 text-center"><span className={`inline-flex min-w-[40px] justify-center px-2 py-1 rounded-md text-xs font-semibold ${p.stock<=5 && p.stock!==-1 ? "bg-admin-warning/15 text-admin-warning":"bg-admin-subtle text-admin-muted"}`}>{p.stock===-1?"∞":p.stock}</span></TableCell>
                      <TableCell className="px-2 py-3 text-center text-xs text-admin-muted">
                        <Input
                          value={soldDraft[p.id] ?? String(p.soldCount ?? 0)}
                          onChange={(e) => setSoldDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 7) }))}
                          onBlur={() => commitSold(p)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setSoldDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                          inputMode="numeric"
                          aria-label={`Ubah angka Terjual ${p.name}`}
                          title="Ketik lalu Enter — angka Terjual — pembelian asli tetap menambah di atas angka ini"
                          className="mx-auto h-8 min-h-0 w-16 border-admin-input bg-admin-card px-1 text-center tabular-nums text-admin-fg shadow-none hover:border-admin-input focus-visible:border-admin-input md:text-sm"
                        />
                        {p.groupSoldCount !== undefined && p.groupSoldCount !== (p.soldCount ?? 0) ? <span className="mt-1 block text-xs text-admin-muted">Tampil di toko: {p.groupSoldCount} (total grup)</span> : null}
                      </TableCell>
                      <TableCell className="px-2 py-3 text-center">
                        <div className="inline-flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                          <Input
                            value={position === undefined ? "—" : jumpDraft[p.id] ?? String(position)}
                            onChange={(e) => setJumpDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                            onBlur={() => commitJump(p)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setJumpDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                            inputMode="numeric"
                            disabled={position === undefined || copyFiltered}
                            aria-label={position === undefined ? `${p.name}: ${notLive}` : `Pindah ${p.name} ke posisi 1 sampai ${categorySize(p)}`}
                            title={position === undefined ? notLive : copyFiltered ? copyFilterHint : `Posisi ${position} dari ${categorySize(p)} — Ketik lalu Enter untuk lompat dalam kategori (kunci teknis sort_order: ${p.sortOrder ?? 0})`}
                            className="mr-1 h-8 min-h-0 w-16 border-admin-input bg-admin-card px-1 text-center tabular-nums text-admin-fg shadow-none hover:border-admin-input focus-visible:border-admin-input md:text-sm"
                          />
                          <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={position === undefined ? notLive : copyFiltered ? copyFilterHint : canMoveUp ? "Naik satu posisi" : "Sudah paling atas di kategori ini"} size="icon" className="size-8"><ArrowUp size={16} aria-hidden="true" /></Button>
                          <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={position === undefined ? notLive : copyFiltered ? copyFilterHint : canMoveDown ? "Turun satu posisi" : "Sudah paling bawah di kategori ini"} size="icon" className="size-8"><ArrowDown size={16} aria-hidden="true" /></Button>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-3 text-center">
                        <Switch checked={p.isActive} onCheckedChange={() => onToggleActive(p)} disabled={toggling === p.id} aria-label={`Toggle aktif ${p.name}`} title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} />
                      </TableCell>
                      <TableCell className="py-3  text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="outline" size="sm" type="button" onClick={()=>onEdit(p)} title="Edit produk & varian"><Pencil aria-hidden="true" /><span className="hidden xl:inline">Edit</span><span className="sr-only"> Produk & Varian</span></Button>
                          <Button variant="outline" size="icon" type="button" onClick={()=>onDelete(p)} className="size-8 text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><Trash2 aria-hidden="true" /></Button>
                        </div>
                      </TableCell>
                    </TableRow></Fragment>
                  );})}
                </TableBody>
              </Table>
            </div>
            {filtered.length===0 && <p className="p-8 text-center text-sm text-admin-muted">{onlyLowStock ? "Tidak ada varian dengan stok ≤ 5 — semua aman." : "Tidak ada produk — coba ubah kata kunci."}</p>}
            </>)}
            {!loadingList && filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
                <p className="text-sm text-admin-muted">Hal {safePage} dari {totalPages} · {filtered.length} produk</p>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    value={perPageAdmin}
                    onChange={(e) => { onPerPageChange(Number(e.target.value) as 20 | 50 | 100); onPageChange(() => 1); }}
                    aria-label="Jumlah per halaman"
                    title="Jumlah produk per halaman"
                    className="h-8 w-28"
                  >
                    <option value={20}>20 / hal</option>
                    <option value={50}>50 / hal</option>
                    <option value={100}>100 / hal</option>
                  </NativeSelect>
                  <Button variant="outline" size="sm" type="button" disabled={safePage<=1} onClick={()=>onPageChange(p=>Math.max(1,p-1))}><ChevronLeft aria-hidden="true" /> Sebelumnya</Button>
                  <Button variant="outline" size="sm" type="button" disabled={safePage>=totalPages} onClick={()=>onPageChange(p=>Math.min(totalPages,p+1))}>Berikutnya <ChevronRight aria-hidden="true" /></Button>
                </div>
              </div>
            )}
          </Card>
        </div>
    </Tabs>
  );
}
