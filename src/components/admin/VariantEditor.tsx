"use client";
import { Badge, Button, Input, Label, NativeSelect } from "@/components/admin/ui";
// TIDAK DIPAKAI: tidak diimpor halaman mana pun sejak Sept 2026. Editor varian
// yang live adalah ProductEditorModal → sections/ProductVariantRows
// (+ sections/SingleVariantFields untuk produk satu varian). Disimpan hanya
// sebagai referensi pola; jangan menambah fitur admin di sini.

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IosIcon } from "@/components/admin/AdminIcon";
import { FulfillmentInventoryPanel } from "@/components/admin/FulfillmentInventoryPanel";
import {
  BulkTierEditor,
  bulkDraftFromApi,
  bulkFieldId,
  bulkToggleId,
  cloneBulkDraft,
  emptyBulkDraft,
  validateBulkDraft,
  type BulkApiConfig,
  type BulkDraft,
} from "@/components/admin/BulkTierEditor";

type Variant = {
  id?: number;
  product_id: number;
  sku: string;
  label: string;
  duration_value: number | null;
  duration_unit: string | null;
  duration_label: string | null;
  warranty_type: string;
  warranty_value: number | null;
  warranty_unit: string | null;
  warranty_label: string | null;
  price: number;
  compare_price: number | null;
  stock: number;
  /** Minimum pembelian per baris (migrasi 0034, milik admin, default 1). */
  min_qty: number;
  max_qty?:number | null;
  buyer_field_key?:"muse_invite_code" | null;
  fulfillment_mode: string;
  is_active: number;
  sort_order: number;
  /** Draft harga grosir (BulkTierEditor). Tidak dikirim bila belum disentuh agar server mempertahankan konfigurasi tersimpan. */
  bulk: BulkDraft;
  _dirty?: boolean;
  _new?: boolean;
};

type ApiVariant = Omit<Variant, "bulk"> & { bulk_pricing?: BulkApiConfig; bulk_pricing_corrupt?: boolean; bulk_pricing_invalid?: boolean };

type Props = { productId: number; productName: string; onClose: () => void };

const DURATION_UNITS = [
  { value: "", label: "Tanpa durasi" },
  { value: "day", label: "Hari" },
  { value: "month", label: "Bulan" },
  { value: "year", label: "Tahun" },
  { value: "lifetime", label: "Selamanya" },
  { value: "custom", label: "Teks khusus" },
];
const WARRANTY_TYPES = [
  { value: "none", label: "Tanpa Garansi" },
  { value: "limited", label: "Garansi Terbatas" },
  { value: "full", label: "Full Garansi" },
  { value: "custom", label: "Teks khusus" },
];
const FULFILLMENT_MODES = [
  { value: "manual", label: "Manual" },
  { value: "shared", label: "Stok bersama" },
  { value: "unique", label: "Stok unik" },
];

const inputClass = "mt-1.5 h-9 w-full rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg outline-none transition placeholder:text-admin-muted focus:border-admin-accent/50 focus:bg-admin-subtle";
const labelClass = "text-sm font-medium text-admin-fg";

function describeSaveError(data: { error?: string; message?: string }) {
  if (data.error === "variants_not_enabled") return "Pengelolaan varian belum diaktifkan pada environment ini.";
  if (data.error === "stale_variant") return `${data.message || "Varian berubah oleh admin lain."} Isian Anda masih ada di layar; tutup editor tanpa menyimpan lalu buka lagi untuk memuat versi terbaru.`;
  if (data.error === "bulk_pricing_invalid") return data.message || "Konfigurasi harga grosir ditolak server. Periksa tingkat dan harga dasar.";
  return data.error || "Gagal menyimpan varian";
}

/** Dialog konfirmasi anak (di dalam wrapper editor ini) menangani Escape sendiri. */
function nestedDialogOpen() {
  const wrapper = document.getElementById("variant-editor-title")?.closest('[role="dialog"]')?.parentElement;
  return (wrapper?.querySelectorAll('[role="dialog"]').length ?? 0) > 1;
}

