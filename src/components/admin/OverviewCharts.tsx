"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { ReportBucket, ReportPoint } from "@/lib/dashboard-report";

const compact = (value: number) => {
  const v = Math.abs(value), sign = value < 0 ? "−" : "";
  return sign + (v >= 1e6 ? `${(v / 1e6).toFixed(1)}jt` : v >= 1000 ? `${Math.round(v / 1000)}rb` : `${Math.round(v)}`);
};

export function ProfitChart({ series, loading, label = "30 hari" }: { series: ReportPoint[]; loading: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null), id = useId().replace(/:/g, "");
  const [width, setWidth] = useState(640), [active, setActive] = useState<number | null>(null);
  const [show, setShow] = useState({ revenue: true, profit: true, orders: false });
  useEffect(() => {
    const node = ref.current; if (!node) return;
    const resize = () => { const w = node.getBoundingClientRect().width; if (w > 0) setWidth(Math.max(280, w)); };
    resize();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }
    const observer = new ResizeObserver(resize); observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => setActive(null), [series]);
  const values = useMemo(() => series.flatMap(p => [0, ...(show.revenue ? [p.revenue] : []), ...(show.profit ? [p.profit] : [])]), [series, show.revenue, show.profit]);
  const min = Math.min(0, ...values), max = Math.max(1, ...values), maxOrders = Math.max(1, ...series.map(p => p.orders));
  const H = 250, L = 54, R = show.orders ? 34 : 14, T = 18, B = 30, inner = width-L-R;
  const x = (i: number) => series.length < 2 ? L+inner/2 : L+i*inner/(series.length-1);
  const y = (v: number) => T+(max-v)/(max-min)*(H-T-B);
  const yo = (v: number) => H-B-v/maxOrders*(H-T-B);
  const path = (field: "revenue" | "profit" | "orders") => series.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${(field==='orders'?yo(p[field]):y(p[field])).toFixed(1)}`).join(' ');
  const selected = active == null ? null : series[active];
  return <section className="ax-glass min-w-0 rounded-[20px] p-4 sm:p-5" aria-label={`Grafik omzet dan untung ${label}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-white">Omzet vs Untung — {label}</h2><p className="mt-1 text-xs text-white/40">WIB · {loading ? 'Memuat…' : 'Ketuk atau arahkan kursor untuk detail'}{show.orders ? ' · Sumbu kanan: jumlah order' : ''}</p></div>
      <div className="flex gap-1.5">{([['revenue','Omzet','#00E5FF'],['profit','Untung','#34D399'],['orders','Order','#FFB800']] as const).map(([key,text,color])=><button key={key} type="button" aria-pressed={show[key]} onClick={()=>setShow(s=>({...s,[key]:!s[key]}))} className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold ${show[key]?'border-white/15 bg-white/[0.07] text-white':'border-white/10 text-white/35'}`}><span className="h-1.5 w-1.5 rounded-full" style={{background:color}} />{text}</button>)}</div>
    </div>
    <div ref={ref} className="relative mt-4 min-w-0">
      <svg viewBox={`0 0 ${width} ${H}`} style={{width:'100%',height:H}} role="img" aria-label={`Grafik garis omzet, untung, dan order ${label}`} onMouseLeave={()=>setActive(null)}>
        <defs>{(['revenue','profit'] as const).map(key=><linearGradient id={`${id}-${key}`} key={key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={key==='revenue'?'#00E5FF':'#34D399'} stopOpacity="0.2"/><stop offset="100%" stopColor={key==='revenue'?'#00E5FF':'#34D399'} stopOpacity="0"/></linearGradient>)}</defs>
        {Array.from({length:5},(_,i)=>min+(max-min)*i/4).map((v,i)=><g key={i}><line x1={L} x2={width-R} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)"/><text x={L-7} y={y(v)+4} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="10">{compact(v)}</text>{show.orders&&<text x={width-R+6} y={yo(maxOrders*i/4)+4} fill="#FFCF55" fontSize="10">{Math.round(maxOrders*i/4)}</text>}</g>)}
        {min<0&&<line data-testid="profit-zero-line" x1={L} x2={width-R} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3"/>}
        {(['revenue','profit','orders'] as const).map(field=>show[field]&&series.length>0&&<g key={field}>
          {field!=='orders'&&series.length>1&&<path d={`${path(field)} L${x(series.length-1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-${field})`}/>}
          <path data-series={field} d={path(field)} fill="none" stroke={field==='revenue'?'#00E5FF':field==='profit'?'#34D399':'#FFB800'} strokeWidth="2" strokeDasharray={field==='orders'?'5 4':undefined} strokeLinejoin="round"/>
          {(series.length===1||selected)&&<circle cx={x(active??0)} cy={field==='orders'?yo((selected??series[0])[field]):y((selected??series[0])[field])} r="4" fill={field==='revenue'?'#00E5FF':field==='profit'?'#34D399':'#FFB800'}/>}
        </g>)}
        {series.map((p,i)=><g key={p.date}>
          {(i%Math.max(1,Math.ceil(series.length/5))===0||i===series.length-1)&&<text x={x(i)} y={H-8} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10">{p.date.includes(':')?p.date:`${p.date.slice(8)}/${p.date.slice(5,7)}`}</text>}
          <rect x={i===0?L:(x(i-1)+x(i))/2} y={T} width={series.length===1?inner:i===0||i===series.length-1?inner/(series.length-1)/2:inner/(series.length-1)} height={H-T-B} fill="transparent" tabIndex={0} role="button" aria-label={`${p.date}, ${p.orders} order, untung ${formatRupiah(p.profit)}`} onFocus={()=>setActive(i)} onMouseEnter={()=>setActive(i)} onClick={()=>setActive(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(i);}}}><title>{`${p.date} · ${p.orders} order · omzet ${formatRupiah(p.revenue)} · untung ${formatRupiah(p.profit)}`}</title></rect>
        </g>)}
        {!series.length&&<text x={width/2} y={H/2} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="12">Belum ada transaksi pada periode ini</text>}
      </svg>
      {selected&&<div role="status" className="pointer-events-none absolute right-0 top-0 max-w-full rounded-xl border border-white/15 bg-[#0B1025]/95 px-3 py-2 shadow-xl"><p className="text-[11px] text-white/55">{selected.date} WIB</p><p className={`mt-1 font-bold ${selected.profit<0?'text-red-300':'text-emerald-300'}`}>{formatRupiah(selected.profit)}</p><p className="mt-1 text-[11px] text-white/50">{selected.orders} order · omzet {formatRupiah(selected.revenue)} · modal {formatRupiah(selected.cost)}</p></div>}
    </div>
  </section>;
}

export type NamedBucket = ReportBucket & { label: string; color: string };
export function RevenueDonut({ rows, loading }: { rows: NamedBucket[]; loading: boolean }) {
  const total = rows.reduce((n,r)=>n+r.revenue,0); let angle = -Math.PI/2;
  const position = (a:number) => `${(80+70*Math.cos(a)).toFixed(2)},${(80+70*Math.sin(a)).toFixed(2)}`;
  const arcs = rows.filter(r=>r.revenue>0).map(r=>{
    const start=angle, share=r.revenue/Math.max(1,total); angle+=share*Math.PI*2;
    return {...r, full:share>=1, path:`M${position(start)} A70,70 0 ${share>0.5?1:0} 1 ${position(angle)}`};
  });
  return <section className="ax-glass flex flex-col rounded-[20px] p-4 sm:p-5" aria-label="Kontribusi omzet">
    <h2 className="text-sm font-semibold text-white">Kontribusi omzet</h2><p className="mt-1 text-xs text-white/40">Menurut asal produk · periode terpilih</p>
    <div className="my-5 flex justify-center"><div role="img" aria-label={total?rows.map(r=>`${r.label} ${(r.revenue/total*100).toFixed(1)}%`).join(', '):'Belum ada omzet'} className="relative flex h-40 w-40 items-center justify-center rounded-full">
      <svg viewBox="0 0 160 160" aria-hidden="true" className="absolute inset-0 h-full w-full"><circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="20"/>{arcs.map(r=>r.full?<circle key={r.label} cx="80" cy="80" r="70" fill="none" stroke={r.color} strokeWidth="20"/>:<path key={r.label} d={r.path} fill="none" stroke={r.color} strokeWidth="20"/>)}</svg>
      <div className="relative flex h-[124px] w-[124px] flex-col items-center justify-center rounded-full bg-[#0B1025]"><span className="text-[10px] text-white/45">Total omzet</span><span className="mt-1 text-sm font-bold tabular-nums text-white">{loading?'—':formatRupiah(total)}</span></div></div></div>
    <div className="mt-auto space-y-2">{rows.map(r=><div key={r.label} className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-white/65"><span className="h-2 w-2 rounded-full" style={{background:r.color}}/>{r.label}</span><span className="tabular-nums text-white/80">{loading?'—':`${total?(r.revenue/total*100).toFixed(1):'0.0'}%`}</span></div>)}</div>
  </section>;
}

export function ProfitBars({ title, rows, loading }: { title: string; rows: NamedBucket[]; loading: boolean }) {
  const max = Math.max(1,...rows.map(r=>Math.abs(r.profit))), losses=rows.some(r=>r.profit<0);
  return <section className="ax-glass rounded-[20px] p-4 sm:p-5"><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-white/40">Periode terpilih · untung produk</p><div className="mt-4 space-y-4">{rows.map(r=><div key={r.label}>
    <div className="flex justify-between gap-3 text-xs"><span className="font-semibold text-white/75">{r.label}</span><span className={`font-bold tabular-nums ${r.profit<0?'text-red-300':'text-emerald-300'}`}>{loading?'—':formatRupiah(r.profit)}</span></div>
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">{losses&&<span className="absolute inset-y-0 left-1/2 w-px bg-white/30"/>}<span className="absolute inset-y-0 rounded-full" style={{width:`${Math.abs(r.profit)/max*(losses?50:100)}%`,left:losses?(r.profit<0?`${50-Math.abs(r.profit)/max*50}%`:'50%'):'0%',background:r.profit<0?'#F87171':r.color}}/></div>
    <p className="mt-1 text-[10px] leading-4 text-white/40">{r.orders} pesanan · omzet {formatRupiah(r.revenue)} · modal {formatRupiah(r.cost)} · margin {r.revenue?`${(r.profit/r.revenue*100).toFixed(1)}%`:'—'}</p>
  </div>)}</div></section>;
}
