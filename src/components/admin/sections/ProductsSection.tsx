"use client";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Badge, Button, Card, Input, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Switch, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/admin/AdminIcon";
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
    return <Badge title={reason || "Kalah pasangan — disembunyikan otomatis"} className="rounded-md border border-admin-border bg-admin-subtle px-2 py-0.5 text-xs font-semibold text-admin-muted">Hidden: kalah</Badge>;
  }
  if (s === "hidden_soldout") {
    return <Badge title={reason || "Stok habis — restok otomatis tampil"} className="rounded-md border border-admin-warning/30 bg-admin-warning/10 px-2 py-0.5 text-xs font-semibold text-admin-warning">Hidden: habis</Badge>;
  }
  return <Badge title={reason || "Nonaktif manual"} className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-2 py-0.5 text-xs font-semibold text-admin-danger">Off</Badge>;
}
/** Badge asal supplier — HANYA admin (keputusan owner 2026-09-30). Pembeli
 *  tidak pernah melihat ini; pembeda di storefront hanya nama bersih. */
function SupplierBadge({ supplier, slug }: { supplier?: Prod["supplier"]; slug: string }) {
  if (supplier === "WR") {
    return <Badge title={`Supplier: Warung Rebahan · slug /${slug}`} className="rounded-md border border-admin-warning/30 bg-admin-warning/10 px-2 py-0.5 text-xs font-semibold text-admin-warning">WR</Badge>;
  }
  if (supplier === "SK") {
    return <Badge title={`Supplier: Sekalipay · slug /${slug}`} className="rounded-md border border-admin-accent/30 bg-admin-primary/10 px-2 py-0.5 text-xs font-semibold text-admin-accent">SK</Badge>;
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
    <Tabs value={liveTab} onValueChange={value => { onLiveTabChange(value as typeof liveTab); onPageChange(() => 1); }}>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 mb-2">
          <Card className="admin-surface rounded-xl p-4"><p className="text-xs tracking-wide text-admin-muted uppercase">Total produk</p><p className="mt-1 text-2xl font-sans font-semibold text-admin-fg">{prods.length}</p></Card>
          {/* "Produk aktif" lama menipu (termasuk pecundang + habis yang tidak
              tampil di toko). Kini: Live = yang benar tampil di storefront. */}
          <Card className="admin-surface rounded-xl p-4"><p className="text-xs tracking-wide text-admin-muted uppercase">Live di toko</p><p className="mt-1 text-2xl font-sans font-semibold text-admin-success">{liveProducts}</p></Card>
          <Card className="admin-surface rounded-xl p-4"><p className="text-xs tracking-wide text-admin-muted uppercase">Hidden otomatis</p><p className="mt-1 text-2xl font-sans font-semibold text-admin-warning">{hiddenProducts}</p></Card>
          <Card className="admin-surface rounded-xl p-4"><p className="text-xs tracking-wide text-admin-muted uppercase">Nonaktif</p><p className="mt-1 text-2xl font-sans font-semibold text-admin-danger">{offProducts}</p></Card>
          <Card className="admin-surface rounded-xl p-4"><p className="text-xs tracking-wide text-admin-muted uppercase">Unit terjual</p><p className="mt-1 text-2xl font-sans font-semibold text-admin-fg">{soldProducts}</p></Card>
      </div>

      <div className="mt-5">
          <div className="mb-3 min-w-0">
            <h2 className="text-xl font-semibold text-admin-fg">Produk</h2>
            <p className="mt-0.5 text-sm text-admin-muted">Katalog, harga, stok varian, dan status tampil di toko.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0 max-w-[520px] flex-wrap">
              <div className="relative flex-1">
                <Input value={q} onChange={e=>{ onQueryChange(e.target.value); onPageChange(()=>1); }} aria-label="Cari produk" placeholder="Cari produk, slug, badge..." className="w-full h-9 pl-10 pr-4 rounded-md bg-admin-subtle border border-admin-border text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none focus:border-admin-accent/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70"><IosIcon name="search" size={16} tint="currentColor" /></span>
              </div>
              {/* Filter asal supplier (WR/SK/Manual) — lokal, tanpa request. */}
              <NativeSelect
                value={supplierFilter}
                onChange={e=>{ onSupplierFilterChange(e.target.value as "all" | "WR" | "SK" | "Manual"); onPageChange(()=>1); }}
                aria-label="Filter asal supplier"
                title="Filter asal supplier (WR/SK/Manual)"
                className="h-9 shrink-0 rounded-md bg-admin-subtle border border-admin-border px-3 text-xs font-semibold text-admin-muted focus:outline-none focus:border-admin-accent/40"
              >
                <option value="all">Semua asal</option>
                <option value="WR">WR</option>
                <option value="SK">SK</option>
                <option value="Manual">Manual</option>
              </NativeSelect>
            </div>
            <Button variant="default" type="button" onClick={onNew} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap px-5 rounded-md bg-admin-primary text-admin-inverse text-sm font-semibold hover:bg-admin-primary transition"><IosIcon name="plus" size={14} tint="currentColor" /> Produk Baru</Button>
          </div>
          {/* Tab status toko (2026-10-01): 1 daftar mencampur 4 kondisi yang
              aturannya beda kini dipisah. Tombol naikturun hanya bermakna di tab Live
              (urutan antar yang tampil); di tab Hidden tombol dimatikan agar
              jelas urutan di sana tidak berpengaruh ke storefront. */}
          <div className="mt-4 flex flex-wrap items-center gap-2"><TabsList aria-label="Status tampil produk" className="justify-start">
            {([["live", `Live (${liveProducts})`], ["hidden", `Disembunyikan otomatis (${hiddenProducts})`], ["off", `Nonaktif manual (${offProducts})`], ["all", `Semua (${prods.length})`]] as const).map(([value, label]) => (
              <TabsTrigger value={value}
                key={value}
                title={value === "live" ? "Yang tampil di storefront — atur urutan di sini" : value === "hidden" ? "Kalah pasangan / stok habis — urutan di sini tidak berpengaruh" : value === "off" ? "Yang kamu matikan sendiri" : "Semua produk untuk audit"}
                className="text-xs"
              >
                {label}
              </TabsTrigger>
            ))}
            </TabsList><NativeSelect
              value={perPageAdmin}
              onChange={(e) => { onPerPageChange(Number(e.target.value) as 20 | 50 | 100); onPageChange(() => 1); }}
              aria-label="Jumlah per halaman"
              title="Jumlah produk per halaman"
              className="ml-auto h-9 shrink-0 rounded-md bg-admin-subtle border border-admin-border px-3 text-xs font-semibold text-admin-muted focus:outline-none focus:border-admin-accent/40"
            >
              <option value={20}>20 / hal</option>
              <option value={50}>50 / hal</option>
              <option value={100}>100 / hal</option>
            </NativeSelect>
          </div>

          {onlyLowStock && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-admin-muted">Filter aktif</span>
              <Button variant="outline" size="sm" type="button" onClick={onClearLowStock} className="inline-flex h-8 items-center gap-2 rounded-md border border-admin-warning/30 bg-admin-warning/10 px-3 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/20">
                Stok menipis · varian ≤ 5
                <IosIcon name="close" size={10} tint="currentColor" />
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
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-admin-fg">{p.name}</p><div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div><p className="mt-0.5 truncate text-xs text-admin-muted">{p.categorySlug} · {p.variantCount ? `${p.variantCount} varian` : "produk"} · #{(orderIndex.get(p.id) ?? 0) + 1} dari {filtered.length}</p>{p.liveStatus !== "live" && p.liveReason ? <p className="mt-0.5 truncate text-xs text-admin-muted">{p.liveReason}</p> : null}<CopyReviewBadge count={p.copyReview} /></div><Switch checked={p.isActive} onCheckedChange={() => onToggleActive(p)} disabled={toggling === p.id} aria-label={`Toggle aktif ${p.name}`} title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} /></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-admin-fg">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-1 text-admin-muted">Stok {p.stock === -1 ? "∞" : p.stock}</Badge><span className="text-admin-muted">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 grid grid-cols-[auto_1fr_auto] gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-9 w-9 items-center justify-center rounded-xl bg-admin-subtle text-sm font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-30 disabled:pointer-events-none"><ArrowUp size={16} aria-hidden="true" /></Button>
                    <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-9 w-9 items-center justify-center rounded-xl bg-admin-subtle text-sm font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-30 disabled:pointer-events-none"><ArrowDown size={16} aria-hidden="true" /></Button>
                  </div>
                  <Button variant="default" type="button" onClick={()=>onEdit(p)} className="h-9 rounded-xl bg-admin-primary text-xs font-semibold text-admin-inverse transition hover:bg-admin-subtle">Edit Produk & Varian</Button><Button variant="outline" size="icon" type="button" onClick={()=>onDelete(p)} className="flex h-9 w-10 shrink-0 items-center justify-center rounded-xl bg-admin-danger/15 transition hover:bg-admin-danger/25" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><IosIcon name="trash" size={14} tint="currentColor" /></Button>
                </div>
              </Card>);})}
            </div>
            <div className="hidden overflow-x-auto md:block" role="region" aria-label="Daftar produk" tabIndex={0}>
              <Table className="w-full text-sm">
                <TableHeader className="text-xs tracking-[0.08em] text-admin-muted uppercase border-b border-admin-border">
                  <TableRow><TableHead className="text-left font-semibold px-4 py-3">Produk</TableHead><TableHead className="text-left font-semibold px-3 py-3">Kategori</TableHead><TableHead className="text-right font-semibold px-3 py-3">Harga</TableHead><TableHead className="text-center font-semibold px-3 py-3">Stok</TableHead><TableHead className="text-center font-semibold px-3 py-3">Terjual</TableHead><TableHead className="text-center font-semibold px-3 py-3">Urutan</TableHead><TableHead className="text-center font-semibold px-3 py-3">Aktif</TableHead><TableHead className="text-right font-semibold px-4 py-3">Aksi</TableHead></TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-admin-border">
                  {paged.map(p=>{ const inHiddenTab = liveTab === "hidden"; const canMoveUp = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, -1)); const canMoveDown = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, 1)); const busy = reordering === p.id; return (
                    <TableRow key={p.id} className="hover:bg-admin-subtle transition">
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-mark.svg"} alt="" className="w-12 h-12 rounded-xl object-cover bg-admin-subtle shrink-0" />
                          <div className="min-w-0">
                            <p className="max-w-xs truncate font-semibold text-admin-fg leading-tight" title={p.name}>{p.name}</p>
                            <div className="mt-1 flex flex-wrap gap-1"><SupplierBadge supplier={p.supplier} slug={p.slug} /><LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></div>
                            <p className="text-xs text-admin-muted line-clamp-1">/{p.slug} {p.badge? `· ${p.badge}`:""}</p>
                            {p.liveStatus !== "live" && p.liveReason ? <p className="text-xs text-admin-muted line-clamp-1">{p.liveReason}</p> : null}
                            <CopyReviewBadge count={p.copyReview} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-xs text-admin-muted">{p.categorySlug}</TableCell>
                      <TableCell className="px-3 py-3 text-right"><span className="font-semibold text-admin-fg">{formatRupiah(p.price)}</span>{p.comparePrice? <span className="block text-xs text-admin-muted line-through">{formatRupiah(p.comparePrice)}</span>:null}</TableCell>
                      <TableCell className="px-3 py-3 text-center"><span className={`inline-flex min-w-[40px] justify-center px-2 py-1 rounded-md text-xs font-semibold ${p.stock<=5 && p.stock!==-1 ? "bg-admin-warning/15 text-admin-warning":"bg-admin-subtle text-admin-muted"}`}>{p.stock===-1?"∞":p.stock}</span></TableCell>
                      <TableCell className="px-3 py-3 text-center text-xs text-admin-muted">
                        <Input
                          value={soldDraft[p.id] ?? String(p.soldCount ?? 0)}
                          onChange={(e) => setSoldDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 7) }))}
                          onBlur={() => commitSold(p)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setSoldDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                          inputMode="numeric"
                          aria-label={`Ubah angka Terjual ${p.name}`}
                          title="Ketik angka Terjual lalu Enter — pembelian asli tetap menambah di atas angka ini"
                          className="h-7 w-[64px] rounded-md border border-transparent bg-transparent px-1 text-center text-xs text-admin-muted outline-none transition hover:bg-admin-subtle focus:border-admin-accent/50 focus:bg-admin-subtle focus:text-admin-fg"
                        />
                      </TableCell>
                      <TableCell className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                          <Input
                            value={jumpDraft[p.id] ?? String((orderIndex.get(p.id) ?? 0) + 1)}
                            onChange={(e) => setJumpDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                            onBlur={() => commitJump(p)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setJumpDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                            inputMode="numeric"
                            disabled={liveTab === "hidden"}
                            aria-label={`Pindah ${p.name} ke posisi 1 sampai ${filtered.length}`}
                            title={liveTab === "hidden" ? "Urutan di tab Hidden tidak berpengaruh ke storefront — atur di tab Live" : `Posisi ${(orderIndex.get(p.id) ?? 0) + 1} dari ${filtered.length} — ketik angka lalu Enter untuk lompat (kunci teknis sort_order: ${p.sortOrder ?? 0})`}
                            className="mr-1 h-7 w-[44px] rounded-md border border-transparent bg-admin-subtle px-1 text-center text-xs font-semibold text-admin-muted outline-none transition focus:border-admin-accent/50 focus:bg-admin-subtle focus:text-admin-fg"
                          />
                          <Button variant="outline" type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-7 w-7 items-center justify-center rounded-md bg-admin-subtle text-xs font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-30 disabled:pointer-events-none"><ArrowUp size={16} aria-hidden="true" /></Button>
                          <Button variant="outline" type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-7 w-7 items-center justify-center rounded-md bg-admin-subtle text-xs font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-30 disabled:pointer-events-none"><ArrowDown size={16} aria-hidden="true" /></Button>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 text-center">
                        <Switch checked={p.isActive} onCheckedChange={() => onToggleActive(p)} disabled={toggling === p.id} aria-label={`Toggle aktif ${p.name}`} title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"} />
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="default" type="button" onClick={()=>onEdit(p)} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 rounded-md bg-admin-primary text-admin-inverse text-xs font-semibold hover:opacity-90"><IosIcon name="edit" size={12} /> Edit Produk & Varian</Button>
                          <Button variant="outline" size="icon" type="button" onClick={()=>onDelete(p)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-admin-danger/30 text-admin-danger hover:bg-admin-danger/10 transition" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><IosIcon name="trash" size={16} /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );})}
                </TableBody>
              </Table>
            </div>
            {filtered.length===0 && <p className="p-8 text-center text-sm text-admin-muted">{onlyLowStock ? "Tidak ada varian dengan stok ≤ 5 — semua aman." : "Tidak ada produk — coba ubah kata kunci."}</p>}
            </>)}
            {filtered.length > perPage && !loadingList && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-admin-border">
                <p className="text-xs text-admin-muted">Hal {safePage} dari {totalPages} · {filtered.length} produk</p>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" type="button" disabled={safePage<=1} onClick={()=>onPageChange(p=>Math.max(1,p-1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-md admin-surface text-xs font-semibold text-admin-muted disabled:opacity-40 disabled:pointer-events-none"><IosIcon name="chevron-left" size={12} tint="currentColor" /> Sebelumnya</Button>
                  <span className="text-xs text-admin-muted px-1">{safePage} / {totalPages}</span>
                  <Button variant="ghost" size="sm" type="button" disabled={safePage>=totalPages} onClick={()=>onPageChange(p=>Math.min(totalPages,p+1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-md admin-surface text-xs font-semibold text-admin-muted disabled:opacity-40 disabled:pointer-events-none">Berikutnya <IosIcon name="chevron-right" size={12} tint="currentColor" /></Button>
                </div>
              </div>
            )}
          </Card>
        </div>
    </Tabs>
  );
}
