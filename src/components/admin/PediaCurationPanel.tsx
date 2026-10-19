"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CurationCandidate, CurationProduct } from "@/lib/pedia/curation-shortlist";
import { formatRupiah } from "@/lib/utils";
const input="mt-2 min-h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-base text-white [color-scheme:dark]";
export function PediaCurationPanel({products,onCreated}:{products:CurationProduct[];onCreated:(productId:number)=>Promise<void>}){
 const [productId,setProductId]=useState(""),[quantity,setQuantity]=useState("100"),[rows,setRows]=useState<CurationCandidate[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(""),[limited,setLimited]=useState(false),[all,setAll]=useState(false),[busy,setBusy]=useState(false),[selected,setSelected]=useState<CurationCandidate|null>(null);
 const saving=useRef(false),context=useRef("");const key=`${productId}:${quantity}`;context.current=key;
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  setSelected(null);setRows([]);setAll(false);setError("");setLimited(false);
  if(!productId||!Number.isSafeInteger(Number(quantity))||Number(quantity)<=0){setLoading(false);return;}
  setLoading(true);
  void (async()=>{try{
   const response=await fetch(`/api/admin/pedia/services?view=shortlist&product_id=${productId}&quantity=${quantity}`,{cache:"no-store",signal:controller.signal});
   const data=await response.json();if(!response.ok)throw Error("Kandidat gagal dimuat. Periksa sesi atau coba jumlah lain.");
   if(active){setRows(data.rows??[]);setLimited(!!data.limited);}
  }catch(e){if(active)setError(e instanceof Error?e.message:"Kandidat gagal dimuat.");}finally{if(active)setLoading(false);}})();
  return()=>{active=false;controller.abort();};
 },[productId,quantity]);
 const product=products.find(p=>p.id===Number(productId));
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!selected||!product||saving.current)return;
  const form=event.currentTarget,fields=new FormData(form);if(fields.get("reviewed")!=="on")return;
  saving.current=true;setBusy(true);setError("");const before=context.current;
  try{
   const body={kind:"tier",product_id:product.id,supplier:selected.supplier,supplier_service_id:selected.service_id,tier:"standar",price_group:"G3",markup_pct:20,min_profit_rp:1000,refill_days:0,is_active:0,is_recommended:0,label_note:String(fields.get("public_name")),public_name:String(fields.get("public_name")),description_md:String(fields.get("description")),terms_md:String(fields.get("terms")),instructions_md:String(fields.get("instructions")),min_qty_override:Number(fields.get("min_qty")),max_qty_override:Number(fields.get("max_qty")),quantity_step:Number(fields.get("quantity_step")),target_format:String(fields.get("target_format")),refill_anchor:"created"};
   const response=await fetch("/api/admin/pedia/products",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),data=await response.json();
   if(!response.ok&&!data.saved)throw Error("Draf gagal disimpan. Kandidat mungkin sudah terhubung atau tidak tersedia.");
   if(before!==context.current)return;
   if(data.saved)throw Error("Draf tersimpan, tetapi harga belum berhasil dihitung. Buka Produk dan periksa draf sebelum mencoba lagi.");
   setSelected(null);await onCreated(product.id);
  }catch(e){setError(e instanceof Error?e.message:"Draf gagal disimpan.");}finally{saving.current=false;setBusy(false);}
 }
 return <section className="mt-4 min-w-0 space-y-5" aria-label="Kurasi terarah">
  <div><h3 className="text-lg font-semibold text-white">Kurasi berdasarkan kebutuhan</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Pilih kebutuhan dan jumlah pembanding. Kandidat kedua supplier disaring dari mirror tersimpan; nama dan flag API belum membuktikan kualitas. Draf selalu nonaktif dan tanpa janji refill sampai ditinjau.</p></div>
  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
   <label className="text-sm text-white/70">Kebutuhan produk<select aria-label="Kebutuhan produk" className={input} value={productId} disabled={busy} onChange={e=>setProductId(e.target.value)}><option value="">Pilih kebutuhan</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label className="text-sm text-white/70">Jumlah pembanding<input aria-label="Jumlah pembanding" className={input} type="number" min={1} max={100000000} step={1} value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)} /></label>
  </div>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {loading&&<p role="status" className="text-sm text-white/60">Menyaring kandidat…</p>}
  {limited&&<p className="text-sm text-amber-200">Kandidat berasal dari 200 layanan termurah yang cocok dengan pencarian awal. Daftar ini bukan seluruh katalog atau penilaian mutu.</p>}
  {!loading&&product&&<p className="text-sm text-white/60">{rows.length} kandidat untuk {Number(quantity).toLocaleString("id-ID")} · wakil wilayah/refill ditampilkan sebelum varian serupa. Seluruh modal memakai jumlah yang sama.</p>}
  <div className="space-y-3">{(all?rows:rows.slice(0,3)).map(row=><article key={`${row.supplier}:${row.service_id}`} className="rounded-2xl border border-white/10 p-4 sm:p-5">
   <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between"><div className="min-w-0 flex-1"><p className="break-words font-medium text-white">{row.name}</p><p className="mt-1 text-xs text-white/45">{row.supplier} #{row.service_id} · {row.region} · Min {row.min_qty.toLocaleString("id-ID")} / maks {row.max_qty.toLocaleString("id-ID")}</p></div><p className="text-sm text-white">Estimasi modal <strong>{formatRupiah(Math.ceil(row.estimated_cost))}</strong></p></div>
   <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-200/85">{row.warnings.map(w=><li key={w}>{w}</li>)}</ul>
   {row.used_in&&<p className="mt-2 text-xs text-white/50">Sudah dipakai: {row.used_in}</p>}
   <button type="button" disabled={busy} onClick={()=>{setSelected(row);setError("");}} className="mt-3 min-h-11 rounded-full border border-[#00E5FF]/35 px-4 text-sm text-[#00E5FF]">Siapkan draf {row.supplier} #{row.service_id}</button>
  </article>)}</div>
  {!loading&&product&&!rows.length&&<p className="text-sm text-white/60">{limited?"Belum ada kandidat cocok dalam 200 layanan pertama yang diperiksa.":"Belum ada kandidat cocok di mirror."} Gunakan Layanan Supplier untuk meninjau katalog dan ketentuan; jangan memaksa layanan yang berbeda kebutuhan.</p>}
  {!all&&rows.length>3&&<button type="button" onClick={()=>setAll(true)} className="min-h-11 text-sm text-[#00E5FF]">Lihat semua {rows.length} kandidat</button>}
  {selected&&<form key={`${selected.supplier}:${selected.service_id}`} onSubmit={save} aria-label="Draf kandidat" className="space-y-4 rounded-2xl border border-[#00E5FF]/20 p-5">
   <h4 className="font-medium text-white">Tinjau draf {product?.name}</h4>
   <label className="block text-sm text-white/70">Nama publik<input name="public_name" required maxLength={200} defaultValue={selected.suggested_name} className={input}/></label>
   <label className="block text-sm text-white/70">Ringkasan<textarea name="description" maxLength={3000} defaultValue={selected.suggested_description} className={input}/></label>
   <label className="block text-sm text-white/70">Ketentuan<textarea name="terms" maxLength={3000} rows={4} defaultValue={selected.suggested_terms} className={input}/></label>
   <label className="block text-sm text-white/70">Panduan<textarea name="instructions" maxLength={3000} defaultValue={selected.suggested_instructions} className={input}/></label>
   <div className="grid gap-3 sm:grid-cols-3">
    <label className="text-sm text-white/70">Jumlah minimum<input name="min_qty" type="number" min={selected.min_qty} max={Math.min(selected.max_qty,100000000)} required defaultValue={selected.min_qty} className={input}/></label>
    <label className="text-sm text-white/70">Jumlah maksimum<input name="max_qty" type="number" min={selected.min_qty} max={Math.min(selected.max_qty,100000000)} required defaultValue={Math.min(selected.max_qty,100000000)} className={input}/></label>
    <label className="text-sm text-white/70">Kelipatan jumlah<input name="quantity_step" type="number" min={1} max={100000} required defaultValue={selected.name.match(/kelipatan\s*(\d+)/i)?.[1]??1} className={input}/></label>
   </div>
   <label className="block text-sm text-white/70">Format target supplier<select name="target_format" defaultValue="url" className={input}><option value="url">Link lengkap</option><option value="username">Username dari link profil</option></select></label>
   <label className="flex min-h-11 items-start gap-3 text-sm leading-6 text-white/70"><input type="checkbox" required name="reviewed" className="mt-1.5"/>Saya telah memeriksa deskripsi supplier, format target, batas/kelipatan, dan ketentuan. Draf ini belum boleh dianggap hasil uji berbayar.</label>
   <div className="flex gap-3"><button disabled={busy} className="min-h-11 rounded-full bg-[#00E5FF] px-5 text-sm font-semibold text-[#080C1E]">{busy?"Menyimpan…":"Simpan draf nonaktif"}</button><button type="button" disabled={busy} onClick={()=>setSelected(null)} className="min-h-11 px-3 text-sm text-white/60">Batal</button></div>
  </form>}
 </section>;
}
