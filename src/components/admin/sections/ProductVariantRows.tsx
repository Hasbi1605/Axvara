"use client";
import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Loading";
import type { FormVariant, ProductForm } from "../product-types";

// Blok daftar varian dipisah dari ProductEditorModal karena inilah sub-form paling padat
// (harga, harga coret, stok, dan matriks garansi per baris). Memisahkannya menjaga file
// modal tetap ringkas dan membuat aturan render baris varian mudah dibaca sendiri.
// Tetap tanpa state lokal: seluruh mutasi diteruskan ke setter formVariants milik page.tsx.

/**
 * Panel konten fulfillment non-WR di dalam baris varian ProductEditorModal.
 * Inilah yang selama ini "hilang": satu-satunya panel pengisian kredensial
 * (FulfillmentInventoryPanel) hanya dirender VariantEditor yang tidak
 * dipakai halaman mana pun — produk non-WR yang dibuat/diubah lewat modal
 * resmi TIDAK PERNAH bisa diisi stoknya dari admin.
 *
 * Keputusan owner 2026-09-19: admin MELIHAT isi kredensial (bukan one-way).
 * Alasan: admin = pemilik toko yang butuh audit/edit/bersih-bersih; enkripsi
 * tetap di DB (AES-GCM), reveal hanya di route admin ini, tidak ke pembeli.
 *
 * Mode "manual" → catatan (admin kirim sendiri).
 * Mode "shared" → tampilkan pesan bersama saat ini + form ganti.
 * Mode "unique" → daftar stok tersedia saat ini + impor/hapus per baris.
 * Mode "__wr__" → varian WR: baca counts saja, tanpa form tulis.
 */
