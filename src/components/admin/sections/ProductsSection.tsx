"use client";
import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
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
    <span
      title="Buka Edit Produk & Varian, lalu tab Deskripsi & S&K"
      className="mt-1 inline-flex rounded-full border border-[#FFB800]/30 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFCF55]"
    >
      S&amp;K perlu ditinjau · {count} varian
    </span>
  );
}

/** Badge status toko — HANYA admin (keputusan owner 2026-10-01). Menjawab
 *  "mana yang live" dalam 1 detik: hijau Live, abu kalah, kuning habis,
 *  merah Off. Pecundang + habis = toggle ON tapi tidak tampil di toko. */
function LiveStatusBadge({ status, reason }: { status?: Prod["liveStatus"]; reason?: string }) {
  const s = status ?? "live";
  if (s === "live") {
    return <span title={reason || "Tampil di storefront"} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Live</span>;
  }
  if (s === "hidden_loser") {
    return <span title={reason || "Kalah pasangan — disembunyikan otomatis"} className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">Hidden: kalah</span>;
  }
  if (s === "hidden_soldout") {
    return <span title={reason || "Stok habis — restok otomatis tampil"} className="rounded-full border border-[#FFB800]/30 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFCF55]">Hidden: habis</span>;
  }
  return <span title={reason || "Nonaktif manual"} className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">Off</span>;
}
/** Badge asal supplier — HANYA admin (keputusan owner 2026-09-30). Pembeli
 *  tidak pernah melihat ini; pembeda di storefront hanya nama bersih. */
