"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { formatRupiah,formatWibDateTime } from "@/lib/utils";
import { Badge,Button,Card,CardContent,CardHeader,CardTitle,Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,Input,PageHeader,StatCard,Switch,Tabs,TabsList,TabsTrigger } from "./ui";
type Item={service_id:string;name:string;stock:number;unit_price_usd:number;markup_percent:number;variant_id:number|null;label:string|null;variant_price:number|null;variant_active:number;product_active:number;aivault_admin_price_idr:number|null;family:{key:string;name:string}};
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
function Variant({item,busy,save}:{item:Item;busy:boolean;save:(id:string,body:Record<string,unknown>)=>Promise<void>}) {
  const [markup,setMarkup]=useState(String(item.markup_percent)),[manual,setManual]=useState(item.aivault_admin_price_idr==null ? "" : String(item.aivault_admin_price_idr));
  useEffect(()=>{setMarkup(String(item.markup_percent));setManual(item.aivault_admin_price_idr==null ? "" : String(item.aivault_admin_price_idr));},[item]);
  return <form className="space-y-3 rounded-lg border border-admin-border p-4" onSubmit={e=>{e.preventDefault();void save(item.service_id,{markup_percent:Number(markup),admin_price_idr:manual.trim() ? Number(manual) : null});}}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium text-admin-fg">{item.label || item.name}</p><p className="text-sm text-admin-muted">Modal {usd(item.unit_price_usd)} · Stok {item.stock} · Jual {item.variant_price==null ? "Belum dipetakan" : formatRupiah(item.variant_price)}</p></div><Switch aria-label={`Aktifkan ${item.label || item.name}`} checked={item.variant_active===1} disabled={busy || !item.variant_id} onCheckedChange={checked=>void save(item.service_id,{is_active:checked})}/></div>
    {!item.product_active && <p className="text-xs text-admin-muted">Produk induk nonaktif. Aktifkan di Produk agar varian tampil kepada pembeli.</p>}
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-sm text-admin-muted">Markup (%)<Input type="number" min="0" max="1000" step="0.1" value={markup} onChange={e=>setMarkup(e.target.value)} required disabled={busy}/></label><label className="text-sm text-admin-muted">Harga manual (Rp)<Input type="number" min="1" max="1000000000" placeholder="Otomatis" value={manual} onChange={e=>setManual(e.target.value)} disabled={busy}/></label><Button className="self-end" type="submit" disabled={busy || !item.variant_id}>Simpan</Button></div>
  </form>;
}
const statusLabel:Record<string,string>={pending:"Menunggu",claimed:"Memproses",processing:"Menunggu supplier",completed:"Siap dikirim",needs_admin:"Perlu diperiksa"};
export function AivaultManager() {
  const [tab,setTab]=useState("summary"),[catalog,setCatalog]=useState<Catalog|null>(null),[balance,setBalance]=useState<number|null>(null),[links,setLinks]=useState<Link[]>([]),[errors,setErrors]=useState<string[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState<string|null>(null);
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
  async function mutate(path:string,body:Record<string,unknown>,method="POST") {
    setBusy(true);setErrors([]);
    try {await request(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});await load();} catch(e){setErrors([e instanceof Error ? e.message : "Gagal menyimpan"]);} finally {setBusy(false);}
  }
  async function reveal(id:number) {
    setBusy(true);setReceipt(null);
    try {const r=await request<{receipt:string}>("orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"reveal"})});setReceipt(r.receipt);} catch(e){setErrors([e instanceof Error ? e.message : "Gagal membuka receipt"]);} finally{setBusy(false);}
  }
  const items=catalog?.items ?? [],families=Array.from(new Set(items.map(i=>i.family.key))),active=items.filter(i=>i.variant_active===1 && i.product_active===1).length;
  return <div className="space-y-6">
    <PageHeader title="AIVault" description="Katalog, harga, dan pengiriman otomatis AIVault." actions={<Button variant="outline" disabled={loading || busy} onClick={()=>void load()}>Muat ulang</Button>}/>
    <div aria-live="polite">{loading && <p className="text-sm text-admin-muted">Memuat data AIVault…</p>}{errors.map(e=><p role="alert" key={e} className="break-words text-sm text-admin-danger">{e}</p>)}</div>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="flex w-full flex-wrap justify-start h-auto">{[["summary","Ringkas"],["orders","Antrean"],["markup","Markup"],["tools","Alat"]].map(([id,label])=><TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}</TabsList></Tabs>
    {tab==="summary" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Saldo wallet" value={balance==null ? "—" : usd(balance)} hint="Saldo USD"/><StatCard label="Varian aktif" value={active} hint={`${items.filter(i=>i.variant_id).length} dipetakan · ${items.length} mirror`}/><StatCard label="Keluarga produk" value={families.length} hint="Produk terpisah dari supplier lain"/><StatCard label="Sinkron terakhir" value={catalog?.last_sync_at ? formatWibDateTime(new Date(Number(catalog.last_sync_at)).toISOString()) || "—" : "Belum pernah"} hint={catalog?.configured ? "Konfigurasi tersedia" : "Belum dikonfigurasi"}/></div>}
    {tab==="orders" && <div className="space-y-3">{!links.length && <Card><CardContent className="p-6 text-sm text-admin-muted">Belum ada pesanan AIVault.</CardContent></Card>}{links.map(link=><Card key={link.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-all font-medium text-admin-fg">{link.order_code}</p><p className="break-all text-sm text-admin-muted">{link.service_id} · {link.quantity} unit · {link.attempt_count}/3 upaya</p><p className="text-sm text-admin-muted">{link.last_error}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant={link.status==="needs_admin" ? "warning" : "secondary"}>{statusLabel[link.status] || link.status}</Badge>{link.can_retry===1 && <Button variant="outline" disabled={busy} onClick={()=>void mutate("orders",{id:link.id,action:"retry"})}>Coba lagi</Button>}{link.has_receipt===1 && <Button variant="outline" disabled={busy} onClick={()=>void reveal(link.id)}>Lihat receipt</Button>}</div></CardContent></Card>)}</div>}
    {tab==="markup" && <div className="space-y-4">{!items.length && <p className="text-sm text-admin-muted">Sinkronkan katalog dari tab Alat untuk memulai.</p>}{families.map(f=><Card key={f}><CardHeader><CardTitle>{items.find(i=>i.family.key===f)!.family.name}</CardTitle></CardHeader><CardContent className="space-y-3">{items.filter(i=>i.family.key===f).map(item=><Variant key={item.service_id} item={item} busy={busy} save={(id,body)=>mutate(`products/${encodeURIComponent(id)}`,body,"PATCH")}/>)}</CardContent></Card>)}</div>}
    {tab==="tools" && <Card><CardHeader><CardTitle>Sinkron katalog</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-admin-muted">Harga USD memakai snapshot kurs AXVARA dan markup awal 35%, dibulatkan ke Rp100. Produk dan varian baru selalu nonaktif. Nama, gambar, label, dan status aktif dikelola dari Produk.</p><Button disabled={busy || loading} onClick={()=>void mutate("publish",{})}>{busy ? "Menyinkronkan…" : "Sinkronkan katalog"}</Button></CardContent></Card>}
    <Dialog open={receipt!==null} onOpenChange={open=>{if(!open)setReceipt(null);}}><DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Receipt AIVault</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader><pre className="whitespace-pre-wrap break-all text-xs">{receipt}</pre></DialogContent></Dialog>
  </div>;
}
