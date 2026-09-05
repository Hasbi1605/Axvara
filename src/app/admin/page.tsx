"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";
import { AdminShell, type AdminSection } from "@/components/admin/AdminShell";
import { AgentIntegration } from "@/components/admin/AgentIntegration";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ArticlesManager } from "@/components/admin/ArticlesManager";
import { toWebp16x9 } from "@/components/admin/ImageDropzone";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { BannerManager } from "@/components/admin/BannerManager";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";
import { IosIcon } from "@/components/ui/IosIcon";
import { NewsletterSubscribers } from "@/components/admin/NewsletterSubscribers";
import BotAutomationManager from "@/components/admin/BotAutomationManager";
import VariantEditor from "@/components/admin/VariantEditor";
import { AdminOverview, EMPTY_ADMIN_OVERVIEW, type AdminOverviewData } from "@/components/admin/AdminOverview";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { StoreSettingsManager } from "@/components/admin/StoreSettingsManager";

type Prod = { id:string; slug:string; name:string; whatsappAlias?:string; description:string; price:number; minPrice?:number; maxPrice?:number; variantCount?:number; comparePrice?:number; categorySlug:string; image:string; images:string[]; badge?:string; soldCount:number; stock:number; isActive:boolean; sortOrder?:number };
type Cat = { id:number; slug:string; name:string };
type FormVariant = {
  id?: number;
  sku: string;
  label: string;
  price: number;
  comparePrice?: number | null;
  stock: number;
  duration_value?: number | null;
  duration_unit?: string | null;
  duration_label?: string | null;
  warranty_type?: string;
  warranty_value?: number | null;
  warranty_unit?: string | null;
  warranty_label?: string | null;
  is_active: number;
};

const PER_PAGE_ADMIN = 8;
const ADMIN_SECTIONS: AdminSection[] = ["summary","products","orders","categories","payments","articles","banners","subscribers","bot","agent","settings"];

type LoginChallenge = {
  mode: "password" | "pbkdf2-proof";
  algorithm?: "PBKDF2-SHA-256";
  iterations?: number;
  salt?: string;
  challenge?: string;
};

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function productFormSignature(form: Partial<Prod>, images: string[], multi: boolean = false, vars: FormVariant[] = []) {
  return JSON.stringify({ form, images, multi, vars });
}

async function makePasswordProof(password: string, config: LoginChallenge): Promise<string> {
  if (config.mode !== "pbkdf2-proof" || !config.salt || !config.iterations || !config.challenge) throw new Error("Konfigurasi login tidak lengkap.");
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(config.salt), iterations: config.iterations, hash: "SHA-256" }, passwordKey, 256));
  const hmacKey = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexFromBytes(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(config.challenge))));
}

