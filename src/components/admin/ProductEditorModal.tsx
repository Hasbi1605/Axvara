"use client";
import { Badge, Button, Checkbox, Input, Label, NativeSelect, Switch, Tabs, TabsList, TabsTrigger, TabsContent, Skeleton } from "@/components/admin/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAdminDraft } from "./AdminWorkspace";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/admin/AdminIcon";
import { MoneyInput } from "@/components/ui/MoneyInput";
import type { Cat, FormVariant, ProductForm } from "./product-types";
import { emptyBulkDraft } from "./BulkTierEditor";
import { ProductVariantRows } from "./sections/ProductVariantRows";
import { SingleVariantFields } from "./sections/SingleVariantFields";
import { ProductCopyTab } from "./sections/ProductCopyTab";
import { useVariantCopyEntries } from "./sections/VariantCopyEditor";

// Modal editor produk dipisah karena ini form terpanjang di admin: identitas produk,
// toggle multi-varian dengan tabel varian penuh (harga/stok/garansi), dan galeri foto.
// Semua state form tetap di page.tsx (single source of truth) dan diturunkan lewat props
// setter agar perilaku dirty-check, autosave signature, dan validasi tidak berubah.

export function ProductEditorModal({
  editing,
  editingId,
  bulkFocus,
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
  /** ID produk numerik saat mode edit (untuk panel fulfillment per varian). */
  editingId?: number | string;
  /** Permintaan fokus ke isian harga grosir yang tidak valid (simpan ditolak). */
  bulkFocus?: { id: string; n: number } | null;
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
  // Modal ini memuat 4 pekerjaan berbeda (identitas, varian, teks, media). Untuk
  // produk 5 varian isinya ~3100px / 46 kontrol, sehingga tombol Simpan ada
  // ~2600px di bawah tempat admin bekerja. Tab memotong scroll per pekerjaan;
  // footer sticky membuat Simpan selalu terjangkau.
  const [tab, setTab] = useState<"detail" | "varian" | "konten" | "media">("detail");
  // Badan modal di-scroll bersama semua tab; ganti tab mulai dari atas.
  const bodyRef = useRef<HTMLDivElement>(null);
  // Simpan ditolak karena isian harga grosir: pindah ke tab Varian lalu
  // fokuskan field pertama yang salah (tab lain `hidden`, tidak bisa fokus).
  useEffect(() => {
    if (!bulkFocus?.id) return;
    setTab("varian");
    const timer = window.setTimeout(() => document.getElementById(bulkFocus.id!)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [bulkFocus]);
  const tabs: [typeof tab, string][] = [["detail", "Produk"], ["varian", "Varian"], ["konten", "Deskripsi & S&K"], ["media", "Foto"]];
  // Dimuat saat modal dibuka (bukan saat tab dibuka) agar penanda "perlu
  // ditinjau" di tab langsung akurat; sebelum termuat pakai angka dari daftar.
  const variantCopy = useVariantCopyEntries(editing ? editingId : undefined);
  const [discardCopy, setDiscardCopy] = useState(false);
  useAdminDraft(variantCopy.dirty || variantCopy.saving, variantCopy.saving);
  const requestClose = useCallback(() => {
    if (saving || variantCopy.saving) return;
    if (variantCopy.dirty) { setDiscardCopy(true); return; }
    onRequestClose();
  }, [saving, variantCopy.saving, variantCopy.dirty, onRequestClose]);
  const copyReviewCount = variantCopy.entries.size > 0
    ? [...variantCopy.entries.values()].filter((entry) => entry.isActive && entry.needsReview).length
    : (form.copyReview ?? 0);
  return (
    <>
    <Dialog title={editing ? "Edit Produk" : "Produk Baru"} onClose={requestClose} busy={saving || variantCopy.saving} className="w-[880px] !overflow-hidden !p-0">
          <Tabs value={tab} onValueChange={value => { setTab(value as typeof tab); if (bodyRef.current) bodyRef.current.scrollTop = 0; }} className="flex min-w-0 max-h-[calc(100dvh-2rem)] flex-col">
            <div className="shrink-0 px-6 pt-6">
            <div className="flex items-center justify-between gap-3">
              <h3 id="product-editor-title" className="font-sans text-lg font-semibold text-admin-fg">{editing? "Edit Produk":"Produk Baru"}</h3>
              <Button variant="outline" size="icon" type="button" onClick={requestClose} disabled={saving || variantCopy.saving} className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md bg-admin-subtle text-admin-muted transition hover:bg-admin-subtle disabled:opacity-50" aria-label="Tutup editor produk"><IosIcon name="close" size={14} tint="currentColor" /></Button>
            </div>

            {formError && <p className="mt-4 rounded-xl bg-admin-danger/10 border border-admin-danger/20 px-3 py-2 text-sm text-admin-danger">{formError}</p>}

            {form.wrManaged && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-xs leading-5 text-admin-warning">
                <Badge variant="outline" className="mt-[1px] shrink-0 rounded-md bg-admin-warning/20 px-2 py-0.5 text-sm font-medium text-admin-warning">WR</Badge>
                <span>Dikelola otomatis Warung Rebahan. Nama, slug, deskripsi, harga, stok, label varian, durasi, dan garansi ikut katalog WR dan akan ditimpa tiap sync. Yang bisa kamu atur di sini: foto, badge, <strong>harga coret (diskon)</strong>, kategori, urutan, aktif/nonaktif, serta deskripsi khusus dan S&amp;K + cara aktivasi per varian di tab Deskripsi &amp; S&amp;K. Markup diatur di tab Warung Rebahan.</span>
              </p>
            )}

            <TabsList className="mt-4 justify-start" aria-label="Bagian editor produk">
              {tabs.map(([id, label]) => (
                <TabsTrigger key={id} value={id} className="text-xs sm:text-sm">
                  {label}{id === "varian" && hasMultiVariants && formVariants.length > 0 ? ` (${formVariants.length})` : ""}
                  {id === "konten" && copyReviewCount > 0 && (
                    <Badge variant="warning" className="px-1.5 py-px text-xs">
                      {copyReviewCount}<span className="sr-only"> varian S&amp;K perlu ditinjau</span>
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            </div>

            <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-2">
            <TabsContent value="detail" forceMount hidden={tab !== "detail"} className="mt-0">
            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <Label className="space-y-2"><span className="flex items-center gap-1.5 text-sm font-medium text-admin-fg">Nama *</span><Input value={form.name??""} readOnly={form.wrManaged} onChange={e=>onSetForm({...form,name:e.target.value, slug: !editing? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""): form.slug})} placeholder="ChatGPT Plus 1 Bulan" className={`w-full h-9 px-3 rounded-xl border text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none ${form.wrManaged ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border focus:border-admin-accent/30"}`} /></Label>
              <Label className="space-y-2"><span className="flex items-center gap-1.5 text-sm font-medium text-admin-fg">Slug *</span><Input value={form.slug??""} readOnly={form.wrManaged} onChange={e=>onSetForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})} placeholder="chatgpt-plus-1-bulan" className={`w-full h-9 px-3 rounded-xl border text-sm text-admin-fg placeholder:text-admin-muted font-mono focus:outline-none ${form.wrManaged ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border focus:border-admin-accent/30"}`} /></Label>
              <Label className="space-y-2"><span className="flex items-center gap-1.5 text-sm font-medium text-admin-fg">Kategori</span><NativeSelect value={form.categorySlug??cats[0]?.slug??""} onChange={e=>onSetForm({...form,categorySlug:e.target.value})} className="w-full h-9 px-3 rounded-xl bg-admin-subtle border border-admin-border text-sm text-admin-fg focus:outline-none focus:border-admin-accent/30">
                {cats.map((category) => <option key={category.id} value={category.slug} className="bg-admin-card">{category.name}</option>)}
              </NativeSelect></Label>
              <Label className="space-y-2"><span className="flex items-center gap-1.5 text-sm font-medium text-admin-fg">Badge</span><Input value={form.badge??""} onChange={e=>onSetForm({...form,badge:e.target.value})} placeholder="Terlaris / Baru / Hemat 92%" className="w-full h-9 px-3 rounded-xl bg-admin-subtle border border-admin-border text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none focus:border-admin-accent/30" /></Label>
              <div className="space-y-2"><span className="block text-sm font-medium text-admin-fg">Posisi tampil</span><p aria-label="Posisi tampil produk" className="text-sm text-admin-muted">{form.displayPosition ?? "—"}</p><span className="block text-xs leading-4 text-admin-muted">Sama dengan kolom Urutan di daftar. Ubah satu posisi secara aman memakai tombol naik/turun setelah menutup editor.</span></div>
            </div>

            </TabsContent>

            {/* Toggle Multi-Varian ala Marketplace */}
            <TabsContent value="varian" forceMount hidden={tab !== "varian"} className="mt-0">
            <div className="mt-5 rounded-xl border border-admin-border bg-admin-subtle p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-admin-fg">Variasi Produk</h4>
                  <p className="mt-0.5 text-xs text-admin-muted">Aktifkan jika produk memiliki beberapa pilihan durasi, akun, atau paket harga.</p>
                </div>
                <Switch checked={hasMultiVariants} aria-label="Variasi Produk"
                  onCheckedChange={() => {
                    const next = !hasMultiVariants;
                    onSetHasMultiVariants(next);
                    // Paritas single↔multi 2026-09-28: jangan hilangkan nilai
                    // saat bolak-balik toggle.
                    if (next) {
                      // OFF → ON: bawa nilai form single ke baris varian.
                      if (formVariants.length === 0) {
                        onSetFormVariants(() => [
                          {
                            sku: `${(form.slug || "PROD").toUpperCase()}-1`,
                            label: "1 Bulan",
                            price: form.price ? Number(form.price) : 50000,
                            comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
                            stock: form.stock != null ? Number(form.stock) : -1,
                            min_qty: form.min_qty ?? 1,
                            buyer_field_key: form.buyer_field_key,
                            max_qty: form.max_qty,
                            manual_cost: form.manual_cost ?? 0,
                            duration_value: 1,
                            duration_unit: "month",
                            warranty_type: form.warranty_type || "full",
                            warranty_value: form.warranty_value ?? 1,
                            warranty_unit: form.warranty_unit || "month",
                            warranty_label: form.warranty_label ?? null,
                            fulfillment_mode: form.fulfillment_mode || "manual",
                            is_active: 1,
                            // Draft harga grosir mode single ikut ke varian pertama.
                            bulk: form.bulk ?? emptyBulkDraft(),
                          },
                        ]);
                      } else if (formVariants.length === 1 && formVariants[0].sku.startsWith("DEFAULT-")) {
                        // Edit produk single yang dinyalakan variannya: sinkronkan
                        // edit single yang mungkin sudah dilakukan ke baris DEFAULT.
                        onSetFormVariants((curr) => curr.map((item, i) => i === 0 ? {
                          ...item,
                          price: form.price != null ? Number(form.price) : item.price,
                          comparePrice: form.comparePrice != null ? Number(form.comparePrice) : item.comparePrice,
                          stock: form.stock != null ? Number(form.stock) : item.stock,
                          min_qty: form.min_qty ?? item.min_qty ?? 1,
                          buyer_field_key: form.buyer_field_key,
                          max_qty: form.max_qty,
                          manual_cost: form.manual_cost ?? item.manual_cost ?? 0,
                          warranty_type: form.warranty_type || item.warranty_type || "none",
                          warranty_value: form.warranty_value ?? item.warranty_value ?? null,
                          warranty_unit: form.warranty_unit || item.warranty_unit || null,
                          warranty_label: form.warranty_label ?? item.warranty_label ?? null,
                          fulfillment_mode: form.fulfillment_mode || item.fulfillment_mode || "manual",
                        } : item));
                      }
                    } else if (formVariants.length > 0) {
                      // ON → OFF: salin varian pertama kembali ke form single
                      // agar nilai tidak reset ke bawaan lama.
                      const v0 = formVariants[0];
                      onSetForm({
                        ...form,
                        price: v0.price,
                        comparePrice: v0.comparePrice ?? undefined,
                        stock: v0.stock,
                        min_qty: v0.min_qty ?? 1,
                        buyer_field_key: v0.buyer_field_key,
                        max_qty: v0.max_qty,
                        manual_cost: v0.manual_cost ?? 0,
                        warranty_type: v0.warranty_type || "none",
                        warranty_value: v0.warranty_value ?? null,
                        warranty_unit: v0.warranty_unit || null,
                        warranty_label: v0.warranty_label ?? null,
                        fulfillment_mode: v0.fulfillment_mode || "manual",
                        bulk: v0.bulk,
                      });
                    }
                  }}
                />
              </div>

              {loadingVariants ? (
                <div className="py-6 text-center text-xs text-admin-muted"><Skeleton className="h-9 w-full" /><span className="sr-only">Memuat rincian varian...</span></div>
              ) : hasMultiVariants ? (
                <ProductVariantRows form={form} formVariants={formVariants} onSetFormVariants={onSetFormVariants} productId={editingId} editing={editing} />
              ) : (
                <>
                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                  <Label className="block min-w-0">
                    <span className="text-sm font-medium text-admin-fg">Harga jual *{form.wrManaged ? " (WR)" : ""}</span>
                    <MoneyInput
                      value={form.price}
                      readOnly={form.wrManaged}
                      onChange={(val) => onSetForm({ ...form, price: val ?? 0 })}
                      placeholder="89000"
                      className={`mt-1 h-9 w-full px-3 rounded-xl border text-sm focus:outline-none ${form.wrManaged ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border text-admin-fg focus:border-admin-accent/30"}`}
                    />
                  </Label>
                  <Label className="block min-w-0">
                    <span className="text-sm font-medium text-admin-fg">Harga coret <span className="normal-case text-admin-muted">bisa diedit</span></span>
                    <MoneyInput
                      value={form.comparePrice}
                      allowEmpty
                      onChange={(val) => onSetForm({ ...form, comparePrice: val ?? undefined })}
                      placeholder="300000"
                      className="mt-1 h-9 w-full px-3 rounded-xl bg-admin-subtle border border-admin-border text-sm text-admin-fg focus:outline-none focus:border-admin-accent/30"
                    />
                  </Label>
                  <Label className="block min-w-0">
                    <span className="text-sm font-medium text-admin-fg">Stok (-1 = ∞){form.wrManaged ? " (WR)" : ""}</span>
                    <Input
                      type="number"
                      value={form.stock ?? -1}
                      readOnly={form.wrManaged || form.fulfillment_mode === "unique"}
                      onChange={(e) => onSetForm({ ...form, stock: Number(e.target.value) })}
                      className={`mt-1 h-9 w-full px-3 rounded-xl border text-sm focus:outline-none ${form.wrManaged ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border text-admin-fg focus:border-admin-accent/30"}`}
                    />
                  </Label>
                </div>
                {/* Paritas single 2026-09-28: min. beli + garansi + cara
                    pengiriman + template pesan — blok yang sama dengan mode
                    varian. variantId diteruskan agar panel fulfillment bisa
                    muat template produk yang sudah tersimpan. */}
                <SingleVariantFields
                  form={form}
                  onSetForm={onSetForm}
                  productId={editingId}
                  editing={editing}
                  variantId={typeof formVariants[0]?.id === "number" ? formVariants[0].id : undefined}
                />
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Label className="flex items-center gap-2">
                <Checkbox  checked={form.isActive !== false} onCheckedChange={(checked) => onSetForm({ ...form, isActive: (checked === true) })} className="w-4 h-4 rounded accent-admin-accent" />
                <span className="text-sm text-admin-muted">Aktif tampil di toko</span>
              </Label>
              {/* Toggle email wajib (migrasi 0033): untuk produk non-WR yang
                  butuh kirim ke email. Varian WR Invite/Link otomatis butuh
                  tanpa toggle ini. */}
              {/* 2026-11-04: dikunci sampai nilai tersimpan termuat. Sebelumnya
                  centang tampil mati saat detail belum termuat, klik admin
                  lalu tertimpa nilai DB (tetap wajib email setelah Simpan). */}
              {(() => {
                const requireEmailPending = editing && (loadingVariants || typeof form.requireEmail !== "boolean");
                return (
                  <Label className="flex items-center gap-2" title="Pembeli wajib isi email sebelum bayar (untuk produk yang dikirim via email)">
                    <Checkbox  disabled={requireEmailPending} aria-busy={requireEmailPending} checked={form.requireEmail === true} onCheckedChange={(checked) => onSetForm({ ...form, requireEmail: (checked === true) })} className="w-4 h-4 rounded accent-admin-accent disabled:opacity-40" />
                    <span className="text-sm text-admin-muted">Wajib email pembeli{requireEmailPending ? " (memuat…)" : ""}</span>
                  </Label>
                );
              })()}
              <div className="text-xs text-admin-muted">
                <Label className="flex items-center gap-2">
                  <span className="text-admin-muted">Terjual</span>
                  <Input
                    type="number" min={0} max={9999999} step={1}
                    value={form.soldCount ?? 0}
                    onChange={(e) => onSetForm({ ...form, soldCount: Math.max(0, Math.min(9999999, Math.floor(Number(e.target.value) || 0))) })}
                    aria-label="Angka Terjual"
                    title="Angka Terjual — pembelian asli tetap menambah di atas angka ini"
                    className="h-8 w-[90px] rounded-lg border border-admin-border bg-admin-subtle px-2 text-center text-xs font-semibold text-admin-fg outline-none transition focus:border-admin-accent/40"
                  />
                </Label>
                <span className="mt-1 block text-xs leading-4 text-admin-muted">Bisa diedit manual; order lunas tetap menambah otomatis.</span>
              </div>
            </div>

            </TabsContent>

            <TabsContent value="konten" forceMount hidden={tab !== "konten"} className="mt-0">
              <ProductCopyTab
                form={form}
                onSetForm={onSetForm}
                formVariants={formVariants}
                hasMultiVariants={hasMultiVariants}
                loadingVariants={loadingVariants}
                variantCopy={variantCopy}
              />
            </TabsContent>

            <TabsContent value="media" forceMount hidden={tab !== "media"} className="mt-0">
            <div className="mt-5">
              <p className="text-sm font-medium text-admin-fg mb-2">Foto Produk — maks 8 (PNG/JPG → WebP otomatis)</p>
              <div className="grid grid-cols-4 gap-2">
                {formImages.map((url,i)=>(
                  <div key={url} className="relative group aspect-square rounded-xl overflow-hidden bg-admin-subtle border border-admin-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className={`w-full h-full ${i === 0 ? "object-cover" : "object-contain"}`} />
                    {i===0 && <span className="absolute top-1 left-1 text-xs font-semibold px-1.5 py-0.5 rounded-md bg-admin-primary text-admin-inverse">Utama</span>}
                    <Button variant="outline" type="button" aria-label={`Hapus foto ${i + 1}`} size="icon" onClick={()=>onSetFormImages(prev=>prev.filter((_,idx)=>idx!==i))} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-md bg-admin-subtle/60 text-admin-fg transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"><IosIcon name="close" size={10} tint="currentColor" /></Button>
                    {i>0 && <Button variant="outline" size="sm" type="button" onClick={()=>onSetFormImages(prev=>{ const a=[...prev]; const t=a[i]; a[i]=a[0]; a[0]=t; return a; })} className="absolute bottom-1 left-1 right-1 text-xs rounded-md py-1 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">Jadikan utama</Button>}
                  </div>
                ))}
                {formImages.length<8 && (
                  <Label className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition ${uploading?"opacity-50 pointer-events-none":"border-admin-border hover:border-admin-accent/40 hover:bg-admin-subtle"}`}>
                    <IosIcon name="plus" size={18} tint="currentColor" className="opacity-40" /><span className="text-xs text-admin-muted">{uploading?"Upload...":"Tambah"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={onUpload} disabled={uploading} />
                  </Label>
                )}
              </div>
              <p className="text-xs text-admin-muted mt-2">Foto pertama = cover WebP 1600x900. Foto kedua dan seterusnya tampil utuh dengan rasio asli, maksimal 1920 px. Foto lama yang terpotong perlu diunggah ulang dari gambar asli.</p>
            </div>

            </TabsContent>
            </div>

             <div className="shrink-0 flex flex-wrap gap-3 justify-end border-t border-admin-border bg-admin-card px-6 py-4">
              {(variantCopy.dirty || variantCopy.saving) && <p role="status" className="w-full text-xs text-admin-warning">{variantCopy.saving ? "Teks varian sedang disimpan…" : "Simpan atau batalkan perubahan teks di panel varian sebelum Simpan Produk."}</p>}
              <Button variant="outline" type="button" onClick={requestClose} disabled={saving || variantCopy.saving} className="h-9 px-5 rounded-md border border-admin-border bg-admin-subtle text-sm font-semibold text-admin-muted transition hover:bg-admin-subtle disabled:opacity-50">Batal</Button>
              <Button variant="default" type="button" onClick={onSave} disabled={saving || uploading || variantCopy.dirty || variantCopy.saving} className="h-9 px-6 rounded-md bg-admin-primary text-admin-inverse text-sm font-semibold hover:bg-admin-primary transition disabled:opacity-60 inline-flex items-center gap-2">
                {saving ? <Spinner size={16} className="border-admin-inverse/20 border-t-admin-inverse" /> : <IosIcon name="checked" size={15} tint="currentColor" />} {saving ? "Menyimpan…" : "Simpan Produk"}
              </Button>
            </div>
          </Tabs>
        </Dialog>
    <ConfirmDialog open={discardCopy} title="Buang perubahan teks varian?" description="Perubahan teks varian belum disimpan." confirmLabel="Buang perubahan" onClose={() => setDiscardCopy(false)} onConfirm={() => { setDiscardCopy(false); onRequestClose(); }} />
    </>
  );
}
