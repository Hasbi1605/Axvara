"use client";
import { Button, Input, Label, Textarea } from "@/components/admin/ui";
// Tab "Deskripsi & S&K" di editor produk: deskripsi produk + S&K dan cara
// aktivasi per varian. Dipisah dari tab Varian (permintaan owner) supaya baris
// varian hanya berisi harga, stok, garansi, dan pengiriman.
import { useId } from "react";
import type { FormVariant, ProductForm } from "../product-types";
import { VariantCopyEditor, type VariantCopyState } from "./VariantCopyEditor";

const FORMAT_HINT =
  "Format: paragraf pembuka, lalu baris \"- \" untuk keunggulan. Baris \"Syarat & Ketentuan:\" / \"Cara Aktivasi:\" memisahkan bagian yang tampil di kartu S&K (terlipat di mobile).";

/** Label varian yang bisa dibedakan (WR sering memakai label sama, mis. "Premium" 28 & 90 hari). */
export function variantCopyTitle(variant: FormVariant): string {
  const label = variant.label.trim() || variant.sku;
  const duration = variant.duration_label?.trim();
  return duration && !label.toLowerCase().includes(duration.toLowerCase()) ? `${label} · ${duration}` : label;
}

export function ProductCopyTab({
  form,
  onSetForm,
  formVariants,
  hasMultiVariants,
  loadingVariants,
  variantCopy,
}: {
  form: ProductForm;
  onSetForm: (form: ProductForm) => void;
  formVariants: FormVariant[];
  hasMultiVariants: boolean;
  loadingVariants: boolean;
  variantCopy: VariantCopyState;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const overrideId = `${id}-override`;
  const descriptionEnId = `${id}-description-en`;
  const nameEnId = `${id}-name-en`;
  const textareaBase = "w-full resize-y rounded-xl border px-3 py-2.5 text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none";

  return (
    <div className="mt-5 space-y-6">
      <section aria-labelledby={`${id}-description-title`} className="space-y-4">
        <h4 id={`${id}-description-title`} className="text-sm font-semibold text-admin-fg">Deskripsi produk</h4>
        <div className="space-y-2">
          <Label htmlFor={nameEnId} className="block text-xs font-semibold text-admin-muted">Nama (English)</Label>
          <Input
            id={nameEnId}
            value={form.nameEn ?? ""}
            onChange={(e) => onSetForm({ ...form, nameEn: e.target.value })}
            maxLength={120}
            placeholder="English product name shown when the buyer selects English…"
            className="h-9 w-full rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/30 focus:outline-none"
          />
          <p className="text-xs leading-4 text-admin-muted">Kosongkan untuk memakai terjemahan token otomatis (durasi/tier) dari nama Indonesia.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={descriptionId} className="block text-xs font-semibold text-admin-muted">
            Deskripsi{form.wrManaged ? " (dari WR)" : ""}
          </Label>
          <Textarea
            id={descriptionId}
            value={form.description ?? ""}
            readOnly={form.wrManaged}
            onChange={(e) => onSetForm({ ...form, description: e.target.value })}
            rows={form.wrManaged ? 3 : 8}
            aria-describedby={form.wrManaged ? undefined : `${descriptionId}-hint`}
            placeholder="Akses GPT-4o penuh..."
            className={`${textareaBase} ${form.wrManaged ? "cursor-not-allowed border-admin-border bg-admin-subtle text-admin-muted" : "border-admin-border bg-admin-subtle focus:border-admin-accent/30"}`}
          />
          {!form.wrManaged && <p id={`${descriptionId}-hint`} className="text-xs leading-4 text-admin-muted">{FORMAT_HINT}</p>}
        </div>
        {form.wrManaged && (
          <div className="space-y-2">
            <Label htmlFor={overrideId} className="block text-xs font-semibold text-admin-muted">Deskripsi khusus (override)</Label>
            <Textarea
              id={overrideId}
              value={form.adminDescriptionOverride ?? ""}
              onChange={(e) => onSetForm({ ...form, adminDescriptionOverride: e.target.value })}
              rows={6}
              maxLength={2000}
              aria-describedby={`${overrideId}-hint`}
              placeholder="Tulis deskripsi versimu sendiri di sini…"
              className={`${textareaBase} border-admin-border bg-admin-subtle focus:border-admin-accent/30`}
            />
            <p id={`${overrideId}-hint`} className="text-xs leading-4 text-admin-muted">
              Jika diisi, teks ini yang tampil di storefront dan tidak akan ditimpa sync. Kosongkan untuk kembali memakai deskripsi WR. {FORMAT_HINT}
            </p>
            {!form.adminDescriptionOverride?.trim() && <Button variant="ghost" type="button" className="min-h-9 text-xs font-semibold text-admin-accent" onClick={() => onSetForm({ ...form, adminDescriptionOverride: form.description ?? "" })}>Gunakan teks sumber sebagai awal</Button>}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={descriptionEnId} className="block text-xs font-semibold text-admin-muted">Deskripsi (English)</Label>
          <Textarea
            id={descriptionEnId}
            value={form.descriptionEn ?? ""}
            onChange={(e) => onSetForm({ ...form, descriptionEn: e.target.value })}
            rows={6}
            maxLength={2000}
            aria-describedby={`${descriptionEnId}-hint`}
            placeholder="English description shown when the buyer selects English…"
            className={`${textareaBase} border-admin-border bg-admin-subtle focus:border-admin-accent/30`}
          />
          <p id={`${descriptionEnId}-hint`} className="text-xs leading-4 text-admin-muted">
            Dipakai storefront EN (PDP, meta, Telegram EN). Kosongkan untuk kembali memakai teks Indonesia. Milik admin; sync WR/SK tidak menimpa. {FORMAT_HINT}
          </p>
        </div>
      </section>

      {!form.wrManaged && form.supplier !== "SK" ? <p className="rounded-xl border border-admin-accent/20 bg-admin-primary/[0.04] p-4 text-xs leading-5 text-admin-muted">S&K dan cara penggunaan bersama diatur pada tab Varian, di bagian pengiriman masing-masing varian. Panduan tersimpan bersama Simpan Produk.</p> : <section aria-labelledby={`${id}-terms-title`}>
        <h4 id={`${id}-terms-title`} className="text-sm font-semibold text-admin-fg">Syarat &amp; Ketentuan · Cara Aktivasi</h4>
        <p className="mt-1 text-xs leading-4 text-admin-muted">
          Sunting langsung teks per varian. Suntingan yang dijeda ditandai terpisah dari versi pembeli. Simpan teks di dalam panel sebelum Simpan Produk.
        </p>
        {loadingVariants ? (
          <p className="mt-3 text-xs text-admin-muted">Memuat varian…</p>
        ) : formVariants.length === 0 ? (
          <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-3 text-xs text-admin-muted">Belum ada varian. Tambahkan dulu di tab Varian, lalu simpan produk.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {formVariants.map((variant, idx) => {
              const variantId = typeof variant.id === "number" ? variant.id : undefined;
              return (
                <li key={variantId ?? `new-${idx}`}>
                  <VariantCopyEditor
                    title={hasMultiVariants ? variantCopyTitle(variant) : (form.name?.trim() || variantCopyTitle(variant))}
                    inactive={Number(variant.is_active ?? 1) === 0}
                    variantId={variantId}
                    entry={variantId ? variantCopy.entries.get(variantId) : undefined}
                    loading={variantCopy.loading}
                    error={variantCopy.error}
                    onSaved={variantCopy.update}
                    onStateChange={variantCopy.report}
                    onReload={variantCopy.reload}
                    description={form.adminDescriptionOverride?.trim() ? form.adminDescriptionOverride : form.description}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>}
    </div>
  );
}