export default function AdminPage() {
  const toast = useToast();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [tab, setTab] = useState<AdminSection>("summary");
  const [prods, setProds] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [overview, setOverview] = useState<AdminOverviewData>(EMPTY_ADMIN_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Prod|null>(null);
  const [showNew, setShowNew] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<Partial<Prod> & { comparePrice?:number; categorySlug?:string }>({});
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
  const [variantEditorProduct, setVariantEditorProduct] = useState<{ id: number; name: string } | null>(null);

  useEffect(()=>{
    const syncSection=()=>{
      const section=new URLSearchParams(window.location.search).get("section") as AdminSection|null;
      if(section&&ADMIN_SECTIONS.includes(section))setTab(section);
    };
    syncSection();
    window.addEventListener("popstate",syncSection);
    return()=>window.removeEventListener("popstate",syncSection);
  },[]);

  const loadOverview = useCallback(async()=>{
    setOverviewLoading(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const data = await response.json().catch(()=>({})) as Partial<AdminOverviewData> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal memuat ringkasan");
      setOverview({ ...EMPTY_ADMIN_OVERVIEW, ...data, channels: { ...EMPTY_ADMIN_OVERVIEW.channels, ...data.channels }, systems: { ...EMPTY_ADMIN_OVERVIEW.systems, ...data.systems } });
    } catch { /* Ringkasan gagal tidak memblokir menu operasional lain. */ }
    finally { setOverviewLoading(false); }
  }, []);

  const navigateAdmin = useCallback((section: AdminSection, params: Record<string,string> = {}) => {
    setTab(section);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("section", section);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams}`);
  }, []);

  const load = useCallback(async()=>{
    setLoadingList(true);
    setListError(null);
    try {
      const [pr, cr] = await Promise.all([
        fetch("/api/products").then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || `Produk ${r.status}`); return j; }),
        fetch("/api/categories?all=1", { cache: "no-store" }).then(async r=>{ const j=await r.json().catch(()=>({})); if(r.status===401){setAuthed(false);throw new Error("Sesi admin berakhir. Silakan login ulang.");} if(!r.ok)throw new Error(j.error||`Kategori ${r.status}`);return j; })
      ]);
      setProds(pr.products ?? []);
      setCats(cr.categories ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally {
      setLoadingList(false);
    }
  },[]);

  const checkAuth = useCallback(async()=>{
    setCheckingAuth(true);
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j.authed) { setAuthed(true); setAuthEmail(j.email || ""); }
      else {
        setAuthed(false);
        if (j.reason === "idle_timeout") toast.error("Sesi habis karena 2 jam tidak aktif. Silakan login ulang.");
        else if (r.status === 401) { /* absolute 8h or not authed — stay on login */ }
      }
    } catch { setAuthed(false); }
    finally { setCheckingAuth(false); }
  },[toast]);

  useEffect(()=>{ checkAuth(); },[checkAuth]);
  useEffect(()=>{ if(authed) { void load(); void loadOverview(); } },[authed, load, loadOverview]);

  // Heartbeat: refresh idle window tiap 90 detik saat tab aktif (sliding 2h)
  useEffect(()=>{
    if(!authed) return;
    const tick = async()=>{
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/auth/refresh", { method:"POST", cache:"no-store" });
        if (r.status === 401) { setAuthed(false); toast.error("Sesi habis. Silakan login ulang."); }
      } catch {}
    };
    const id = window.setInterval(tick, 90_000);
    const onVis = ()=> { if(document.visibilityState==="visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return ()=> { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  },[authed,toast]);

  // Juga cek saat window focus (user kembali setelah lama)
  useEffect(()=>{
    if(!authed) return;
    const onFocus = async()=>{
      try {
        const r = await fetch("/api/auth/me", { cache:"no-store" });
        if (r.status === 401) { setAuthed(false); }
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return ()=> window.removeEventListener("focus", onFocus);
  },[authed]);

  const login = async()=>{
    setLoginError(null);
    if (!email.trim() || !pass) { setLoginError("Email dan password wajib diisi."); return; }
    setLoginLoading(true);
    try {
      const challengeResponse = await fetch("/api/auth/login", { cache: "no-store" });
      const challenge = await challengeResponse.json().catch(()=>({})) as LoginChallenge & { error?: string };
      if (!challengeResponse.ok) throw new Error(challenge.error || "Layanan login sedang tidak siap.");
      const body = challenge.mode === "pbkdf2-proof"
        ? { email: email.trim(), password_proof: await makePasswordProof(pass, challenge), challenge: challenge.challenge }
        : { email: email.trim(), password: pass };
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || "Gagal masuk");
      setAuthed(true);
      setAuthEmail(j.email || email.trim());
      setPass("");
      toast.success("Berhasil masuk.");
      await Promise.all([load(), loadOverview()]);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Gagal masuk");
    } finally { setLoginLoading(false); }
  };

  const openEdit = async (p: Prod) => {
    const nextForm = { ...p, categorySlug: p.categorySlug };
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
        const prodData = (await prodRes.json().catch(() => ({}))) as { product?: { variants?: FormVariant[] } };
        if (Array.isArray(prodData.product?.variants) && prodData.product.variants.length > 0) {
          rawVars = prodData.product.variants;
        }
      }

      if (rawVars.length === 0) {
        const res = await fetch(`/api/admin/variants?product_id=${p.id}`);
        const data = (await res.json().catch(() => ({}))) as { variants?: FormVariant[] };
        rawVars = data.variants || [];
      }

      const isMulti = rawVars.length > 1 || (rawVars.length === 1 && !rawVars[0].sku.startsWith("DEFAULT-"));
      setHasMultiVariants(isMulti);
      const mapped = rawVars.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: v.label,
        price: v.price,
        comparePrice: v.comparePrice ?? null,
        stock: v.stock ?? -1,
        duration_value: v.duration_value,
        duration_unit: v.duration_unit,
        duration_label: v.duration_label,
        warranty_type: v.warranty_type,
        warranty_value: v.warranty_value,
        warranty_unit: v.warranty_unit,
        warranty_label: v.warranty_label,
        is_active: v.is_active ?? 1,
      }));
      setFormVariants(mapped);
      setProductInitialSignature(productFormSignature(nextForm, nextImages, isMulti, mapped));
    } catch {
      setHasMultiVariants(false);
      setFormVariants([]);
      setProductInitialSignature(productFormSignature(nextForm, nextImages, false, []));
    } finally {
      setLoadingVariants(false);
    }
  };

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

    const minVarPrice = hasMultiVariants && formVariants.length > 0
      ? Math.min(...formVariants.filter((vr) => (vr.is_active ?? 1) !== 0).map((vr) => vr.price))
      : Number(form.price || 0);

    const payload = {
      ...form,
      name: form.name!.trim(),
      slug: form.slug!.trim().toLowerCase(),
      description: (form.description ?? "").trim(),
      price: minVarPrice,
      comparePrice: hasMultiVariants ? null : (form.comparePrice ? Number(form.comparePrice) : null),
      stock: hasMultiVariants ? -1 : (form.stock != null ? Number(form.stock) : -1),
      soldCount: form.soldCount ? Number(form.soldCount) : 0,
      sortOrder: 0,
      images: formImages,
      imageUrl: formImages[0] ?? form.image ?? null,
      isActive: form.isActive !== false,
      variants: hasMultiVariants
        ? formVariants.map((vr, idx) => ({
            id: vr.id,
            sku: vr.sku || `${form.slug!.trim().toUpperCase()}-${idx + 1}`,
            label: vr.label.trim(),
            price: Number(vr.price),
            comparePrice: vr.comparePrice ? Number(vr.comparePrice) : null,
            stock: vr.stock != null ? Number(vr.stock) : -1,
            duration_value: vr.duration_value,
            duration_unit: vr.duration_unit,
            duration_label: vr.duration_label,
            warranty_type: vr.warranty_type || "none",
            warranty_value: vr.warranty_value,
            warranty_unit: vr.warranty_unit,
            warranty_label: vr.warranty_label,
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
      if (!r.ok) throw new Error(j.error || `Gagal simpan (${r.status})`);
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
  const lowStock=prods.filter(p=>p.stock>=0&&p.stock<=5).length;
  const soldProducts=prods.reduce((total,product)=>total+product.soldCount,0);
  const filtered = useMemo(()=> prods.filter(p=> !q || `${p.name} ${p.slug} ${p.badge??""}`.toLowerCase().includes(q.toLowerCase())), [prods, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE_ADMIN));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage-1)*PER_PAGE_ADMIN, safePage*PER_PAGE_ADMIN);
  const productModalOpen = Boolean(editing || showNew);
  const productDirty = productModalOpen && productFormSignature(form, formImages, hasMultiVariants, formVariants) !== productInitialSignature;

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

  if(checkingAuth) return (
    <div className="mx-auto max-w-[420px] px-4 py-16">
      <div className="ax-glass rounded-[24px] p-8 flex flex-col items-center gap-4">
        <Spinner size={28} />
        <p className="text-sm text-white/60">Memeriksa sesi admin…</p>
      </div>
    </div>
  );

  if(!authed) return (
    <div className="mx-auto max-w-[420px] px-4 py-10 sm:py-16">
      <div className="ax-glass rounded-[24px] p-6">
        <Link href="/" className="flex items-center gap-2 text-white/70 text-sm"><span className="w-6 h-5 text-white flex items-center justify-center"><svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"><path d="M60 4 L6.5 104 L113.5 104 Z"/><path d="M60 4 L60 49.5"/><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z"/><path d="M35.8 78.5 L84.2 78.5"/><path d="M35.8 78.5 L6.5 104"/><path d="M84.2 78.5 L113.5 104"/></svg></span> AXVARA Admin</Link>
        <h1 className="font-display font-bold text-white text-xl mt-3">Masuk Panel Admin</h1>
        <p className="text-xs text-white/50 mt-1">Otentikasi diperlukan untuk mengelola katalog & pesanan.</p>
        <div className="mt-5 space-y-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/60">Email</span><input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=> e.key==="Enter" && login()} placeholder="admin@axvara.tech" autoComplete="username" className="w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/60">Password</span><input value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=> e.key==="Enter" && login()} type="password" placeholder="••••••••" autoComplete="current-password" className="w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" /></label>
          {loginError && <p className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-300">{loginError}</p>}
          <button onClick={login} disabled={loginLoading} className="w-full h-11 rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold hover:bg-[#00D0E8] transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {loginLoading && <Spinner size={16} className="border-[#080C1E]/20 border-t-[#080C1E]" />} {loginLoading ? "Memproses…" : "Masuk"}
          </button>
          <p className="text-[11px] text-white/25 text-center">Akses terbatas — hanya akun terotorisasi.</p>
        </div>
      </div>
    </div>
  );

  return (
    <AdminShell section={tab} onSection={(section)=>navigateAdmin(section)} badges={{ orders: overview.pending_orders, payments: overview.payment_attention, bot: overview.fulfillment_attention }}>
      <div className="mt-4 flex items-center gap-2 text-[11px] text-white/35">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Masuk sebagai <span className="text-white/60">{authEmail || "admin"}</span> <span className="opacity-40">·</span> maks. 8 jam <span className="opacity-40">·</span> idle 2 jam
      </div>

      {tab==="products" && <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total produk</p><p className="text-2xl font-display font-bold text-white">{prods.length}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Produk aktif</p><p className="text-2xl font-display font-bold text-[#22C55E]">{activeProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Stok menipis</p><p className="text-2xl font-display font-bold text-[#FFB800]">{lowStock}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Unit terjual</p><p className="text-2xl font-display font-bold text-white">{soldProducts}</p></div>
      </div>}

      {listError && <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"><span>{listError}</span><button onClick={load} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">Coba lagi</button></div>}

      {tab==="summary" && <AdminOverview data={overview} loading={overviewLoading} onNavigate={navigateAdmin} />}
      {tab==="orders" && <OrdersManager onChanged={loadOverview} />}
      {tab==="categories" && <CategoryManager />}
      {tab==="payments" && <PaymentMethodsManager />}
      {tab==="agent" && <AgentIntegration />}
      {tab==="bot" && <BotAutomationManager />}
      {tab==="settings" && <StoreSettingsManager />}

      {tab==="products" && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-[420px]">
              <div className="relative flex-1">
                <input value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} placeholder="Cari produk, slug, badge..." className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70"><IosIcon name="search" size={16} tint="white" /></span>
              </div>
            </div>
            <button onClick={openNew} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition"><IosIcon name="plus" size={14} tint="black" /> Produk Baru</button>
          </div>

          <div className="mt-4 ax-glass rounded-[20px] overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-white/60"><Spinner size={24} /><span className="text-sm">Memuat produk…</span></div>
            ) : (<>
            <div className="divide-y divide-white/[0.06] md:hidden">
              {paged.map(p=><article key={p.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="h-14 w-14 shrink-0 rounded-xl bg-white/5 object-cover" />
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{p.name}</p><p className="mt-0.5 truncate text-[11px] text-white/35">{p.categorySlug} · {p.variantCount ? `${p.variantCount} varian` : "produk"}</p></div><button type="button" aria-pressed={p.isActive} aria-label={`Toggle aktif ${p.name}`} disabled={toggling === p.id} onClick={() => toggleActive(p)} className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 items-center rounded-full border px-[2px] ${p.isActive ? "border-emerald-600 bg-emerald-500" : "border-white/20 bg-white/15"}`}><span className={`h-[18px] w-[18px] rounded-full bg-white transition-transform ${p.isActive ? "translate-x-[20px]" : "translate-x-0"}`} /></button></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-white">{p.minPrice != null && p.maxPrice != null && p.minPrice !== p.maxPrice ? `${formatRupiah(p.minPrice)}–${formatRupiah(p.maxPrice)}` : formatRupiah(p.price)}</span><span className="rounded-full bg-white/[0.07] px-2 py-1 text-white/50">Stok {p.stock === -1 ? "∞" : p.stock}</span><span className="text-white/35">{p.soldCount} terjual</span></div></div>
                </div>
                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><button onClick={()=>openEdit(p)} className="h-9 rounded-xl bg-white text-xs font-bold text-[#080C1E]">Edit Produk & Varian</button><button onClick={()=>setDeleteTarget(p)} className="flex h-9 w-10 items-center justify-center rounded-xl bg-red-500/15" aria-label={`Arsipkan ${p.name}`}><IosIcon name="trash" size={14} tint="white" /></button></div>
              </article>)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="text-[11px] tracking-[0.08em] text-white/40 uppercase border-b border-white/10">
                  <tr><th className="text-left font-semibold px-4 py-3">Produk</th><th className="text-left font-semibold px-3 py-3">Kategori</th><th className="text-right font-semibold px-3 py-3">Harga</th><th className="text-center font-semibold px-3 py-3">Stok</th><th className="text-center font-semibold px-3 py-3">Terjual</th><th className="text-center font-semibold px-3 py-3">Aktif</th><th className="text-right font-semibold px-4 py-3">Aksi</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paged.map(p=>(
                    <tr key={p.id} className="hover:bg-white/[0.03] transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.image || "/brand/axvara-ribbon-mark.png"} alt="" className="w-12 h-12 rounded-xl object-cover bg-white/5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-white leading-tight line-clamp-1">{p.name}</p>
                            <p className="text-xs text-white/40 line-clamp-1">/{p.slug} {p.badge? `• ${p.badge}`:""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-white/60">{p.categorySlug}</td>
                      <td className="px-3 py-3 text-right"><span className="font-semibold text-white">{formatRupiah(p.price)}</span>{p.comparePrice? <span className="block text-[11px] text-white/30 line-through">{formatRupiah(p.comparePrice)}</span>:null}</td>
                      <td className="px-3 py-3 text-center"><span className={`inline-flex min-w-[40px] justify-center px-2 py-1 rounded-full text-xs font-bold ${p.stock<=5 && p.stock!==-1 ? "bg-[#FFB800]/15 text-[#FFB800]":"bg-white/10 text-white/70"}`}>{p.stock===-1?"∞":p.stock}</span></td>
                      <td className="px-3 py-3 text-center text-xs text-white/60">{p.soldCount}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          type="button"
                          aria-pressed={p.isActive}
                          aria-label={`Toggle aktif ${p.name}`}
                          disabled={toggling === p.id}
                          onClick={() => toggleActive(p)}
                          title={p.isActive ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"}
                          className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 cursor-pointer items-center rounded-full border px-[2px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/50 disabled:opacity-50 disabled:cursor-wait ${p.isActive ? "bg-[#22C55E] border-[#16a34a] shadow-[0_0_14px_rgba(34,197,94,0.45)]" : "bg-white/20 border-white/25"}`}
                        >
                          <span className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform duration-200 ${p.isActive ? "translate-x-[20px]" : "translate-x-0"}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={()=>openEdit(p)} className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90 shadow-sm"><IosIcon name="edit" size={12} tint="black" /> Edit Produk & Varian</button>
                          <button onClick={()=>setDeleteTarget(p)} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition" aria-label={`Hapus ${p.name}`} title="Hapus produk"><IosIcon name="trash" size={16} tint="white" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length===0 && <p className="p-8 text-center text-sm text-white/40">Tidak ada produk — coba ubah kata kunci.</p>}
            </>)}
            {filtered.length > PER_PAGE_ADMIN && !loadingList && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
                <p className="text-xs text-white/40">Hal {safePage} dari {totalPages} • {filtered.length} produk</p>
                <div className="flex items-center gap-1.5">
                  <button disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"><IosIcon name="chevron-left" size={12} tint="white" /> Sebelumnya</button>
                  <span className="text-xs text-white/40 px-1">{safePage} / {totalPages}</span>
                  <button disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">Berikutnya <IosIcon name="chevron-right" size={12} tint="white" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==="articles" && <ArticlesManager />}

      {tab==="banners" && <BannerManager />}

      {tab==="subscribers" && <NewsletterSubscribers />}

      {(editing || showNew) && (
        <div className="fixed inset-0 z-[80] isolate flex items-end justify-center overflow-hidden bg-[#040612]/95 p-0 sm:items-start sm:overflow-y-auto sm:p-5 sm:pt-10" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving){if(productDirty)setConfirmProductClose(true);else closeModal();}}}>
          <section role="dialog" aria-modal="true" aria-labelledby="product-editor-title" className="relative z-10 isolate max-h-[94dvh] w-full max-w-[720px] overflow-y-auto rounded-t-[26px] border border-white/10 bg-[#0B1025] p-5 shadow-[0_28px_90px_rgba(0,0,0,0.85)] sm:max-h-[92vh] sm:rounded-[26px] sm:p-6">
            <div className="flex items-center justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#00E5FF]">Katalog</p><h3 id="product-editor-title" className="mt-1 font-display text-lg font-bold text-white">{editing? "Edit Produk":"Produk Baru"}</h3></div>
              <button onClick={()=>{if(productDirty)setConfirmProductClose(true);else closeModal();}} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/15" aria-label="Tutup editor produk"><IosIcon name="close" size={14} tint="white" /></button>
            </div>

            {formError && <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-200">{formError}</p>}

            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Nama *</span><input value={form.name??""} onChange={e=>setForm({...form,name:e.target.value, slug: !editing? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""): form.slug})} placeholder="ChatGPT Plus 1 Bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Slug *</span><input value={form.slug??""} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})} placeholder="chatgpt-plus-1-bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="text-xs font-semibold text-white/60">Nama di WhatsApp (Alias)</span><input value={form.whatsappAlias??""} onChange={e=>setForm({...form,whatsappAlias:e.target.value})} maxLength={50} placeholder="CHATGPT" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /><span className="block text-[11px] leading-4 text-white/35">Dipakai pada daftar dan header detail produk WhatsApp. Jika kosong, bot memakai nama produk web.</span></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="text-xs font-semibold text-white/60">Deskripsi</span><textarea value={form.description??""} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Akses GPT-4o penuh..." className="w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Kategori</span><select value={form.categorySlug??cats[0]?.slug??""} onChange={e=>setForm({...form,categorySlug:e.target.value})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30">
                {cats.map((category) => <option key={category.id} value={category.slug} className="bg-[#0F1430]">{category.name}</option>)}
              </select></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Badge</span><input value={form.badge??""} onChange={e=>setForm({...form,badge:e.target.value})} placeholder="Terlaris / Baru / Hemat 92%" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
            </div>

            {/* Toggle Multi-Varian ala Marketplace */}
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-white">Variasi Produk</h4>
                  <p className="text-xs text-white/45">Aktifkan jika produk memiliki beberapa pilihan durasi, akun, atau paket harga.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !hasMultiVariants;
                    setHasMultiVariants(next);
                    if (next && formVariants.length === 0) {
                      setFormVariants([
                        {
                          sku: `${(form.slug || "PROD").toUpperCase()}-1`,
                          label: "1 Bulan",
                          price: form.price ? Number(form.price) : 50000,
                          comparePrice: form.comparePrice ? Number(form.comparePrice) : null,
                          stock: form.stock != null ? Number(form.stock) : -1,
                          duration_value: 1,
                          duration_unit: "month",
                          warranty_type: "full",
                          is_active: 1,
                        },
                      ]);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${hasMultiVariants ? "bg-[#00E5FF]" : "bg-white/20"}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#080C1E] shadow ring-0 transition duration-200 ease-in-out ${hasMultiVariants ? "translate-x-5" : "translate-x-0 bg-white"}`} />
                </button>
              </div>

              {loadingVariants ? (
                <div className="py-6 text-center text-xs text-white/40">Memuat rincian varian...</div>
              ) : hasMultiVariants ? (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#00E5FF]">Daftar Pilihan Paket / Varian</span>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = formVariants.length + 1;
                        setFormVariants((curr) => [
                          ...curr,
                          {
                            sku: `${(form.slug || "PROD").toUpperCase()}-${idx}`,
                            label: `Paket ${idx}`,
                            price: 50000,
                            comparePrice: null,
                            stock: -1,
                            warranty_type: "none",
                            is_active: 1,
                          },
                        ]);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#00E5FF] hover:underline"
                    >
                      <IosIcon name="plus" size={12} tint="#00E5FF" /> Tambah Varian
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {formVariants.map((v, idx) => (
                      <div key={v.id || idx} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5 transition hover:border-white/20">
                        <div className="grid sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] gap-2.5 items-center">
                          <div>
                            <span className="block text-[10px] uppercase font-semibold text-white/40">Nama Varian *</span>
                            <input
                              value={v.label}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, label: val } : item));
                              }}
                              placeholder="misal: 1 Bulan Private"
                              className="mt-1 h-9 w-full rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/40 focus:outline-none"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-semibold text-white/40">Harga Jual (Rp) *</span>
                            <MoneyInput
                              value={v.price}
                              onChange={(val) => {
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, price: val ?? 0 } : item));
                              }}
                              className="mt-1 h-9 w-full rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-xs text-white focus:border-[#00E5FF]/40 focus:outline-none"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-semibold text-white/40">Harga Coret (Rp)</span>
                            <MoneyInput
                              value={v.comparePrice}
                              allowEmpty
                              onChange={(val) => {
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, comparePrice: val } : item));
                              }}
                              placeholder="Opsional"
                              className="mt-1 h-9 w-full rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/40 focus:outline-none"
                            />
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-semibold text-white/40">Stok (-1 = ∞)</span>
                            <input
                              type="number"
                              min={-1}
                              value={v.stock}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, stock: val } : item));
                              }}
                              className="mt-1 h-9 w-full rounded-lg bg-white/[0.06] border border-white/10 px-2.5 text-xs text-white focus:border-[#00E5FF]/40 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-1 pt-4 sm:pt-3">
                            <button
                              type="button"
                              onClick={() => {
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, is_active: item.is_active ? 0 : 1 } : item));
                              }}
                              title={v.is_active ? "Aktif" : "Nonaktif"}
                              className={`h-7 px-2 rounded-lg text-[10px] font-semibold transition ${v.is_active ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-white/5 text-white/40 border border-white/10"}`}
                            >
                              {v.is_active ? "Aktif" : "Mati"}
                            </button>
                            {formVariants.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFormVariants((curr) => curr.filter((_, i) => i !== idx));
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                                title="Hapus varian"
                              >
                                <IosIcon name="trash" size={12} tint="#f87171" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Pengaturan Garansi & Durasi Ringkas per Varian */}
                        <div className="mt-2.5 pt-2.5 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-white/40 font-medium shrink-0">🛡 Garansi:</span>
                            <select
                              value={v.warranty_type || "full"}
                              onChange={(e) => {
                                const wType = e.target.value;
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? {
                                  ...item,
                                  warranty_type: wType,
                                  warranty_value: wType === "limited" ? (item.warranty_value || 7) : (item.warranty_value || 1),
                                  warranty_unit: item.warranty_unit || "month",
                                } : item));
                              }}
                              className="h-7 rounded-md bg-white/[0.06] border border-white/10 px-2 text-white/80 text-[11px] focus:outline-none focus:border-[#00E5FF]/40"
                            >
                              <option value="full" className="bg-[#0F1430]">Full Garansi</option>
                              <option value="limited" className="bg-[#0F1430]">Garansi Terbatas</option>
                              <option value="none" className="bg-[#0F1430]">Tanpa Garansi</option>
                              <option value="custom" className="bg-[#0F1430]">Teks Khusus</option>
                            </select>

                            {(v.warranty_type === "full" || v.warranty_type === "limited") && (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  value={v.warranty_value ?? 1}
                                  onChange={(e) => {
                                    const val = Math.max(1, Number(e.target.value));
                                    setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_value: val } : item));
                                  }}
                                  className="h-7 w-12 rounded-md bg-white/[0.06] border border-white/10 px-1.5 text-white text-[11px] text-center focus:outline-none focus:border-[#00E5FF]/40"
                                />
                                <select
                                  value={v.warranty_unit || "month"}
                                  onChange={(e) => {
                                    const unit = e.target.value;
                                    setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_unit: unit } : item));
                                  }}
                                  className="h-7 rounded-md bg-white/[0.06] border border-white/10 px-1.5 text-white/80 text-[11px] focus:outline-none focus:border-[#00E5FF]/40"
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
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, warranty_label: val } : item));
                                }}
                                placeholder="mis: 7 Hari Ganti Baru"
                                className="h-7 w-32 rounded-md bg-white/[0.06] border border-white/10 px-2 text-white text-[11px] placeholder:text-white/20 focus:outline-none"
                              />
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 sm:justify-end flex-wrap">
                            <span className="text-white/40 font-medium shrink-0">⏱ Durasi:</span>
                            {v.duration_unit !== "lifetime" && v.duration_unit !== "custom" && (
                              <input
                                type="number"
                                min={1}
                                value={v.duration_value ?? 1}
                                onChange={(e) => {
                                  const val = Math.max(1, Number(e.target.value));
                                  setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, duration_value: val } : item));
                                }}
                                className="h-7 w-12 rounded-md bg-white/[0.06] border border-white/10 px-1.5 text-white text-[11px] text-center focus:outline-none focus:border-[#00E5FF]/40"
                              />
                            )}
                            <select
                              value={v.duration_unit || "month"}
                              onChange={(e) => {
                                const dUnit = e.target.value;
                                setFormVariants((curr) => curr.map((item, i) => i === idx ? { ...item, duration_unit: dUnit } : item));
                              }}
                              className="h-7 rounded-md bg-white/[0.06] border border-white/10 px-2 text-white/80 text-[11px] focus:outline-none focus:border-[#00E5FF]/40"
                            >
                              <option value="month" className="bg-[#0F1430]">Bulan</option>
                              <option value="day" className="bg-[#0F1430]">Hari</option>
                              <option value="year" className="bg-[#0F1430]">Tahun</option>
                              <option value="lifetime" className="bg-[#0F1430]">Selamanya / Lifetime</option>
                              <option value="custom" className="bg-[#0F1430]">Teks Khusus</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
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
              ) : (
                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-xs font-semibold text-white/60">Harga Jual *</span>
                    <MoneyInput
                      value={form.price}
                      onChange={(val) => setForm({ ...form, price: val ?? 0 })}
                      placeholder="89000"
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white/60">Harga Coret</span>
                    <MoneyInput
                      value={form.comparePrice}
                      allowEmpty
                      onChange={(val) => setForm({ ...form, comparePrice: val ?? undefined })}
                      placeholder="300000"
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white/60">Stok (-1 = ∞)</span>
                    <input
                      type="number"
                      value={form.stock ?? -1}
                      onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
                      className="mt-1 h-10 w-full px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4 rounded accent-[#00E5FF]" />
                <span className="text-sm text-white/80">Aktif tampil di toko</span>
              </label>
              <div className="text-xs text-white/40">
                Terjual: <span className="text-white/70 font-semibold">{form.soldCount ?? 0}</span>
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold text-white/60 mb-2">Foto Produk — maks 8 (PNG/JPG → WebP otomatis)</p>
              <div className="grid grid-cols-4 gap-2">
                {formImages.map((url,i)=>(
                  <div key={url} className="relative group aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {i===0 && <span className="absolute top-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#00E5FF] text-[#080C1E]">Utama</span>}
                    <button onClick={()=>setFormImages(prev=>prev.filter((_,idx)=>idx!==i))} className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"><IosIcon name="close" size={10} tint="white" /></button>
                    {i>0 && <button onClick={()=>setFormImages(prev=>{ const a=[...prev]; const t=a[i]; a[i]=a[0]; a[0]=t; return a; })} className="absolute bottom-1 left-1 right-1 text-[10px] font-bold bg-white/90 text-[#080C1E] rounded-full py-1 opacity-0 group-hover:opacity-100 transition">Jadikan utama</button>}
                  </div>
                ))}
                {formImages.length<8 && (
                  <label className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition ${uploading?"opacity-50 pointer-events-none":"border-white/15 hover:border-[#00E5FF]/40 hover:bg-white/5"}`}>
                    <IosIcon name="plus" size={18} tint="white" className="opacity-40" /><span className="text-[11px] text-white/50">{uploading?"Upload...":"Tambah"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-white/30 mt-2">Foto disesuaikan ke WebP 1600×900 — ringan dan konsisten. Foto pertama = cover card.</p>
            </div>

            <div className="mt-6 flex gap-3 justify-end">
              <button onClick={()=>{if(productDirty)setConfirmProductClose(true);else closeModal();}} disabled={saving} className="h-11 px-5 rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50">Batal</button>
              <button onClick={save} disabled={saving || uploading} className="h-11 px-6 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition disabled:opacity-60 inline-flex items-center gap-2">
                {saving && <Spinner size={16} className="border-[#080C1E]/20 border-t-[#080C1E]" />} {saving ? "Menyimpan…" : "Simpan Produk"}
              </button>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Arsipkan produk?"
        description={deleteTarget ? `"${deleteTarget.name}" akan dinonaktifkan dan disimpan sebagai arsip agar riwayat pesanan tetap aman.` : ""}
        confirmLabel="Arsipkan produk"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={()=> !deleting && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog open={confirmProductClose} title="Buang perubahan?" description="Perubahan pada produk ini belum disimpan." confirmLabel="Buang perubahan" cancelLabel="Lanjut mengedit" variant="danger" onClose={()=>setConfirmProductClose(false)} onConfirm={()=>{setConfirmProductClose(false);closeModal();}} />

      {variantEditorProduct && (
        <VariantEditor
          productId={variantEditorProduct.id}
          productName={variantEditorProduct.name}
          onClose={() => setVariantEditorProduct(null)}
        />
      )}

    </AdminShell>
  );
}