function money(value: number) {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export default function VariantEditor({ productId, productName, onClose }: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [aliasesText, setAliasesText] = useState("");
  const [aliasesDirty, setAliasesDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/variants?product_id=${productId}`);
      const data = (await response.json().catch(() => ({}))) as { variants?: ApiVariant[]; aliases?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error === "variants_not_enabled" ? "Pengelolaan varian belum diaktifkan pada environment ini." : data.error || "Gagal memuat varian");
      setVariants((data.variants || []).map(({ bulk_pricing, bulk_pricing_corrupt, bulk_pricing_invalid, ...variant }) => ({
        ...variant,
        min_qty: Number(variant.min_qty ?? 1) || 1,
        max_qty:variant.max_qty == null ? null : Number(variant.max_qty),
        buyer_field_key:variant.buyer_field_key === "muse_invite_code" ? "muse_invite_code" as const : null,
        bulk: bulkDraftFromApi(bulk_pricing, bulk_pricing_corrupt || bulk_pricing_invalid),
        _dirty: false,
        _new: false,
      })));
      setAliasesText((data.aliases || []).join(", "));
      setAliasesDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal memuat varian");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const hasDirty = variants.some((variant) => variant._dirty) || aliasesDirty;
  const bulkValidations = variants.map((variant) => validateBulkDraft(variant.bulk, { base: Number(variant.price), minQty: Math.max(1, Number(variant.min_qty) || 1), stock: Number(variant.stock), mode: variant.fulfillment_mode }));
  const pendingFocusId = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocusId.current) return;
    const target = document.getElementById(pendingFocusId.current);
    pendingFocusId.current = null;
    if (!target) return;
    target.focus();
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  });
  const updateBulk = (index: number, next: BulkDraft) => {
    setSuccess("");
    setVariants((current) => current.map((variant, row) => {
      if (row !== index) return variant;
      const changed = next.enabled !== variant.bulk.enabled || next.rows !== variant.bulk.rows;
      return { ...variant, bulk: next, _dirty: variant._dirty || changed };
    }));
  };
  const update = (index: number, field: keyof Variant, value: unknown) => {
    setSuccess("");
    setVariants((current) => current.map((variant, row) => row === index ? { ...variant, [field]: value, _dirty: true } : variant));
  };

  const addVariant = () => {
    const sortOrder = Math.max(0, ...variants.map((variant) => variant.sort_order)) + 10;
    setVariants((current) => [...current, {
      product_id: productId,
      sku: "",
      label: "",
      duration_value: null,
      duration_unit: null,
      duration_label: null,
      warranty_type: "none",
      warranty_value: null,
      warranty_unit: null,
      warranty_label: null,
      price: 0,
      compare_price: null,
      stock: -1,
      min_qty: 1,
      fulfillment_mode: "manual",
      is_active: 1,
      sort_order: sortOrder,
      bulk: emptyBulkDraft(),
      _dirty: true,
      _new: true,
    }]);
  };

  const duplicateVariant = (index: number) => {
    const source = variants[index];
    const sortOrder = Math.max(0, ...variants.map((variant) => variant.sort_order)) + 10;
    setVariants((current) => [...current, {
      ...source,
      id: undefined,
      sku: source.sku ? `${source.sku}-COPY` : "",
      label: source.label ? `${source.label} (Salinan)` : "",
      sort_order: sortOrder,
      bulk: cloneBulkDraft(source.bulk),
      _dirty: true,
      _new: true,
    }]);
  };

  const removeVariant = async () => {
    if (deleteIndex === null) return;
    const variant = variants[deleteIndex];
    if (variant._new) {
      setVariants((current) => current.filter((_, index) => index !== deleteIndex));
      setDeleteIndex(null);
      return;
    }
    if (!variant.id) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/variants?id=${variant.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal menonaktifkan varian");
      setDeleteIndex(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menonaktifkan varian");
    } finally {
      setDeleting(false);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = variants.map((variant, index) => ({
        id: variant.id,
        product_id: productId,
        sku: variant.sku.trim().toUpperCase(),
        label: variant.label.trim(),
        duration_value: variant.duration_value,
        duration_unit: variant.duration_unit || null,
        duration_label: variant.duration_label?.trim() || null,
        warranty_type: variant.warranty_type,
        warranty_value: variant.warranty_value,
        warranty_unit: variant.warranty_unit || null,
        warranty_label: variant.warranty_label?.trim() || null,
        price: Number(variant.price),
        compare_price: variant.compare_price ? Number(variant.compare_price) : null,
        stock: Number(variant.stock),
        min_qty: Math.max(1, Math.floor(Number(variant.min_qty ?? 1) || 1)),
        max_qty:variant.max_qty,
        buyer_field_key:variant.buyer_field_key,
        fulfillment_mode: variant.fulfillment_mode,
        is_active: Number(variant.is_active),
        sort_order: Number(variant.sort_order),
        // Hanya dikirim bila admin mengubahnya; dihilangkan = server mempertahankan konfigurasi tersimpan.
        ...(variant.bulk.touched && bulkValidations[index].payload ? { bulk_pricing: bulkValidations[index].payload } : {}),
      }));
      for (const variant of payload) {
        if (!variant.sku) throw new Error(`Varian "${variant.label || "tanpa nama"}": SKU wajib diisi.`);
        if (!variant.label) throw new Error(`SKU ${variant.sku}: nama varian wajib diisi.`);
        if (variant.price < 0) throw new Error(`Varian "${variant.label}": harga tidak boleh negatif.`);
        if (variant.min_qty < 1 || variant.min_qty > 100) throw new Error(`Varian "${variant.label}": minimal pembelian 1–100 (produk min-besar tetap harus ≤ 100 agar bisa dibeli).`);
      }
      const invalidBulk = bulkValidations.map((validation, index) => ({ validation, index })).filter((item) => item.validation.errorCount > 0);
      if (invalidBulk.length) {
        const total = invalidBulk.reduce((sum, item) => sum + item.validation.errorCount, 0);
        const first = invalidBulk[0];
        const prefix = bulkPrefix(first.index);
        const target = first.validation.firstInvalid;
        pendingFocusId.current = target && target !== "group" ? bulkFieldId(prefix, target.rowKey, target.field) : bulkToggleId(prefix);
        const invalidIndexes = new Set(invalidBulk.map((item) => item.index));
        setVariants((current) => current.map((variant, row) => invalidIndexes.has(row) && !variant.bulk.open ? { ...variant, bulk: { ...variant.bulk, open: true } } : variant));
        setError(`Perbaiki ${total} isian harga grosir sebelum menyimpan.`);
        return;
      }
      const response = await fetch("/api/admin/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          aliases: aliasesDirty ? aliasesText.split(",").map((value) => value.trim()).filter(Boolean) : undefined,
          variants: payload,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(describeSaveError(data));
      await load();
      setSuccess("Semua perubahan varian berhasil disimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan varian");
    } finally {
      setSaving(false);
    }
  };

  const bulkPrefix = (index: number) => `bulk-${variants[index]?.id ?? `new${index}`}`;
  const activeVariants = variants.filter((variant) => variant.is_active);
  const minPrice = activeVariants.length ? Math.min(...activeVariants.map((variant) => Number(variant.price))) : null;
  const maxPrice = activeVariants.length ? Math.max(...activeVariants.map((variant) => Number(variant.price))) : null;
  const requestClose = useCallback(() => { if (hasDirty) setConfirmClose(true); else onClose(); }, [hasDirty, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Dialog konfirmasi bertumpuk (mis. hapus tingkat terakhir) menangani Escape sendiri.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving && !nestedDialogOpen()) requestClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKeyDown); };
  }, [requestClose, saving]);

  return (
    <div className="fixed inset-0 z-[80] isolate flex items-end justify-center overflow-hidden bg-admin-subtle/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="variant-editor-title" className="relative z-10 flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-admin-border bg-admin-card shadow-sm sm:rounded-xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-admin-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-admin-accent">Katalog Produk</p>
            <h2 id="variant-editor-title" className="mt-0.5 text-lg font-semibold text-admin-fg">Kelola Varian</h2>
            <p className="mt-0.5 truncate text-xs text-admin-muted">{productName} · {variants.length} varian terdaftar</p>
          </div>
          <Button variant="outline" size="icon" type="button" onClick={requestClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-admin-subtle transition hover:bg-admin-subtle" aria-label="Tutup editor varian"><IosIcon name="close" size={14} tint="currentColor" /></Button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">
          <div className="rounded-xl border border-admin-accent/15 bg-admin-primary/[0.045] p-4">
            <Label className={labelClass} htmlFor="variant-keywords">Kata kunci pencarian WhatsApp</Label>
            <Input id="variant-keywords" value={aliasesText} onChange={(event) => { setAliasesText(event.target.value); setAliasesDirty(true); setSuccess(""); }} className={inputClass} placeholder="Contoh: chat gpt, gpt plus, openai" />
            <p className="mt-2 text-xs leading-5 text-admin-muted">Pisahkan dengan koma. Ini dipakai bot untuk mengenali pencarian; nama yang tampil di WhatsApp diatur lewat field Alias pada Edit Produk.</p>
          </div>

          {error && <div role="alert" className="mt-4 rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-4 py-3 text-sm text-admin-danger">{error}</div>}
          {success && <div role="status" className="mt-4 rounded-xl border border-admin-success/20 bg-admin-success/10 px-4 py-3 text-sm text-admin-success">{success}</div>}

          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-admin-muted"><span className="h-5 w-5 animate-spin rounded-md border-2 border-admin-border border-t-admin-accent" /> Memuat varian…</div>
          ) : variants.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-admin-border px-5 py-12 text-center"><p className="text-sm font-semibold text-admin-fg">Produk ini belum memiliki varian.</p><p className="mt-1 text-xs text-admin-muted">Tambahkan pilihan paket agar pembeli bisa memilih durasi dan harga.</p><Button variant="default" type="button" onClick={addVariant} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse transition hover:bg-admin-primary"><IosIcon name="plus" size={14} tint="currentColor" /> Tambah varian pertama</Button></div>
          ) : (
            <div className="mt-5 space-y-4">
              {variants.map((variant, index) => (
                <article key={variant.id ?? `new-${index}`} className={`rounded-xl border p-4 transition sm:p-5 ${variant._dirty ? "border-admin-accent/30 bg-admin-primary/[0.035]" : "border-admin-border bg-admin-subtle"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-admin-border pb-4">
                    <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-admin-subtle text-xs font-semibold text-admin-muted">{index + 1}</span><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-admin-fg">{variant.label || "Varian baru"}</h3><p className="mt-0.5 font-mono text-xs text-admin-muted">{variant.sku || "SKU belum diisi"}</p></div>{variant._dirty && <Badge className="shrink-0 rounded-md border border-admin-accent/25 bg-admin-primary/10 px-2 py-0.5 text-xs font-semibold text-admin-accent">Baru</Badge>}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" type="button" onClick={() => update(index, "is_active", variant.is_active ? 0 : 1)} className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold transition ${variant.is_active ? "border-admin-success/25 bg-admin-success/10 text-admin-success" : "border-admin-border bg-admin-subtle text-admin-muted"}`}>{variant.is_active ? "Aktif" : "Nonaktif"}</Button>
                      <Button variant="outline" size="sm" type="button" onClick={() => duplicateVariant(index)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-admin-border bg-admin-subtle px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg"><IosIcon name="copy" size={12} tint="currentColor" /> Duplikasi</Button>
                      <Button variant="outline" size="sm" type="button" onClick={() => setDeleteIndex(index)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-3 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/20"><IosIcon name="trash" size={12} tint="currentColor" /> {variant._new ? "Hapus" : "Nonaktifkan"}</Button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Label className={labelClass}>SKU<Input value={variant.sku} onChange={(event) => update(index, "sku", event.target.value.toUpperCase())} className={inputClass} placeholder="CHATGPT-1M" /></Label>
                    <Label className={`${labelClass} lg:col-span-2`}>Nama varian<Input value={variant.label} onChange={(event) => update(index, "label", event.target.value)} className={inputClass} placeholder="Premium 1 Bulan" /></Label>
                    <Label className={labelClass}>Urutan<Input type="number" min={0} value={variant.sort_order} onChange={(event) => update(index, "sort_order", Number(event.target.value))} className={inputClass} /></Label>

                    <Label className={labelClass}>Unit durasi<NativeSelect value={variant.duration_unit ?? ""} onChange={(event) => update(index, "duration_unit", event.target.value || null)} className={inputClass}>{DURATION_UNITS.map((item) => <option key={item.value} value={item.value} className="bg-admin-card">{item.label}</option>)}</NativeSelect></Label>
                    {variant.duration_unit === "custom" ? <Label className={`${labelClass} lg:col-span-3`}>Teks durasi<Input value={variant.duration_label ?? ""} onChange={(event) => update(index, "duration_label", event.target.value)} className={inputClass} placeholder="Contoh: Sampai 31 Desember" /></Label> : variant.duration_unit && variant.duration_unit !== "lifetime" ? <Label className={labelClass}>Jumlah durasi<Input type="number" min={0} value={variant.duration_value ?? ""} onChange={(event) => update(index, "duration_value", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="1" /></Label> : null}

                    <Label className={labelClass}>Tipe garansi<NativeSelect value={variant.warranty_type} onChange={(event) => update(index, "warranty_type", event.target.value)} className={inputClass}>{WARRANTY_TYPES.map((item) => <option key={item.value} value={item.value} className="bg-admin-card">{item.label}</option>)}</NativeSelect></Label>
                    {variant.warranty_type === "limited" && <><Label className={labelClass}>Durasi garansi<Input type="number" min={0} value={variant.warranty_value ?? ""} onChange={(event) => update(index, "warranty_value", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="7" /></Label><Label className={labelClass}>Unit garansi<NativeSelect value={variant.warranty_unit ?? ""} onChange={(event) => update(index, "warranty_unit", event.target.value || null)} className={inputClass}>{DURATION_UNITS.filter((item) => !["custom", "lifetime"].includes(item.value)).map((item) => <option key={item.value} value={item.value} className="bg-admin-card">{item.label}</option>)}</NativeSelect></Label></>}
                    {variant.warranty_type === "custom" && <Label className={`${labelClass} lg:col-span-3`}>Teks garansi<Input value={variant.warranty_label ?? ""} onChange={(event) => update(index, "warranty_label", event.target.value)} className={inputClass} placeholder="Contoh: Garansi login 30 hari" /></Label>}

                    <Label className={labelClass}>Harga jual<Input type="number" min={0} value={variant.price} onChange={(event) => update(index, "price", Number(event.target.value))} className={inputClass} /></Label>
                    <Label className={labelClass}>Harga coret<Input type="number" min={0} value={variant.compare_price ?? ""} onChange={(event) => update(index, "compare_price", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="Opsional" /></Label>
                    <Label className={labelClass}>Stok <span className="normal-case tracking-normal text-admin-muted">(-1 = ∞)</span><Input type="number" min={-1} value={variant.stock} onChange={(event) => update(index, "stock", Number(event.target.value))} className={inputClass} /></Label>
                    {/* Minimum pembelian (migrasi 0034, generik): GSuite = 50. Milik admin — sync WR tak menyentuh. */}
                    <Label className={labelClass}>Min. beli <span className="normal-case tracking-normal text-admin-muted">(1 = bebas)</span><Input type="number" min={1} max={100} value={variant.min_qty ?? 1} onChange={(event) => update(index, "min_qty", Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className={inputClass} /></Label>
                    <Label className={labelClass}>Input pembeli<NativeSelect value={variant.buyer_field_key ?? ""} onChange={e => update(index,"buyer_field_key",e.target.value === "muse_invite_code" ? "muse_invite_code" : null)} className={inputClass}><option value="">Tidak ada</option><option value="muse_invite_code">Kode Invite Muse</option></NativeSelect></Label>
                    <Label className={labelClass}>Maks. beli<Input type="number" min={1} max={100} value={variant.max_qty ?? ""} onChange={e => update(index,"max_qty",e.target.value ? Number(e.target.value) : null)} className={inputClass}/></Label>
                    <Label className={labelClass}>Fulfillment<NativeSelect value={variant.fulfillment_mode} onChange={(event) => update(index, "fulfillment_mode", event.target.value)} className={inputClass}>{FULFILLMENT_MODES.map((item) => <option key={item.value} value={item.value} className="bg-admin-card">{item.label}</option>)}</NativeSelect></Label>
                  </div>
                  <BulkTierEditor
                    idPrefix={bulkPrefix(index)}
                    draft={variant.bulk}
                    validation={bulkValidations[index]}
                    basePrice={Number(variant.price)}
                    minQty={Math.max(1, Number(variant.min_qty) || 1)}
                    disabled={saving || deleting}
                    onChange={(next) => updateBulk(index, next)}
                  />
                  {variant.id ? <FulfillmentInventoryPanel productId={productId} variantId={variant.id} mode={variant.fulfillment_mode} /> : <p className="mt-4 rounded-xl border border-admin-border bg-admin-subtle px-3 py-3 text-xs text-admin-muted">Simpan varian baru terlebih dahulu sebelum mengisi konten fulfillment.</p>}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-admin-border bg-admin-card/80 px-4 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs tabular-nums text-admin-muted">{activeVariants.length} aktif · {minPrice === null ? "Harga belum tersedia" : minPrice === maxPrice ? money(minPrice) : `${money(minPrice)} – ${money(maxPrice ?? minPrice)}`}</p><p className={`mt-1 text-xs ${hasDirty ? "text-admin-warning" : "text-admin-success"}`}>{hasDirty ? "Perubahan belum disimpan" : "Semua perubahan tersimpan"}</p></div>
            <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" type="button" onClick={requestClose} className="h-9 whitespace-nowrap rounded-md border border-admin-border bg-admin-subtle px-5 text-sm font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg">Tutup</Button><Button variant="outline" type="button" onClick={addVariant} disabled={loading || saving} className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-admin-accent/25 bg-admin-primary/10 px-5 text-sm font-semibold text-admin-accent transition hover:bg-admin-primary/20 disabled:opacity-40"><IosIcon name="plus" size={14} tint="currentColor" /> Tambah Varian</Button><Button variant="default" type="button" onClick={() => void saveAll()} disabled={loading || saving || variants.length === 0 || !hasDirty} className="inline-flex h-9 min-w-36 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-admin-primary px-6 text-sm font-semibold text-admin-inverse transition hover:bg-admin-primary disabled:cursor-not-allowed disabled:opacity-40">{saving ? <><span className="h-4 w-4 animate-spin rounded-md border-2 border-admin-inverse/25 border-t-admin-inverse" /> Menyimpan…</> : <><IosIcon name="checked" size={14} tint="currentColor" /> Simpan Semua</>}</Button></div>
          </div>
        </footer>
      </section>

      <ConfirmDialog open={deleteIndex !== null} title={variants[deleteIndex ?? -1]?._new ? "Hapus varian baru?" : "Nonaktifkan varian?"} description={variants[deleteIndex ?? -1]?._new ? "Varian yang belum disimpan akan dihapus dari formulir." : `Varian “${variants[deleteIndex ?? -1]?.label || "ini"}” tidak akan ditawarkan lagi, sementara riwayat pesanan tetap aman.`} confirmLabel={variants[deleteIndex ?? -1]?._new ? "Hapus" : "Nonaktifkan"} loading={deleting} onClose={() => !deleting && setDeleteIndex(null)} onConfirm={() => void removeVariant()} />
      <ConfirmDialog open={confirmClose} title="Buang perubahan varian?" description="Perubahan yang belum disimpan akan hilang." confirmLabel="Buang perubahan" cancelLabel="Lanjut mengedit" variant="danger" onClose={() => setConfirmClose(false)} onConfirm={onClose} />
    </div>
  );
}
