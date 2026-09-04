"use client";

import { useState, useEffect, useCallback } from "react";

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

type Props = {
  productId: number;
  productName: string;
  onClose: () => void;
};

const DURATION_UNITS = [
  { value: "", label: "\u2014" },
  { value: "day", label: "Hari" },
  { value: "month", label: "Bulan" },
  { value: "year", label: "Tahun" },
  { value: "lifetime", label: "Selamanya" },
];

const WARRANTY_TYPES = [
  { value: "none", label: "Tanpa Garansi" },
  { value: "limited", label: "Terbatas" },
  { value: "full", label: "Full Garansi" },
  { value: "custom", label: "Custom" },
];

const FULFILLMENT_MODES = [
  { value: "manual", label: "Manual" },
  { value: "shared", label: "Shared" },
  { value: "unique", label: "Unique" },
];

function formatRupiah(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export default function VariantEditor({ productId, productName, onClose }: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/variants?product_id=${productId}`);
      if (!res.ok) throw new Error("Gagal memuat varian");
      const data = await res.json();
      setVariants((data.variants || []).map((v: Variant) => ({ ...v, _dirty: false, _new: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, [load]);

  const addVariant = () => {
    const maxSort = Math.max(0, ...variants.map(v => v.sort_order));
    setVariants(prev => [...prev, {
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
      sort_order: maxSort + 10,
      _dirty: true,
      _new: true,
    }]);
  };

  const updateField = (index: number, field: string, value: unknown) => {
    setVariants(prev => prev.map((v, i) => i === index ? { ...v, [field]: value, _dirty: true } : v));
  };

  const duplicateVariant = (index: number) => {
    const src = variants[index];
    const maxSort = Math.max(0, ...variants.map(v => v.sort_order));
    setVariants(prev => [...prev, {
      ...src,
      id: undefined,
      sku: src.sku + "-COPY",
      sort_order: maxSort + 10,
      _dirty: true,
      _new: true,
    }]);
  };

  const removeVariant = async (index: number) => {
    const v = variants[index];
    if (v._new) {
      setVariants(prev => prev.filter((_, i) => i !== index));
      return;
    }
    if (!v.id) return;
    if (!confirm(`Hapus/nonaktifkan varian "${v.label}"?`)) return;

    try {
      const res = await fetch(`/api/admin/variants?id=${v.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  };

  const saveAll = async () => {
    setSaving(true);
    setError("");
    try {
      for (const v of variants) {
        if (!v._dirty) continue;

        const payload = {
          product_id: v.product_id,
          sku: v.sku,
          label: v.label,
          duration_value: v.duration_value,
          duration_unit: v.duration_unit || null,
          duration_label: v.duration_label || null,
          warranty_type: v.warranty_type,
          warranty_value: v.warranty_value,
          warranty_unit: v.warranty_unit || null,
          warranty_label: v.warranty_label || null,
          price: v.price,
          compare_price: v.compare_price,
          stock: v.stock,
          fulfillment_mode: v.fulfillment_mode,
          is_active: v.is_active,
          sort_order: v.sort_order,
        };

        if (v._new) {
          const res = await fetch("/api/admin/variants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Gagal membuat varian");
          }
        } else if (v.id) {
          const res = await fetch(`/api/admin/variants?id=${v.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Gagal mengupdate varian");
          }
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  };

  const hasDirty = variants.some(v => v._dirty);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0d1117] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-semibold text-white">Varian — {productName}</h2>
            <p className="text-xs text-white/50 mt-0.5">{variants.length} varian</p>
          </div>
          <div className="flex gap-2">
            <button onClick={addVariant} className="px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition">+ Tambah</button>
            {hasDirty && (
              <button onClick={saveAll} disabled={saving} className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition disabled:opacity-50">
                {saving ? "Menyimpan..." : "Simpan Semua"}
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-xs bg-white/10 text-white/60 rounded-lg hover:bg-white/20 transition">Tutup</button>
          </div>
        </div>

        {error && <div className="px-4 py-2 bg-red-500/10 text-red-400 text-xs">{error}</div>}

        {/* Table */}
        <div className="overflow-auto flex-1 p-4">
          {loading ? (
            <div className="text-white/40 text-center py-8">Memuat varian...</div>
          ) : variants.length === 0 ? (
            <div className="text-white/40 text-center py-8">
              <p>Belum ada varian.</p>
              <button onClick={addVariant} className="mt-2 text-cyan-400 underline text-sm">Tambah varian pertama</button>
            </div>
          ) : (
            <table className="w-full text-xs text-white/80">
              <thead>
                <tr className="text-left text-white/40 border-b border-white/5">
                  <th className="pb-2 pr-2">SKU</th>
                  <th className="pb-2 pr-2">Label</th>
                  <th className="pb-2 pr-2">Durasi</th>
                  <th className="pb-2 pr-2">Garansi</th>
                  <th className="pb-2 pr-2">Harga</th>
                  <th className="pb-2 pr-2">Stok</th>
                  <th className="pb-2 pr-2">Fulfillment</th>
                  <th className="pb-2 pr-2">Aktif</th>
                  <th className="pb-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={v.id ?? `new-${i}`} className={`border-b border-white/5 ${v._dirty ? "bg-cyan-500/5" : ""}`}>
                    <td className="py-2 pr-2">
                      <input
                        value={v.sku}
                        onChange={e => updateField(i, "sku", e.target.value.toUpperCase())}
                        className="w-28 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs"
                        placeholder="SKU"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        value={v.label}
                        onChange={e => updateField(i, "label", e.target.value)}
                        className="w-24 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs"
                        placeholder="Label"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-1">
                        <input
                          type="number"
                          value={v.duration_value ?? ""}
                          onChange={e => updateField(i, "duration_value", e.target.value ? Number(e.target.value) : null)}
                          className="w-12 bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                          placeholder="0"
                          min={0}
                        />
                        <select
                          value={v.duration_unit ?? ""}
                          onChange={e => updateField(i, "duration_unit", e.target.value || null)}
                          className="bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                        >
                          {DURATION_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-1">
                        <select
                          value={v.warranty_type}
                          onChange={e => updateField(i, "warranty_type", e.target.value)}
                          className="bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                        >
                          {WARRANTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        {v.warranty_type === "limited" && (
                          <>
                            <input
                              type="number"
                              value={v.warranty_value ?? ""}
                              onChange={e => updateField(i, "warranty_value", e.target.value ? Number(e.target.value) : null)}
                              className="w-10 bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                              min={0}
                            />
                            <select
                              value={v.warranty_unit ?? ""}
                              onChange={e => updateField(i, "warranty_unit", e.target.value || null)}
                              className="bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                            >
                              {DURATION_UNITS.filter(u => u.value !== "custom").map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                            </select>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        value={v.price}
                        onChange={e => updateField(i, "price", Number(e.target.value))}
                        className="w-20 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs"
                        min={0}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        value={v.stock}
                        onChange={e => updateField(i, "stock", Number(e.target.value))}
                        className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs"
                        min={-1}
                      />
                      <span className="text-white/30 ml-1">{v.stock === -1 ? "\u221E" : ""}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={v.fulfillment_mode}
                        onChange={e => updateField(i, "fulfillment_mode", e.target.value)}
                        className="bg-white/5 border border-white/10 rounded px-1 py-1 text-xs"
                      >
                        {FULFILLMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <button
                        onClick={() => updateField(i, "is_active", v.is_active ? 0 : 1)}
                        className={`px-2 py-0.5 rounded text-xs ${v.is_active ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
                      >
                        {v.is_active ? "Ya" : "Tidak"}
                      </button>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button onClick={() => duplicateVariant(i)} className="px-1.5 py-0.5 bg-white/5 text-white/40 rounded text-xs hover:bg-white/10" title="Duplikasi">{"\u29C9"}</button>
                        <button onClick={() => removeVariant(i)} className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20" title="Hapus">{"\u2715"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer summary */}
        <div className="p-3 border-t border-white/10 text-xs text-white/40 flex justify-between">
          <span>
            {variants.filter(v => v.is_active).length} aktif &middot;{" "}
            Harga: {variants.length > 0 ? formatRupiah(Math.min(...variants.filter(v=>v.is_active).map(v=>v.price))) : "\u2014"} &mdash; {variants.length > 0 ? formatRupiah(Math.max(...variants.filter(v=>v.is_active).map(v=>v.price))) : "\u2014"}
          </span>
          <span>{hasDirty ? "\u26A1 Perubahan belum disimpan" : "\u2713 Tersimpan"}</span>
        </div>
      </div>
    </div>
  );
}
