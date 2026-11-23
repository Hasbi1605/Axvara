"use client";
import { Button, Card, CardHeader } from "@/components/admin/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { ReportBucket, ReportPoint } from "@/lib/dashboard-report";
import { SupplierBadge } from "./supplier-style";

const compact = (value: number) => {
  const v = Math.abs(value), sign = value < 0 ? "−" : "";
  return sign + (v >= 1e6 ? `${(v / 1e6).toFixed(1)}jt` : v >= 1000 ? `${Math.round(v / 1000)}rb` : `${Math.round(v)}`);
};

export function ProfitChart({ series, loading, label = "30 hari", profitLabel = "Untung" }: { series: Pick<ReportPoint, "date" | "orders" | "revenue" | "cost" | "profit">[]; loading: boolean; label?: string; profitLabel?: string }) {
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
  return <Card className="admin-surface min-w-0 rounded-xl p-4 sm:p-5" aria-label={`Grafik omzet dan ${profitLabel.toLowerCase()} ${label}`}>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 p-0">
      <div><h2 className="text-sm font-semibold text-admin-fg">Omzet vs {profitLabel} — {label}</h2><p className="mt-1 text-xs text-admin-muted">WIB{loading ? ' · Memuat…' : ''}{show.orders ? ' · Sumbu kanan: jumlah order' : ''}</p></div>
      <div className="flex gap-1.5">{([['revenue','Omzet','rgb(var(--admin-accent))'],['profit',profitLabel,'rgb(var(--admin-success))'],['orders','Order','rgb(var(--admin-warning))']] as const).map(([key,text,color])=><Button variant="outline" key={key} type="button" aria-pressed={show[key]} onClick={()=>setShow(s=>({...s,[key]:!s[key]}))} className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${show[key]?'border-admin-border bg-admin-subtle text-admin-fg':'border-admin-border text-admin-muted'}`}><span className="h-1.5 w-1.5 rounded-md" style={{background:color}} />{text}</Button>)}</div>
    </CardHeader>
    <div ref={ref} className="relative mt-4 min-w-0">
      <svg viewBox={`0 0 ${width} ${H}`} style={{width:'100%',height:H}} role="img" aria-label={`Grafik garis omzet, untung, dan order ${label}`} onMouseLeave={()=>setActive(null)}>
        <defs>{(['revenue','profit'] as const).map(key=><linearGradient id={`${id}-${key}`} key={key} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={key==='revenue'?'rgb(var(--admin-accent))':'rgb(var(--admin-success))'} stopOpacity="0.2"/><stop offset="100%" stopColor={key==='revenue'?'rgb(var(--admin-accent))':'rgb(var(--admin-success))'} stopOpacity="0"/></linearGradient>)}</defs>
        {Array.from({length:5},(_,i)=>min+(max-min)*i/4).map((v,i)=><g key={i}><line x1={L} x2={width-R} y1={y(v)} y2={y(v)} stroke="rgb(var(--admin-border))"/><text x={L-7} y={y(v)+4} textAnchor="end" fill="rgb(var(--admin-muted))" fontSize="10">{compact(v)}</text>{show.orders&&<text x={width-R+6} y={yo(maxOrders*i/4)+4} fill="rgb(var(--admin-warning))" fontSize="10">{Math.round(maxOrders*i/4)}</text>}</g>)}
        {min<0&&<line data-testid="profit-zero-line" x1={L} x2={width-R} y1={y(0)} y2={y(0)} stroke="rgb(var(--admin-muted))" strokeDasharray="3 3"/>}
        {(['revenue','profit','orders'] as const).map(field=>show[field]&&series.length>0&&<g key={field}>
          {field!=='orders'&&series.length>1&&<path d={`${path(field)} L${x(series.length-1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-${field})`}/>}
          <path data-series={field} d={path(field)} fill="none" stroke={field==='revenue'?'rgb(var(--admin-accent))':field==='profit'?'rgb(var(--admin-success))':'rgb(var(--admin-warning))'} strokeWidth="2" strokeDasharray={field==='orders'?'5 4':undefined} strokeLinejoin="round"/>
          {(series.length===1||selected)&&<circle cx={x(active??0)} cy={field==='orders'?yo((selected??series[0])[field]):y((selected??series[0])[field])} r="4" fill={field==='revenue'?'rgb(var(--admin-accent))':field==='profit'?'rgb(var(--admin-success))':'rgb(var(--admin-warning))'}/>}
        </g>)}
        {series.map((p,i)=><g key={p.date}>
          {(i%Math.max(1,Math.ceil(series.length/5))===0||i===series.length-1)&&<text x={x(i)} y={H-8} textAnchor="middle" fill="rgb(var(--admin-muted))" fontSize="10">{p.date.includes(':')?p.date:`${p.date.slice(8)}/${p.date.slice(5,7)}`}</text>}
          <rect x={i===0?L:(x(i-1)+x(i))/2} y={T} width={series.length===1?inner:i===0||i===series.length-1?inner/(series.length-1)/2:inner/(series.length-1)} height={H-T-B} fill="transparent" tabIndex={0} role="button" aria-label={`${p.date}, ${p.orders} order, ${profitLabel.toLowerCase()} ${formatRupiah(p.profit)}`} onFocus={()=>setActive(i)} onMouseEnter={()=>setActive(i)} onClick={()=>setActive(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(i);}}}><title>{`${p.date} · ${p.orders} order · omzet ${formatRupiah(p.revenue)} · ${profitLabel.toLowerCase()} ${formatRupiah(p.profit)}`}</title></rect>
        </g>)}
        {!series.length&&<text x={width/2} y={H/2} textAnchor="middle" fill="rgb(var(--admin-muted))" fontSize="12">Belum ada transaksi pada periode ini</text>}
      </svg>
      {selected&&<div role="status" className="pointer-events-none absolute right-0 top-0 max-w-full rounded-xl border border-admin-border bg-admin-card/95 px-3 py-2 shadow-xl"><p className="text-xs text-admin-muted">{selected.date} WIB</p><p className="mt-1 font-semibold text-admin-fg">{profitLabel} {formatRupiah(selected.profit)}</p><p className="mt-1 text-xs text-admin-muted">{selected.orders} order · omzet {formatRupiah(selected.revenue)} · modal {formatRupiah(selected.cost)}{selected.revenue-selected.cost-selected.profit!==0?` · biaya & pengeluaran ${formatRupiah(selected.revenue-selected.cost-selected.profit)}`:""}</p></div>}
    </div>
  </Card>;
}

export type NamedBucket = ReportBucket & { label: string; color: string; supplierBadge?: "StoreBat" | "Mirai" | "Pixel" };
export function RevenueDonut({ rows, loading }: { rows: NamedBucket[]; loading: boolean }) {
  const total = rows.reduce((n,r)=>n+r.revenue,0); let angle = -Math.PI/2;
  const position = (a:number) => `${(80+70*Math.cos(a)).toFixed(2)},${(80+70*Math.sin(a)).toFixed(2)}`;
  const arcs = rows.filter(r=>r.revenue>0).map(r=>{
    const start=angle, share=r.revenue/Math.max(1,total); angle+=share*Math.PI*2;
    return {...r, full:share>=1, path:`M${position(start)} A70,70 0 ${share>0.5?1:0} 1 ${position(angle)}`};
  });
  return <Card className="admin-surface flex flex-col rounded-xl p-4 sm:p-5" aria-label="Kontribusi omzet">
    <CardHeader className="space-y-1 p-0"><h2 className="text-sm font-semibold text-admin-fg">Kontribusi omzet</h2><p className="text-xs text-admin-muted">Menurut asal produk · periode terpilih</p></CardHeader>
    <div className="my-5 flex justify-center"><div role="img" aria-label={total?rows.map(r=>`${r.label} ${(r.revenue/total*100).toFixed(1)}%`).join(', '):'Belum ada omzet'} className="relative flex h-40 w-40 items-center justify-center rounded-md">
      <svg viewBox="0 0 160 160" aria-hidden="true" className="absolute inset-0 h-full w-full"><circle cx="80" cy="80" r="70" fill="none" stroke="rgb(var(--admin-border))" strokeWidth="20"/>{arcs.map(r=>r.full?<circle key={r.label} cx="80" cy="80" r="70" fill="none" stroke={r.color} strokeWidth="20"/>:<path key={r.label} d={r.path} fill="none" stroke={r.color} strokeWidth="20"/>)}</svg>
      <div className="relative flex h-[124px] w-[124px] flex-col items-center justify-center rounded-full bg-admin-card"><span className="text-xs text-admin-muted">Total omzet</span><span className="mt-1 text-sm font-semibold tabular-nums text-admin-fg">{loading?'—':formatRupiah(total)}</span></div></div></div>
    <div className="mt-auto space-y-2">{rows.map(r=><div key={r.label} className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 text-admin-muted"><span className="h-2 w-2 rounded-md" style={{background:r.color}}/>{r.label}</span><span className="tabular-nums text-admin-muted">{loading?'—':`${total?(r.revenue/total*100).toFixed(1):'0.0'}%`}</span></div>)}</div>
  </Card>;
}

export function ProfitBars({ title, rows, loading }: { title: string; rows: NamedBucket[]; loading: boolean }) {
  const max = Math.max(1,...rows.map(r=>Math.abs(r.profit))), losses=rows.some(r=>r.profit<0);
  return <Card className="admin-surface rounded-xl p-4 sm:p-5"><CardHeader className="space-y-1 p-0"><h2 className="text-sm font-semibold text-admin-fg">{title}</h2><p className="text-xs text-admin-muted">Periode terpilih · untung produk</p></CardHeader><div className="mt-4 space-y-6">{rows.map(r=><div key={r.label}>
    <div className="flex items-center justify-between gap-3 text-xs">{r.supplierBadge ? <SupplierBadge supplier={r.supplierBadge} /> : <span className="font-semibold text-admin-muted">{r.label}</span>}<span className="font-semibold tabular-nums text-admin-fg">{loading?'—':formatRupiah(r.profit)}</span></div>
    <div className="relative mt-2 h-2 overflow-hidden rounded-md bg-admin-subtle">{losses&&<span className="absolute inset-y-0 left-1/2 w-px bg-admin-subtle"/>}<span className="absolute inset-y-0 rounded-md" style={{width:`${Math.abs(r.profit)/max*(losses?50:100)}%`,left:losses?(r.profit<0?`${50-Math.abs(r.profit)/max*50}%`:'50%'):'0%',background:r.profit<0?'rgb(var(--admin-danger))':r.color}}/></div>
    <p className="mt-1 text-xs leading-4 text-admin-muted">{r.orders} pesanan · omzet {formatRupiah(r.revenue)} · modal {formatRupiah(r.cost)} · margin {r.revenue?`${(r.profit/r.revenue*100).toFixed(1)}%`:'—'}</p>
  </div>)}</div></Card>;
}
