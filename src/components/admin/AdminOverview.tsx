"use client";

import { useMemo, useState } from "react";
import { formatRupiah } from "@/lib/utils";

export type ProfitBucket = { orders: number; revenue: number; cost: number; profit: number };
export type SupplierBucket = ProfitBucket;
export type ChannelBucket = { orders: number; revenue: number; profit: number };

export type AdminOverviewData = {
  total_orders: number;
  pending_orders: number;
  paid_orders: number;
  revenue_total: number;
  revenue_today: number;
  revenue_week: number;
  revenue_month: number;
  revenue_from?: string | null;
  revenue_to?: string | null;
  revenue_timezone?: string;
  orders_today: number;
  orders_week: number;
  orders_month: number;
  cost_today: number;
  cost_week: number;
  cost_month: number;
  cost_total: number;
  profit_today: number;
  profit_week: number;
  profit_month: number;
  profit_total: number;
  profit_estimated_orders: number;
  profit_by_supplier: { wr: SupplierBucket; sk: SupplierBucket; manual: SupplierBucket };
  top_profit_products: { name: string; qty: number; revenue: number; cost: number; profit: number }[];
  profit_by_channel: { web: ChannelBucket; telegram: ChannelBucket; whatsapp: ChannelBucket };
  daily_series: { date: string; orders: number; revenue: number; cost: number; profit: number }[];
  pending_proofs: number;
  payment_attention: number;
  fulfillment_attention: number;
  low_stock: number;
  top_product: null | { name: string; sold_count: number };
  channels: { web: number; telegram: number; whatsapp: number };
  systems: { telegram: boolean; whatsapp: boolean; qris: boolean; fulfillment: boolean };
  system_details?: {
    telegram?: { level: string; detail: string };
    whatsapp?: { level: string; detail: string };
    qris?: { level: string; detail: string };
    fulfillment?: { level: string; detail: string };
  };
};

export const EMPTY_ADMIN_OVERVIEW: AdminOverviewData = {
  total_orders: 0, pending_orders: 0, paid_orders: 0, revenue_total: 0,
  revenue_today: 0, revenue_week: 0, revenue_month: 0,
  orders_today: 0, orders_week: 0, orders_month: 0,
  cost_today: 0, cost_week: 0, cost_month: 0, cost_total: 0,
  profit_today: 0, profit_week: 0, profit_month: 0, profit_total: 0,
  profit_estimated_orders: 0,
  profit_by_supplier: {
    wr: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    sk: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    manual: { orders: 0, revenue: 0, cost: 0, profit: 0 },
  },
  top_profit_products: [],
  profit_by_channel: {
    web: { orders: 0, revenue: 0, profit: 0 },
    telegram: { orders: 0, revenue: 0, profit: 0 },
    whatsapp: { orders: 0, revenue: 0, profit: 0 },
  },
  daily_series: [],
  pending_proofs: 0,
  payment_attention: 0, fulfillment_attention: 0, low_stock: 0,
  top_product: null, channels: { web: 0, telegram: 0, whatsapp: 0 },
  systems: { telegram: false, whatsapp: false, qris: false, fulfillment: false },
};

type Period = "today" | "week" | "month";
const PERIOD_LABEL: Record<Period, string> = { today: "Hari ini", week: "Minggu ini", month: "Bulan ini" };

function marginOf(revenue: number, profit: number): string {
  if (!revenue) return "—";
  return `${((profit / revenue) * 100).toFixed(1)}%`;
}

function periodBucket(data: AdminOverviewData, period: Period): ProfitBucket & { orders: number } {
  if (period === "today") return { orders: data.orders_today, revenue: data.revenue_today, cost: data.cost_today, profit: data.profit_today };
  if (period === "week") return { orders: data.orders_week, revenue: data.revenue_week, cost: data.cost_week, profit: data.profit_week };
  return { orders: data.orders_month, revenue: data.revenue_month, cost: data.cost_month, profit: data.profit_month };
}

