"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { formatRupiah,formatWibDateTime } from "@/lib/utils";
import { Badge,Button,Card,CardContent,CardDescription,CardHeader,CardTitle,Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,Input,PageHeader,StatCard } from "./ui";
import { SupplierTabs,type SupplierTabId } from "./SupplierTabs";
import { SupplierPriceHeader,SupplierPriceRow,StatusBadges,costWithIdr,type SupplierPriceSave } from "./SupplierPriceRow";
type Item={service_id:string;name:string;stock:number;unit_price_usd:number;markup_percent:number;variant_id:number|null;label:string|null;variant_price:number|null;variant_active:number;product_active:number;aivault_admin_price_idr:number|null;fx_idr_per_usd?:number|null;product_name?:string|null;product_archived?:number;family:{key:string;name:string}};
type Link={id:number;order_code:string;service_id:string;quantity:number;status:string;attempt_count:number;last_error:string|null;can_retry:number;has_receipt:number};
type Catalog={items:Item[];last_sync_at:string|null;configured:boolean};
async function request<T>(path:string,init?:RequestInit):Promise<T> {
  const response=await fetch(`/api/admin/aivault/${path}`,{...init,cache:"no-store"});
  let body:Record<string,unknown>;
  try {body=await response.json();} catch {throw new Error(`HTTP ${response.status}: respons tidak valid`);}
  if (!response.ok || body.error) throw new Error(`HTTP ${response.status}: ${String(body.error ?? "gagal")}`);
  return body as T;
}
const usd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:4}).format(n);
const statusLabel:Record<string,string>={pending:"Menunggu",claimed:"Memproses",processing:"Menunggu supplier",completed:"Siap dikirim",needs_admin:"Perlu diperiksa"};
export function AivaultManager() {
  const [tab,setTab]=useState<SupplierTabId>("ringkas"),[success,setSuccess]=useState(""),[q,setQ]=useState(""),[catalog,setCatalog]=useState<Catalog|null>(null),[balance,setBalance]=useState<number|null>(null),[links,setLinks]=useState<Link[]>([]),[errors,setErrors]=useState<string[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState<string|null>(null);
  const generation=useRef(0);
  const load=useCallback(async()=>{
    const current=++generation.current;setLoading(true);
    const results=await Promise.allSettled([request<Catalog>("products"),request<{balance:number}>("balance"),request<{items:Link[]}>("orders")]);
    if (current!==generation.current) return;
    const failures:string[]=[];
    if(results[0].status==="fulfilled")setCatalog(results[0].value);else failures.push(`Katalog: ${String(results[0].reason.message)}`);
    if(results[1].status==="fulfilled")setBalance(results[1].value.balance);else failures.push(`Saldo: ${String(results[1].reason.message)}`);
    if(results[2].status==="fulfilled")setLinks(results[2].value.items);else failures.push(`Antrean: ${String(results[2].reason.message)}`);
    setErrors(failures);setLoading(false);
  },[]);
  useEffect(()=>{const token=generation;void load();return()=>{token.current++;};},[load]);
  async function mutate(path:string,body:Record<string,unknown>,method="POST",message="Perubahan disimpan.") {
    if (busy) return;
    setBusy(true);setErrors([]);setSuccess("");
    try {
      const result=await request<{skipped?:string}>(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      await load();
      setSuccess(result.skipped==="throttled" ? "Sinkron baru saja berjalan; coba lagi sekitar 2 menit." : result.skipped==="claimed_elsewhere" ? "Sinkron sedang berjalan di proses lain." : result.skipped==="not_configured" ? "AIVault belum dikonfigurasi." : message);
    } catch(e){setErrors([e instanceof Error ? e.message : "Gagal menyimpan"]);} finally {setBusy(false);}
  }
  async function reveal(id:number) {
    setBusy(true);setReceipt(null);
    try {const r=await request<{receipt:string}>("orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"reveal"})});setReceipt(r.receipt);} catch(e){setErrors([e instanceof Error ? e.message : "Gagal membuka receipt"]);} finally{setBusy(false);}
  }
  const items=catalog?.items ?? [],query=q.trim().toLowerCase(),shown=items.filter(i=>!query || `${i.service_id} ${i.name} ${i.label ?? ""} ${i.product_name ?? i.family.name}`.toLowerCase().includes(query)),families=Array.from(new Set(items.map(i=>i.family.key))),groups=Array.from(new Set(shown.map(i=>i.family.key))).map(key=>{const rows=shown.filter(i=>i.family.key===key);return {key,name:rows.find(i=>i.product_name)?.product_name || rows[0].family.name,rows,active:rows.some(i=>i.product_active===1),archived:rows.some(i=>i.product_archived===1)};}).sort((a,b)=>a.name.localeCompare(b.name)),active=items.filter(i=>i.variant_active===1 && i.product_active===1).length;
  return <div className="space-y-6">
    <PageHeader title="AIVault" description="Katalog, harga, dan pengiriman otomatis AIVault." actions={<Button variant="outline" disabled={loading || busy} onClick={()=>void load()}>Muat ulang</Button>}/>
    <SupplierTabs tabs={[{id:"ringkas",label:"Ringkas"},{id:"antrean",label:"Antrean"},{id:"markup",label:"Markup"},{id:"alat",label:"Alat"}]} active={tab} onChange={setTab}/>
    <div aria-live="polite" className="space-y-1 text-sm">{loading && !catalog && <p className="text-admin-muted">Memuat data AIVault…</p>}{busy && <p role="status" className="text-admin-muted">Memproses…</p>}{errors.map(e=><p role="alert" key={e} className="break-words text-admin-danger">{e}</p>)}{success && <p role="status" className="text-admin-success">{success}</p>}</div>
    {tab==="ringkas" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Saldo wallet" value={balance==null ? "—" : usd(balance)} hint="Saldo USD"/><StatCard label="Varian aktif" value={active} hint={`${items.filter(i=>i.variant_id).length} dipetakan · ${items.length} mirror`}/><StatCard label="Keluarga produk" value={families.length} hint="Produk terpisah dari supplier lain"/><StatCard label="Sinkron terakhir" value={catalog?.last_sync_at ? formatWibDateTime(new Date(Number(catalog.last_sync_at)).toISOString()) || "—" : "Belum pernah"} hint={catalog?.configured ? "Konfigurasi tersedia" : "Belum dikonfigurasi"}/></div>}
    {tab==="antrean" && <div className="space-y-3">{!links.length && <Card><CardContent className="p-6 text-sm text-admin-muted">Belum ada pesanan AIVault.</CardContent></Card>}{links.map(link=><Card key={link.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-all font-medium text-admin-fg">{link.order_code}</p><p className="break-all text-sm text-admin-muted">{link.service_id} · {link.quantity} unit · {link.attempt_count}/3 upaya</p><p className="text-sm text-admin-muted">{link.last_error}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={link.status==="needs_admin" ? "warning" : "secondary"}>{statusLabel[link.status] || link.status}</Badge>{link.can_retry===1 && <Button variant="outline" disabled={busy} onClick={()=>void mutate("orders",{id:link.id,action:"retry"},"POST","Pesanan dijadwalkan ulang.")}>Coba lagi</Button>}{link.has_receipt===1 && <Button variant="outline" disabled={busy} onClick={()=>void reveal(link.id)}>Lihat receipt</Button>}</div></CardContent></Card>)}</div>}
    {tab==="markup" && <>
      <div className="flex flex-wrap items-center gap-3"><Input className="max-w-sm" value={q} onChange={e=>setQ(e.target.value)} placeholder="Cari varian…" aria-label="Cari varian"/><p className="text-xs text-admin-muted">Harga jual = modal USD dikali kurs tersimpan dikali (1 + markup), dibulatkan ke Rp100. Harga manual mengalahkan rumus; kosongkan untuk kembali ke rumus.</p></div>
      {!items.length && <p className="text-sm text-admin-muted">Sinkronkan katalog dari tab Alat untuk memulai.</p>}
      <div className="space-y-4">{groups.map(g=><Card key={g.key}><CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2"><CardTitle className="text-base">{g.name}</CardTitle><StatusBadges archived={g.archived} parentInactive={!g.active}/><CardDescription className="w-full text-xs">{g.rows.length} varian</CardDescription></CardHeader><CardContent className="space-y-2 p-4 pt-0"><SupplierPriceHeader/>{g.rows.map(item=>{const title=item.label || item.name;return <SupplierPriceRow key={item.service_id} id={`aivault-${item.service_id}`} title={title}
        meta={<>{item.name} · modal {costWithIdr(usd(item.unit_price_usd),item.unit_price_usd,item.fx_idr_per_usd)} · stok {item.stock}</>}
        badges={!item.variant_id ? <Badge variant="warning">Belum dipetakan</Badge> : undefined}
        markup={Number(item.markup_percent)} manual={item.aivault_admin_price_idr} price={item.variant_price} active={item.variant_active===1}
        canEdit={!!item.variant_id && item.product_archived!==1} locked={busy} busy={false}
        onToggle={()=>void mutate(`products/${encodeURIComponent(item.service_id)}`,{is_active:item.variant_active!==1},"PATCH",`${title} ${item.variant_active===1 ? "dinonaktifkan" : "diaktifkan"}.`)}
        onSave={(body:SupplierPriceSave)=>mutate(`products/${encodeURIComponent(item.service_id)}`,body,"PATCH",`Harga ${title} disimpan.`)}/>;})}</CardContent></Card>)}</div>
    </>}
    {tab==="alat" && <Card><CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron katalog</CardTitle></CardHeader><CardContent className="space-y-3 p-4 pt-0"><p className="text-sm leading-5 text-admin-muted">Harga USD memakai snapshot kurs AXVARA dan markup awal 35%, dibulatkan ke Rp100. Produk dan varian baru selalu nonaktif. Nama, gambar, label, dan status produk dikelola dari Produk.</p><Button disabled={busy || loading} onClick={()=>void mutate("publish",{},"POST","Sinkron katalog selesai.")}>{busy ? "Menyinkronkan…" : "Sinkronkan katalog"}</Button></CardContent></Card>}
    <Dialog open={receipt!==null} onOpenChange={open=>{if(!open)setReceipt(null);}}><DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Receipt AIVault</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-all text-xs">{receipt}</pre></DialogContent></Dialog>
  </div>;
}
