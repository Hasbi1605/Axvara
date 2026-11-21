"use client";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Textarea } from "@/components/admin/ui";
import { AsyncConfirmDialog, ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SupplierBadge } from "../supplier-style";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Trash2 } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/admin/AdminIcon";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Loading";
import type { FormVariant, ProductForm } from "../product-types";
import { WarrantyFields } from "./VariantWarrantyFields";
import { DurationFields } from "./VariantDurationFields";
import { CredentialQueue } from "./CredentialQueue";
import {
  BulkTierEditor,
  emptyBulkDraft,
  isBulkEligibleForm,
  validateBulkDraft,
  variantBulkPrefix,
} from "@/components/admin/BulkTierEditor";

// Blok daftar varian dipisah dari ProductEditorModal karena inilah sub-form paling padat
// (harga, harga coret, stok, dan matriks garansi per baris). Memisahkannya menjaga file
// modal tetap ringkas dan membuat aturan render baris varian mudah dibaca sendiri.
// Tetap tanpa state lokal: seluruh mutasi diteruskan ke setter formVariants milik page.tsx.

// Opsi label pengiriman non-WR (milik admin): Manual = MBO dikerjakan
// admin; shared/unique = instan dari stok sendiri. Sinkron 1:1 dengan
// fulfillment_mode agar display buyer (badge/ETA) tidak menebak.
// Diekspor 2026-09-28 agar mode single memakai opsi yang sama (paritas).
/** Salin ke clipboard; fallback textarea untuk konteks non-secure/izin ditolak. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* coba fallback di bawah */ }
  try {
    const area = document.createElement("textarea");
    area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch { return false; }
}

