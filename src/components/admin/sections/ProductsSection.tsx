"use client";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import type { Prod } from "../product-types";

// Section "Produk" dipisah karena inilah bagian terbesar page.tsx: kartu statistik,
// pencarian, tabel/daftar responsif, dan pagination. Semua state tetap dimiliki
// page.tsx dan diturunkan lewat props eksplisit — komponen ini hanya merender dan
// meneruskan event, tanpa memiliki state bisnis sendiri.

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
  onQueryChange,
  onPageChange,
  onNew,
  onEdit,
  onDelete,
  onToggleActive,
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
  onQueryChange: (value: string) => void;
  onPageChange: (updater: (prev: number) => number) => void;
  onNew: () => void;
  onEdit: (p: Prod) => void;
  onDelete: (p: Prod) => void;
  onToggleActive: (p: Prod) => void;
}) {
  return (
    <>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total produk</p><p className="mt-1 text-2xl font-display font-bold text-white">{prods.length}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Produk aktif</p><p className="mt-1 text-2xl font-display font-bold text-[#22C55E]">{activeProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Stok menipis</p><p className="mt-1 text-2xl font-display font-bold text-[#FFB800]">{lowStock}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Unit terjual</p><p className="mt-1 text-2xl font-display font-bold text-white">{soldProducts}</p></div>
      </div>

      <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-[420px]">
              <div className="relative flex-1">
                <input value={q} onChange={e=>{ onQueryChange(e.target.value); onPageChange(()=>1); }} placeholder="Cari produk, slug, badge..." className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70"><IosIcon name="search" size={16} tint="white" /></span>
              </div>
            </div>
            <button onClick={onNew} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition"><IosIcon name="plus" size={14} tint="black" /> Produk Baru</button>
          </div>

          <div className="mt-4 ax-glass rounded-[20px] overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-white/60"><Spinner size={24} /><span className="text-sm">Memuat produk…</span></div>
            ) : (<>
            <div className="divide-y divide-white/[0.06] md:hidden">
              {paged.map(p=><article key={p.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{p.name}</p><p className="mt-0.5 truncate text-[11px] text-white/35">{p.categorySlug} · {p.variantCount ? `${p.variantCount} varian` : "produk"}</p></div><button type="button" aria-pressed={p.isActive} aria-label={`Toggle aktif ${p.name}`} disabled={toggling === p.id} onClick={() => onToggleActive(p)} className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 items-center rounded-full border px-[2px] ${p.isActive ? "border-emerald-600 bg-emerald-500" : "border-white/20 bg-white/15"}`}><span className={`h-[18px] w-[18px] rounded-full bg-white transition-transform ${p.isActive ? "translate-x-[20px]" : "translate-x-0"}`} /></button></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-white">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><span className="rounded-full bg-white/[0.07] px-2 py-1 text-white/50">Stok {p.stock === -1 ? "∞" : p.stock}</span><span className="text-white/35">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><button onClick={()=>onEdit(p)} className="h-9 rounded-xl bg-white text-xs font-bold text-[#080C1E] transition hover:bg-white/90">Edit Produk & Varian</button><button onClick={()=>onDelete(p)} className="flex h-9 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 transition hover:bg-red-500/25" aria-label={`Arsipkan ${p.name}`} title="Arsipkan produk"><IosIcon name="trash" size={14} tint="white" /></button></div>
              </article>)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-[11px] tracking-[0.08em] text-white/40 uppercase border-b border-white/10">
                  <tr><th className="text-left font-semibold px-4 py-3">Produk</th><th className="text-left font-semibold px-3 py-3">Kategori</th><th className="text-right font-semibold px-3 py-3">Harga</th><th className="text-center font-semibold px-3 py-3">Stok</th><th className="text-center font-semibold px-3 py-3">Terjual</th><th className="text-center font-semibold px-3 py-3">Aktif</th><th className="text-right font-semibold px-4 py-3">Aksi</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paged.map(p=>(
                    <tr key={p.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="w-12 h-12 rounded-xl object-cover bg-white/5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-white leading-tight line-clamp-1">{p.name}</p>
                            <p className="text-xs text-white/40 line-clamp-1">/{p.slug} {p.badge? `• ${p.badge}`:""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-white/60">{p.categorySlug}</td>
                      <td className="px-3 py-3 text-right"><span className="font-semibold text-white">{formatRupiah(p.price)}</span>{p.comparePrice? <span className="block text-[11px] text-white/30 line-through">{formatRupiah(p.comparePrice)}</span>:null}</td>
                      <td className="px-3 py-3 text-center"><span className={`inline-flex min-w-[40px] justify-center px-2 py-1 rounded-full text-xs font-bold ${p.stock<=5 && p.stock!==-1 ? "bg-[#FFB800]/15 text-[#FFB800]":"bg-white/10 text-white/70"}`}>{p.stock===-1?"∞":p.stock}</span></td>
                      <td className="px-3 py-3 text-center text-xs text-white/60">{p.soldCount}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length===0 && <p className="p-8 text-center text-sm text-white/40">Tidak ada produk — coba ubah kata kunci.</p>}
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
