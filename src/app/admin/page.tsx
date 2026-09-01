"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";
import { AdminNavbar } from "@/components/storefront/AdminNavbar";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Prod = { id:string; slug:string; name:string; description:string; price:number; comparePrice?:number; categorySlug:string; image:string; images:string[]; badge?:string; soldCount:number; stock:number; isActive:boolean; sortOrder?:number };
type Cat = { id:number; slug:string; name:string };
type Order = { code:string; name:string; wa:string; method:string; items:{ name:string;price:number;qty:number }[]; subtotal:number; status:string; fileName?:string; createdAt:string };

const PER_PAGE_ADMIN = 8;

export default function AdminPage() {
  const toast = useToast();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [tab, setTab] = useState<"orders"|"products">("products");
  const [orders, setOrders] = useState<Order[]>([]);
  const [prods, setProds] = useState<Prod[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const load = useCallback(async()=>{
    setLoadingList(true);
    setListError(null);
    try {
      const [pr, cr] = await Promise.all([
        fetch("/api/products").then(async r=>{ const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error || `Produk ${r.status}`); return j; }),
        fetch("/api/categories").then(r=>r.json()).catch(()=>({categories:[]}))
      ]);
      setProds(pr.products ?? []);
      setCats(cr.categories ?? [{id:1,slug:"ai-gateway",name:"AI Gateway"},{id:2,slug:"akun-premium",name:"Akun Premium"},{id:3,slug:"tools-pro",name:"Tools Pro"},{id:4,slug:"bundle-hemat",name:"Bundle Hemat"}]);
      setOrders(JSON.parse(localStorage.getItem("axvara-orders")||"[]"));
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
      else { setAuthed(false); }
    } catch { setAuthed(false); }
    finally { setCheckingAuth(false); }
  },[]);

  useEffect(()=>{ checkAuth(); load(); },[checkAuth, load]);

  const login = async()=>{
    setLoginError(null);
    if (!email.trim() || !pass) { setLoginError("Email dan password wajib diisi."); return; }
    setLoginLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ email: email.trim(), password: pass })
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

  const logout = async()=>{
    try { await fetch("/api/auth/logout", { method:"POST" }); } catch {}
    setAuthed(false);
    setAuthEmail("");
  };

  const setStatus=(code:string,status:string)=>{
    try {
      const all:Order[]=JSON.parse(localStorage.getItem("axvara-orders")||"[]");
      const next=all.map(o=>o.code===code?{...o,status}:o);
      localStorage.setItem("axvara-orders",JSON.stringify(next));
      setOrders(next);
      toast.success(status === "lunas" ? "Pesanan dikonfirmasi lunas." : "Pesanan dibatalkan.");
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
    const tooBig = Array.from(files).find(f=> f.size > 8*1024*1024);
    if (tooBig) { toast.error(`${tooBig.name} melebihi 8MB.`); e.target.value=""; return; }
    setUploading(true);
    const fd=new FormData(); Array.from(files).forEach(f=>fd.append("files",f));
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
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/60">Email</span><input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=> e.key==="Enter" && login()} placeholder="admin@axvara.id" autoComplete="username" className="w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" /></label>
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
    <div className="min-h-screen">
      <AdminNavbar tab={tab} onTab={setTab} total={prods.length} pending={pending} />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6">
      {authEmail && <p className="text-[11px] text-white/35">Masuk sebagai <span className="text-white/60">{authEmail}</span> • sesi 8 jam • <button onClick={logout} className="underline hover:text-white">keluar</button></p>}

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Total Produk</p><p className="text-2xl font-display font-bold text-white">{prods.length}</p><p className="text-[11px] text-white/40">{prods.filter(p=>p.isActive).length} aktif</p></div>
        <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Pending</p><p className="text-2xl font-display font-bold text-[#FFB800]">{pending}</p></div>
        <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Lunas</p><p className="text-2xl font-display font-bold text-[#22C55E]">{lunas}</p></div>
        <div className="ax-glass rounded-2xl p-4"><p className="text-[11px] tracking-wide text-white/50 uppercase">Omzet</p><p className="text-lg font-display font-bold text-white">{formatRupiah(omzet)}</p></div>
      </div>

      {listError && <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"><span>{listError}</span><button onClick={load} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0">Coba lagi</button></div>}

      {tab==="products" && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-[420px]">
              <div className="relative flex-1">
                <input value={q} onChange={e=>{ setQ(e.target.value); setPage(1); }} placeholder="Cari produk, slug, badge..." className="w-full h-10 pl-10 pr-4 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">⌕</span>
              </div>
            </div>
            <button onClick={openNew} className="h-10 px-5 rounded-full bg-[#00E5FF] text-[#080C1E] text-sm font-bold hover:bg-[#00D0E8] transition">+ Produk Baru</button>
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
                          <button onClick={()=>openEdit(p)} className="h-8 px-3 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90">Edit</button>
                          <button onClick={()=>setDeleteTarget(p)} className="h-8 w-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 shadow-[0_2px_10px_rgba(239,68,68,0.35)] transition" aria-label={`Hapus ${p.name}`} title="Hapus produk">
                            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                          </button>
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
                  <button disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="h-8 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">‹ Sebelumnya</button>
                  <span className="text-xs text-white/40 px-1">{safePage} / {totalPages}</span>
                  <button disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="h-8 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">Berikutnya ›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==="orders" && (
        <div className="mt-6 ax-glass rounded-[24px] overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between"><h2 className="font-semibold text-white text-sm">Pesanan Masuk</h2><span className="text-xs text-white/40">{orders.length} total</span></div>
          {orders.length===0? <p className="p-8 text-center text-sm text-white/40">Belum ada pesanan — coba checkout sebagai pembeli dulu.</p> : (
            <div className="divide-y divide-white/5">{orders.slice().reverse().map(o=>(
              <div key={o.code} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0"><p className="font-mono text-xs font-bold text-[#00E5FF]">{o.code}</p><p className="text-sm text-white">{o.name} • {o.wa}</p><p className="text-xs text-white/50">{o.items.map(i=>`${i.name} ×${i.qty}`).join(", ")} • {o.method.toUpperCase()} • {formatRupiah(o.subtotal)}</p>{o.fileName && <p className="text-xs text-white/30">Bukti: {o.fileName}</p>}</div>
                <div className="flex items-center gap-2 flex-wrap"><span className={`text-xs font-bold px-2.5 py-1 rounded-full ${o.status==="pending"?"bg-[#FFB800]/15 text-[#FFB800] border border-[#FFB800]/20":o.status==="lunas"?"bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20":"bg-white/10 text-white/50"}`}>{o.status}</span>{o.status==="pending" && <><button onClick={()=>setStatus(o.code,"lunas")} className="h-8 px-3 rounded-full bg-[#22C55E] text-white text-xs font-bold">Konfirmasi Lunas</button><button onClick={()=>setStatus(o.code,"dibatalkan")} className="h-8 px-3 rounded-full ax-glass text-xs">Batalkan</button><a href={`https://wa.me/${o.wa.replace(/^0/,"62")}?text=Halo%20${encodeURIComponent(o.name)}%2C%20pesanan%20${o.code}%20kamu%20sudah%20kami%20terima.`} target="_blank" className="h-8 px-3 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center">WA</a></>}</div>
              </div>
            ))}</div>
          )}
        </div>
      )}

      {(editing || showNew) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-6 sm:pt-10 overflow-y-auto bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full max-w-[720px] ax-glass-strong rounded-[24px] border border-white/10 p-5 sm:p-6 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-white text-lg">{editing? "Edit Produk":"Produk Baru"}</h3>
              <button onClick={closeModal} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/70 hover:bg-white/15">✕</button>
            </div>

            {formError && <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-200">{formError}</p>}

            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Nama *</span><input value={form.name??""} onChange={e=>setForm({...form,name:e.target.value, slug: !editing? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""): form.slug})} placeholder="ChatGPT Plus 1 Bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Slug *</span><input value={form.slug??""} onChange={e=>setForm({...form,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g,"-")})} placeholder="chatgpt-plus-1-bulan" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 font-mono focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="sm:col-span-2 space-y-1.5"><span className="text-xs font-semibold text-white/60">Deskripsi</span><textarea value={form.description??""} onChange={e=>setForm({...form,description:e.target.value})} rows={2} placeholder="Akses GPT-4o penuh..." className="w-full px-3 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Harga *</span><input type="number" min={0} value={form.price??""} onChange={e=>setForm({...form,price:Number(e.target.value)})} placeholder="89000" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Harga Coret (opsional)</span><input type="number" min={0} value={form.comparePrice??""} onChange={e=>setForm({...form,comparePrice:e.target.value?Number(e.target.value):undefined})} placeholder="300000" className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30" /></label>
              <label className="space-y-1.5"><span className="text-xs font-semibold text-white/60">Kategori</span><select value={form.categorySlug??"akun-premium"} onChange={e=>setForm({...form,categorySlug:e.target.value})} className="w-full h-11 px-3 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white focus:outline-none focus:border-[#00E5FF]/30">
                <option value="ai-gateway" className="bg-[#0F1430]">AI Gateway</option><option value="akun-premium" className="bg-[#0F1430]">Akun Premium</option><option value="tools-pro" className="bg-[#0F1430]">Tools Pro</option><option value="bundle-hemat" className="bg-[#0F1430]">Bundle Hemat</option>
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
                    <button onClick={()=>setFormImages(prev=>prev.filter((_,idx)=>idx!==i))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">✕</button>
                    {i>0 && <button onClick={()=>setFormImages(prev=>{ const a=[...prev]; const t=a[i]; a[i]=a[0]; a[0]=t; return a; })} className="absolute bottom-1 left-1 right-1 text-[10px] font-bold bg-white/90 text-[#080C1E] rounded-full py-1 opacity-0 group-hover:opacity-100 transition">Jadikan utama</button>}
                  </div>
                ))}
                {formImages.length<8 && (
                  <label className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition ${uploading?"opacity-50 pointer-events-none":"border-white/15 hover:border-[#00E5FF]/40 hover:bg-white/5"}`}>
                    <span className="text-xl text-white/40">+</span><span className="text-[11px] text-white/50">{uploading?"Upload...":"Tambah"}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-white/30 mt-2">Foto di-resize max 1200px & konversi WebP q72 — ringan & tajam. Foto pertama = cover card.</p>
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus produk?"
        description={deleteTarget ? `“${deleteTarget.name}” akan dihapus permanen dari katalog. Tindakan ini tidak dapat dibatalkan.` : ""}
        confirmLabel="Hapus permanen"
        cancelLabel="Batal"
        variant="danger"
        loading={deleting}
        onClose={()=> !deleting && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <p className="mt-8 text-center"><Link href="/" className="text-sm text-white/40 hover:text-white">← Kembali ke toko</Link></p>
      </div>
    </div>
  );
}
