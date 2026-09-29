"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toWebp16x9 } from "@/components/admin/ImageDropzone";
import type { Prod, Cat, FormVariant, ProductForm } from "@/components/admin/product-types";
import { adjacentReorderProduct, sortProductsForDisplay } from "@/lib/product-order";

// Hook ini memusatkan seluruh state + handler katalog produk (daftar, filter, pagination,
// editor form, varian, upload, simpan, hapus, toggle aktif). Dipisah dari page.tsx BUKAN
// untuk mengubah arsitektur — tidak ada Context/store baru — melainkan agar komponen halaman
// tetap tipis dan orkestrasinya mudah dibaca. Kepemilikan state tetap di React (useState),
// hanya dikelompokkan ke satu unit yang kohesif. Perilaku persis sama dengan sebelumnya.

const PER_PAGE_ADMIN = 8;

/** Nama field WR-owned dalam bahasa yang dikenali admin di form. */
const WR_FIELD_LABEL: Record<string, string> = {
  name: "Nama",
  slug: "Slug",
  description: "Deskripsi",
  price: "Harga Jual",
  stock: "Stok",
  label: "Nama Varian",
  duration_value: "Durasi",
  duration_unit: "Durasi",
  duration_label: "Durasi",
  warranty_type: "Garansi",
  warranty_value: "Garansi",
  warranty_unit: "Garansi",
  warranty_label: "Garansi",
};

export type AdminToast = {
  success: (msg: string) => void;
  error: (msg: string) => void;
};

export function productFormSignature(form: Partial<Prod>, images: string[], multi: boolean = false, vars: FormVariant[] = []) {
  return JSON.stringify({ form, images, multi, vars });
}

/**
 * Batas valid nilai kolom Urutan produk (cermin zod `sortOrder` di
 * `src/app/api/products/[id]/route.ts` + `src/app/api/products/route.ts`).
 */
export const SORT_ORDER_MIN = 0;
export const SORT_ORDER_MAX = 999999;

/** Normalisasi input Urutan: bulatkan, clamp ke 0-999999, NaN → null. */
export function normalizeSortOrder(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(SORT_ORDER_MIN, Math.min(SORT_ORDER_MAX, Math.floor(n)));
}

/**
 * Urutan GLOBAL produk untuk swap ↑↓: sama persis dengan `filtered` di bawah
 * (aktif dulu, ready dulu, lalu sortOrder, lalu id) — TANPA filter q/lowStock
 * dan TANPA potong halaman, sehingga tetangga yang ditukar adalah tetangga
 * sebenarnya di seluruh katalog, bukan tetangga satu halaman.
 */
export function globalProductOrder(list: Prod[]): Prod[] {
  return sortProductsForDisplay(list);
}

