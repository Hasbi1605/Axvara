"use client";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { FormVariant, ProductForm } from "../product-types";

// Blok daftar varian dipisah dari ProductEditorModal karena inilah sub-form paling padat
// (harga, harga coret, stok, dan matriks garansi per baris). Memisahkannya menjaga file
// modal tetap ringkas dan membuat aturan render baris varian mudah dibaca sendiri.
// Tetap tanpa state lokal: seluruh mutasi diteruskan ke setter formVariants milik page.tsx.

export function ProductVariantRows({
  form,
  formVariants,
  onSetFormVariants,
}: {
  form: ProductForm;
  formVariants: FormVariant[];
  onSetFormVariants: (updater: (prev: FormVariant[]) => FormVariant[]) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#00E5FF]">Daftar Pilihan Paket / Varian</span>
        <button
          type="button"
          onClick={() => {
            const idx = formVariants.length + 1;
            onSetFormVariants((curr) => [
              ...curr,
              {
                sku: `${(form.slug || "PROD").toUpperCase()}-${idx}`,
                label: `Paket ${idx}`,
                price: 50000,
                comparePrice: null,
                stock: -1,
                warranty_type: "none",
                is_active: 1,
              },
            ]);
          }}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[#00E5FF]/25 bg-[#00E5FF]/10 px-3 text-xs font-bold text-[#5cefff] transition hover:bg-[#00E5FF]/20"
        >
          <IosIcon name="plus" size={12} tint="#00E5FF" /> Tambah Varian
        </button>
      </div>

      <div className="space-y-3">
        {formVariants.map((v, idx) => (
          <div key={v.id || idx} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/20">
            {/* Baris 1: Nama Varian & Aksi */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Nama Varian / Paket *</span>
                <input
                  value={v.label}
                  onChange={(e) => {
                    const val = e.target.value;
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, label: val } : item));
                  }}
                  placeholder="Contoh: 1 Bulan Private / 1 Tahun Sharing"
                  className="h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, is_active: item.is_active ? 0 : 1 } : item));
                  }}
                  title={v.is_active ? "Aktif" : "Nonaktif"}
                  className={`inline-flex h-8 items-center gap-1.5 px-3 rounded-xl text-xs font-bold transition ${v.is_active ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-white/5 text-white/40 border border-white/10"}`}
                >
                  {v.is_active ? "Aktif" : "Mati"}
                </button>
                {formVariants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      onSetFormVariants((curr) => curr.filter((_, i) => i !== idx));
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
                    title="Hapus varian"
                    aria-label="Hapus varian"
                  >
                    <IosIcon name="trash" size={14} tint="#F87171" />
                  </button>
                )}
              </div>
            </div>

            {/* Baris 2: Harga, Harga Coret, Stok */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-3 border-b border-white/5">
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Harga Jual (Rp) *</span>
                <MoneyInput
                  value={v.price}
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, price: val ?? 0 } : item));
                  }}
                  className="h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
                />
              </div>
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Harga Coret (Rp)</span>
                <MoneyInput
                  value={v.comparePrice}
                  allowEmpty
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, comparePrice: val } : item));
                  }}
                  placeholder="Opsional"
                  className="h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:outline-none"
                />
              </div>
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Stok (-1 = ∞)</span>
                <input
                  type="number"
                  min={-1}
                  value={v.stock}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, stock: val } : item));
                  }}
                  className="h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
                />
              </div>
            </div>

            {/* Baris 3: Pengaturan Garansi yang Jelas & Rapi */}
            <div className="pt-3">
              <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1.5">Masa Garansi</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={v.warranty_type || "full"}
                  onChange={(e) => {
                    const wType = e.target.value;
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? {
                      ...item,
                      warranty_type: wType,
                      warranty_value: item.warranty_value ?? 1,
                      warranty_unit: item.warranty_unit || "month",
                    } : item));
                  }}
                  className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
                >
                  <option value="full" className="bg-[#0F1430]">Full Garansi</option>
                  <option value="limited" className="bg-[#0F1430]">Garansi Terbatas</option>
                  <option value="none" className="bg-[#0F1430]">Tanpa Garansi</option>
                  <option value="custom" className="bg-[#0F1430]">Teks Kustom</option>
                </select>

                {(v.warranty_type === "full" || v.warranty_type === "limited") && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      value={v.warranty_value ?? 1}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 1);
                        onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_value: val, duration_value: val } : item));
                      }}
                      className="h-9 w-16 rounded-xl bg-white/[0.06] border border-white/10 px-2 text-xs text-white text-center focus:border-[#00E5FF]/50 focus:outline-none"
                    />
                    <select
                      value={v.warranty_unit || "month"}
                      onChange={(e) => {
                        const unit = e.target.value;
                        onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_unit: unit, duration_unit: unit } : item));
                      }}
                      className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
                    >
                      <option value="day" className="bg-[#0F1430]">Hari</option>
                      <option value="month" className="bg-[#0F1430]">Bulan</option>
                      <option value="year" className="bg-[#0F1430]">Tahun</option>
                      <option value="lifetime" className="bg-[#0F1430]">Selamanya</option>
                    </select>
                  </div>
                )}

                {v.warranty_type === "custom" && (
                  <input
                    value={v.warranty_label || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_label: val } : item));
                    }}
                    placeholder="Contoh: Garansi 24 Jam Ganti Akun"
                    className="h-9 flex-1 min-w-[200px] rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white placeholder:text-white/20 focus:border-[#00E5FF]/50 focus:outline-none"
                  />
                )}

                {/* Label Hasil Preview Badge */}
                <span className="text-[11px] text-[#00E5FF]/80 font-medium ml-auto pl-2 py-1">
                  Hasil: {v.warranty_type === "none" ? "Tanpa Garansi" : v.warranty_type === "custom" ? (v.warranty_label || "Kustom") : `${v.warranty_type === "full" ? "Full Garansi" : "Garansi Terbatas"} ${v.warranty_value ?? 1} ${v.warranty_unit === "day" ? "Hari" : v.warranty_unit === "year" ? "Tahun" : v.warranty_unit === "lifetime" ? "Selamanya" : "Bulan"}`}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {formVariants.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#00E5FF]/5 border border-[#00E5FF]/20 px-3 py-2 flex items-center justify-between text-xs">
          <span className="text-white/60">Tampilan Harga di Katalog:</span>
          <span className="font-bold text-[#00E5FF]">
            Mulai {formatRupiah(Math.min(...formVariants.filter((vr) => (vr.is_active ?? 1) !== 0).map((vr) => vr.price) || [0]))}
          </span>
        </div>
      )}
    </div>
  );
}
