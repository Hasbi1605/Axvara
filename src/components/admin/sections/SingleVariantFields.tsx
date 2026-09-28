"use client";

// Field mode single (toggle "Variasi Produk" OFF) — paritas 2026-09-28.
// Sebelumnya cabang single di ProductEditorModal hanya menampilkan
// Harga Jual / Harga Coret / Stok, sehingga produk non-varian terkunci di
// garansi=none + fulfillment=manual tanpa jalan keluar dari UI.
//
// Komponen ini memakai blok yang SAMA dengan mode varian (WarrantyFields,
// FULFILLMENT_OPTIONS, NonWrFulfillmentPanel) agar kedua mode tidak pernah
// divergen lagi. Terikat ke `form` via `onSetForm`; useProductManager
// menerjemahkannya menjadi 1 varian `Default` eksplisit saat save.
//
// Produk WR-managed: seluruh field milik sync terkunci (harga/stok/garansi),
// hanya harga coret yang tetap bisa diedit — sama seperti baris varian WR.

import type { ProductForm } from "../product-types";
import { WarrantyFields } from "./VariantWarrantyFields";
import { FULFILLMENT_OPTIONS, NonWrFulfillmentPanel } from "./ProductVariantRows";

export function SingleVariantFields({
  form,
  onSetForm,
  productId,
  variantId,
}: {
  form: ProductForm;
  onSetForm: (form: ProductForm) => void;
  productId?: number | string;
  variantId?: number;
}) {
  const wrLocked = Boolean(form.wrManaged);
  const openInput =
    "h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none";
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      {/* Min. Beli (migrasi 0034, milik admin — bukan WR). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">
            Min. Beli <span className="normal-case tracking-normal text-white/25">(1 = bebas)</span>
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={form.min_qty ?? 1}
            onChange={(e) => {
              const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
              onSetForm({ ...form, min_qty: val });
            }}
            className={openInput}
          />
        </div>
      </div>

      <WarrantyFields
        value={{
          warranty_type: form.warranty_type,
          warranty_value: form.warranty_value,
          warranty_unit: form.warranty_unit,
          warranty_label: form.warranty_label,
        }}
        wrLocked={wrLocked}
        onChange={(patch) => onSetForm({ ...form, ...patch })}
      />

      {!wrLocked ? (
        <div className="pt-3">
          <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1.5">Cara Pengiriman</span>
          <select
            value={form.fulfillment_mode || "manual"}
            onChange={(e) => onSetForm({ ...form, fulfillment_mode: e.target.value })}
            className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
          >
            {FULFILLMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#0F1430]">
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] leading-4 text-white/35">
            {(form.fulfillment_mode || "manual") === "manual"
              ? "Badge pembeli: Made By Order (disiapkan admin)."
              : "Badge pembeli: Kirim otomatis (dikirim sistem dari stok di bawah)."}
          </p>
          <NonWrFulfillmentPanel productId={productId} variantId={variantId} mode={form.fulfillment_mode || "manual"} />
        </div>
      ) : (
        <NonWrFulfillmentPanel productId={productId} variantId={variantId} mode="__wr__" />
      )}
    </div>
  );
}