export function useProductManager(toast: AdminToast, onUnauthorized: () => void) {
  const [prods, setProds] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState("");
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Prod|null>(null);
  const [showNew, setShowNew] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<ProductForm>({});
  const [formImages, setFormImages] = useState<string[]>([]);
  const [hasMultiVariants, setHasMultiVariants] = useState(false);
  const [formVariants, setFormVariants] = useState<FormVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [productInitialSignature, setProductInitialSignature] = useState("");
  const [confirmProductClose, setConfirmProductClose] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Prod|null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toggling, setToggling] = useState<string | null>(null);

  // Edit angka Terjual inline dari kolom tabel: SET absolut via endpoint
  // khusus (tanpa buka modal). Optimistic + rollback, realtime tanpa reload.
  // Pembelian asli menambah via `sold_count += qty` di jalur order — angka
  // manual hanya jadi baseline baru, tidak merusak increment otomatis.
  const [savingSold, setSavingSold] = useState<string | null>(null);
  const saveSoldCount = useCallback(async (p: Prod, soldCount: number) => {
    if (savingSold) return;
    setSavingSold(p.id);
    const snapshot = prods;
    setProds((prev) => prev.map((x) => x.id === p.id ? { ...x, soldCount } : x));
    try {
      const r = await fetch(`/api/products/${p.id}/sold-count`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soldCount }),
      });
      const body = await r.json().catch(() => ({})) as { error?: string; soldCount?: number };
      if (r.status === 429) throw new Error("Terlalu cepat — tunggu sebentar, angka yang sudah tersimpan aman.");
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      if (typeof body.soldCount === "number") {
        setProds((prev) => prev.map((x) => x.id === p.id ? { ...x, soldCount: body.soldCount! } : x));
      }
      toast.success(`Terjual “${p.name}” menjadi ${body.soldCount ?? soldCount}.`);
    } catch (e) {
      setProds(snapshot);
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan angka Terjual");
    } finally {
      setSavingSold(null);
    }
  }, [prods, savingSold, toast]);

  const load = useCallback(async()=>{
    setLoadingList(true);
    setListError(null);
    try {
      const [pr, cr] = await Promise.all([
        fetch("/api/products").then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || `Produk ${r.status}`); return j; }),
        fetch("/api/categories?all=1", { cache: "no-store" }).then(async r=>{ const j=await r.json().catch(()=>({})); if(r.status===401){onUnauthorized();throw new Error("Sesi admin berakhir. Silakan login ulang.");} if(!r.ok)throw new Error(j.error||`Kategori ${r.status}`);return j; })
      ]);
      setProds(pr.products ?? []);
      setCats(cr.categories ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally {
      setLoadingList(false);
    }
  },[onUnauthorized]);

  const openEdit = async (p: Prod) => {
    const position = globalProductOrder(prods).findIndex((item) => item.id === p.id) + 1;
    // Modal dan tabel berbicara bahasa yang sama: posisi 1..N. Raw sort_order
    // tidak lagi diedit dari modal karena ia hanya kunci teknis server.
    // sortOrder produk existing sengaja dikosongkan dari form: payload edit
    // TIDAK membawa kunci posisi sehingga Simpan tidak pernah menggesernya
    // diam-diam (inkonsistensi modal-vs-tabel 2026-09-29).
    const { sortOrder: _ignoredSortOrder, ...positionless } = p;
    void _ignoredSortOrder;
    const nextForm: ProductForm = { ...positionless, sortOrder: undefined, categorySlug: p.categorySlug, displayPosition: Math.max(1, position) };
    const nextImages = p.images?.length ? p.images : p.image ? [p.image] : [];
    setEditing(p);
    setShowNew(false);
    setForm(nextForm);
    setFormImages(nextImages);
    setFormError(null);
    setLoadingVariants(true);

    try {
      // First check if GET /api/products/:id returned variants, otherwise fallback to /api/admin/variants
      let rawVars: FormVariant[] = [];
      const prodRes = await fetch(`/api/products/${p.id}`);
      if (prodRes.ok) {
        const prodData = (await prodRes.json().catch(() => ({}))) as {
          product?: { variants?: FormVariant[]; wrDescription?: string; adminDescriptionOverride?: string | null; wrManaged?: boolean; requireEmail?: boolean };
        };
        if (Array.isArray(prodData.product?.variants) && prodData.product.variants.length > 0) {
          rawVars = prodData.product.variants;
        }
        // Daftar produk mengirim deskripsi yang TAMPIL (override bila ada).
        // Editor harus memisahkan keduanya: teks WR di kolom Deskripsi,
        // teks admin di kolom override — kalau tidak, menyimpan ulang akan
        // menyalin override ke kolom milik WR.
        if (prodData.product) {
          nextForm.description = prodData.product.wrDescription ?? nextForm.description;
          nextForm.adminDescriptionOverride = prodData.product.adminDescriptionOverride ?? "";
          nextForm.wrManaged = Boolean(prodData.product.wrManaged);
          // Daftar produk tidak membawa require_email; tanpa baris ini
          // centang selalu tampil mati dan Simpan menulis 0 ke database.
          if (typeof prodData.product.requireEmail === "boolean") nextForm.requireEmail = prodData.product.requireEmail;
          setForm({ ...nextForm });
        }
      }

      if (rawVars.length === 0) {
        const res = await fetch(`/api/admin/variants?product_id=${p.id}`);
        const data = (await res.json().catch(() => ({}))) as { variants?: FormVariant[]; error?: string };
        // Kedua sumber varian boleh kosong (produk memang tanpa varian), tapi
        // sumber yang GAGAL bukan "kosong". Dulu respons non-OK jatuh diam ke
        // rawVars=[] sehingga produk multi-varian terbuka sebagai form kosong
        // tanpa satu pun pesan — admin mengira variannya hilang.
        if (!res.ok && !prodRes.ok) throw new Error(data.error || `Varian gagal dimuat (${res.status})`);
        rawVars = data.variants || [];
      }

      const isMulti = rawVars.length > 1 || (rawVars.length === 1 && !rawVars[0].sku.startsWith("DEFAULT-"));
      setHasMultiVariants(isMulti);
      const mapped = rawVars.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: v.label,
        price: v.price,
        comparePrice: v.comparePrice ?? (v as Record<string, unknown>).compare_price as number | null ?? null,
        stock: v.stock ?? -1,
        min_qty: Number((v as Record<string, unknown>).min_qty ?? 1) || 1,
        duration_value: v.duration_value,
        duration_unit: v.duration_unit,
        duration_label: v.duration_label,
        warranty_type: v.warranty_type,
        warranty_value: v.warranty_value,
        warranty_unit: v.warranty_unit,
        warranty_label: v.warranty_label,
        is_active: v.is_active ?? 1,
        // Cara pengiriman non-WR (milik admin; default manual agar
        // produk lama tanpa kolom ini tetap MBO, bukan instan).
        fulfillment_mode: String((v as Record<string, unknown>).fulfillment_mode ?? "manual"),
        wr_auto_managed: (v as Record<string, unknown>).wr_auto_managed as number | undefined,
      }));
      // Paritas single 2026-09-28: produk 1 varian DEFAULT dibuka sebagai mode
      // single — salin nilai variannya ke field form agar garansi/pengiriman/
      // min. beli tampil dan bisa diedit tanpa menyalakan toggle varian.
      if (!isMulti && mapped.length > 0) {
        const v0 = mapped[0];
        nextForm.min_qty = v0.min_qty ?? 1;
        nextForm.warranty_type = v0.warranty_type || "none";
        nextForm.warranty_value = v0.warranty_value ?? null;
        nextForm.warranty_unit = v0.warranty_unit || null;
        nextForm.warranty_label = v0.warranty_label ?? null;
        nextForm.fulfillment_mode = v0.fulfillment_mode || "manual";
        setForm({ ...nextForm });
      }
      setFormVariants(mapped);
      setProductInitialSignature(productFormSignature(nextForm, nextImages, isMulti, mapped));
    } catch (cause) {
      setHasMultiVariants(false);
      setFormVariants([]);
      setProductInitialSignature(productFormSignature(nextForm, nextImages, false, []));
      // Form kosong TANPA penjelasan adalah jebakan: admin bisa mengira
      // varian terhapus lalu menyimpan ulang di atas data yang belum termuat.
      const message = cause instanceof Error ? cause.message : "Varian produk gagal dimuat";
      setFormError(`${message}. Tutup editor dan coba lagi — jangan simpan sebelum varian tampil.`);
      toast.error(message);
    } finally {
      setLoadingVariants(false);
    }
  };

  // Toggle varian tunggal (migrasi varian generik): produk baru tanpa
  // varian mengembalikan varian bawaan DEFAULT.
  // Paritas single 2026-09-28: field single-mode diinisialisasi eksplisit
  // (garansi=none + manual, seperti varian DEFAULT otomatis server) agar
  // tampilan UI dan nilai tersimpan tidak pernah divergen.
  const openNew = () => {
    const ordered = globalProductOrder(prods);
    const maxSortOrder = ordered.reduce((max, product) => Math.max(max, Number(product.sortOrder ?? 0)), 0);
    // Hitung posisi tampilan dari ordered (bukan dari asumsi): produk baru
    // masuk paling belakang daftar tampil.
    const nextPosition = ordered.length + 1;
    const nextForm: ProductForm = {
      name: "",
      slug: "",
      whatsappAlias: "",
      description: "",
      price: 50000,
      categorySlug: "ai-chatbot",
      stock: 10,
      soldCount: 0,
      // Produk baru masuk akhir bucket aktif+ready tanpa menabrak key existing.
      sortOrder: Math.min(SORT_ORDER_MAX, maxSortOrder + 10),
      displayPosition: nextPosition,
      isActive: true,
      min_qty: 1,
      warranty_type: "none",
      warranty_value: null,
      warranty_unit: null,
      warranty_label: null,
      fulfillment_mode: "manual",
    };
    setShowNew(true);
    setEditing(null);
    setForm(nextForm);
    setFormImages([]);
    setHasMultiVariants(false);
    setFormVariants([]);
    setProductInitialSignature(productFormSignature(nextForm, [], false, []));
    setFormError(null);
  };

  const closeModal = () => {
    setEditing(null);
    setShowNew(false);
    setForm({});
    setFormImages([]);
    setHasMultiVariants(false);
    setFormVariants([]);
    setFormError(null);
    setSaving(false);
  };

  const handleUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const files=e.target.files; if(!files?.length) return;
    if(formImages.length + files.length > 8) { toast.error("Maks 8 foto per produk."); e.target.value=""; return; }
    const tooBig = Array.from(files).find(f=> f.size > 5*1024*1024);
    if (tooBig) { toast.error(`${tooBig.name} melebihi 5MB.`); e.target.value=""; return; }
    setUploading(true);
    const fd=new FormData(); (await Promise.all(Array.from(files).map(toWebp16x9))).forEach(f=>fd.append("files",f)); fd.append("area","products");
    try{
      const r=await fetch("/api/upload",{method:"POST",body:fd});
      const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.error || `Upload gagal (${r.status})`);
      if (!Array.isArray(j.urls) || j.urls.length===0) throw new Error("Upload tidak mengembalikan URL");
      setFormImages(prev=>[...prev, ...j.urls].slice(0,8));
      toast.success("Foto ditambahkan.");
    } catch(err:unknown){
      toast.error(err instanceof Error?err.message:String(err));
    } finally{ setUploading(false); e.target.value=""; }
  };

  const validateForm = (): string | null => {
    if (!form.name?.trim()) return "Nama produk wajib diisi.";
    if (!form.slug?.trim()) return "Slug wajib diisi.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) return "Slug hanya huruf kecil, angka, dan strip. Contoh: chatgpt-plus-1-bulan";

    if (hasMultiVariants) {
      if (formVariants.length === 0) return "Tambahkan minimal 1 varian atau matikan opsi varian.";
      const activeVars = formVariants.filter((v) => (v.is_active ?? 1) !== 0);
      if (form.isActive !== false && activeVars.length === 0) {
        return "Minimal 1 varian harus aktif.";
      }
      for (let i = 0; i < formVariants.length; i++) {
        const v = formVariants[i];
        if (!v.label.trim()) return `Nama varian ke-${i + 1} wajib diisi.`;
        if (v.price < 0 || Number.isNaN(Number(v.price))) return `Harga varian "${v.label}" tidak valid.`;
        if (v.comparePrice != null && Number(v.comparePrice) > 0 && Number(v.comparePrice) <= Number(v.price)) {
          return `Varian "${v.label}": harga coret harus lebih besar dari harga jual.`;
        }
      }
    } else {
      if (form.price == null || Number.isNaN(Number(form.price))) return "Harga wajib diisi.";
      if (Number(form.price) < 1000) return "Harga minimal Rp 1.000.";
      if (form.comparePrice != null && Number(form.comparePrice) !== 0 && Number(form.comparePrice) <= Number(form.price)) return "Harga coret harus lebih besar dari harga jual.";
      if (form.stock != null && Number(form.stock) < -1) return "Stok tidak valid.";
    }
    return null;
  };

  const save = async () => {
    const v = validateForm();
    if (v) { setFormError(v); toast.error(v); return; }
    setSaving(true);
    setFormError(null);

    // Paritas single 2026-09-28: mode single SELALU dikirim sebagai 1 varian
    // `Default` eksplisit. Sebelumnya `variants: undefined` sehingga server
    // membuat varian DEFAULT hardcoded (manual/none) dan garansi/pengiriman/
    // min.beli dari form single tidak pernah tersimpan.
    // id/sku/label lama HANYA dipakai ulang bila barisnya memang varian
    // DEFAULT-* (hasil openEdit produk single) agar update in-place, bukan
    // insert baru — stok fulfillment keyed by variant_id. Bila formVariants
    // berisi varian NON-default (mis. produk multi yang di-toggle OFF, atau
    // produk baru), kirim sebagai Default baru tanpa id: memakai id lama di
    // sini akan menimpa varian pertama + menonaktifkan sisanya via
    // `id NOT IN (...)` di server.
    const existingDefault = !hasMultiVariants && formVariants.length === 1 && formVariants[0].sku.startsWith("DEFAULT-")
      ? formVariants[0]
      : undefined;
    const singleDefaultVariant = !hasMultiVariants ? {
      id: existingDefault?.id,
      // Produk BARU / konversi dari multi wajib memakai prefix DEFAULT-
      // (bukan auto `${SLUG}-1` milik server) agar saat dibuka lagi
      // terdeteksi sebagai mode single
      // (openEdit: 1 varian + sku DEFAULT-* = single; sku lain = multi).
      // Slug sudah tervalidasi non-kosong sebelum save, jadi selalu ada.
      sku: existingDefault?.sku || `DEFAULT-${form.slug!.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30)}`,
      label: existingDefault?.label || "Default",
      price: Number(form.price || 0),
      comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
      stock: form.stock != null ? Number(form.stock) : -1,
      min_qty: Math.max(1, Math.min(100, Number(form.min_qty ?? 1) || 1)),
      // Durasi bukan field mode single (tidak ada UI-nya) — teruskan nilai
      // varian DEFAULT existing agar tidak ter-nol-kan saat update in-place.
      duration_value: existingDefault?.duration_value ?? null,
      duration_unit: existingDefault?.duration_unit ?? null,
      duration_label: existingDefault?.duration_label ?? null,
      warranty_type: form.warranty_type || "none",
      warranty_value: form.warranty_value ?? null,
      warranty_unit: form.warranty_unit || null,
      warranty_label: form.warranty_label?.trim() || null,
      fulfillment_mode: (["manual", "shared", "unique"] as const).includes(form.fulfillment_mode as "manual" | "shared" | "unique") ? (form.fulfillment_mode as "manual" | "shared" | "unique") : "manual",
      is_active: form.isActive !== false ? 1 : 0,
      sort_order: 0,
    } : null;

    const payload = {
      ...form,
      name: form.name!.trim(),
      slug: form.slug!.trim().toLowerCase(),
      description: (form.description ?? "").trim(),
      adminDescriptionOverride: form.wrManaged ? (form.adminDescriptionOverride ?? "").trim() : undefined,
      // Field milik WR tidak pernah dikirim ulang untuk produk auto-managed:
      // server menolaknya dengan 409 dan nilainya toh ditimpa sync berikutnya.
      wrManaged: undefined,
      // Field form khusus mode single: hanya kontrak UI, sumber kebenaran
      // adalah entries `variants` di bawah — jangan bocor ke top-level API.
      min_qty: undefined,
      warranty_type: undefined,
      warranty_value: undefined,
      warranty_unit: undefined,
      warranty_label: undefined,
      fulfillment_mode: undefined,
      // Hanya state presentasi modal, bukan kontrak API/kolom DB.
      displayPosition: undefined,
      // FIX Canva 409: mode MULTI jangan kirim kolom legacy sama sekali.
      // Server menghitung ulang master price/stock/compare dari varian aktif,
      // sehingga nilai pendamping (min price, -1, null) tak lagi dibaca
      // sebagai "edit legacy" yang memicu guard 409.
      // Mode SINGLE mengirim cerminan top-level (untuk master row saat POST;
      // saat PUT server mengabaikannya karena variants eksplisit dikirim —
      // guard 409 tidak terpicu karena ignoreLegacyCommerce=true).
      price: hasMultiVariants ? undefined : Number(form.price || 0),
      comparePrice: hasMultiVariants ? undefined : (form.comparePrice ? Number(form.comparePrice) : null),
      stock: hasMultiVariants ? undefined : (form.stock != null ? Number(form.stock) : -1),
      soldCount: form.soldCount ? Number(form.soldCount) : 0,
      // Posisi reorder kini milik endpoint /api/products/reorder — modal
      // hanya membaca displayPosition (read-only) dan TIDAK mengirim kunci
      // teknis. sortOrder form tetap dipakai saat Produk Baru (alokasi akhir)
      // lalu ikut payload sebagai penanda akhir, bukan edit posisi existing.
      sortOrder: editing ? undefined : normalizeSortOrder(form.sortOrder) ?? undefined,
      images: formImages,
      imageUrl: formImages[0] ?? form.image ?? null,
      isActive: form.isActive !== false,
      // Nilai belum termuat (detail gagal dibaca) = jangan kirim, supaya
      // server tidak menimpa require_email dengan 0.
      requireEmail: typeof form.requireEmail === "boolean" ? form.requireEmail : undefined,
      variants: hasMultiVariants
        ? formVariants.map((vr, idx) => ({
            id: vr.id,
            sku: vr.sku || `${form.slug!.trim().toUpperCase()}-${idx + 1}`,
            label: vr.label.trim(),
            price: Number(vr.price),
            comparePrice: vr.comparePrice ? Number(vr.comparePrice) : null,
            stock: vr.stock != null ? Number(vr.stock) : -1,
            min_qty: Math.max(1, Math.min(100, Number(vr.min_qty ?? 1) || 1)),
            duration_value: vr.duration_value,
            duration_unit: vr.duration_unit,
            duration_label: vr.duration_label,
            warranty_type: vr.warranty_type || "none",
            warranty_value: vr.warranty_value,
            warranty_unit: vr.warranty_unit,
            warranty_label: vr.warranty_label,
            // Cara pengiriman non-WR (milik admin — sync WR tidak menyentuh,
            // guard WR hanya menolak field miliknya bila produk auto-managed).
            fulfillment_mode: (["manual", "shared", "unique"] as const).includes(vr.fulfillment_mode as "manual" | "shared" | "unique") ? (vr.fulfillment_mode as "manual" | "shared" | "unique") : "manual",
            is_active: vr.is_active ?? 1,
            sort_order: idx,
          }))
        : (singleDefaultVariant ? [singleDefaultVariant] : undefined),
    };

    const url = editing ? `/api/products/${editing.id}` : "/api/products";
    const method = editing ? "PUT" : "POST";
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Guard kepemilikan WR membalas `{ error, field }`. Dulu `field`
        // dibuang, sehingga admin yang mengubah banyak field sekaligus hanya
        // melihat pesan generik dan harus coba-coba — sementara perubahan yang
        // SAH (foto/badge/harga coret) ikut hangus karena PUT gagal utuh.
        const field = typeof j.field === "string" ? j.field : "";
        const label = WR_FIELD_LABEL[field] ?? field;
        throw new Error(
          label
            ? `Field "${label}" tidak bisa diubah. ${j.error || ""}`.trim()
            : (j.error || `Gagal simpan (${r.status})`),
        );
      }
      toast.success(editing ? "Produk diperbarui." : "Produk dibuat.");
      await load(); closeModal();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal simpan";
      setFormError(msg);
      toast.error(msg);
    } finally { setSaving(false); }
  };

  const confirmDelete = async()=>{
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/products/${deleteTarget.id}`,{method:"DELETE"});
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || `Gagal hapus (${r.status})`);
      toast.success(`“${deleteTarget.name}” dinonaktifkan dan diarsipkan.`);
      setDeleteTarget(null);
      await load();
    } catch(e){
      toast.error(e instanceof Error ? e.message : "Gagal hapus");
    } finally { setDeleting(false); }
  };

  // Exact-one-step reorder + jump-to-position. Request DIANTREKAN berurutan
  // (bukan paralel): tiap request membaca urutan D1 hasil request sebelumnya,
  // sehingga klik cepat tidak berpacu dan toast 429 jujur ("kebanyakan —
  // tunggu sebentar") tanpa me-reset posisi yang sudah benar. Response
  // server memuat key final sehingga state realtime identik dengan D1
  // tanpa fetch ulang.
  const [reordering, setReordering] = useState<string | null>(null);
  const reorderQueue = useMemo(() => ({ tail: Promise.resolve() as Promise<void> }), []);
  const runReorder = useCallback(async (p: Prod, body: Record<string, unknown>, movedLabel: string) => {
    if (toggling) return;
    const run = reorderQueue.tail.then(async () => {
      const ordered = globalProductOrder(prods);
      const idx = ordered.findIndex((x) => x.id === p.id);
      if (idx < 0) return;
      setReordering(p.id);
      const snapshot = prods;
      try {
        const r = await fetch("/api/products/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await r.json().catch(() => ({})) as { error?: string; clamped?: boolean; products?: { id: number; sortOrder: number }[] };
        if (r.status === 429) throw new Error("Terlalu cepat — tunggu sebentar, posisi yang sudah tersimpan aman.");
        if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
        const finalOrder = new Map((payload.products ?? []).map((item) => [String(item.id), item.sortOrder]));
        setProds((prev) => prev.map((item) => finalOrder.has(item.id) ? { ...item, sortOrder: finalOrder.get(item.id)! } : item));
        toast.success(payload.clamped ? `“${p.name}” dijepit ke ujung kelompoknya.` : movedLabel);
      } catch (e) {
        setProds(snapshot);
        toast.error(e instanceof Error ? e.message : "Gagal memindah posisi produk");
      } finally {
        setReordering(null);
      }
    });
    // Antrean tidak boleh putus oleh satu kegagalan.
    reorderQueue.tail = run.catch(() => undefined);
    await reorderQueue.tail;
  }, [prods, toggling, toast, reorderQueue]);
  const moveProduct = (p: Prod, direction: -1 | 1) => {
    // Guard lokal cepat: tombol mati tidak mengirim request sama sekali.
    if (reordering || toggling) return;
    if (!adjacentReorderProduct(prods, p.id, direction)) return;
    void runReorder(p, { productId: Number(p.id), direction },
      direction < 0 ? `“${p.name}” naik satu posisi.` : `“${p.name}” turun satu posisi.`);
  };
  const jumpProduct = (p: Prod, targetPosition: number) => {
    if (reordering || toggling) return;
    const current = globalProductOrder(prods).findIndex((x) => x.id === p.id) + 1;
    if (current < 1 || current === targetPosition) return;
    void runReorder(p, { productId: Number(p.id), targetPosition }, `“${p.name}” pindah ke posisi ${targetPosition}.`);
  };

  const toggleActive = async (p: Prod) => {
    if (toggling) return;
    const next = !p.isActive;
    setToggling(p.id);
    const snapshot = prods;
    setProds(prev => prev.map(x => x.id === p.id ? { ...x, isActive: next } : x));
    try {
      const r = await fetch(`/api/products/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const body = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) throw new Error((body as { error?: string }).error || `HTTP ${r.status}`);
      await load();
      toast.success(next ? "Produk diaktifkan." : "Produk dinonaktifkan.");
    } catch (e) {
      setProds(snapshot);
      toast.error(e instanceof Error ? e.message : "Gagal update status aktif");
    } finally {
      setToggling(null);
    }
  };

  const activeProducts=prods.filter(p=>p.isActive).length;
  // Satuan "stok menipis" = VARIAN aktif berstok 0..5, sama persis dengan
  // kartu Ringkasan. Sebelumnya layar ini menghitung produk, sehingga satu
  // label menampilkan dua angka berbeda (66 di Ringkasan vs 33 di sini).
  const lowStock = prods.reduce((total, p) => total + (p.lowStockVariants ?? (p.stock >= 0 && p.stock <= 5 ? 1 : 0)), 0);
  const soldProducts=prods.reduce((total,product)=>total+product.soldCount,0);
  // Urutan daftar admin meniru storefront (page.tsx): ready dulu, habis
  // belakangan — plus nonaktif PALING belakang (storefront tak menampilkan
  // nonaktif sama sekali karena ?active=1, tapi admin perlu melihatnya).
  // Tanpa ini produk habis/nonaktif (Netflix, Capcut, Claude di screenshot
  // owner 2026-09-19) nangkring di atas dan produk ready tenggelam.
  const isOut = (p: Prod): boolean => p.stock != null && p.stock !== -1 && p.stock <= 0;
  // Filter "hanya stok menipis" dipicu dari kartu Ringkasan (?low_stock=1).
  // Tanpa ini kartu itu cuma memindah tab: daftar tetap menampilkan semua
  // produk dan admin harus mencari sendiri varian mana yang tipis.
  const filtered = useMemo(
    () => prods
      .filter(p=> {
        if (q && !`${p.name} ${p.slug} ${p.badge??""}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (onlyLowStock && !((p.lowStockVariants ?? (p.stock >= 0 && p.stock <= 5 ? 1 : 0)) > 0)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const byActive = Number(!a.isActive) - Number(!b.isActive);
        if (byActive !== 0) return byActive;
        const bySold = Number(isOut(a)) - Number(isOut(b));
        if (bySold !== 0) return bySold;
        const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (byOrder !== 0) return byOrder;
        return Number(a.id) - Number(b.id);
      }),
    [prods, q, onlyLowStock],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE_ADMIN));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage-1)*PER_PAGE_ADMIN, safePage*PER_PAGE_ADMIN);
  const productModalOpen = Boolean(editing || showNew);
  const productDirty = productModalOpen && productFormSignature(form, formImages, hasMultiVariants, formVariants) !== productInitialSignature;

  // Satu titik untuk permintaan tutup modal: jika ada perubahan belum tersimpan minta
  // konfirmasi, jika tidak langsung tutup. Sebelumnya logika ini digandakan di 4 tempat.
  const requestCloseProductModal = useCallback(() => {
    if (saving) return;
    if (productDirty) setConfirmProductClose(true);
    else closeModal();
  }, [saving, productDirty]);

  // Scroll lock + Escape untuk modal produk (perilaku identik dengan sebelumnya).
  useEffect(() => {
    if (!productModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        if (productDirty) setConfirmProductClose(true);
        else closeModal();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", onKeyDown); };
  }, [productModalOpen, productDirty, saving]);

  return {
    // data & daftar
    prods, cats, q, page, loadingList, listError, load,
    setQ, setPage, onlyLowStock, setOnlyLowStock,
    activeProducts, lowStock, soldProducts, filtered, paged, safePage, totalPages, perPage: PER_PAGE_ADMIN,
    // editor
    editing, showNew, uploading, form, formImages, hasMultiVariants, formVariants,
    loadingVariants, formError, saving, confirmProductClose, productDirty,
    setForm, setFormImages, setHasMultiVariants, setFormVariants, setConfirmProductClose,
    openEdit, openNew, closeModal, handleUpload, save, requestCloseProductModal,
    // hapus & toggle & urutan & terjual
    deleteTarget, deleting, toggling, reordering, savingSold, setDeleteTarget, confirmDelete, toggleActive, moveProduct, jumpProduct, saveSoldCount,
  };
}
