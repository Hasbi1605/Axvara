"use client";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge, Button, Card, Input, NativeSelect, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Switch, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { Prod } from "../product-types";
import { adjacentReorderProduct } from "@/lib/product-order";

// Section "Produk" dipisah karena inilah bagian terbesar page.tsx: kartu statistik,
// pencarian, tabel/daftar responsif, dan pagination. Semua state tetap dimiliki
// page.tsx dan diturunkan lewat props eksplisit — komponen ini hanya merender dan
// meneruskan event, tanpa memiliki state bisnis sendiri.

/** Filter asal supplier di daftar admin (keputusan owner 2026-09-30). */
export type SupplierFilter = "all" | "WR" | "SK" | "Manual";

/** Varian aktif yang S&K-nya perlu ditinjau (teks WR belum versi Axvara / suntingan dijeda). */
function CopyReviewBadge({ count }: { count?: number }) {
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
    return <Badge variant="secondary" title={reason || "Pasangan supplier lain dipilih — disembunyikan otomatis"}>Disembunyikan</Badge>;
  }
  if (s === "hidden_soldout") {
    return <Badge variant="warning" title={reason || "Stok habis — restok otomatis tampil"}>Stok habis</Badge>;
  }
  return <Badge variant="secondary" title={reason || "Nonaktif manual"}>Nonaktif</Badge>;
}
/** Badge asal supplier — HANYA admin (keputusan owner 2026-09-30). Pembeli
 *  tidak pernah melihat ini; pembeda di storefront hanya nama bersih. */
function SupplierBadge({ supplier, slug }: { supplier?: Prod["supplier"]; slug: string }) {
  if (supplier === "WR") {
    return <Badge variant="secondary" title={`Supplier: Warung Rebahan · slug /${slug}`}>WR</Badge>;
  }
  if (supplier === "SK") {
    return <Badge variant="secondary" title={`Supplier: Sekalipay · slug /${slug}`}>SK</Badge>;
  }
  return <Badge title="Produk manual Axvara" className="rounded-md border border-admin-border bg-admin-subtle px-2 py-0.5 text-xs font-semibold text-admin-muted">Manual</Badge>;
}