function SupplierBadge({ supplier, slug }: { supplier?: Prod["supplier"]; slug: string }) {
  if (supplier === "WR") {
    return <span title={`Supplier: Warung Rebahan · slug /${slug}`} className="rounded-full border border-[#FFB800]/30 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFCF55]">WR</span>;
  }
  if (supplier === "SK") {
    return <span title={`Supplier: Sekalipay · slug /${slug}`} className="rounded-full border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-2 py-0.5 text-[10px] font-bold text-[#5cefff]">SK</span>;
  }
  return <span title="Produk manual Axvara" className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">Manual</span>;
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
  // untuk menonaktifkan tombol ↑ di puncak dan ↓ di dasar, SEKALIGUS
  // sebagai angka yang TAMPIL di kolom Urutan (pos + 1, selalu 1..N rapi).
  // Yang tampil BUKAN raw sort_order — raw adalah kunci teknis yang boleh
  // kembar/lompat (hasil geser delta, backfill parsial, edit manual) dan
  // memang membingungkan bila dipajang (laporan owner 2026-09-29: 2,2,3,3,
  // 7,17,18,19 padahal posisi di toko sudah benar). Raw tetap dikirim ke
  // server dan terlihat di tooltip untuk diagnosis.
  // Tombol ↑↓ hanya aktif bila tetangga se-bucket status ada
  // (adjacentReorderProduct): sort_order tidak dapat melewati batas
  // ready/habis/nonaktif, jadi tombol di batas kelompok mati — menekan yang
  // mati tidak mengirim request dan tidak mengubah apa pun.
  const orderIndex = new Map(filtered.map((p, i) => [p.id, i]));
  // Badge posisi yang bisa diketik: ketik "1" + Enter untuk lompat ke puncak
  // dalam SATU request (bukan 29× klik ↑). Nilai dikunci 1..N saat commit.
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
    <>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 mb-2">
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total produk</p><p className="mt-1 text-2xl font-display font-bold text-white">{prods.length}</p></div>
          {/* "Produk aktif" lama menipu (termasuk pecundang + habis yang tidak
              tampil di toko). Kini: Live = yang benar tampil di storefront. */}
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Live di toko</p><p className="mt-1 text-2xl font-display font-bold text-[#22C55E]">{liveProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Hidden otomatis</p><p className="mt-1 text-2xl font-display font-bold text-[#FFB800]">{hiddenProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Nonaktif</p><p className="mt-1 text-2xl font-display font-bold text-red-300">{offProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Unit terjual</p><p className="mt-1 text-2xl font-display font-bold text-white">{soldProducts}</p></div>
      </div>

      <div className="mt-5">
          <div className="mb-3 min-w-0">
            <h2 className="text-sm font-semibold text-white">Produk</h2>
            <p className="mt-0.5 text-xs text-white/40">Katalog, harga, stok varian, dan status tampil di toko.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-[420px]">
              <div className="relative flex-1">
                <input value={q} onChange={e=>{ onQueryChange(e.target.value); onPageChange(()=>1); }} placeholder="Cari produk, slug, badge..." className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70"><IosIcon name="search" size={16} tint="white" /></span>
              </div>
              {/* Filter asal supplier (WR/SK/Manual) — lokal, tanpa request. */}
              <select
                value={supplierFilter}
                onChange={e=>{ onSupplierFilterChange(e.target.value as "all" | "WR" | "SK" | "Manual"); onPageChange(()=>1); }}
                aria-label="Filter asal supplier"
                title="Filter asal supplier (WR/SK/Manual)"
                className="h-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 px-3 text-xs font-semibold text-white/70 focus:outline-none focus:border-[#00E5FF]/40"
              >
                <option value="all">Semua asal</option>
                <option value="WR">WR</option>
                <option value="SK">SK</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
            <button onClick={onNew} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition"><IosIcon name="plus" size={14} tint="black" /> Produk Baru</button>
          </div>
          {/* Tab status toko (2026-10-01): 1 daftar mencampur 4 kondisi yang
              aturannya beda kini dipisah. Tombol ↑↓ hanya bermakna di tab Live
              (urutan antar yang tampil); di tab Hidden tombol dimatikan agar
              jelas urutan di sana tidak berpengaruh ke storefront. */}
          <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Status tampil produk">
            {([["live", `Live (${liveProducts})`], ["hidden", `Disembunyikan otomatis (${hiddenProducts})`], ["off", `Nonaktif manual (${offProducts})`], ["all", `Semua (${prods.length})`]] as const).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={liveTab === value}
                onClick={() => { onLiveTabChange(value); onPageChange(() => 1); }}
                title={value === "live" ? "Yang tampil di storefront — atur urutan di sini" : value === "hidden" ? "Kalah pasangan / stok habis — urutan di sini tidak berpengaruh" : value === "off" ? "Yang kamu matikan sendiri" : "Semua produk untuk audit"}
                className={`h-9 whitespace-nowrap rounded-full px-4 text-xs font-bold transition ${liveTab === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
            <select
              value={perPageAdmin}
              onChange={(e) => { onPerPageChange(Number(e.target.value) as 20 | 50 | 100); onPageChange(() => 1); }}
              aria-label="Jumlah per halaman"
              title="Jumlah produk per halaman"
              className="ml-auto h-9 shrink-0 rounded-full bg-white/[0.06] border border-white/10 px-3 text-xs font-semibold text-white/70 focus:outline-none focus:border-[#00E5FF]/40"
            >
              <option value={20}>20 / hal</option>
              <option value={50}>50 / hal</option>
              <option value={100}>100 / hal</option>
            </select>
          </div>

          {onlyLowStock && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-white/35">Filter aktif</span>
              <button type="button" onClick={onClearLowStock} className="inline-flex h-8 items-center gap-2 rounded-full border border-[#FFB800]/30 bg-[#FFB800]/10 px-3 text-xs font-semibold text-[#FFCF55] transition hover:bg-[#FFB800]/20">
                Stok menipis · varian ≤ 5
                <IosIcon name="close" size={10} tint="#FFCF55" />
              </button>
            </div>
          )}

          <div className="mt-4 ax-glass rounded-[20px] overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-white/60"><Spinner size={24} /><span className="text-sm">Memuat produk…</span></div>
            ) : (<>
            <div className="divide-y divide-white/[0.06] md:hidden">
              {paged.map(p=>{ const inHiddenTab = liveTab === "hidden"; const canMoveUp = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, -1)); const canMoveDown = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, 1)); const busy = reordering === p.id; return (<article key={p.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{p.name} <SupplierBadge supplier={p.supplier} slug={p.slug} /> <LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></p><p className="mt-0.5 truncate text-[11px] text-white/35">{p.categorySlug} · {p.variantCount ? `${p.variantCount} varian` : "produk"} · #{(orderIndex.get(p.id) ?? 0) + 1} dari {filtered.length}</p>{p.liveStatus !== "live" && p.liveReason ? <p className="mt-0.5 truncate text-[11px] text-white/40">{p.liveReason}</p> : null}<CopyReviewBadge count={p.copyReview} /></div><button type="button" aria-pressed={p.isActive} aria-label={`Toggle aktif ${p.name}`} disabled={toggling === p.id} onClick={() => onToggleActive(p)} className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 items-center rounded-full border px-[2px] ${p.isActive ? "border-emerald-600 bg-emerald-500" : "border-white/20 bg-white/15"}`}><span className={`h-[18px] w-[18px] rounded-full bg-white transition-transform ${p.isActive ? "translate-x-[20px]" : "translate-x-0"}`} /></button></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-white">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><span className="rounded-full bg-white/[0.07] px-2 py-1 text-white/50">Stok {p.stock === -1 ? "∞" : p.stock}</span><span className="text-white/35">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 grid grid-cols-[auto_1fr_auto] gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                    <button type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] text-sm font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-30 disabled:pointer-events-none">↑</button>
                    <button type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] text-sm font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-30 disabled:pointer-events-none">↓</button>
                  </div>
                  <button onClick={()=>onEdit(p)} className="h-9 rounded-xl bg-white text-xs font-bold text-[#080C1E] transition hover:bg-white/90">Edit Produk & Varian</button><button onClick={()=>onDelete(p)} className="flex h-9 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 transition hover:bg-red-500/25" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><IosIcon name="trash" size={14} tint="white" /></button>
                </div>
              </article>);})}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-[11px] tracking-[0.08em] text-white/40 uppercase border-b border-white/10">
                  <tr><th className="text-left font-semibold px-4 py-3">Produk</th><th className="text-left font-semibold px-3 py-3">Kategori</th><th className="text-right font-semibold px-3 py-3">Harga</th><th className="text-center font-semibold px-3 py-3">Stok</th><th className="text-center font-semibold px-3 py-3">Terjual</th><th className="text-center font-semibold px-3 py-3">Urutan</th><th className="text-center font-semibold px-3 py-3">Aktif</th><th className="text-right font-semibold px-4 py-3">Aksi</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paged.map(p=>{ const inHiddenTab = liveTab === "hidden"; const canMoveUp = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, -1)); const canMoveDown = !inHiddenTab && Boolean(adjacentReorderProduct(filtered, p.id, 1)); const busy = reordering === p.id; return (
                    <tr key={p.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="w-12 h-12 rounded-xl object-cover bg-white/5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-white leading-tight line-clamp-1">{p.name} <SupplierBadge supplier={p.supplier} slug={p.slug} /> <LiveStatusBadge status={p.liveStatus} reason={p.liveReason} /></p>
                            <p className="text-xs text-white/40 line-clamp-1">/{p.slug} {p.badge? `• ${p.badge}`:""}</p>
                            {p.liveStatus !== "live" && p.liveReason ? <p className="text-[11px] text-white/40 line-clamp-1">{p.liveReason}</p> : null}
                            <CopyReviewBadge count={p.copyReview} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-white/60">{p.categorySlug}</td>
                      <td className="px-3 py-3 text-right"><span className="font-semibold text-white">{formatRupiah(p.price)}</span>{p.comparePrice? <span className="block text-[11px] text-white/30 line-through">{formatRupiah(p.comparePrice)}</span>:null}</td>
                      <td className="px-3 py-3 text-center"><span className={`inline-flex min-w-[40px] justify-center px-2 py-1 rounded-full text-xs font-bold ${p.stock<=5 && p.stock!==-1 ? "bg-[#FFB800]/15 text-[#FFB800]":"bg-white/10 text-white/70"}`}>{p.stock===-1?"∞":p.stock}</span></td>
                      <td className="px-3 py-3 text-center text-xs text-white/60">
                        <input
                          value={soldDraft[p.id] ?? String(p.soldCount ?? 0)}
                          onChange={(e) => setSoldDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 7) }))}
                          onBlur={() => commitSold(p)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setSoldDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                          inputMode="numeric"
                          aria-label={`Ubah angka Terjual ${p.name}`}
                          title="Ketik angka Terjual lalu Enter — pembelian asli tetap menambah di atas angka ini"
                          className="h-7 w-[64px] rounded-full border border-transparent bg-transparent px-1 text-center text-xs text-white/60 outline-none transition hover:bg-white/[0.07] focus:border-[#00E5FF]/50 focus:bg-white/[0.10] focus:text-white"
                        />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1" role="group" aria-label={`Ubah urutan ${p.name}`}>
                          <input
                            value={jumpDraft[p.id] ?? String((orderIndex.get(p.id) ?? 0) + 1)}
                            onChange={(e) => setJumpDraft((prev) => ({ ...prev, [p.id]: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) }))}
                            onBlur={() => commitJump(p)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setJumpDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next; }); }}
                            inputMode="numeric"
                            disabled={liveTab === "hidden"}
                            aria-label={`Pindah ${p.name} ke posisi 1 sampai ${filtered.length}`}
                            title={liveTab === "hidden" ? "Urutan di tab Hidden tidak berpengaruh ke storefront — atur di tab Live" : `Posisi ${(orderIndex.get(p.id) ?? 0) + 1} dari ${filtered.length} — ketik angka lalu Enter untuk lompat (kunci teknis sort_order: ${p.sortOrder ?? 0})`}
                            className="mr-1 h-7 w-[44px] rounded-full border border-transparent bg-white/10 px-1 text-center text-xs font-bold text-white/70 outline-none transition focus:border-[#00E5FF]/50 focus:bg-white/[0.14] focus:text-white"
                          />
                          <button type="button" onClick={()=>onMove(p, -1)} disabled={busy || !canMoveUp} aria-label={`Naikkan ${p.name}`} title={canMoveUp ? "Naik satu posisi" : "Sudah di puncak kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-xs font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-30 disabled:pointer-events-none">↑</button>
                          <button type="button" onClick={()=>onMove(p, 1)} disabled={busy || !canMoveDown} aria-label={`Turunkan ${p.name}`} title={canMoveDown ? "Turun satu posisi" : "Sudah di dasar kelompoknya (aktif/habis/nonaktif tidak bisa saling melewati)"} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-xs font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-30 disabled:pointer-events-none">↓</button>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          type="button"
                          aria-pressed={p.isActive}
                          aria-label={`Toggle aktif ${p.name}`}
                          disabled={toggling === p.id}
                          onClick={() => onToggleActive(p)}
                          title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"}
                          className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 cursor-pointer items-center rounded-full border px-[2px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/50 disabled:opacity-50 disabled:cursor-wait ${p.isActive ? "bg-[#22C55E] border-[#16a34a] shadow-[0_0_14px_rgba(34,197,94,0.45)]" : "bg-white/20 border-white/25"}`}
                        >
                          <span className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform duration-200 ${p.isActive ? "translate-x-[20px]" : "translate-x-0"}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={()=>onEdit(p)} className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90 shadow-sm"><IosIcon name="edit" size={12} tint="black" /> Edit Produk & Varian</button>
                          <button onClick={()=>onDelete(p)} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition" aria-label={`Hapus ${p.name}`} title="Hapus produk"><IosIcon name="trash" size={16} tint="white" /></button>
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            {filtered.length===0 && <p className="p-8 text-center text-sm text-white/40">{onlyLowStock ? "Tidak ada varian dengan stok ≤ 5 — semua aman." : "Tidak ada produk — coba ubah kata kunci."}</p>}
            </>)}
            {filtered.length > perPage && !loadingList && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
                <p className="text-xs text-white/40">Hal {safePage} dari {totalPages} • {filtered.length} produk</p>
                <div className="flex items-center gap-1.5">
                  <button disabled={safePage<=1} onClick={()=>onPageChange(p=>Math.max(1,p-1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"><IosIcon name="chevron-left" size={12} tint="white" /> Sebelumnya</button>
                  <span className="text-xs text-white/40 px-1">{safePage} / {totalPages}</span>
                  <button disabled={safePage>=totalPages} onClick={()=>onPageChange(p=>Math.min(totalPages,p+1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">Berikutnya <IosIcon name="chevron-right" size={12} tint="white" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  );
}
