"use client";
import { Input, Label, NativeSelect } from "@/components/admin/ui";

// Field mode single (toggle "Variasi Produk" OFF) — paritas 2026-09-28.
// Sebelumnya cabang single di ProductEditorModal hanya menampilkan
// Harga jual / Harga coret / Stok, sehingga produk non-varian terkunci di
// garansi=none + fulfillment=manual tanpa jalan keluar dari UI.
//
// Komponen ini memakai blok yang SAMA dengan mode varian (WarrantyFields,
// FULFILLMENT_OPTIONS, NonWrFulfillmentPanel) agar kedua mode tidak pernah
// divergen lagi. Terikat ke `form` via `onSetForm`; useProductManager
// menerjemahkannya menjadi 1 varian `Default` eksplisit saat save.
//
// Produk WR-managed: seluruh field milik sync terkunci (harga/stok/garansi),
// hanya harga coret yang tetap bisa diedit — sama seperti baris varian WR.

import { useId, useRef } from "react";
import type { ProductForm } from "../product-types";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { SupplierBadge } from "../supplier-style";
import { WarrantyFields } from "./VariantWarrantyFields";
import { DurationFields } from "./VariantDurationFields";
import { FULFILLMENT_OPTIONS, NonWrFulfillmentPanel } from "./ProductVariantRows";
import {
  BulkTierEditor,
  SINGLE_BULK_PREFIX,
  emptyBulkDraft,
  isBulkEligibleForm,
  validateBulkDraft,
} from "@/components/admin/BulkTierEditor";

export function SingleVariantFields({
  form,
  onSetForm,
  productId,
  variantId,
  editing = true,
}: {
  form: ProductForm;
  onSetForm: (form: ProductForm) => void;
  productId?: number | string;
  variantId?: number;
  /** false = produk baru; harga grosir baru bisa diatur setelah produk tersimpan. */
  editing?: boolean;
}) {
  const fulfillmentId = useId();
  const latestForm = useRef(form);
  latestForm.current = form;
  const wrLocked = Boolean(form.wrManaged);
  // Harga grosir hanya untuk produk manual (keputusan owner 2026-11-08).
  const manualProduct = isBulkEligibleForm(form);
  const aivaultProduct = form.aivault_family != null || form.supplier === "AIVault";
  const managedSupplier = form.mirai_family != null || form.supplier === "Mirai" ? "Mirai"
    : form.storebat_family != null || form.supplier === "StoreBat" ? "StoreBat"
    : form.pixelverif_family != null || form.supplier === "Pixel" ? "Pixel" : null;
  const bulkDraft = form.bulk ?? emptyBulkDraft();
  const bulkValidation = validateBulkDraft(bulkDraft, {
    base: Number(form.price ?? 0),
    minQty: Math.max(1, Number(form.min_qty ?? 1) || 1),
    stock: Number(form.stock ?? -1),
    mode: form.fulfillment_mode || "manual",
  });
  const openInput =
    "h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none";
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-admin-border bg-admin-subtle p-4">
      {managedSupplier && <div className="flex flex-wrap items-center gap-2 text-xs text-admin-muted"><SupplierBadge supplier={managedSupplier} /> Atur markup dan harga manual di tab Markup supplier.</div>}
      <Label className="block space-y-2 text-sm font-medium">Input pembeli<NativeSelect disabled={!!managedSupplier} value={form.buyer_field_key ?? ""} onChange={e => onSetForm({ ...form,buyer_field_key:e.target.value === "muse_invite_code" ? "muse_invite_code" : null })} className={openInput}><option value="">Tidak ada</option><option value="muse_invite_code">Kode Invite Muse (6 huruf/angka)</option></NativeSelect></Label>
      <Label className="block space-y-2 text-sm font-medium">Maks. beli (kosong = 100)<Input type="number" min={1} max={100} value={form.max_qty ?? ""} onChange={e => onSetForm({ ...form,max_qty:e.target.value ? Number(e.target.value) : null })} className={openInput}/></Label>
      {/* Min. beli (migrasi 0034, milik admin — bukan WR). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Label className="block min-w-0">
          <span className="block text-sm font-medium text-admin-fg mb-1">
            Min. beli <span className="normal-case tracking-normal text-admin-muted">(1 = bebas)</span>
          </span>
          <Input
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
        </Label>
        <Label className="block min-w-0">
          <span className="block text-sm font-medium text-admin-fg mb-1">
            Modal (Rp) <span className="normal-case tracking-normal text-admin-muted">{form.supplier_cost_source ? `dari ${form.supplier_cost_source}` : "(0 = tanpa modal)"}</span>
          </span>
          {form.supplier_cost_source ? (
            <Input readOnly inputMode="numeric" value={form.supplier_cost?.toLocaleString("id-ID") ?? "—"} className="h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-muted cursor-not-allowed" />
          ) : <><MoneyInput
            value={form.manual_cost ?? 0}
            onChange={(val) => onSetForm({ ...form, manual_cost: Math.max(0, val ?? 0) })}
            placeholder="0"
            className={openInput}
          />
          <span className="mt-1 block text-xs leading-4 text-admin-muted">Modal per unit produk manual/stok sendiri (milik admin, ikut hitung untung).</span></>}
        </Label>
      </div>

      {/* Harga grosir — HANYA produk manual (owner 2026-11-08). */}
      {aivaultProduct ? <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Harga grosir AIVault otomatis mengikuti markup — atur di menu AIVault → Markup.</p> : !manualProduct ? (
        <p className="rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Harga grosir hanya untuk produk manual.</p>
      ) : !editing ? (
        <p className="rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Simpan produk dulu, lalu atur harga grosir di Edit Produk.</p>
      ) : (
        <BulkTierEditor
          idPrefix={SINGLE_BULK_PREFIX}
          draft={bulkDraft}
          validation={bulkValidation}
          basePrice={Number(form.price ?? 0)}
          minQty={Math.max(1, Number(form.min_qty ?? 1) || 1)}
          onChange={(next) => onSetForm({ ...latestForm.current, bulk: next })}
        />
      )}

      <DurationFields value={form} wrLocked={wrLocked} onChange={(patch) => onSetForm({ ...form, ...patch })} />

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

      {managedSupplier ? <p className="text-xs leading-5 text-admin-muted">Diproses otomatis setelah pembayaran dikonfirmasi. Tidak perlu mengisi stok kredensial lokal.</p> : !wrLocked ? (
        <div className="pt-3">
          <Label htmlFor={fulfillmentId} className="block text-sm font-medium text-admin-fg mb-1.5">Cara pengiriman</Label>
          <NativeSelect
            id={fulfillmentId}
            value={form.fulfillment_mode || "manual"}
            onChange={(e) => onSetForm({ ...form, fulfillment_mode: e.target.value })}
            className="h-9 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none"
          >
            {FULFILLMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-admin-card">
                {opt.label}
              </option>
            ))}
          </NativeSelect>
          <p className="mt-1.5 text-xs leading-4 text-admin-muted">
            {(form.fulfillment_mode || "manual") === "manual"
              ? "Badge pembeli: Made By Order (disiapkan admin)."
              : "Badge pembeli: Kirim otomatis (dikirim sistem dari stok di bawah)."}
          </p>
          <NonWrFulfillmentPanel productId={productId} variantId={variantId} mode={form.fulfillment_mode || "manual"} onStockChange={stock=>{if(latestForm.current.stock!==stock)onSetForm({...latestForm.current,stock});}} />
        </div>
      ) : (
        <NonWrFulfillmentPanel productId={productId} variantId={variantId} mode="__wr__" />
      )}
    </div>
  );
}
