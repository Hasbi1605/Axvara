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
import { ProofThumbnail } from "@/components/admin/ProofThumbnail";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";
import { IosIcon } from "@/components/ui/IosIcon";
import { NewsletterSubscribers } from "@/components/admin/NewsletterSubscribers";
import BotAutomationManager from "@/components/admin/BotAutomationManager";
import VariantEditor from "@/components/admin/VariantEditor";

type Prod = { id:string; slug:string; name:string; description:string; price:number; comparePrice?:number; categorySlug:string; image:string; images:string[]; badge?:string; soldCount:number; stock:number; isActive:boolean; sortOrder?:number };
type Cat = { id:number; slug:string; name:string };
type Order = { code:string; name:string; wa:string; method:string; items:{ name:string;price:number;qty:number }[]; subtotal:number; status:string; fileName?:string; createdAt:string };

const PER_PAGE_ADMIN = 8;
const ADMIN_SECTIONS: AdminSection[] = ["summary","products","orders","categories","payments","articles","banners","subscribers","bot","agent"];

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Prod|null>(null);
  const [showNew, setShowNew] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<Partial<Prod> & { comparePrice?:number; categorySlug?:string }>({});
  const [formImages, setFormImages] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Prod|null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toggling, setToggling] = useState<string | null>(null);
  // BUG-03 fix: modal konfirmasi lunas dengan input lisensi/key
  const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [confirming, setConfirming] = useState(false);
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

  const load = useCallback(async()=>{
    setLoadingList(true);
    setListError(null);
    try {
      const [pr, cr, or] = await Promise.all([
        fetch("/api/products").then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || `Produk ${r.status}`); return j; }),
        fetch("/api/categories?all=1", { cache: "no-store" }).then(async r=>{ const j=await r.json().catch(()=>({})); if(r.status===401){setAuthed(false);throw new Error("Sesi admin berakhir. Silakan login ulang.");} if(!r.ok)throw new Error(j.error||`Kategori ${r.status}`);return j; }),
        fetch("/api/admin/orders").then(async r=> {
          if (r.status === 401) { setAuthed(false); throw new Error("Sesi admin berakhir. Silakan login ulang."); }
          const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || `Pesanan ${r.status}`); return j;
        })
      ]);
      setProds(pr.products ?? []);
      setCats(cr.categories ?? []);
      // Normalize admin orders to local Order shape
      const serverOrders: Order[] = (or.orders ?? []).map((o: Record<string, unknown>) => ({
        code: String(o.code),
        name: String(o.customer_name ?? o.name ?? ""),
        wa: String(o.customer_wa ?? o.wa ?? ""),
        method: String(o.payment_method ?? o.method ?? ""),
        items: (o.items as Order["items"]) ?? [],
        subtotal: Number(o.subtotal ?? 0),
        status: String(o.status ?? "pending"),
        fileName: (o.proof_url as string) ?? undefined,
        createdAt: String(o.created_at ?? o.createdAt ?? ""),
      }));
      setOrders(serverOrders);
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
  useEffect(()=>{ if(authed) load(); },[authed, load]);

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
      await load();
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Gagal masuk");
    } finally { setLoginLoading(false); }
  };

  const setStatus=async(code:string,status:string,note?:string)=>{
    // Try server first
    try {
      const r = await fetch(`/api/admin/orders/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ status, admin_note: note || undefined }),
      });
      const j = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await load();
      toast.success(status === "lunas" ? "Pesanan dikonfirmasi lunas." : "Pesanan dibatalkan.");
      return;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal update status");
    }
  };

  const openEdit=(p:Prod)=>{ setEditing(p); setForm({...p, categorySlug:p.categorySlug}); setFormImages(p.images?.length? p.images : p.image? [p.image] : []); setFormError(null); };
  const openNew=()=>{ setShowNew(true); setEditing(null); setForm({ name:"", slug:"", description:"", price:50000, categorySlug:"akun-premium", stock:10, soldCount:0, isActive:true }); setFormImages([]); setFormError(null); };
  const closeModal=()=>{ setEditing(null); setShowNew(false); setForm({}); setFormImages([]); setFormError(null); setSaving(false); };

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
    if (form.price == null || Number.isNaN(Number(form.price))) return "Harga wajib diisi.";
    if (Number(form.price) < 1000) return "Harga minimal Rp 1.000.";
    if (form.comparePrice != null && Number(form.comparePrice) !== 0 && Number(form.comparePrice) <= Number(form.price)) return "Harga coret harus lebih besar dari harga jual.";
    if (form.stock != null && Number(form.stock) < -1) return "Stok tidak valid.";
    return null;
  };

  const save=async()=>{
    const v = validateForm();
    if (v) { setFormError(v); toast.error(v); return; }
    setSaving(true);
    setFormError(null);
    const payload={ ...form, name: form.name!.trim(), slug: form.slug!.trim().toLowerCase(), description: (form.description ?? "").trim(), price:Number(form.price), comparePrice: form.comparePrice? Number(form.comparePrice): null, stock: form.stock!=null? Number(form.stock): -1, soldCount: form.soldCount? Number(form.soldCount):0, sortOrder:0, images: formImages, imageUrl: formImages[0] ?? form.image ?? null, isActive: form.isActive!==false };
    const url = editing? `/api/products/${editing.id}` : "/api/products";
    const method = editing? "PUT":"POST";
    try{
      const r=await fetch(url,{method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(j.error||`Gagal simpan (${r.status})`);
      toast.success(editing ? "Produk diperbarui." : "Produk dibuat.");
      await load(); closeModal();
    } catch(e){
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
      toast.success(`“${deleteTarget.name}” dihapus.`);
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

  const pending=orders.filter(o=>o.status==="pending").length; const lunas=orders.filter(o=>o.status==="lunas").length; const omzet=orders.filter(o=>o.status==="lunas").reduce((a,b)=>a+b.subtotal,0);
  const activeProducts=prods.filter(p=>p.isActive).length;
  const lowStock=prods.filter(p=>p.stock>=0&&p.stock<=5).length;
  const soldProducts=prods.reduce((total,product)=>total+product.soldCount,0);
  const filtered = useMemo(()=> prods.filter(p=> !q || `${p.name} ${p.slug} ${p.badge??""}`.toLowerCase().includes(q.toLowerCase())), [prods, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE_ADMIN));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage-1)*PER_PAGE_ADMIN, safePage*PER_PAGE_ADMIN);

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
    <AdminShell section={tab} onSection={(section)=>{setTab(section);window.history.replaceState(null,"",`/admin?section=${section}`)}}>
      <div className="mt-4 flex items-center gap-2 text-[11px] text-white/35">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Masuk sebagai <span className="text-white/60">{authEmail || "admin"}</span> <span className="opacity-40">·</span> Sesi 8 jam
      </div>

      {["summary","orders","products"].includes(tab) && <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        {tab==="products" ? <>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total produk</p><p className="text-2xl font-display font-bold text-white">{prods.length}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Produk aktif</p><p className="text-2xl font-display font-bold text-[#22C55E]">{activeProducts}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Stok menipis</p><p className="text-2xl font-display font-bold text-[#FFB800]">{lowStock}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Unit terjual</p><p className="text-2xl font-display font-bold text-white">{soldProducts}</p></div>
        </> : <>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total pesanan</p><p className="text-2xl font-display font-bold text-white">{orders.length}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Pending</p><p className="text-2xl font-display font-bold text-[#FFB800]">{pending}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Lunas</p><p className="text-2xl font-display font-bold text-[#22C55E]">{lunas}</p></div>
          <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Omzet</p><p className="text-lg font-display font-bold text-white">{formatRupiah(omzet)}</p></div>
        </>}
      </div>}

      {listError && <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"><span>{listError}</span><button onClick={load} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">Coba lagi</button></div>}

      {tab==="summary" && <div className="mt-6 ax-glass rounded-[20px] overflow-hidden"><div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-white/10"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/5"><IosIcon name="dashboard" size={16} tint="white" /></span><h2 className="text-white font-semibold text-sm">Ringkasan toko</h2></div><p className="p-4 sm:p-5 text-sm text-white/50">Gunakan sidebar untuk mengelola produk, pesanan, CMS, dan integrasi agent.</p></div>}
      {tab==="categories" && <CategoryManager />}
      {tab==="payments" && <PaymentMethodsManager />}
      {tab==="agent" && <AgentIntegration />}
      {tab==="bot" && <BotAutomationManager products={prods.map(p=>({id:Number(p.id),name:p.name,fulfillment_mode:(p as unknown as Record<string,unknown>).fulfillment_mode as string,telegram_enabled:(p as unknown as Record<string,unknown>).telegram_enabled as number}))} />}

      {tab==="products" && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-[420px]">
              <div className="relative flex-1">
                <input value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} placeholder="Cari produk, slug, badge..." className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-70"><IosIcon name="search" size={16} tint="white" /></span>
              </div>
            </div>
            <button onClick={openNew} className="inline-flex h-10 items-center gap-1.5 px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition"><IosIcon name="plus" size={14} tint="black" /> Produk Baru</button>
          </div>

          <div className="mt-4 ax-glass rounded-[20px] overflow-hidden">
            {loadingList ? (
              <div className="p-10 flex flex-col items-center gap-3 text-white/60"><Spinner size={24} /><span className="text-sm">Memuat produk…</span></div>
            ) : (
            <div className="overflow-x-auto">
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
                          <button onClick={()=>setVariantEditorProduct({ id: Number(p.id), name: p.name })} className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded text-xs">Varian</button>
                          <button onClick={()=>openEdit(p)} className="inline-flex h-8 items-center gap-1 px-3 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90"><IosIcon name="edit" size={12} tint="black" /> Edit</button>
                          <button onClick={()=>setDeleteTarget(p)} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition" aria-label={`Hapus ${p.name}`} title="Hapus produk"><IosIcon name="trash" size={16} tint="white" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length===0 && <p className="p-8 text-center text-sm text-white/40">Tidak ada produk — coba ubah kata kunci.</p>}
            </div>
            )}
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

      {tab==="orders" && (
        <div className="mt-5 ax-glass rounded-[20px] overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/5">
              <IosIcon name="purchase-order" size={16} tint="white" />
            </span>
            <h2 className="font-semibold text-white text-sm">Pesanan Masuk</h2>
            <span className="ml-auto text-xs text-white/40">{orders.length} total</span>
          </div>
          {orders.length===0? <p className="p-8 text-center text-sm text-white/40">Belum ada pesanan — coba checkout sebagai pembeli dulu.</p> : (
            <div className="divide-y divide-white/5">{orders.slice().map(o=>(
              <div key={o.code} className="flex flex-col gap-4 px-4 py-4 transition hover:bg-white/[0.03] sm:flex-row sm:items-center sm:px-5">
                <div className="grid min-w-0 flex-1 grid-cols-[136px_minmax(0,1fr)] items-start gap-3.5">
                  <ProofThumbnail proof={o.fileName}/>
                  <div className="min-w-0 pt-0.5">
                    <p className="truncate font-mono text-xs font-bold text-[#00E5FF]">{o.code}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-white">{o.name}</p>
                    <p className="truncate text-xs text-white/45">{o.wa}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/50">{o.items.map(i=>`${i.name} ×${i.qty}`).join(", ")} · {o.method.toUpperCase()} · {formatRupiah(o.subtotal)}</p>
                    <span className={`mt-1.5 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${o.status==="pending"?"border-[#FFB800]/20 bg-[#FFB800]/15 text-[#FFB800]":o.status==="lunas"?"border-[#22C55E]/20 bg-[#22C55E]/15 text-[#22C55E]":"border-white/10 bg-white/10 text-white/50"}`}>{o.status}</span>
                  </div>
                </div>
                <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{o.status==="pending" && <><button onClick={()=>{ setConfirmOrder(o); setAdminNote(""); }} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#22C55E] px-3.5 text-xs font-bold text-white transition hover:bg-[#16a34a]"><IosIcon name="checked" size={14} tint="white" /> Konfirmasi Lunas</button><button onClick={()=>setStatus(o.code,"dibatalkan")} className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 bg-white/10 px-3.5 text-xs font-semibold text-white/70 hover:bg-white/15 hover:text-white"><IosIcon name="close" size={12} tint="white" /> Batalkan</button><a href={`https://wa.me/${o.wa.replace(/^0/,"62")}?text=Halo%20${encodeURIComponent(o.name)}%2C%20pesanan%20${o.code}%20kamu%20sudah%20kami%20terima.`} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#25D366] px-3.5 text-xs font-bold text-white transition hover:bg-[#1ebd5a]"><IosIcon name="chat" size={14} tint="white" /> WA</a></>}</div>
              </div>
            ))}</div>
          )}
        </div>
      )}

      {tab==="articles" && <ArticlesManager />}

      {tab==="banners" && <BannerManager />}

      {tab==="subscribers" && <NewsletterSubscribers />}

      {(editing || showNew) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-6 sm:pt-10 overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-[720px] ax-glass-strong rounded-[24px] border border-white/10 p-5 sm:p-6 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-white text-lg">{editing? "Edit Produk":"Produk Baru"}</h3>
              <button onClick={closeModal} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/15"><IosIcon name="close" size={14} tint="white" /></button>
            </div>

            {formError && <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-200">{formError}</p>}

            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Nama *</span><input value={form.name??""} onChange={e=>setForm({...form,name:e.target.value, slug: !editing? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""): form.slug})} placeholder="ChatGPT Plus 1 Bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Slug *</span><input value={form.slug??""} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})} placeholder="chatgpt-plus-1-bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="text-xs font-semibold text-white/60">Deskripsi</span><textarea value={form.description??""} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Akses GPT-4o penuh..." className="w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Harga *</span><input type="number" min={0} value={form.price??""} onChange={e=>setForm({...form,price:Number(e.target.value)})} placeholder="89000" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Harga Coret (opsional)</span><input type="number" min={0} value={form.comparePrice??""} onChange={e=>setForm({...form,comparePrice:e.target.value?Number(e.target.value):undefined})} placeholder="300000" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Kategori</span><select value={form.categorySlug??cats[0]?.slug??""} onChange={e=>setForm({...form,categorySlug:e.target.value})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30">
                {cats.map((category) => <option key={category.id} value={category.slug} className="bg-[#0F1430]">{category.name}</option>)}
              </select></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Badge</span><input value={form.badge??""} onChange={e=>setForm({...form,badge:e.target.value})} placeholder="Terlaris / Baru / Hemat 92%" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Stok (-1 = ∞)</span><input type="number" value={form.stock??-1} onChange={e=>setForm({...form,stock:Number(e.target.value)})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Terjual</span><input type="number" min={0} value={form.soldCount??0} onChange={e=>setForm({...form,soldCount:Number(e.target.value)})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.isActive!==false} onChange={e=>setForm({...form,isActive:e.target.checked})} className="w-4 h-4 rounded accent-[#00E5FF]" /> <span className="text-sm text-white/80">Aktif tampil di toko</span></label>
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
              <button onClick={closeModal} disabled={saving} className="h-11 px-5 rounded-full ax-glass text-sm font-semibold text-white/80 hover:text-white disabled:opacity-50">Batal</button>
              <button onClick={save} disabled={saving || uploading} className="h-11 px-6 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition disabled:opacity-60 inline-flex items-center gap-2">
                {saving && <Spinner size={16} className="border-[#080C1E]/20 border-t-[#080C1E]" />} {saving ? "Menyimpan…" : "Simpan Produk"}
              </button>
            </div>
          </div>
        </div>
      )}

      

      {/* BUG-03 fix: Modal konfirmasi lunas + input lisensi/key */}
      {confirmOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={()=> !confirming && setConfirmOrder(null)}>
          <div className="w-full max-w-[480px] ax-glass-strong rounded-[24px] p-5 sm:p-6" onClick={e=>e.stopPropagation()}>
            <h3 className="font-display font-bold text-white text-lg">Konfirmasi Lunas</h3>
            <p className="mt-2 text-sm text-white/60">Pesanan <span className="font-mono text-[#00E5FF] font-bold">{confirmOrder.code}</span> — {confirmOrder.name}</p>
            <p className="text-xs text-white/40 mt-1">{confirmOrder.items.map(i=>`${i.name} ×${i.qty}`).join(", ")} • {formatRupiah(confirmOrder.subtotal)}</p>
            <div className="mt-4">
              <label className="text-xs font-semibold text-white/60">Lisensi / Key / Catatan untuk pembeli</label>
              <textarea
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                rows={3}
                placeholder="Masukkan lisensi, key, atau link akses yang akan dikirim ke pembeli via WA..."
                className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40 resize-none"
              />
              <p className="text-[11px] text-white/30 mt-1">Opsional — akan tersimpan di admin_note pesanan.</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={()=> setConfirmOrder(null)} disabled={confirming} className="h-10 px-4 rounded-full ax-glass text-sm text-white/80 disabled:opacity-50">Batal</button>
              <button
                onClick={async ()=> {
                  setConfirming(true);
                  await setStatus(confirmOrder.code, "lunas", adminNote.trim() || undefined);
                  setConfirming(false);
                  setConfirmOrder(null);
                  setAdminNote("");
                }}
                disabled={confirming}
                className="h-10 px-5 rounded-full bg-[#22C55E] text-white text-sm font-bold hover:bg-[#16a34a] transition disabled:opacity-60 inline-flex items-center gap-2"
              >
                {confirming && <Spinner size={14} className="border-white/30 border-t-white" />} {confirming ? "Memproses…" : "Konfirmasi Lunas"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus produk?"
        description={deleteTarget ? `"${deleteTarget.name}" akan dihapus permanen dari katalog. Tindakan ini tidak dapat dibatalkan.` : ""}
        confirmLabel="Hapus permanen"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={()=> !deleting && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

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
