"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toWebp16x9 } from "@/components/admin/ImageDropzone";
import type { Prod, Cat, FormVariant, ProductForm } from "@/components/admin/product-types";

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
    const nextForm: ProductForm = { ...p, categorySlug: p.categorySlug };
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
          product?: { variants?: FormVariant[]; wrDescription?: string; adminDescriptionOverride?: string | null; wrManaged?: boolean };
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
  const openNew = () => {
    const nextForm = {
      name: "",
      slug: "",
      whatsappAlias: "",
      description: "",
      price: 50000,
      categorySlug: "akun-premium",
      stock: 10,
      soldCount: 0,
      isActive: true,
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

    const activeVarPrices = hasMultiVariants && formVariants.length > 0
      ? formVariants.filter((vr) => (vr.is_active ?? 1) !== 0).map((vr) => vr.price)
      : [];
    const minVarPrice = activeVarPrices.length > 0
      ? Math.min(...activeVarPrices)
      : Number(form.price || 0);

    const payload = {
      ...form,
      name: form.name!.trim(),
      slug: form.slug!.trim().toLowerCase(),
      description: (form.description ?? "").trim(),
      adminDescriptionOverride: form.wrManaged ? (form.adminDescriptionOverride ?? "").trim() : undefined,
      // Field milik WR tidak pernah dikirim ulang untuk produk auto-managed:
      // server menolaknya dengan 409 dan nilainya toh ditimpa sync berikutnya.
      wrManaged: undefined,
      // FIX Canva 409: mode varian jangan kirim kolom legacy sama sekali.
      // Server menghitung ulang master price/stock/compare dari varian aktif,
      // sehingga nilai pendamping (min price, -1, null) tak lagi dibaca
      // sebagai "edit legacy" yang memicu guard 409.
      price: hasMultiVariants ? undefined : minVarPrice,
      comparePrice: hasMultiVariants ? undefined : (form.comparePrice ? Number(form.comparePrice) : null),
      stock: hasMultiVariants ? undefined : (form.stock != null ? Number(form.stock) : -1),
      soldCount: form.soldCount ? Number(form.soldCount) : 0,
      sortOrder: 0,
      images: formImages,
      imageUrl: formImages[0] ?? form.image ?? null,
      isActive: form.isActive !== false,
      requireEmail: form.requireEmail === true,
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
        : undefined,
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
    // hapus & toggle
    deleteTarget, deleting, toggling, setDeleteTarget, confirmDelete, toggleActive,
  };
}
