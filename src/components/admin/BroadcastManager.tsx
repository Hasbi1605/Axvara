"use client";
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CHANNELS,CHANNEL_LABELS,UUID,type BroadcastChannel,type BroadcastContent,type BroadcastTemplate,type BroadcastSnapshot } from '@/lib/broadcasts/model';
import { formatWibDateTime } from '@/lib/utils';
type Progress={channel:BroadcastChannel;status:string;n:number;last_error?:string};
type Campaign={id:string;content:BroadcastContent;channels:BroadcastChannel[];status:string;created_at:string;progress:Progress[]};
type Launch={action:'send';id:string;templateId:string;revision:number;channels:BroadcastChannel[];waIdentity?:{botNumber:string;botRevision:string;groupId:string}};
type Review={snapshot:BroadcastSnapshot;counts:Partial<Record<BroadcastChannel,number>>};
const EMPTY:BroadcastContent={name:'',title:'',body:'',cta_label:'',cta_url:''};
const PENDING='axvara-broadcast-pending';
const STATUS:Record<string,string>={pending:'Menunggu',sending:'Diproses',sent:'Terkirim',failed:'Gagal',unknown:'Perlu diperiksa',skipped:'Dilewati',canceled:'Dihentikan'};
const field='w-full rounded-xl border border-white/10 bg-[#101428] px-3 py-3 text-sm text-white outline-none focus:border-cyan-400/60';
const button='min-h-11 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/80 disabled:opacity-40';
function contentOf(t:BroadcastTemplate):BroadcastContent{return {name:t.name,title:t.title,body:t.body,cta_label:t.cta_label,cta_url:t.cta_url};}
export function BroadcastManager(){
 const [templates,setTemplates]=useState<BroadcastTemplate[]>([]),[campaigns,setCampaigns]=useState<Campaign[]>([]);
 const [selected,setSelected]=useState<BroadcastTemplate|null>(null),[draft,setDraft]=useState<BroadcastContent>({...EMPTY});
 const [channels,setChannels]=useState<BroadcastChannel[]>([]),[review,setReview]=useState<Review|null>(null);
 const [pending,setPending]=useState<Launch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [cancelId,setCancelId]=useState<string|null>(null);
 const dirty=JSON.stringify(draft)!==JSON.stringify(selected?contentOf(selected):EMPTY);
 function clearPending(){sessionStorage.removeItem(PENDING);setPending(null);}
 async function load(){
  const response=await fetch('/api/admin/broadcasts',{cache:'no-store'});const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Siaran gagal dimuat.');
  setTemplates(data.templates||[]);setCampaigns(data.campaigns||[]);
  const stored=sessionStorage.getItem(PENDING);if(stored){try{const p=JSON.parse(stored);if((data.campaigns||[]).some((c:Campaign)=>c.id===p.id))clearPending();}catch{clearPending();}}
  return data as {templates:BroadcastTemplate[];campaigns:Campaign[]};
 }
 useEffect(()=>{try{const p=JSON.parse(sessionStorage.getItem(PENDING)||'null');if(p&&UUID.test(p.id))setPending(p);}catch{sessionStorage.removeItem(PENDING);}void load().catch(e=>setError(e.message));},[]);
 async function post(body:unknown){
  const response=await fetch('/api/admin/broadcasts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){if((body as {action?:string}).action==='send'&&[400,409].includes(response.status))clearPending();throw new Error(data.error||'Permintaan belum berhasil.');}
  return data;
 }
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Permintaan belum berhasil.');}finally{setBusy(false);}}
 function choose(t:BroadcastTemplate|null){setSelected(t);setDraft(t?contentOf(t):{...EMPTY});setReview(null);setChannels([]);setError('');}
 function update(key:keyof BroadcastContent,value:string){setDraft(v=>({...v,[key]:value}));setReview(null);}
 async function save(){const result=await post({action:'save',id:selected?.id,revision:selected?.revision,content:draft});const data=await load();const saved=data.templates.find(t=>t.id===result.id);if(saved)choose(saved);setNotice('Template disimpan dan bisa dipakai berulang.');}
 async function send(payload:Launch){
  sessionStorage.setItem(PENDING,JSON.stringify(payload));setPending(payload);
  await post(payload);clearPending();setReview(null);setNotice('Siaran masuk antrean. Perbarui riwayat untuk melihat perkembangannya.');await load();
 }
 return <section className="mt-4 space-y-5" aria-label="Siaran admin">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[.16em] text-cyan-400">KONTEN</p><h1 className="mt-1 text-xl font-bold text-white">Siaran</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Simpan pesan sebagai template, pilih tujuan, lalu kirim saat dibutuhkan. Template tetap tersedia setelah digunakan.</p></div><button className={button} disabled={busy} onClick={()=>void run(async()=>{await load();})}>Perbarui riwayat</button></div>
  {error&&<p role="alert" className="rounded-xl border border-amber-300/20 p-3 text-sm text-amber-200">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-cyan-400/20 p-3 text-sm text-cyan-200">{notice}</p>}
  {pending&&<div className="rounded-xl border border-amber-300/20 p-4"><p className="text-sm leading-6 text-amber-200">Pengiriman sebelumnya belum terkonfirmasi. Perbarui riwayat atau coba lagi; percobaan ini akan memeriksa pengiriman yang sama.</p><button className={button+' mt-3'} disabled={busy} onClick={()=>void run(()=>send(pending))}>Coba lagi pengiriman</button></div>}
  <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
   <aside className="ax-glass rounded-[22px] p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-white">Template</h2><button className={button} disabled={busy||dirty||!!pending} onClick={()=>choose(null)}>Buat baru</button></div>
    <div className="mt-4 space-y-2">{templates.map(t=><button type="button" key={t.id} disabled={busy||dirty||!!pending} onClick={()=>choose(t)} className={`w-full rounded-xl border p-3 text-left text-sm disabled:opacity-50 ${selected?.id===t.id?'border-cyan-400/50 bg-cyan-400/10 text-white':'border-white/10 text-white/60'}`}><span className="block break-words font-medium">{t.name}</span><span className="mt-1 block text-xs opacity-60">{t.archived?'Diarsipkan':'Siap dipakai'}</span></button>)}{!templates.length&&<p className="text-sm leading-6 text-white/40">Belum ada template. Buat pesan pertama di editor.</p>}</div>
   </aside>
   <div className="ax-glass min-w-0 rounded-[22px] p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-white">{selected?'Edit template':'Template baru'}</h2>{selected&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy||dirty||!!pending} onClick={()=>{setSelected(null);setDraft({...contentOf(selected),name:selected.name+' (salinan)'});setReview(null);}}>Salin template</button><button className={button} disabled={busy||dirty||!!pending} onClick={()=>void run(async()=>{await post({action:'archive',id:selected.id,revision:selected.revision,archived:!selected.archived});choose(null);await load();})}>{selected.archived?'Pulihkan template':'Arsipkan'}</button></div>}</div>
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();void run(save);}}>
     <fieldset disabled={busy||!!pending||!!selected?.archived} className="space-y-4 disabled:opacity-60">
      <label className="block text-xs text-white/60">Nama template<input className={field+' mt-2'} value={draft.name} maxLength={80} required onChange={e=>update('name',e.target.value)} placeholder="Misalnya: Promo akhir pekan"/></label>
      <label className="block text-xs text-white/60">Judul / subjek email<input className={field+' mt-2'} value={draft.title} maxLength={120} required onChange={e=>update('title',e.target.value)} placeholder="Judul yang dilihat penerima"/></label>
      <label className="block text-xs text-white/60">Isi siaran<textarea className={field+' mt-2 min-h-52 resize-y leading-6'} value={draft.body} maxLength={3000} required onChange={e=>update('body',e.target.value)} placeholder="Tulis informasi atau promosi di sini…"/></label>
      <p className="text-right text-xs text-white/35">{draft.body.length}/3000 karakter</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs text-white/60">Label tombol (opsional)<input className={field+' mt-2'} value={draft.cta_label} maxLength={24} onChange={e=>update('cta_label',e.target.value)} placeholder="Lihat produk"/></label><label className="block min-w-0 text-xs text-white/60">Tautan tombol<input className={field+' mt-2'} value={draft.cta_url} maxLength={500} onChange={e=>update('cta_url',e.target.value)} placeholder="https://… atau /produk"/></label></div>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" className="min-h-11 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#080c1e] disabled:opacity-40" disabled={!dirty||!draft.name.trim()||!draft.title.trim()||!draft.body.trim()}>Simpan template</button>{dirty&&<button type="button" className={button} onClick={()=>choose(selected)}>Batal perubahan</button>}<span className="text-xs text-white/40">{dirty?'Perubahan belum disimpan.':'Isi tersimpan; siap dipakai kembali.'}</span></div>
     </fieldset>
    </form>
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[.025] p-4"><h3 className="text-xs font-semibold uppercase tracking-widest text-white/40">Pratinjau pesan</h3><p className="mt-3 break-words font-semibold text-white">{draft.title||'Judul siaran'}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/65">{draft.body||'Pesan Anda akan tampil di sini.'}</p>{draft.cta_label&&<span className="mt-4 inline-block max-w-full break-words rounded-lg border border-cyan-400/30 px-3 py-2 text-sm text-cyan-200">{draft.cta_label}</span>}<p className="mt-4 text-xs leading-5 text-white/35">Email dan Telegram menyertakan cara berhenti menerima siaran. Teks dipertahankan; format mengikuti kanal tujuan.</p></div>
    <fieldset disabled={busy||dirty||!!pending||!selected||!!selected.archived} className="mt-6 space-y-3 disabled:opacity-50"><legend className="text-sm font-semibold text-white">Tujuan siaran</legend><div className="flex flex-wrap gap-3">{CHANNELS.map(channel=><label key={channel} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-white/75"><input type="checkbox" checked={channels.includes(channel)} onChange={e=>{setChannels(v=>e.target.checked?[...v,channel]:v.filter(c=>c!==channel));setReview(null);}}/>{CHANNEL_LABELS[channel]}</label>)}</div><button className={button} disabled={!channels.length} onClick={()=>void run(async()=>{setReview(await post({action:'review',templateId:selected!.id,revision:selected!.revision,channels}));})}>Tinjau siaran</button></fieldset>
    {review&&!dirty&&selected&&<div className="mt-5 rounded-2xl border border-cyan-400/25 bg-cyan-400/5 p-4"><h3 className="font-semibold text-white">Tinjau sebelum mengirim</h3><ul className="mt-3 space-y-2 text-sm text-white/70">{channels.map(c=><li key={c}>{CHANNEL_LABELS[c]}: {review.counts[c]||0} {c==='whatsapp'?'grup':'penerima'}</li>)}</ul>{review.snapshot.wa&&<p className="mt-2 text-xs text-white/50">Bot {review.snapshot.wa.botNumber} · Grup AXVARA&apos;S</p>}<p className="mt-3 text-xs leading-6 text-white/50">Jumlah akhir mengikuti penerima aktif saat siaran mulai. Pengiriman berlangsung bertahap. Menyimpan template saja tidak mengirim pesan.</p><button className="mt-4 min-h-11 rounded-xl bg-cyan-400 px-5 text-sm font-bold text-[#080c1e] disabled:opacity-40" disabled={busy||!!pending} onClick={()=>void run(()=>send({action:'send',id:crypto.randomUUID(),templateId:selected.id,revision:selected.revision,channels,...(review.snapshot.wa?{waIdentity:{botNumber:review.snapshot.wa.botNumber,botRevision:review.snapshot.wa.botRevision,groupId:review.snapshot.wa.destination}}:{})}))}>Kirim siaran sekarang</button></div>}
   </div>
  </div>
  <section className="ax-glass rounded-[22px] p-4 sm:p-5" aria-label="Riwayat siaran"><h2 className="font-semibold text-white">Riwayat pengiriman</h2><p className="mt-2 text-xs leading-6 text-white/40">Terkirim berarti diterima layanan pengirim, bukan bukti dibaca. Hasil yang belum pasti ditandai Perlu diperiksa dan tidak dikirim ulang otomatis.</p><div className="mt-4 space-y-3">{campaigns.map(c=><article key={c.id} className="rounded-xl border border-white/10 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold text-white">{c.content.title}</p><p className="mt-1 text-xs text-white/40">{formatWibDateTime(c.created_at)} WIB · {c.status==='queued'?'Dalam antrean':c.status==='completed'?'Selesai':'Dihentikan'}</p></div>{c.status==='queued'&&<button className={button} disabled={busy} onClick={()=>setCancelId(c.id)}>Hentikan</button>}</div><div className="mt-3 space-y-2">{c.channels.map(channel=><div key={channel} className="text-xs leading-6 text-white/55"><span className="font-semibold text-white/75">{CHANNEL_LABELS[channel]}</span> · {c.progress.filter(p=>p.channel===channel).map(p=>`${STATUS[p.status]||p.status}: ${p.n}`).join(' · ')||'Tidak ada penerima'}{c.progress.some(p=>p.channel===channel&&p.last_error==='bot_changed_review_required')&&<p className="text-amber-200">Nomor bot berubah. Hentikan siaran ini dan tinjau pengiriman baru.</p>}</div>)}</div></article>)}{!campaigns.length&&<p className="py-5 text-sm text-white/40">Belum ada siaran yang dikirim.</p>}</div></section>
  <ConfirmDialog open={!!cancelId} title="Hentikan siaran?" description="Penerima yang belum diproses akan dihentikan. Pesan yang sudah terkirim atau sedang diproses mungkin tetap diterima." confirmLabel="Hentikan siaran" loading={busy} onClose={()=>!busy&&setCancelId(null)} onConfirm={()=>void run(async()=>{await post({action:'cancel',id:cancelId});setCancelId(null);await load();})}/>
 </section>;
}