/**
 * Grafik 30 hari: omzet vs untung (SVG murni, tanpa library).
 * Interaktif: hover/tap titik mana pun menampilkan tooltip angka harian
 * (tanggal, order, omzet, modal, untung); toggle chip Omzet/Untung/Order
 * menyalakan-matikan tiap garis; sumbu kiri = skala rupiah ringkas.
 */
export function ProfitChart({ series, loading }: { series: AdminOverviewData["daily_series"]; loading: boolean }) {
  const points = useMemo(() => series.slice(-30), [series]);
  const [active, setActive] = useState<number | null>(null);
  const [show, setShow] = useState({ revenue: true, profit: true, orders: false });
  const maxMoney = Math.max(1, ...points.map((d) => Math.max(d.revenue, d.profit)));
  const maxOrders = Math.max(1, ...points.map((d) => d.orders));
  const W = 640; const H = 200; const PAD_L = 44; const PAD_R = 12; const PAD_T = 12; const PAD_B = 26;
  const x = (i: number) => (points.length <= 1 ? W / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1));
  const yMoney = (v: number) => H - PAD_B - (v / maxMoney) * (H - PAD_T - PAD_B);
  const yOrders = (v: number) => H - PAD_B - (v / maxOrders) * (H - PAD_T - PAD_B);
  const line = (pick: (d: (typeof points)[number]) => number, yFn: (v: number) => number) =>
    points.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yFn(pick(d)).toFixed(1)}`).join(" ");
  const area = (pick: (d: (typeof points)[number]) => number, yFn: (v: number) => number) =>
    `${line(pick, yFn)} L${x(points.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;
  const shortRp = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}jt`
    : v >= 1000 ? `${Math.round(v / 1000)}rb` : String(Math.round(v));
  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxMoney * f));
  const sel = active != null ? points[active] : null;
  const toggle = (key: keyof typeof show) => setShow((s) => ({ ...s, [key]: !s[key] }));
  const chip = (key: keyof typeof show, label: string, dot: string) => (
    <button key={key} type="button" onClick={() => toggle(key)} aria-pressed={show[key]}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition ${show[key] ? "border-white/15 bg-white/[0.07] text-white" : "border-white/10 text-white/35 hover:text-white/60"}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${show[key] ? "" : "opacity-30"}`} />{label}
    </button>
  );
  return (
    <section className="ax-glass rounded-[20px] p-5" aria-label="Grafik omzet dan untung 30 hari">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-white">Omzet vs Untung — 30 hari</h2>
        <p className="mt-0.5 text-xs text-white/40">Kalender WIB · {loading ? "memuat…" : "arahkan kursor / ketuk titik untuk detail harian"}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {chip("revenue", "Omzet", "bg-[#00E5FF]")}
          {chip("profit", "Untung", "bg-emerald-400")}
          {chip("orders", "Order", "bg-[#FFB800]")}
        </div>
      </div>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full sm:h-56" role="img" aria-label="Grafik garis omzet, untung, dan order 30 hari terakhir"
          onMouseLeave={() => setActive(null)}>
          <defs>
            <linearGradient id="ax-rev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ax-prof-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34D399" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#34D399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={PAD_L} x2={W - PAD_R} y1={yMoney(v)} y2={yMoney(v)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <text x={PAD_L - 6} y={yMoney(v) + 3.5} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="9" className="tabular-nums">{shortRp(v)}</text>
            </g>
          ))}
          {points.length > 1 && <>
            {show.revenue && <path d={area((d) => d.revenue, yMoney)} fill="url(#ax-rev-fill)" />}
            {show.profit && <path d={area((d) => d.profit, yMoney)} fill="url(#ax-prof-fill)" />}
            {show.revenue && <path d={line((d) => d.revenue, yMoney)} fill="none" stroke="#00E5FF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />}
            {show.profit && <path d={line((d) => d.profit, yMoney)} fill="none" stroke="#34D399" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />}
            {show.orders && <path d={line((d) => d.orders, yOrders)} fill="none" stroke="#FFB800" strokeWidth="1.5" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />}
            {/* Label tanggal: 5 titik merata agar tak berdesakan di mobile. */}
            {points.map((d, i) => (i % Math.ceil(points.length / 5) === 0 || i === points.length - 1) && (
              <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="9" className="tabular-nums">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>
            ))}
            {active != null && sel && (
              <g>
                <line x1={x(active)} x2={x(active)} y1={PAD_T} y2={H - PAD_B} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3 3" />
                {show.revenue && <circle cx={x(active)} cy={yMoney(sel.revenue)} r="4" fill="#00E5FF" stroke="#07101f" strokeWidth="2" />}
                {show.profit && <circle cx={x(active)} cy={yMoney(sel.profit)} r="4" fill="#34D399" stroke="#07101f" strokeWidth="2" />}
                {show.orders && <circle cx={x(active)} cy={yOrders(sel.orders)} r="3.5" fill="#FFB800" stroke="#07101f" strokeWidth="2" />}
              </g>
            )}
            {/* Zona hover/tap lebar per titik — ramah jempol di HP. */}
            {points.map((d, i) => (
              <rect key={d.date} x={i === 0 ? 0 : (x(i - 1) + x(i)) / 2} y={0}
                width={i === 0 ? (x(1) - x(0)) / 2 + x(0) : i === points.length - 1 ? W - (x(i - 1) + x(i)) / 2 : (x(i + 1) - x(i - 1)) / 2}
                height={H} fill="transparent"
                onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
                <title>{`${d.date} · ${d.orders} order · omzet ${formatRupiah(d.revenue)} · untung ${formatRupiah(d.profit)}`}</title>
              </rect>
            ))}
          </>}
          {points.length <= 1 && <text x={W / 2} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="12">Belum cukup data harian</text>}
        </svg>
        {sel && active != null && points.length > 1 && (
          <div className="pointer-events-none absolute left-1/2 top-0 w-max max-w-[92%] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#0B1025]/95 px-4 py-3 shadow-xl backdrop-blur sm:left-auto sm:right-2 sm:translate-x-0" role="status">
            <p className="text-[11px] font-bold tabular-nums text-white/60">{sel.date}</p>
            <p className="mt-1 font-display text-lg font-bold tabular-nums text-emerald-300">{formatRupiah(sel.profit)}</p>
            <p className="mt-0.5 text-[11px] tabular-nums text-white/50">{sel.orders} order · omzet {formatRupiah(sel.revenue)} · modal {formatRupiah(sel.revenue - sel.profit)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function AdminOverview({ data, loading, onLowStock }: { data: AdminOverviewData; loading: boolean; onLowStock?: () => void }) {
  const [period, setPeriod] = useState<Period>("week");
  const bucket = periodBucket(data, period);
  const metrics = [
    ["Pesanan lunas", String(bucket.orders), "text-white"],
    ["Omzet", formatRupiah(bucket.revenue), "text-white"],
    ["Modal", formatRupiah(bucket.cost), "text-[#FFB800]"],
    ["Untung Produk", formatRupiah(bucket.profit), "text-emerald-300"],
    ["Margin", marginOf(bucket.revenue, bucket.profit), "text-[#5cefff]"],
    ["Rata2 / order", bucket.orders ? formatRupiah(Math.round(bucket.revenue / bucket.orders)) : "—", "text-white"],
  ] as const;

  return <div className="mt-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="Periode laporan">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={period === key} onClick={() => setPeriod(key)}
            className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${period === key ? "bg-[#00E5FF] text-[#07101f]" : "text-white/55 hover:text-white"}`}>
            {PERIOD_LABEL[key]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/35">
        <span>Minggu = Senin–Minggu WIB · Total {data.total_orders} · Pending {data.pending_orders}</span>
        {data.low_stock > 0 && (
          onLowStock ? (
            <button type="button" onClick={onLowStock} title="Buka daftar Produk dengan filter stok menipis"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FFCF55] transition hover:bg-[#FFB800]/20">
              Stok menipis · {data.low_stock} varian
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FFCF55]" title="Varian aktif tersisa ≤ 5 — atur dari daftar Produk">
              Stok menipis · {data.low_stock} varian
            </span>
          )
        )}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {metrics.map(([label, value, tone]) => <div key={label} className="ax-glass rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
        <p className={`mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>{loading ? "—" : value}</p>
      </div>)}
    </div>

    <ProfitChart series={data.daily_series} loading={loading} />

    <section className="ax-glass overflow-hidden rounded-[20px]">
      <div className="border-b border-white/10 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Untung per supplier</h2>
        <p className="mt-0.5 text-xs text-white/40">Seluruh waktu — WR vs SK vs stok sendiri (modal manual ikut di Manual).</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {(Object.entries({ "Warung Rebahan": data.profit_by_supplier.wr, "Sekalipay": data.profit_by_supplier.sk, "Stok sendiri": data.profit_by_supplier.manual }) as [string, SupplierBucket][]).map(([label, bucket]) => {
          return <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <p className="text-xs font-semibold text-white/65">{label}</p>
            <p className="mt-2 font-display text-xl font-bold tabular-nums text-emerald-300">{loading ? "—" : formatRupiah(bucket.profit)}</p>
            <p className="mt-1 text-[11px] leading-5 text-white/40">{loading ? "…" : `${bucket.orders} order · omzet ${formatRupiah(bucket.revenue)} · modal ${formatRupiah(bucket.cost)} · margin ${marginOf(bucket.revenue, bucket.profit)}`}</p>
          </div>;
        })}
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ax-glass rounded-[20px] p-5">
        <h2 className="text-sm font-semibold text-white">Top 5 penyumbang untung</h2>
        <p className="mt-0.5 text-xs text-white/40">500 order lunas terbaru · modal dibagi proporsional per item.</p>
        <div className="mt-4 space-y-2.5">
          {data.top_profit_products.length === 0 && <p className="text-xs text-white/40">{loading ? "Memuat…" : "Belum ada data"}</p>}
          {data.top_profit_products.map((row) => (
            <div key={row.name} className="rounded-xl bg-white/[0.04] p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={row.name}>{row.name}</p>
                <p className="shrink-0 font-display text-sm font-bold tabular-nums text-emerald-300">{loading ? "—" : formatRupiah(row.profit)}</p>
              </div>
              <p className="mt-1 text-[11px] tabular-nums text-white/40">{row.qty}x terjual · omzet {formatRupiah(row.revenue)} · modal {formatRupiah(row.cost)} · margin {marginOf(row.revenue, row.profit)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="ax-glass rounded-[20px] p-5">
        <h2 className="text-sm font-semibold text-white">Untung per channel</h2>
        <p className="mt-0.5 text-xs text-white/40">Seluruh waktu — order lunas per kanal penjualan.</p>
        <div className="mt-4 space-y-2.5">
          {(Object.entries({ Web: data.profit_by_channel.web, Telegram: data.profit_by_channel.telegram, WhatsApp: data.profit_by_channel.whatsapp }) as [string, ChannelBucket][]).map(([label, bucket]) => {
            return <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3">
              <div><p className="text-sm font-semibold text-white">{label}</p><p className="mt-0.5 text-[11px] tabular-nums text-white/40">{bucket.orders} order · omzet {formatRupiah(bucket.revenue)}</p></div>
              <p className="shrink-0 font-display text-sm font-bold tabular-nums text-emerald-300">{loading ? "—" : formatRupiah(bucket.profit)}</p>
            </div>;
          })}
        </div>
      </section>
    </div>

  </div>;
}
