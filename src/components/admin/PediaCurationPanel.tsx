"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CurationCandidate, CurationProduct } from "@/lib/pedia/curation-shortlist";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Card, CardContent, Checkbox, Input, Label, NativeSelect, Separator, Skeleton, Textarea } from "@/components/admin/ui";
import { Field } from "./pedia/shared";

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
   <div><h3 className="text-base font-semibold text-admin-fg">Bandingkan per kebutuhan</h3><p className="mt-1 max-w-3xl text-sm leading-5 text-admin-muted">Bandingkan layanan IndoSMM untuk jumlah yang sama. Nama dan dukungan API bukan bukti kualitas. Draf dibuat nonaktif, tanpa janji refill sampai ditinjau.</p></div>
  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
   <Field label="Kebutuhan produk"><NativeSelect aria-label="Kebutuhan produk" value={productId} disabled={busy} onChange={e=>setProductId(e.target.value)}><option value="">Pilih kebutuhan</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
   <Field label="Jumlah pembanding"><Input aria-label="Jumlah pembanding" type="number" min={1} max={100000000} step={1} value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)} /></Field>
  </div>
  {error&&<div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{error}</div>}
  {loading&&<div className="space-y-2" role="status"><span className="text-sm text-admin-muted">Menyaring kandidat…</span><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
  {limited&&<p className="text-sm text-admin-warning">Kandidat berasal dari 200 layanan termurah yang cocok dengan pencarian awal. Daftar ini bukan seluruh katalog atau penilaian mutu.</p>}
  {!loading&&product&&<p className="text-sm text-admin-muted">{rows.length} kandidat untuk {Number(quantity).toLocaleString("id-ID")} · wakil wilayah/refill ditampilkan sebelum varian serupa. Seluruh modal memakai jumlah yang sama.</p>}
  <div className="space-y-3">{(all?rows:rows.slice(0,3)).map(row=><Card key={`${row.supplier}:${row.service_id}`}>
    <CardContent className="space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between">
        <div className="min-w-0 flex-1"><p className="break-words font-medium text-admin-fg">{row.name}</p><p className="mt-1 text-xs text-admin-muted">IndoSMM #{row.service_id} · {row.region} · Min {row.min_qty.toLocaleString("id-ID")} / maks {row.max_qty.toLocaleString("id-ID")}</p></div>
        <p className="text-sm text-admin-fg">Estimasi modal <strong className="tabular-nums">{formatRupiah(Math.ceil(row.estimated_cost))}</strong></p>
      </div>
      <ul className="space-y-1 text-xs leading-5 text-admin-warning">{row.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      {row.used_in&&<p className="text-xs text-admin-muted">Sudah dipakai: {row.used_in}</p>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>{setSelected(row);setError("");}}>Siapkan draf IndoSMM #{row.service_id}</Button>
    </CardContent>
  </Card>)}</div>
   {!loading&&product&&!rows.length&&<p className="text-sm text-admin-muted">{limited?"Belum ada kandidat cocok dalam 200 layanan pertama yang diperiksa.":"Belum ada kandidat cocok di katalog."} Gunakan Semua layanan untuk meninjau layanan dan ketentuan.</p>}
  {!all&&rows.length>3&&<Button type="button" variant="outline" size="sm" onClick={()=>setAll(true)}>Lihat semua {rows.length} kandidat</Button>}
  {selected&&<Card className="border-admin-accent/30">
    <CardContent className="p-4">
      <form key={`${selected.supplier}:${selected.service_id}`} onSubmit={save} aria-label="Draf kandidat" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><h4 className="font-medium text-admin-fg">Tinjau draf {product?.name}</h4><Badge variant="secondary">Nonaktif</Badge></div>
        <Field label="Nama publik"><Input name="public_name" required maxLength={200} defaultValue={selected.suggested_name}/></Field>
        <Field label="Ringkasan"><Textarea name="description" maxLength={3000} defaultValue={selected.suggested_description}/></Field>
        <Field label="Ketentuan"><Textarea name="terms" maxLength={3000} rows={4} defaultValue={selected.suggested_terms}/></Field>
        <Field label="Panduan"><Textarea name="instructions" maxLength={3000} defaultValue={selected.suggested_instructions}/></Field>
        <Separator />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Jumlah minimum"><Input name="min_qty" type="number" min={selected.min_qty} max={Math.min(selected.max_qty,100000000)} required defaultValue={selected.min_qty}/></Field>
          <Field label="Jumlah maksimum"><Input name="max_qty" type="number" min={selected.min_qty} max={Math.min(selected.max_qty,100000000)} required defaultValue={Math.min(selected.max_qty,100000000)}/></Field>
          <Field label="Kelipatan jumlah"><Input name="quantity_step" type="number" min={1} max={100000} required defaultValue={selected.name.match(/kelipatan\s*(\d+)/i)?.[1]??1}/></Field>
        </div>
        <Field label="Format target supplier"><NativeSelect name="target_format" defaultValue="url"><option value="url">Link lengkap</option><option value="username">Username dari link profil</option></NativeSelect></Field>
        <div className="flex items-start gap-3">
          <Checkbox id="curation-reviewed" required name="reviewed" className="mt-0.5" />
          <Label htmlFor="curation-reviewed" className="text-sm font-normal leading-6 text-admin-muted">Saya telah memeriksa deskripsi supplier, format target, batas/kelipatan, dan ketentuan. Draf ini belum boleh dianggap hasil uji berbayar.</Label>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy}>{busy?"Menyimpan…":"Simpan draf nonaktif"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={()=>setSelected(null)}>Batal</Button>
        </div>
      </form>
    </CardContent>
  </Card>}
 </section>;
}
