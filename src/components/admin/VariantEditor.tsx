"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IosIcon } from "@/components/ui/IosIcon";
import { FulfillmentInventoryPanel } from "@/components/admin/FulfillmentInventoryPanel";

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
  fulfillment_mode: string;
  is_active: number;
  sort_order: number;
  _dirty?: boolean;
  _new?: boolean;
};

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

const inputClass = "mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:bg-white/[0.08]";
const labelClass = "text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45";

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
      const data = (await response.json().catch(() => ({}))) as { variants?: Variant[]; aliases?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error === "variants_not_enabled" ? "Pengelolaan varian belum diaktifkan pada environment ini." : data.error || "Gagal memuat varian");
      setVariants((data.variants || []).map((variant) => ({ ...variant, _dirty: false, _new: false })));
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
      fulfillment_mode: "manual",
      is_active: 1,
      sort_order: sortOrder,
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
      const payload = variants.map((variant) => ({
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
        fulfillment_mode: variant.fulfillment_mode,
        is_active: Number(variant.is_active),
        sort_order: Number(variant.sort_order),
      }));
      for (const variant of payload) {
        if (!variant.sku) throw new Error(`Varian "${variant.label || "tanpa nama"}": SKU wajib diisi.`);
        if (!variant.label) throw new Error(`SKU ${variant.sku}: nama varian wajib diisi.`);
        if (variant.price < 0) throw new Error(`Varian "${variant.label}": harga tidak boleh negatif.`);
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
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error === "variants_not_enabled" ? "Pengelolaan varian belum diaktifkan pada environment ini." : data.error || "Gagal menyimpan varian");
      await load();
      setSuccess("Semua perubahan varian berhasil disimpan.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan varian");
    } finally {
      setSaving(false);
    }
  };

  const activeVariants = variants.filter((variant) => variant.is_active);
  const minPrice = activeVariants.length ? Math.min(...activeVariants.map((variant) => Number(variant.price))) : null;
  const maxPrice = activeVariants.length ? Math.max(...activeVariants.map((variant) => Number(variant.price))) : null;
  const requestClose = useCallback(() => { if (hasDirty) setConfirmClose(true); else onClose(); }, [hasDirty, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) requestClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKeyDown); };
  }, [requestClose, saving]);

  return (
    <div className="fixed inset-0 z-[80] isolate flex items-end justify-center bg-[#040612]/95 p-0 sm:items-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="variant-editor-title" className="relative z-10 flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[28px] border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.7)] sm:max-h-[92vh] sm:rounded-[28px]" style={{ background: "#0B1025" }}>
        <header className="flex shrink-0 items-start justify-between border-b border-white/10 px-5 py-5 sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#00E5FF]">Katalog Produk</p>
            <h2 id="variant-editor-title" className="mt-1 text-xl font-semibold text-white">Kelola Varian</h2>
            <p className="mt-1 text-sm text-white/50">{productName} · {variants.length} varian terdaftar</p>
          </div>
          <button type="button" onClick={requestClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/15" aria-label="Tutup editor varian"><IosIcon name="close" size={14} tint="white" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">
          <div className="rounded-2xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.045] p-4">
            <label className={labelClass} htmlFor="variant-keywords">Kata kunci pencarian WhatsApp</label>
            <input id="variant-keywords" value={aliasesText} onChange={(event) => { setAliasesText(event.target.value); setAliasesDirty(true); setSuccess(""); }} className={inputClass} placeholder="Contoh: chat gpt, gpt plus, openai" />
            <p className="mt-2 text-xs leading-5 text-white/45">Pisahkan dengan koma. Ini dipakai bot untuk mengenali pencarian; nama yang tampil di WhatsApp diatur lewat field Alias pada Edit Produk.</p>
          </div>

          {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          {success && <div role="status" className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div>}

          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-white/45"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[#00E5FF]" /> Memuat varian…</div>
          ) : variants.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-white/15 px-5 py-12 text-center"><p className="text-sm text-white/50">Produk ini belum memiliki varian.</p><button type="button" onClick={addVariant} className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E]"><IosIcon name="plus" size={14} tint="black" /> Tambah varian pertama</button></div>
          ) : (
            <div className="mt-5 space-y-4">
              {variants.map((variant, index) => (
                <article key={variant.id ?? `new-${index}`} className={`rounded-2xl border p-4 transition sm:p-5 ${variant._dirty ? "border-[#00E5FF]/30 bg-[#00E5FF]/[0.035]" : "border-white/10 bg-white/[0.025]"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
                    <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-xs font-bold text-white/60">{index + 1}</span><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{variant.label || "Varian baru"}</h3><p className="mt-0.5 text-xs text-white/35">{variant.sku || "SKU belum diisi"}</p></div></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => update(index, "is_active", variant.is_active ? 0 : 1)} className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${variant.is_active ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-white/45"}`}><span className={`h-1.5 w-1.5 rounded-full ${variant.is_active ? "bg-emerald-400" : "bg-white/30"}`} />{variant.is_active ? "Aktif" : "Nonaktif"}</button>
                      <button type="button" onClick={() => duplicateVariant(index)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white/65 transition hover:bg-white/10 hover:text-white"><IosIcon name="copy" size={12} tint="white" /> Duplikasi</button>
                      <button type="button" onClick={() => setDeleteIndex(index)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/20"><IosIcon name="trash" size={12} tint="white" /> {variant._new ? "Hapus" : "Nonaktifkan"}</button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <label className={labelClass}>SKU<input value={variant.sku} onChange={(event) => update(index, "sku", event.target.value.toUpperCase())} className={inputClass} placeholder="CHATGPT-1M" /></label>
                    <label className={`${labelClass} lg:col-span-2`}>Nama varian<input value={variant.label} onChange={(event) => update(index, "label", event.target.value)} className={inputClass} placeholder="Premium 1 Bulan" /></label>
                    <label className={labelClass}>Urutan<input type="number" min={0} value={variant.sort_order} onChange={(event) => update(index, "sort_order", Number(event.target.value))} className={inputClass} /></label>

                    <label className={labelClass}>Unit durasi<select value={variant.duration_unit ?? ""} onChange={(event) => update(index, "duration_unit", event.target.value || null)} className={inputClass}>{DURATION_UNITS.map((item) => <option key={item.value} value={item.value} className="bg-[#10152d]">{item.label}</option>)}</select></label>
                    {variant.duration_unit === "custom" ? <label className={`${labelClass} lg:col-span-3`}>Teks durasi<input value={variant.duration_label ?? ""} onChange={(event) => update(index, "duration_label", event.target.value)} className={inputClass} placeholder="Contoh: Sampai 31 Desember" /></label> : variant.duration_unit && variant.duration_unit !== "lifetime" ? <label className={labelClass}>Jumlah durasi<input type="number" min={0} value={variant.duration_value ?? ""} onChange={(event) => update(index, "duration_value", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="1" /></label> : null}

                    <label className={labelClass}>Tipe garansi<select value={variant.warranty_type} onChange={(event) => update(index, "warranty_type", event.target.value)} className={inputClass}>{WARRANTY_TYPES.map((item) => <option key={item.value} value={item.value} className="bg-[#10152d]">{item.label}</option>)}</select></label>
                    {variant.warranty_type === "limited" && <><label className={labelClass}>Durasi garansi<input type="number" min={0} value={variant.warranty_value ?? ""} onChange={(event) => update(index, "warranty_value", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="7" /></label><label className={labelClass}>Unit garansi<select value={variant.warranty_unit ?? ""} onChange={(event) => update(index, "warranty_unit", event.target.value || null)} className={inputClass}>{DURATION_UNITS.filter((item) => !["custom", "lifetime"].includes(item.value)).map((item) => <option key={item.value} value={item.value} className="bg-[#10152d]">{item.label}</option>)}</select></label></>}
                    {variant.warranty_type === "custom" && <label className={`${labelClass} lg:col-span-3`}>Teks garansi<input value={variant.warranty_label ?? ""} onChange={(event) => update(index, "warranty_label", event.target.value)} className={inputClass} placeholder="Contoh: Garansi login 30 hari" /></label>}

                    <label className={labelClass}>Harga jual<input type="number" min={0} value={variant.price} onChange={(event) => update(index, "price", Number(event.target.value))} className={inputClass} /></label>
                    <label className={labelClass}>Harga coret<input type="number" min={0} value={variant.compare_price ?? ""} onChange={(event) => update(index, "compare_price", event.target.value ? Number(event.target.value) : null)} className={inputClass} placeholder="Opsional" /></label>
                    <label className={labelClass}>Stok <span className="normal-case tracking-normal text-white/25">(-1 = ∞)</span><input type="number" min={-1} value={variant.stock} onChange={(event) => update(index, "stock", Number(event.target.value))} className={inputClass} /></label>
                    <label className={labelClass}>Fulfillment<select value={variant.fulfillment_mode} onChange={(event) => update(index, "fulfillment_mode", event.target.value)} className={inputClass}>{FULFILLMENT_MODES.map((item) => <option key={item.value} value={item.value} className="bg-[#10152d]">{item.label}</option>)}</select></label>
                  </div>
                  {variant.id ? <FulfillmentInventoryPanel productId={productId} variantId={variant.id} mode={variant.fulfillment_mode} /> : <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/40">Simpan varian baru terlebih dahulu sebelum mengisi konten fulfillment.</p>}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-white/10 bg-[#080C1E]/80 px-4 py-4 backdrop-blur-xl sm:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-xs text-white/50">{activeVariants.length} aktif · {minPrice === null ? "Harga belum tersedia" : minPrice === maxPrice ? money(minPrice) : `${money(minPrice)} – ${money(maxPrice ?? minPrice)}`}</p><p className={`mt-1 text-[11px] ${hasDirty ? "text-[#FFB800]" : "text-emerald-300/70"}`}>{hasDirty ? "Perubahan belum disimpan" : "Semua perubahan tersimpan"}</p></div>
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={requestClose} className="h-11 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.06] px-5 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white">Tutup</button><button type="button" onClick={addVariant} disabled={loading || saving} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-[#00E5FF]/25 bg-[#00E5FF]/10 px-5 text-sm font-bold text-[#5cefff] transition hover:bg-[#00E5FF]/20 disabled:opacity-40"><IosIcon name="plus" size={14} tint="#00E5FF" /> Tambah Varian</button><button type="button" onClick={() => void saveAll()} disabled={loading || saving || variants.length === 0 || !hasDirty} className="inline-flex h-11 min-w-36 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#00E5FF] px-6 text-sm font-bold text-[#080C1E] transition hover:bg-[#00D0E8] disabled:cursor-not-allowed disabled:opacity-40">{saving ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#080C1E]/25 border-t-[#080C1E]" /> Menyimpan…</> : <><IosIcon name="checked" size={14} tint="black" /> Simpan Semua</>}</button></div>
          </div>
        </footer>
      </section>

      <ConfirmDialog open={deleteIndex !== null} title={variants[deleteIndex ?? -1]?._new ? "Hapus varian baru?" : "Nonaktifkan varian?"} description={variants[deleteIndex ?? -1]?._new ? "Varian yang belum disimpan akan dihapus dari formulir." : `Varian “${variants[deleteIndex ?? -1]?.label || "ini"}” tidak akan ditawarkan lagi, sementara riwayat pesanan tetap aman.`} confirmLabel={variants[deleteIndex ?? -1]?._new ? "Hapus" : "Nonaktifkan"} loading={deleting} onClose={() => !deleting && setDeleteIndex(null)} onConfirm={() => void removeVariant()} />
      <ConfirmDialog open={confirmClose} title="Buang perubahan varian?" description="Perubahan yang belum disimpan akan hilang." confirmLabel="Buang perubahan" cancelLabel="Lanjut mengedit" variant="danger" onClose={() => setConfirmClose(false)} onConfirm={onClose} />
    </div>
  );
}