function NonWrFulfillmentPanel({ productId, variantId, mode }: { productId?: number | string; variantId?: number; mode: string }) {
  const toast = useToast();
  const [counts, setCounts] = useState<{ available: number; reserved: number; delivered: number } | null>(null);
  const [sharedCurrent, setSharedCurrent] = useState<string | null>(null);
  const [handoverTemplate, setHandoverTemplate] = useState("");
  const [handoverSaved, setHandoverSaved] = useState("");
  const [inventory, setInventory] = useState<{ id: number; secret: string }[]>([]);
  const [sharedText, setSharedText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [loading, setLoading] = useState(false);
  const pid = Number(productId);

  const load = async () => {
    if (!pid || !variantId) return;
    try {
      const res = await fetch(`/api/admin/fulfillment?product_id=${pid}&variant_id=${variantId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as {
        available?: number; reserved?: number; delivered?: number;
        shared_secret?: string | null;
        inventory?: { id: number; secret: string }[];
        handover_template?: string;
      };
      if (!res.ok) return;
      const template = typeof data.handover_template === "string" ? data.handover_template : "";
      setHandoverTemplate(template);
      setHandoverSaved(template);
      setCounts({ available: Number(data.available || 0), reserved: Number(data.reserved || 0), delivered: Number(data.delivered || 0) });
      setSharedCurrent(typeof data.shared_secret === "string" ? data.shared_secret : null);
      setInventory(Array.isArray(data.inventory) ? data.inventory : []);
    } catch { /* counts pendukung — gagal muat tidak menghalangi simpan. */ }
  };

  // Auto-load saat panel dibuka / mode berubah — tanpa ini counts selalu
  // null ("Tersedia 0") sampai admin menekan tombol manual.
  useEffect(() => { void load(); }, [pid, variantId, mode]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/fulfillment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: pid, variant_id: variantId, ...payload }) });
    const data = await res.json().catch(() => ({})) as { error?: string; inserted?: number };
    if (!res.ok) throw new Error(data.error || "Gagal menyimpan");
    return data;
  };

  const saveHandoverTemplate = async () => {
    setLoading(true);
    try {
      await post({ action: "set_handover_template", handover_template: handoverTemplate.trim() });
      setHandoverSaved(handoverTemplate.trim());
      toast.success(handoverTemplate.trim() ? "Template pesan disimpan." : "Template pesan dihapus.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Gagal menyimpan"); }
    finally { setLoading(false); }
  };

  const saveShared = async () => {
    if (!sharedText.trim()) return;
    setLoading(true);
    try { await post({ action: "set_shared_secret", shared_secret: sharedText.trim() }); setSharedText(""); toast.success("Pesan bersama disimpan."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Gagal menyimpan"); }
    finally { setLoading(false); }
  };

  const importInventory = async () => {
    const secrets = inventoryText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!secrets.length) return;
    setLoading(true);
    try {
      await post({ action: "set_mode", fulfillment_mode: "unique" });
      const data = await post({ action: "import", secrets });
      setInventoryText(""); toast.success(`${data.inserted || 0} stok unik ditambahkan.`); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Gagal mengimpor"); }
    finally { setLoading(false); }
  };

  const removeOne = async (inventoryId: number) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/fulfillment", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventory_id: inventoryId }) });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Gagal menghapus");
      toast.success("Stok dihapus."); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Gagal menghapus"); }
    finally { setLoading(false); }
  };

  if (!variantId) return <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/40">Simpan produk terlebih dahulu (agar varian punya ID), lalu buka Edit untuk mengisi konten fulfillment.</p>;
  if (mode === "__wr__") {
    return (
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3 text-xs text-white/40">
        <button type="button" onClick={() => void load()} className="font-semibold text-[#5cefff] hover:underline">Muat status stok WR</button>
        {counts && <span className="ml-2">Tersedia {counts.available} · Terpakai {counts.delivered} · Dipesan {counts.reserved}</span>}
      </div>
    );
  }
  if (mode === "manual") {
    // Made By Order: admin mengirim lewat Pesanan → Kirim ke pembeli. Template
    // ini mengisi otomatis kolom "Detail untuk pembeli" di dialog itu.
    const dirty = handoverTemplate.trim() !== handoverSaved.trim();
    return (
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <p className="text-xs font-semibold text-white">Template pesan untuk pembeli</p>
        <p className="mt-0.5 text-[11px] leading-5 text-white/40">
          Admin mengirim pesanan ini dari Pesanan → Kirim ke pembeli. Teks di bawah mengisi otomatis kolom detail di dialog itu dan bisa disunting sebelum dikirim. Bisa memakai {"{email}"}, {"{nama}"}, {"{kode}"}, dan {"{produk}"}.
        </p>
        <textarea
          aria-label="Template pesan untuk pembeli"
          value={handoverTemplate}
          onChange={(e) => setHandoverTemplate(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Contoh: Undangan Canva sudah dikirim ke {email}. Buka email dari Canva lalu terima undangannya."
          className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-white/[0.055] p-3 text-sm text-white placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:outline-none"
        />
        <button type="button" onClick={() => void saveHandoverTemplate()} disabled={loading || !dirty} className="mt-3 rounded-full bg-[#00E5FF] px-4 py-2 text-xs font-bold text-[#07101f] disabled:opacity-40">
          {loading ? "Menyimpan..." : "Simpan template"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-white">Konten fulfillment</p>
          <p className="mt-0.5 text-[11px] text-white/35">Tersimpan terenkripsi di database; terlihat di panel admin ini.</p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "shared" ? (
            sharedCurrent ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">Pesan bersama aktif</span>
            ) : (
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] text-white/45">Belum ada isi</span>
            )
          ) : (
            counts && <div className="flex flex-wrap gap-1.5 text-[10px]"><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Tersedia {counts.available}</span><span className="rounded-full bg-white/[0.06] px-2 py-1 text-white/45">Terpakai {counts.delivered}</span><span className="rounded-full bg-[#FFB800]/10 px-2 py-1 text-[#FFCF55]">Dipesan {counts.reserved}</span></div>
          )}
          <button type="button" onClick={() => void load()} className="text-[11px] font-semibold text-[#5cefff] hover:underline">Muat ulang</button>
        </div>
      </div>
      {mode === "shared" ? (
        <div className="mt-3">
          {sharedCurrent ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-300/80">Isi saat ini</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white">{sharedCurrent}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs text-white/40">Belum ada pesan bersama — isi di bawah lalu simpan.</p>
          )}
          <textarea value={sharedText} onChange={(e) => setSharedText(e.target.value)} rows={3} placeholder={sharedCurrent ? "Tulis pesan baru untuk MENGGANTI isi di atas…" : "Link, akun bersama, atau instruksi yang dikirim ke setiap pembeli…"} className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40" />
          <button type="button" onClick={() => void saveShared()} disabled={loading || !sharedText.trim()} className="mt-2 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">{loading && <Spinner size={13} />} {sharedCurrent ? "Ganti pesan bersama" : "Simpan pesan bersama"}</button>
        </div>
      ) : (
        <div className="mt-3">
          {inventory.length > 0 ? (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-[#080C1E]/65 p-2.5">
              {inventory.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-white">{row.secret}</span>
                  <button type="button" onClick={() => void removeOne(row.id)} disabled={loading} className="shrink-0 text-[11px] font-semibold text-red-300 hover:text-red-200 hover:underline disabled:opacity-40">Hapus</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs text-white/40">Belum ada stok unik — impor di bawah.</p>
          )}
          <textarea value={inventoryText} onChange={(e) => setInventoryText(e.target.value)} rows={4} placeholder={"Satu akun/key per baris\nemail:password\nLICENSE-KEY"} className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[10px] text-white/35">Maksimal 100 entri per impor.</p>
            <button type="button" onClick={() => void importInventory()} disabled={loading || !inventoryText.trim()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">{loading && <Spinner size={13} />} Impor stok unik</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductVariantRows({
  form,
  formVariants,
  onSetFormVariants,
  productId,
}: {
  form: ProductForm;
  formVariants: FormVariant[];
  onSetFormVariants: (updater: (prev: FormVariant[]) => FormVariant[]) => void;
  productId?: number | string;
}) {
  // Opsi label pengiriman non-WR (milik admin): Manual = MBO dikerjakan
  // admin; shared/unique = instan dari stok sendiri. Sinkron 1:1 dengan
  // fulfillment_mode agar display buyer (badge/ETA) tidak menebak.
  const FULFILLMENT_OPTIONS = [
    { value: "manual", label: "Made By Order — admin kerjakan manual" },
    { value: "shared", label: "Kirim otomatis — pesan/instruksi bersama" },
    { value: "unique", label: "Kirim otomatis — stok kredensial unik" },
  ];
  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#00E5FF]">Daftar Pilihan Paket / Varian</span>
        {form.wrManaged ? (
          <span className="text-[11px] text-[#FFD980]/80">Varian dikelola Warung Rebahan — markup diatur di tab Warung Rebahan. Harga coret tetap bisa kamu edit ✎.</span>
        ) : (
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
                  min_qty: 1,
                  warranty_type: "none",
                  fulfillment_mode: "manual",
                  is_active: 1,
                },
              ]);
            }}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[#00E5FF]/25 bg-[#00E5FF]/10 px-3 text-xs font-bold text-[#5cefff] transition hover:bg-[#00E5FF]/20"
        >
          <IosIcon name="plus" size={12} tint="#00E5FF" /> Tambah Varian
        </button>
        )}
      </div>

      <div className="space-y-3">
        {formVariants.map((v, idx) => {
          // Varian WR: label, harga, stok, durasi, dan garansi dimiliki sync.
          // Dibuat read-only agar admin tidak mengedit nilai yang pasti
          // hilang di sweep berikutnya (API juga menolaknya 409).
          // PENGECUALIAN: harga coret (comparePrice) milik admin — tetap bisa
          // diedit agar katalog WR bisa pasang diskon/badge seperti produk
          // manual. Sync tidak pernah menulis compare_price.
          const wrLocked = Number(v.wr_auto_managed ?? 0) === 1 || Boolean(form.wrManaged);
          const lockedInput = "h-9 w-full rounded-xl bg-white/[0.03] border border-white/5 px-3 text-xs text-white/50 cursor-not-allowed";
          const openInput = "h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:outline-none";
          return (
          <div key={v.id || idx} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/20">
            {/* Baris 1: Nama Varian & Aksi */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div className="flex-1 min-w-0">
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Nama Varian / Paket *{wrLocked ? " (WR)" : ""}</span>
                <input
                  value={v.label}
                  readOnly={wrLocked}
                  onChange={(e) => {
                    const val = e.target.value;
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, label: val } : item));
                  }}
                  placeholder="Contoh: 1 Bulan Private / 1 Tahun Sharing"
                  className={wrLocked ? lockedInput : openInput}
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
                {formVariants.length > 1 && !wrLocked && (
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

            {/* Baris 2: Harga, Harga Coret, Stok, Min. Beli */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 py-3 border-b border-white/5">
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Harga Jual (Rp) *{wrLocked ? " (WR)" : ""}</span>
                <MoneyInput
                  value={v.price}
                  readOnly={wrLocked}
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, price: val ?? 0 } : item));
                  }}
                  className={wrLocked ? lockedInput : openInput}
                />
              </div>
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Harga Coret (Rp) <span className="normal-case tracking-normal text-emerald-300/70">✎ bisa diedit</span></span>
                <MoneyInput
                  value={v.comparePrice}
                  allowEmpty
                  readOnly={false}
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, comparePrice: val } : item));
                  }}
                  placeholder="Opsional"
                  className={openInput}
                />
              </div>
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Stok (-1 = ∞){wrLocked ? " (WR)" : ""}</span>
                <input
                  type="number"
                  min={-1}
                  value={v.stock}
                  readOnly={wrLocked}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, stock: val } : item));
                  }}
                  className={wrLocked ? lockedInput : openInput}
                />
              </div>
              {/* Minimum pembelian (migrasi 0034, milik admin — bukan WR):
                  GSuite = 50; produk lain tinggal set angka bila butuh. */}
              <div>
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1">Min. Beli <span className="normal-case tracking-normal text-white/25">(1 = bebas)</span></span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={v.min_qty ?? 1}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, min_qty: val } : item));
                  }}
                  className={openInput}
                />
              </div>
            </div>

            {/* Baris 3: Pengaturan Garansi yang Jelas & Rapi */}
            <div className="pt-3">
              <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1.5">Masa Garansi{wrLocked ? " (WR)" : ""}</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={v.warranty_type || "full"}
                  disabled={wrLocked}
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
                      readOnly={wrLocked}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 1);
                        onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_value: val, duration_value: val } : item));
                      }}
                      className={`h-9 w-16 rounded-xl border px-2 text-xs text-center focus:outline-none ${wrLocked ? "bg-white/[0.03] border-white/5 text-white/50 cursor-not-allowed" : "bg-white/[0.06] border-white/10 text-white focus:border-[#00E5FF]/50"}`}
                    />
                    <select
                      value={v.warranty_unit || "month"}
                      disabled={wrLocked}
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
                    readOnly={wrLocked}
                    onChange={(e) => {
                      const val = e.target.value;
                      onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_label: val } : item));
                    }}
                    placeholder="Contoh: Garansi 24 Jam Ganti Akun"
                    className={`h-9 flex-1 min-w-[200px] rounded-xl border px-3 text-xs focus:outline-none ${wrLocked ? "bg-white/[0.03] border-white/5 text-white/50 cursor-not-allowed" : "bg-white/[0.06] border-white/10 text-white placeholder:text-white/20 focus:border-[#00E5FF]/50"}`}
                  />
                )}

                {/* Label Hasil Preview Badge */}
                <span className="text-[11px] text-[#00E5FF]/80 font-medium ml-auto pl-2 py-1">
                  Hasil: {v.warranty_type === "none" ? "Tanpa Garansi" : v.warranty_type === "custom" ? (v.warranty_label || "Kustom") : `${v.warranty_type === "full" ? "Full Garansi" : "Garansi Terbatas"} ${v.warranty_value ?? 1} ${v.warranty_unit === "day" ? "Hari" : v.warranty_unit === "year" ? "Tahun" : v.warranty_unit === "lifetime" ? "Selamanya" : "Bulan"}`}
                </span>
              </div>
            </div>

            {/* Baris 4: Cara pengiriman (non-WR, milik admin) + panel konten
                fulfillment. Opsi ini sinkron 1:1 dengan fulfillment_mode yang
                dipakai engine + display buyer — bukan label bebas. Varian WR
                (wrLocked) menyembunyikan opsi ini (ikut kelas sync); panel
                read-only status stok tetap tampil. */}
            {!wrLocked ? (
              <div className="pt-3">
                <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1.5">Cara Pengiriman</span>
                <select
                  value={v.fulfillment_mode || "manual"}
                  onChange={(e) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, fulfillment_mode: e.target.value } : item));
                  }}
                  className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
                >
                  {FULFILLMENT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value} className="bg-[#0F1430]">{opt.label}</option>)}
                </select>
                <p className="mt-1.5 text-[11px] leading-4 text-white/35">
                  {(v.fulfillment_mode || "manual") === "manual"
                    ? "Badge pembeli: Made By Order (disiapkan admin)."
                    : "Badge pembeli: Kirim otomatis (dikirim sistem dari stok di bawah)."}
                </p>
                <NonWrFulfillmentPanel productId={productId} variantId={typeof v.id === "number" ? v.id : undefined} mode={v.fulfillment_mode || "manual"} />
              </div>
            ) : (
              <NonWrFulfillmentPanel productId={productId} variantId={typeof v.id === "number" ? v.id : undefined} mode="__wr__" />
            )}
          </div>
          );
        })}
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
