"use client";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { Cat, FormVariant, ProductForm } from "./product-types";
import { ProductVariantRows } from "./sections/ProductVariantRows";

// Modal editor produk dipisah karena ini form terpanjang di admin: identitas produk,
// toggle multi-varian dengan tabel varian penuh (harga/stok/garansi), dan galeri foto.
// Semua state form tetap di page.tsx (single source of truth) dan diturunkan lewat props
// setter agar perilaku dirty-check, autosave signature, dan validasi tidak berubah.

export function ProductEditorModal({
  editing,
  saving,
  uploading,
  loadingVariants,
  hasMultiVariants,
  formError,
  form,
  formImages,
  formVariants,
  cats,
  onRequestClose,
  onSetForm,
  onSetFormImages,
  onSetHasMultiVariants,
  onSetFormVariants,
  onUpload,
  onSave,
}: {
  editing: boolean;
  saving: boolean;
  uploading: boolean;
  loadingVariants: boolean;
  hasMultiVariants: boolean;
  formError: string | null;
  form: ProductForm;
  formImages: string[];
  formVariants: FormVariant[];
  cats: Cat[];
  onRequestClose: () => void;
  onSetForm: (form: ProductForm) => void;
  onSetFormImages: (updater: (prev: string[]) => string[]) => void;
  onSetHasMultiVariants: (value: boolean) => void;
  onSetFormVariants: (updater: (prev: FormVariant[]) => FormVariant[]) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] isolate flex items-end justify-center overflow-hidden bg-black/60 p-0 backdrop-blur-sm sm:items-start sm:overflow-y-auto sm:p-6 sm:pt-10" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving){onRequestClose();}}}>
          <section role="dialog" aria-modal="true" aria-labelledby="product-editor-title" className="relative z-10 isolate max-h-[92dvh] w-full max-w-[720px] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0B1025] p-6 shadow-[0_24px_64px_rgba(0,0,0,0.6)] sm:rounded-3xl">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#00E5FF]">Katalog</p><h3 id="product-editor-title" className="mt-0.5 font-display text-lg font-bold text-white">{editing? "Edit Produk":"Produk Baru"}</h3></div>
              <button onClick={onRequestClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/15" aria-label="Tutup editor produk"><IosIcon name="close" size={14} tint="white" /></button>
            </div>

            {formError && <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-200">{formError}</p>}

            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Nama *</span><input value={form.name??""} onChange={e=>onSetForm({...form,name:e.target.value, slug: !editing? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""): form.slug})} placeholder="ChatGPT Plus 1 Bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Slug *</span><input value={form.slug??""} onChange={e=>onSetForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})} placeholder="chatgpt-plus-1-bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Nama di WhatsApp (Alias)</span><input value={form.whatsappAlias??""} onChange={e=>onSetForm({...form,whatsappAlias:e.target.value})} maxLength={50} placeholder="CHATGPT" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /><span className="block text-[11px] leading-4 text-white/35">Dipakai pada daftar dan header detail produk WhatsApp. Jika kosong, bot memakai nama produk web.</span></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Deskripsi</span><textarea value={form.description??""} onChange={e=>onSetForm({...form,description:e.target.value})} rows={2} placeholder="Akses GPT-4o penuh..." className="w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Kategori</span><select value={form.categorySlug??cats[0]?.slug??""} onChange={e=>onSetForm({...form,categorySlug:e.target.value})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30">
                {cats.map((category) => <option key={category.id} value={category.slug} className="bg-[#0F1430]">{category.name}</option>)}
              </select></label>
              <label className="space-y-1.5"><span className="flex items-center gap-1.5 text-xs font-semibold text-white/60">Badge</span><input value={form.badge??""} onChange={e=>onSetForm({...form,badge:e.target.value})} placeholder="Terlaris / Baru / Hemat 92%" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
            </div>

            {/* Toggle Multi-Varian ala Marketplace */}
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white">Variasi Produk</h4>
                  <p className="mt-0.5 text-xs text-white/45">Aktifkan jika produk memiliki beberapa pilihan durasi, akun, atau paket harga.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !hasMultiVariants;
                    onSetHasMultiVariants(next);
                    if (next && formVariants.length === 0) {
                      onSetFormVariants(() => [
                        {
                          sku: `${(form.slug || "PROD").toUpperCase()}-1`,
                          label: "1 Bulan",
                          price: form.price ? Number(form.price) : 50000,
                          comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
                          stock: form.stock != null ? Number(form.stock) : -1,
                          duration_value: 1,
                          duration_unit: "month",
                          warranty_type: "full",
                          is_active: 1,
                        },
                      ]);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${hasMultiVariants ? "bg-[#00E5FF]" : "bg-white/20"}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#080C1E] shadow ring-0 transition duration-200 ease-in-out ${hasMultiVariants ? "translate-x-5" : "translate-x-0 bg-white"}`} />
                </button>
              </div>

              {loadingVariants ? (
                <div className="py-6 text-center text-xs text-white/40">Memuat rincian varian...</div>
              ) : hasMultiVariants ? (
                <ProductVariantRows form={form} formVariants={formVariants} onSetFormVariants={onSetFormVariants} />
              ) : (
                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs font-semibold text-white/60">Harga Jual *</span>
                    <MoneyInput
                      value={form.price}
                      onChange={(val) => onSetForm({ ...form, price: val ?? 0 })}
                      placeholder="89000"
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white/60">Harga Coret</span>
                    <MoneyInput
                      value={form.comparePrice}
                      allowEmpty
                      onChange={(val) => onSetForm({ ...form, comparePrice: val ?? undefined })}
                      placeholder="300000"
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white/60">Stok (-1 = ∞)</span>
                    <input
                      type="number"
                      value={form.stock ?? -1}
                      onChange={(e) => onSetForm({ ...form, stock: Number(e.target.value) })}
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive !== false} onChange={(e) => onSetForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 rounded accent-[#00E5FF]" />
                <span className="text-sm text-white/80">Aktif tampil di toko</span>
              </label>
              <div className="text-xs text-white/40">
                Terjual: <span className="text-white/70 font-semibold">{form.soldCount ?? 0}</span>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold text-white/60 mb-2">Foto Produk — maks 8 (PNG/JPG → WebP otomatis)</p>
              <div className="grid grid-cols-4 gap-2">
                {formImages.map((url,i)=>(
                  <div key={url} className="relative group aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {i===0 && <span className="absolute top-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#00E5FF] text-[#080C1E]">Utama</span>}
                    <button onClick={()=>onSetFormImages(prev=>prev.filter((_,idx)=>idx!==i))} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><IosIcon name="close" size={10} tint="white" /></button>
                    {i>0 && <button onClick={()=>onSetFormImages(prev=>{ const a=[...prev]; const t=a[i]; a[i]=a[0]; a[0]=t; return a; })} className="absolute bottom-1 left-1 right-1 text-[10px] font-bold bg-white/90 text-[#080C1E] rounded-full py-1 opacity-0 group-hover:opacity-100 transition">Jadikan utama</button>}
                  </div>
                ))}
                {formImages.length<8 && (
                  <label className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition ${uploading?"opacity-50 pointer-events-none":"border-white/15 hover:border-[#00E5FF]/40 hover:bg-white/5"}`}>
                    <IosIcon name="plus" size={18} tint="white" className="opacity-40" /><span className="text-[11px] text-white/50">{uploading?"Upload...":"Tambah"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={onUpload} disabled={uploading} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-white/30 mt-2">Foto disesuaikan ke WebP 1600×900 — ringan dan konsisten. Foto pertama = cover card.</p>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button onClick={onRequestClose} disabled={saving} className="h-11 px-5 rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-50">Batal</button>
              <button onClick={onSave} disabled={saving || uploading} className="h-11 px-6 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition disabled:opacity-60 inline-flex items-center gap-2">
                {saving ? <Spinner size={16} className="border-[#080C1E]/20 border-t-[#080C1E]" /> : <IosIcon name="checked" size={15} tint="black" />} {saving ? "Menyimpan…" : "Simpan Produk"}
              </button>
            </div>
          </section>
        </div>
  );
}