export const FULFILLMENT_OPTIONS = [
  { value: "manual", label: "Made By Order — admin kerjakan manual" },
  { value: "shared", label: "Kirim otomatis — pesan/instruksi bersama" },
  { value: "unique", label: "Kirim otomatis — stok kredensial unik" },
];

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
export function NonWrFulfillmentPanel({ productId, variantId, mode, onStockChange }: { productId?: number | string; variantId?: number; mode: string; onStockChange?: (stock: number) => void }) {
  const toast = useToast();
  const [counts, setCounts] = useState<{ available: number; reserved: number; delivered: number } | null>(null);
  const [variantStock, setVariantStock] = useState<number | null>(null);
  const [stockMismatch, setStockMismatch] = useState(false);
  const [sharedCurrent, setSharedCurrent] = useState<string | null>(null);
  const [handoverTemplate, setHandoverTemplate] = useState("");
  const [handoverSaved, setHandoverSaved] = useState("");
  const [inventory, setInventory] = useState<{ id: number; secret: string }[]>([]);
  const [sharedText, setSharedText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmOne, setConfirmOne] = useState<number | null>(null);
  const pid = Number(productId);
  const loadGeneration = useRef(0);
  const invalidateLoad = useCallback(() => { loadGeneration.current++; }, []);

  const load = async () => {
    if (!pid || !variantId) return;
    const generation = ++loadGeneration.current;
    try {
      const res = await fetch(`/api/admin/fulfillment?product_id=${pid}&variant_id=${variantId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({})) as {
        available?: number; reserved?: number; delivered?: number;
        shared_secret?: string | null;
        inventory?: { id: number; secret: string }[];
        handover_template?: string;
        variant_stock?: number; stock_mismatch?: boolean;
      };
      if (!res.ok || generation !== loadGeneration.current) return;
      const template = typeof data.handover_template === "string" ? data.handover_template : "";
      setHandoverTemplate(template);
      setHandoverSaved(template);
      setCounts({ available: Number(data.available || 0), reserved: Number(data.reserved || 0), delivered: Number(data.delivered || 0) });
      setVariantStock(typeof data.variant_stock === "number" ? data.variant_stock : null);
      setStockMismatch(data.stock_mismatch === true);
      setSharedCurrent(typeof data.shared_secret === "string" ? data.shared_secret : null);
      const rows = Array.isArray(data.inventory) ? data.inventory : [];
      setInventory(rows);
      // Pilihan hanya untuk baris yang masih ada (terjual/dihapus = lepas).
      setSelected(prev => { const live = new Set(rows.map(row => row.id)); const next = new Set([...prev].filter(id => live.has(id))); return next.size === prev.size ? prev : next; });
      if (mode === "unique" && typeof data.available === "number") onStockChange?.(data.available);
    } catch { /* counts pendukung — gagal muat tidak menghalangi simpan. */ }
  };

  // Auto-load saat panel dibuka / mode berubah — tanpa ini counts selalu
  // null ("Tersedia 0") sampai admin menekan tombol manual.
  useEffect(() => { void load(); return invalidateLoad; }, [pid, variantId, mode, invalidateLoad]);

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
    } finally { setLoading(false); }
  };

  const toggleOne = (id: number, checked: boolean) => setSelected(prev => {
    const next = new Set(prev);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(inventory.map(row => row.id)) : new Set());

  const copyRows = async (rows: { secret: string }[]) => {
    if (!rows.length) return;
    const ok = await copyText(rows.map(row => row.secret).join("\n"));
    if (ok) toast.success(rows.length === 1 ? "Kredensial disalin." : `${rows.length} kredensial disalin.`);
    else toast.error("Gagal menyalin — izinkan akses clipboard di browser.");
  };

  const removeSelected = async () => {
    const ids = inventory.filter(row => selected.has(row.id)).map(row => row.id);
    if (!ids.length) { setConfirmBulk(false); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/fulfillment", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: pid, variant_id: variantId, inventory_ids: ids }) });
      const data = await res.json().catch(() => ({})) as { error?: string; revoked?: number; skipped?: number };
      if (!res.ok) throw new Error(data.error || "Gagal menghapus");
      const revoked = Number(data.revoked || 0), skipped = Number(data.skipped || 0);
      if (skipped > 0) toast.error(`${revoked} stok dihapus; ${skipped} dilewati karena sudah dipesan/terkirim.`);
      else toast.success(`${revoked} stok dihapus.`);
      setSelected(new Set());
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Gagal menghapus"); }
    finally { setLoading(false); setConfirmBulk(false); }
  };

  const moveInventory = async (id: number, targetIndex: number) => {
    const sourceIndex = inventory.findIndex(row => row.id === id);
    if (loading || sourceIndex < 0 || sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= inventory.length) return;
    const previous = inventory;
    const next = [...inventory];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    invalidateLoad();
    setLoading(true);
    setInventory(next);
    try {
      await post({ action: "reorder", inventory_ids: next.map(row => row.id) });
      toast.success("Urutan pengiriman disimpan.");
      await load();
    } catch (error) {
      setInventory(previous);
      toast.error(error instanceof Error ? error.message : "Gagal mengatur urutan");
      await load();
    } finally { setLoading(false); }
  };

  if (!variantId) return <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-3 text-xs text-admin-muted">Simpan produk terlebih dahulu (agar varian punya ID), lalu buka Edit untuk mengisi konten fulfillment.</p>;
  if (mode === "__wr__") {
    return (
      <div className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-3 text-xs text-admin-muted">
        <Button variant="ghost" type="button" onClick={() => void load()} className="font-semibold text-admin-accent hover:underline">Muat status stok WR</Button>
        {counts && <span className="ml-2">Tersedia {counts.available} · Terpakai {counts.delivered} · Dipesan {counts.reserved}</span>}
      </div>
    );
  }
  if (mode === "manual") {
    // Made By Order: admin mengirim lewat Pesanan → Kirim ke pembeli. Template
    // ini mengisi otomatis kolom "Detail untuk pembeli" di dialog itu.
    const dirty = handoverTemplate.trim() !== handoverSaved.trim();
    return (
      <div className="mt-3 rounded-xl border border-admin-border bg-admin-subtle p-4">
        <p className="text-xs font-semibold text-admin-fg">Template pesan untuk pembeli</p>
        <p className="mt-0.5 text-xs leading-5 text-admin-muted">
          Admin mengirim pesanan ini dari Pesanan → Kirim ke pembeli. Teks di bawah mengisi otomatis kolom detail di dialog itu dan bisa disunting sebelum dikirim. Bisa memakai {"{email}"}, {"{nama}"}, {"{kode}"}, dan {"{produk}"}.
        </p>
        <Textarea
          aria-label="Template pesan untuk pembeli"
          value={handoverTemplate}
          onChange={(e) => setHandoverTemplate(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Contoh: Undangan Canva sudah dikirim ke {email}. Buka email dari Canva lalu terima undangannya."
          className="mt-3 w-full resize-y rounded-xl border border-admin-border bg-admin-subtle p-3 text-sm text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/50 focus:outline-none"
        />
        <Button variant="outline" size="sm" type="button" onClick={() => void saveHandoverTemplate()} disabled={loading || !dirty} className="mt-3 rounded-md bg-admin-card px-4 py-2 text-xs font-semibold text-admin-fg disabled:opacity-40">
          {loading ? "Menyimpan..." : "Simpan template"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 min-w-0 rounded-xl border border-admin-border bg-admin-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-admin-fg">Detail akses produk</p>
          <p className="mt-0.5 text-xs text-admin-muted">Tersimpan terenkripsi di database; terlihat di panel admin ini.</p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "shared" ? (
            sharedCurrent ? (
              <Badge variant="outline" className="rounded-md bg-admin-success/10 px-2 py-1 text-xs font-semibold text-admin-success">Pesan bersama aktif</Badge>
            ) : (
              <Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-1 text-xs text-admin-muted">Belum ada isi</Badge>
            )
          ) : (
            counts && <div className="flex flex-wrap gap-1.5 text-xs"><Badge variant="outline" className="rounded-md bg-admin-success/10 px-2 py-1 text-admin-success">Tersedia {counts.available}</Badge><Badge variant="outline" className="rounded-md bg-admin-subtle px-2 py-1 text-admin-muted">Terpakai {counts.delivered}</Badge><Badge variant="outline" className="rounded-md bg-admin-warning/10 px-2 py-1 text-admin-warning">Dipesan {counts.reserved}</Badge></div>
          )}
          <Button variant="ghost" size="sm" type="button" onClick={() => void load()}>Muat ulang</Button>
        </div>
      </div>
      {/* Selisih angka unique (2026-10-02, cermin FulfillmentInventoryPanel):
          kolom stock vs kredensial tersisa. */}
      {mode === "unique" && stockMismatch && variantStock != null && counts && (
        <p role="alert" className="mt-3 rounded-xl border border-admin-warning/30 bg-admin-warning/[0.08] px-3 py-2 text-xs leading-5 text-admin-warning">
          Angka stok kolom ({variantStock}) tidak sama dengan kredensial tersisa ({counts.available}). Pembeli melihat yang terkecil. Impor ulang atau hapus 1 baris untuk menyelaraskan.
        </p>
      )}
      {mode === "shared" ? (
        <div className="mt-3">
          {sharedCurrent ? (
            <div className="rounded-xl border border-admin-success/20 bg-admin-success/[0.06] p-3">
              <p className="text-sm font-medium text-admin-success">Isi saat ini</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-admin-fg">{sharedCurrent}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-admin-border bg-admin-subtle px-3 py-2.5 text-xs text-admin-muted">Belum ada pesan bersama — isi di bawah lalu simpan.</p>
          )}
          <Textarea aria-label="Pesan bersama baru" value={sharedText} onChange={(e) => setSharedText(e.target.value)} rows={3} placeholder={sharedCurrent ? "Tulis pesan baru untuk MENGGANTI isi di atas…" : "Link, akun bersama, atau instruksi yang dikirim ke setiap pembeli…"} className="mt-3 w-full resize-none rounded-xl border border-admin-border bg-admin-card/65 p-3 text-sm text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40" />
          <Button variant="outline" size="sm" type="button" onClick={() => void saveShared()} disabled={loading || !sharedText.trim()} className="mt-2 inline-flex h-9 items-center gap-2 rounded-xl bg-admin-card px-4 text-xs font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-40">{loading && <Spinner size={13} />} {sharedCurrent ? "Ganti pesan bersama" : "Simpan pesan bersama"}</Button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs text-admin-muted">Kredensial paling atas dikirim lebih dulu. Geser pegangan atau gunakan panah. Urutan langsung tersimpan.</p>
          {inventory.length > 0 ? (<>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border bg-admin-subtle px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-admin-fg">
                <Checkbox aria-label="Pilih semua kredensial" disabled={loading}
                  checked={selected.size === 0 ? false : selected.size === inventory.length ? true : "indeterminate"}
                  onCheckedChange={value => toggleAll(value === true)} />
                {selected.size ? `${selected.size} dari ${inventory.length} dipilih` : "Pilih semua"}
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="outline" size="sm" type="button" disabled={!selected.size}
                  onClick={() => void copyRows(inventory.filter(row => selected.has(row.id)))}
                  className="h-8 gap-1.5 rounded-lg px-3 text-xs"><Copy size={13} /> Salin terpilih</Button>
                <Button variant="outline" size="sm" type="button" disabled={loading || !selected.size} onClick={() => setConfirmBulk(true)}
                  className="h-8 gap-1.5 rounded-lg px-3 text-xs text-admin-danger hover:text-admin-danger"><Trash2 size={13} /> Hapus terpilih{selected.size ? ` (${selected.size})` : ""}</Button>
              </div>
            </div>
            <CredentialQueue inventory={inventory} disabled={loading} onMove={(id, index) => void moveInventory(id, index)} onRemove={setConfirmOne}
              selected={selected} onToggle={toggleOne} onCopy={row => void copyRows([row])} />
            <ConfirmDialog open={confirmBulk} loading={loading}
              title={`Hapus ${selected.size} kredensial?`}
              description="Kredensial terpilih ditarik dari stok dan tidak akan dikirim ke pembeli. Kredensial yang keburu dipesan pembeli dilewati otomatis."
              confirmLabel={`Hapus ${selected.size}`}
              onClose={() => setConfirmBulk(false)} onConfirm={() => void removeSelected()} />
          </>
          ) : (
            <p className="rounded-xl border border-admin-border bg-admin-subtle px-3 py-2.5 text-xs text-admin-muted">Belum ada stok unik — impor di bawah.</p>
          )}
          {confirmOne !== null && <AsyncConfirmDialog title={`Tarik kredensial #${confirmOne} dari stok?`}
            description="Kredensial ini tidak akan dikirim ke pembeli jika masih tersedia."
            onClose={() => setConfirmOne(null)} onConfirm={() => removeOne(confirmOne)} />}
          <Textarea aria-label="Stok kredensial untuk diimpor" value={inventoryText} onChange={(e) => setInventoryText(e.target.value)} rows={4} placeholder={"Satu link, akun, atau key per baris\nhttps://contoh.com/aktivasi/...\nemail:password\nLICENSE-KEY"} className="mt-3 w-full resize-none rounded-xl border border-admin-border bg-admin-card/65 p-3 font-mono text-xs text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-admin-muted">Maksimal 100 entri. Impor langsung tersimpan.</p>
            <Button variant="outline" size="sm" type="button" onClick={() => void importInventory()} disabled={loading || !inventoryText.trim()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-admin-card px-4 text-xs font-semibold text-admin-fg transition hover:bg-admin-subtle disabled:opacity-40">{loading && <Spinner size={13} />} Impor stok unik</Button>
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
  editing = true,
}: {
  form: ProductForm;
  formVariants: FormVariant[];
  onSetFormVariants: (updater: (prev: FormVariant[]) => FormVariant[]) => void;
  productId?: number | string;
  /** false = produk baru; harga grosir baru bisa diatur setelah produk tersimpan. */
  editing?: boolean;
}) {
  const [openVariant, setOpenVariant] = useState<number | null>(0);
  const activePrices = formVariants.filter(v => (v.is_active ?? 1) !== 0).map(v => v.price);
  const minPrice = activePrices.length ? Math.min(...activePrices) : 0;
  // Harga grosir hanya untuk produk manual (owner 2026-11-08). Validasi di
  // sini mencerminkan kontrak server; server tetap otoritatif.
  const manualProduct = isBulkEligibleForm(form);
  const aivaultProduct = form.aivault_family != null || form.supplier === "AIVault";
  const managedSupplier = form.storebat_family != null || form.mirai_family != null || form.supplier === "StoreBat" || form.supplier === "Mirai";
  const bulkValidations = formVariants.map((v) => validateBulkDraft(v.bulk ?? emptyBulkDraft(), {
    base: Number(v.price),
    minQty: Math.max(1, Number(v.min_qty ?? 1) || 1),
    stock: Number(v.stock),
    mode: v.fulfillment_mode || "manual",
  }));
  // Baris dengan isian grosir tidak valid dibuka agar pesan simpan bisa
  // ditindaklanjuti tanpa mencari manual.
  const invalidSignature = bulkValidations.map((validation, index) => validation.errorCount > 0 ? index : -1).filter((index) => index >= 0).join(",");
  useEffect(() => {
    if (!invalidSignature) return;
    setOpenVariant(Number(invalidSignature.split(",")[0]));
  }, [invalidSignature]);
  return (
    <div className="mt-4 min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-admin-fg">Daftar pilihan paket / varian <SupplierBadge supplier={form.supplier} /></span>
        {form.wrManaged ? (
          <span className="text-xs text-admin-muted">Varian dikelola Warung Rebahan — nama varian bisa diubah dan tidak tertimpa sync. Harga jual, stok, masa aktif, dan masa garansi ikut WR. Markup diatur di tab Warung Rebahan; harga coret tetap bisa diedit.</span>
        ) : managedSupplier ? (
          <span className="text-xs text-admin-muted">Varian baru dibuat lewat sinkron katalog supplier. Atur markup dan harga manual di tab Markup supplier.</span>
        ) : (
        <Button variant="outline" size="sm"
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
                  manual_cost: 0,
                  warranty_type: "none",
                  fulfillment_mode: "manual",
                  is_active: 1,
                },
              ]);
            }}
        >
          <IosIcon name="plus" size={12} tint="currentColor" /> Tambah Varian
        </Button>
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
          // Semua varian akun TUNVN (SKU TUNVN-{id}) dikirim otomatis setelah
          // lunas; Buff Muse tetap perilaku lama (bukan akun).
          const supplierAutomatic = managedSupplier || v.sku.startsWith("AV-") || /^TUNVN-\d+$/.test(v.sku)
            || (form.slug === "muse-ai-1-miliar-token" && v.sku === "TUNVN-BUFF-1B");
          const lockedInput = "h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-muted cursor-not-allowed";
          const openInput = "h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/50 focus:outline-none";
          return (
          <div key={v.id || idx} className="overflow-hidden rounded-xl border border-admin-border bg-admin-subtle transition hover:border-admin-border">
            <Button variant="ghost" type="button" aria-expanded={openVariant === idx} aria-controls={`variant-fields-${v.id ?? idx}`} onClick={()=>setOpenVariant(openVariant === idx ? null : idx)} className="flex h-auto w-full items-center justify-between gap-3 whitespace-normal rounded-none px-4 py-3 text-left hover:bg-admin-subtle">
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-admin-fg">{v.label || `Varian ${idx+1}`}</span><Badge variant={(v.is_active ?? 1) !== 0 ? "success" : "secondary"}>{(v.is_active ?? 1) !== 0 ? "Aktif" : "Nonaktif"}</Badge></span><span className="mt-1 block text-xs font-normal text-admin-muted">{formatRupiah(v.price)} · {v.stock === -1 ? "Stok tanpa batas" : `Stok ${v.stock}`}</span></span>
              <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-admin-muted transition-transform ${openVariant === idx ? "rotate-180" : ""}`} />
            </Button>
            <div role="region" aria-label={`Pengaturan varian ${v.label || idx+1}`} id={`variant-fields-${v.id ?? idx}`} hidden={openVariant !== idx} className="border-t border-admin-border p-4">
            {/* Baris 1: Nama Varian & Aksi */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-admin-border">
              <div className="flex-1 min-w-0">
                <Label htmlFor={`variant-name-${v.id ?? idx}`} className="mb-2 block">Nama varian / paket *</Label>
                <Input
                  id={`variant-name-${v.id ?? idx}`}
                  value={v.label}
                  onChange={(e) => {
                    const val = e.target.value;
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, label: val } : item));
                  }}
                  placeholder="Contoh: 1 Bulan Private / 1 Tahun Sharing"
                  className={openInput}
                />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <Button variant="outline" size="sm"
                  type="button"
                  onClick={() => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, is_active: item.is_active ? 0 : 1 } : item));
                  }}
                  title={v.is_active ? "Aktif" : "Nonaktif"}
                  className={`inline-flex h-8 items-center gap-1.5 px-3 rounded-xl text-xs font-semibold transition ${v.is_active ? "bg-admin-success/20 text-admin-success border border-admin-success/30" : "bg-admin-subtle text-admin-muted border border-admin-border"}`}
                >
                  {v.is_active ? "Aktif" : "Mati"}
                </Button>
                {formVariants.length > 1 && !wrLocked && !managedSupplier && (
                  <Button variant="outline" size="icon"
                    type="button"
                    onClick={() => {
                      onSetFormVariants((curr) => curr.filter((_, i) => i !== idx));
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-admin-danger/10 text-admin-danger hover:bg-admin-danger/20 transition"
                    title="Hapus varian"
                    aria-label="Hapus varian"
                  >
                    <IosIcon name="trash" size={14} tint="currentColor" />
                  </Button>
                )}
              </div>
            </div>

            {/* Baris 2: Harga, Harga coret, Stok, Min. beli, Modal */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4 border-b border-admin-border">
              <Label className="block min-w-0">
                <span className="block text-sm font-medium text-admin-fg mb-1 sm:min-h-[28px]">Harga jual (Rp) *{wrLocked ? " (WR)" : ""}</span>
                <MoneyInput
                  value={v.price}
                  readOnly={wrLocked}
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, price: val ?? 0 } : item));
                  }}
                  className={wrLocked ? lockedInput : openInput}
                />
              </Label>
              <Label className="block min-w-0">
                <span className="block text-sm font-medium text-admin-fg mb-1 sm:min-h-[28px]">Harga coret (Rp) <span className="normal-case tracking-normal text-admin-muted">bisa diedit</span></span>
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
              </Label>
              <Label className="block min-w-0">
                <span className="block text-sm font-medium text-admin-fg mb-1 sm:min-h-[28px]">Stok{wrLocked ? " (WR)" : ""}</span>
                <Input
                  type="number"
                  min={-1}
                  value={v.stock}
                  readOnly={wrLocked || v.fulfillment_mode === "unique"}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, stock: val } : item));
                  }}
                  className={wrLocked || v.fulfillment_mode === "unique" ? lockedInput : openInput}
                />
                <p className="mt-1 text-xs text-admin-muted">{v.fulfillment_mode === "unique" ? "Mengikuti stok kredensial tersedia" : "-1 untuk stok tanpa batas"}</p>
              </Label>
              {/* Minimum pembelian (migrasi 0034, milik admin — bukan WR):
                  GSuite = 50; produk lain tinggal set angka bila butuh. */}
              <Label className="block min-w-0">
                <span className="block text-sm font-medium text-admin-fg mb-1 sm:min-h-[28px]">Min. beli <span className="normal-case tracking-normal text-admin-muted">(minimal 1)</span></span>
                <Input
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
              </Label>
               <Label className="block min-w-0 text-sm font-medium"><span className="mb-1 block sm:min-h-[28px]">Input pembeli</span>
                <NativeSelect disabled={managedSupplier} value={v.buyer_field_key ?? ""} onChange={e => onSetFormVariants(curr => curr.map((item,i) => i === idx ? { ...item,buyer_field_key:e.target.value === "muse_invite_code" ? "muse_invite_code" : null } : item))} className={openInput}>
                  <option value="">Tidak ada</option><option value="muse_invite_code">Kode Invite Muse (6 huruf/angka)</option>
                </NativeSelect>
              </Label>
               <Label className="block min-w-0 text-sm font-medium"><span className="mb-1 block sm:min-h-[28px]">Maks. beli (kosong = 100)</span><Input disabled={v.sku === "SB-BUFF" || v.sku.startsWith("MR-")} type="number" min={1} max={100} value={v.max_qty ?? ""} onChange={e => onSetFormVariants(curr => curr.map((item,i) => i === idx ? { ...item,max_qty:e.target.value ? Number(e.target.value) : null } : item))} className={openInput} /></Label>
              {/* Modal manual per unit (migrasi 0058, milik admin): untuk
                  produk manual/stok sendiri yang modalnya tak tercatat di
                  link supplier. 0 = murni tanpa modal. */}
              <Label className="block min-w-0">
                <span className="block text-sm font-medium text-admin-fg mb-1 sm:min-h-[28px]">Modal (Rp) <span className="normal-case tracking-normal text-admin-muted">{v.supplier_cost_source ? `dari ${v.supplier_cost_source}` : "(0 = tanpa modal)"}</span></span>
                {v.supplier_cost_source ? (
                  <Input readOnly inputMode="numeric" value={v.supplier_cost?.toLocaleString("id-ID") ?? "—"} className={lockedInput} />
                ) : <MoneyInput
                  value={v.manual_cost ?? 0}
                  onChange={(val) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, manual_cost: Math.max(0, val ?? 0) } : item));
                  }}
                  placeholder="0"
                  className={openInput}
                />}
              </Label>
            </div>

            {/* Harga grosir per varian — HANYA produk manual (owner 2026-11-08).
                Produk supplier (WR/SK) tidak pernah menampilkan editor ini. */}
            {aivaultProduct ? <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Harga grosir AIVault otomatis mengikuti markup — atur di menu AIVault → Markup.</p> : !manualProduct ? (
              <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Harga grosir hanya untuk produk manual.</p>
            ) : !editing ? (
              <p className="mt-3 rounded-xl border border-admin-border bg-admin-subtle px-3 py-2 text-xs leading-5 text-admin-muted">Simpan produk dulu, lalu atur harga grosir di Edit Produk.</p>
            ) : (
              <BulkTierEditor
                idPrefix={variantBulkPrefix(v, idx)}
                draft={v.bulk ?? emptyBulkDraft()}
                validation={bulkValidations[idx]}
                basePrice={Number(v.price)}
                minQty={Math.max(1, Number(v.min_qty) || 1)}
                onChange={(next) => onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, bulk: next } : item))}
              />
            )}

            <DurationFields
              value={v}
              wrLocked={wrLocked}
              onChange={(patch) => onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, ...patch } : item))}
            />

            {/* Garansi dan masa aktif disunting terpisah (owner 2026-11-18). */}
            <WarrantyFields
              value={v}
              wrLocked={wrLocked}
              onChange={(patch) => {
                onSetFormVariants((curr) => curr.map((item, i) => i === idx ? {
                  ...item,
                  ...patch,
                } : item));
              }}
            />

            {/* Baris 4: Cara pengiriman (non-WR, milik admin) + panel konten
                fulfillment. Opsi ini sinkron 1:1 dengan fulfillment_mode yang
                dipakai engine + display buyer — bukan label bebas. Varian WR
                (wrLocked) menyembunyikan opsi ini (ikut kelas sync); panel
                read-only status stok tetap tampil. */}
            {!wrLocked ? (
              <div className="pt-3">
                <Label htmlFor={`variant-fulfillment-${v.id ?? idx}`} className="mb-2 block">Cara pengiriman</Label>
                {supplierAutomatic ? <p className="text-xs leading-5 text-admin-muted">Diproses otomatis setelah pembayaran dikonfirmasi. Tidak perlu mengisi stok kredensial lokal.</p> : <>
                <NativeSelect
                  id={`variant-fulfillment-${v.id ?? idx}`}
                  value={v.fulfillment_mode || "manual"}
                  onChange={(e) => {
                    onSetFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, fulfillment_mode: e.target.value } : item));
                  }}
                  className="h-9 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none"
                >
                  {FULFILLMENT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value} className="bg-admin-card">{opt.label}</option>)}
                </NativeSelect>
                <p className="mt-1.5 text-xs leading-4 text-admin-muted">
                  {(v.fulfillment_mode || "manual") === "manual"
                    ? "Badge pembeli: Made By Order (disiapkan admin)."
                    : "Badge pembeli: Kirim otomatis (dikirim sistem dari stok di bawah)."}
                </p>
                <NonWrFulfillmentPanel productId={productId} variantId={typeof v.id === "number" ? v.id : undefined} mode={v.fulfillment_mode || "manual"} onStockChange={stock=>onSetFormVariants(curr=>curr.some(item=>item.id===v.id && item.stock!==stock)?curr.map(item=>item.id===v.id?{...item,stock}:item):curr)} />
                </>}
              </div>
            ) : (
              <NonWrFulfillmentPanel productId={productId} variantId={typeof v.id === "number" ? v.id : undefined} mode="__wr__" />
            )}
            </div>
          </div>
          );
        })}
      </div>

      {formVariants.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-admin-border px-3 py-2 text-xs">
          <span className="text-admin-muted">Tampilan harga di katalog:</span>
          <span className="font-medium text-admin-fg">
            {activePrices.length ? `Mulai ${formatRupiah(minPrice)}` : "Belum ada varian aktif"}
          </span>
        </div>
      )}
    </div>
  );
}