export function ProductsSection({
  prods,
  paged,
  filtered,
  q,
  safePage,
  totalPages,
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
  onToggleActive,
  reordering,
  onMove,
  onJump,
  onSoldCount,
}: {
  prods: Prod[];
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
  liveTab: "live" | "hidden" | "off" | "all";
  onLiveTabChange: (value: "live" | "hidden" | "off" | "all") => void;
  perPageAdmin: 20 | 50 | 100;
  onPerPageChange: (value: 20 | 50 | 100) => void;
  supplierFilter: "all" | "WR" | "SK" | "Manual";
  onSupplierFilterChange: (value: "all" | "WR" | "SK" | "Manual") => void;
  onQueryChange: (value: string) => void;
  onPageChange: (updater: (prev: number) => number) => void;
  onlyLowStock: boolean;
  onClearLowStock: () => void;
  onNew: () => void;
  onEdit: (p: Prod) => void;
  onDelete: (p: Prod) => void;
  onToggleActive: (p: Prod) => void;
  reordering: string | null;
  onMove: (p: Prod, direction: -1 | 1) => void;
  /** Lompat langsung ke posisi 1..N (badge diketik) — satu request. */
  onJump: (p: Prod, targetPosition: number) => void;
  /** Edit angka Terjual inline (ketik + Enter) — SET absolut. */
  onSoldCount: (p: Prod, soldCount: number) => void;
}) {
  // Posisi tampil produk di daftar penuh (tanpa potong halaman): dipakai
  // untuk menonaktifkan tombol naik di puncak dan turun di dasar, SEKALIGUS
  // sebagai angka yang TAMPIL di kolom Urutan (pos + 1, selalu 1..N rapi).
  // Yang tampil BUKAN raw sort_order — raw adalah kunci teknis yang boleh
  // kembar/lompat (hasil geser delta, backfill parsial, edit manual) dan
  // memang membingungkan bila dipajang (laporan owner 2026-09-29: 2,2,3,3,
  // 7,17,18,19 padahal posisi di toko sudah benar). Raw tetap dikirim ke
  // server dan terlihat di tooltip untuk diagnosis.
  // Tombol naikturun hanya aktif bila tetangga se-bucket status ada
  // (adjacentReorderProduct): sort_order tidak dapat melewati batas
  // ready/habis/nonaktif, jadi tombol di batas kelompok mati — menekan yang
  // mati tidak mengirim request dan tidak mengubah apa pun.
  const orderIndex = new Map(filtered.map((p, i) => [p.id, i]));
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
    if (!raw) return;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return;
    const target = Math.max(1, Math.min(filtered.length, n));
    const current = (orderIndex.get(p.id) ?? 0) + 1;
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Total produk" value={loadingList ? <Skeleton className="h-8 w-16" /> : prods.length} />
          <StatCard label="Live di toko" value={loadingList ? <Skeleton className="h-8 w-16" /> : liveProducts} />
          <StatCard label="Disembunyikan otomatis" value={loadingList ? <Skeleton className="h-8 w-16" /> : hiddenProducts} />
          <StatCard label="Nonaktif" value={loadingList ? <Skeleton className="h-8 w-16" /> : offProducts} />
          <StatCard label="Unit terjual" value={loadingList ? <Skeleton className="h-8 w-16" /> : soldProducts} />
      </div>

      <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" aria-hidden="true" />
              <Input value={q} onChange={e=>{ onQueryChange(e.target.value); onPageChange(()=>1); }} aria-label="Cari produk" placeholder="Cari produk, slug, badge..." className="pl-9" />
            </div>
            {/* Filter asal supplier (WR/SK/Manual) — lokal, tanpa request. */}
            <NativeSelect
              value={supplierFilter}
              onChange={e=>{ onSupplierFilterChange(e.target.value as "all" | "WR" | "SK" | "Manual"); onPageChange(()=>1); }}
              aria-label="Filter asal supplier"
              title="Filter asal supplier (WR/SK/Manual)"
              className="w-full sm:w-44"
            >
              <option value="all">Semua asal</option>
              <option value="WR">WR</option>
              <option value="SK">SK</option>
              <option value="Manual">Manual</option>
            </NativeSelect>
          </div>
          {/* Tab status toko (2026-10-01): 1 daftar mencampur 4 kondisi yang
              aturannya beda kini dipisah. Tombol naikturun hanya bermakna di tab Live
              (urutan antar yang tampil); di tab Hidden tombol dimatikan agar
              jelas urutan di sana tidak berpengaruh ke storefront. */}
          <div className="mt-3 max-w-full overflow-x-auto"><TabsList aria-label="Status tampil produk" className="justify-start">
            {([["live", `Live (${liveProducts})`], ["hidden", `Disembunyikan otomatis (${hiddenProducts})`], ["off", `Nonaktif manual (${offProducts})`], ["all", `Semua (${prods.length})`]] as const).map(([value, label]) => (
              <TabsTrigger value={value}
                key={value}
                title={value === "live" ? "Yang tampil di storefront — atur urutan di sini" : value === "hidden" ? "Kalah pasangan / stok habis — urutan di sini tidak berpengaruh" : value === "off" ? "Yang kamu matikan sendiri" : "Semua produk untuk audit"}
              >
                {label}
              </TabsTrigger>
            ))}
            </TabsList></div>

          {onlyLowStock && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-admin-muted">Filter aktif</span>
              <Button variant="outline" size="sm" type="button" onClick={onClearLowStock}>
                Stok menipis · varian ≤ 5
                <X aria-hidden="true" />
              </Button>
            </div>
          )}

          <Card className="mt-4 admin-surface rounded-xl overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-admin-muted"><Skeleton className="h-6 w-48" /><span className="text-sm">Memuat produk…</span></div>
            ) : (<>
            <div className="divide-y divide-admin-border md:hidden">
              {paged.map(p=>{ const inHiddenTab = liveTab === "hidden"; const canMoveUp = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, -1)); const canMoveDown = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, 1)); const busy = reordering === p.id; return (<Card key={p.id} className="border-0 p-4 shadow-none">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image || "/brand/axvara-mark.svg"} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-admin-subtle object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-admin-fg">{p.name}</p><div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div><p className="mt-0.5 truncate text-xs text-admin-muted">{p.categoryName || "Tanpa kategori"} · {p.variantCount ? `${p.variantCount} varian` : "produk"} · #{(orderIndex.get(p.id) ?? 0) + 1} dari {filtered.length}</p>{p.liveStatus !== "live" && p.liveReason ? <p className="mt-0.5 truncate text-xs text-admin-muted">{p.liveReason}</p> : null}<CopyReviewBadge count={p.copyReview} /></div><Switch checked={p.isActive} onCheckedChange={() => onToggleActive(p)} disabled={toggling === p.id} aria-label={`Toggle aktif ${p.name}`} title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} /></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-admin-fg">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-1 text-admin-muted">Stok {p.stock === -1 ? "∞" : p.stock}</Badge><span className="text-admin-muted">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} size="icon"><ArrowUp size={16} aria-hidden="true" /></Button>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} size="icon"><ArrowDown size={16} aria-hidden="true" /></Button>
                  </div>
                  <Button variant="outline" size="sm" type="button" onClick={()=>onEdit(p)}><Pencil aria-hidden="true" /> Edit Produk & Varian</Button><Button variant="outline" size="icon" type="button" onClick={()=>onDelete(p)} className="size-8 text-admin-danger hover:bg-admin-danger/10 hover:text-admin-danger" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><Trash2 aria-hidden="true" /></Button>
                </div>
              </Card>);})}
            </div>
            <div className="hidden overflow-x-auto md:block" role="region" aria-label="Daftar produk" tabIndex={0}>
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="">Produk</TableHead><TableHead className="hidden px-2 xl:table-cell">Kategori</TableHead><TableHead className="px-2 text-right">Harga</TableHead><TableHead className="px-2 text-center">Stok</TableHead><TableHead className="px-2 text-center">Terjual</TableHead><TableHead className="px-2 text-center">Urutan</TableHead><TableHead className="px-2 text-center">Aktif</TableHead><TableHead className=" text-right">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map(p=>{ const inHiddenTab = liveTab === "hidden"; const canMoveUp = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, -1)); const canMoveDown = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, 1)); const busy = reordering === p.id; return (
                    <TableRow key={p.id}>
                      <TableCell className="py-3 ">
                        <div className="flex min-w-[180px] items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-mark.svg"} alt="" className="size-10 shrink-0 rounded-md bg-admin-subtle object-cover" />
                          <div className="min-w-0">
                            <p className="max-w-[11rem] truncate font-medium 2xl:max-w-[16rem] leading-tight text-admin-fg" title={p.name}>{p.name}</p>
                            <div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div>
                            <p className="text-xs text-admin-muted line-clamp-1">/{p.slug} {p.badge? `· ${p.badge}`:""}</p>
                            {p.liveStatus !== "live" && p.liveReason ? <p className="text-xs text-admin-muted line-clamp-1">{p.liveReason}</p> : null}
                            <CopyReviewBadge count={p.copyReview} />
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
                      </TableCell>
                      <TableCell className="px-2 py-3 text-center">
                        <div className="inline-flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                          <Input
                            value={jumpDraft[p.id] ?? String((orderIndex.get(p.id) ?? 0) + 1)}
                            onChange={(e) => setJumpDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                            onBlur={() => commitJump(p)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setJumpDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                            inputMode="numeric"
                            disabled={liveTab === "hidden"}
                            aria-label={`Pindah ${p.name} ke posisi 1 sampai ${filtered.length}`}
                            title={liveTab === "hidden" ? "Urutan di tab Hidden tidak berpengaruh ke storefront — atur di tab Live" : `Posisi ${(orderIndex.get(p.id) ?? 0) + 1} dari ${filtered.length} — Ketik lalu Enter untuk lompat (kunci teknis sort_order: ${p.sortOrder ?? 0})`}
                            className="mr-1 h-8 min-h-0 w-16 border-admin-input bg-admin-card px-1 text-center tabular-nums text-admin-fg shadow-none hover:border-admin-input focus-visible:border-admin-input md:text-sm"
                          />
                          <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} size="icon" className="size-8"><ArrowUp size={16} aria-hidden="true" /></Button>
                          <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} size="icon" className="size-8"><ArrowDown size={16} aria-hidden="true" /></Button>
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
                    </TableRow>
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
