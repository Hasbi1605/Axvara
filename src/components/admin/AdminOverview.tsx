"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { PeriodReport, ReportPeriod } from "@/lib/dashboard-report";
import { ProfitChart, ProfitBars, RevenueDonut, type NamedBucket } from "./OverviewCharts";
export { ProfitChart } from "./OverviewCharts";

export type ProfitBucket = { orders: number; revenue: number; cost: number; profit: number };
export type SupplierBucket = ProfitBucket;
export type ChannelBucket = { orders: number; revenue: number; profit: number };

export type AdminOverviewData = {
  period_reports?: Record<ReportPeriod, PeriodReport>;
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

export function AdminOverview({ data, loading, onLowStock, error, onRetry }: { data: AdminOverviewData; loading: boolean; onLowStock?: () => void; error?: string | null; onRetry?: () => void }) {
  const [period, setPeriod] = useState<Period>("week");
  if (error) return <div role="alert" className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-5"><p className="text-sm text-red-200">{error}</p><button type="button" onClick={onRetry} disabled={loading} className="mt-3 rounded-xl bg-[#00E5FF] px-4 py-2 text-xs font-bold text-[#080C1E]">Muat ulang ringkasan</button></div>;
  const report = data.period_reports?.[period];
  const bucket = report ?? periodBucket(data, period);
  const suppliers = report?.suppliers ?? data.profit_by_supplier;
  const channels = report?.channels ?? data.profit_by_channel;
  const top = report?.top_products ?? data.top_profit_products;
  const supplierRows: NamedBucket[] = [
    { label: "Warung Rebahan", color: "#818CF8", ...suppliers.wr },
    { label: "Sekalipay", color: "#00E5FF", ...suppliers.sk },
    { label: "Stok sendiri", color: "#FFB800", ...suppliers.manual },
    ...(report && report.suppliers.pedia.orders > 0 ? [{ label: "Pedia", color: "#34D399", ...report.suppliers.pedia }] : []),
  ];
  const channelRows = Object.entries({ Web: channels.web, Telegram: channels.telegram, WhatsApp: channels.whatsapp })
    .map(([label,r])=>({ ...r, label, cost: r.revenue-r.profit, color: "#00E5FF" }));
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

    {report && report.estimated_orders > 0 && <p className="rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/[0.05] px-3 py-2 text-xs leading-5 text-white/55" role="status">
      {report.estimated_orders} pesanan memakai estimasi modal: riwayat tanpa snapshot atau proses supplier belum selesai.
    </p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <ProfitChart series={report?.series ?? data.daily_series} loading={loading} label={PERIOD_LABEL[period]} />
      <RevenueDonut rows={supplierRows} loading={loading} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ProfitBars title="Untung per supplier" rows={supplierRows} loading={loading} />
      <ProfitBars title="Untung per channel" rows={channelRows} loading={loading} />
    </div>
    <section className="ax-glass rounded-[20px] p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-white">Top 5 penyumbang untung</h2>
      <p className="mt-1 text-xs text-white/40">{PERIOD_LABEL[period]} · modal dihitung per item sesuai asal produk</p>
      <div className="mt-4 space-y-2.5">
        {!top.length && <p className="text-xs text-white/40">{loading ? "Memuat…" : "Belum ada transaksi pada periode ini"}</p>}
        {top.map((row,i)=><div key={`${row.name}:${i}`} className="rounded-xl bg-white/[0.04] p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold leading-5 text-white"><span className="mr-2 text-white/35">{i+1}.</span>{row.name}</p>
            <p className={`shrink-0 text-sm font-bold tabular-nums ${row.profit<0?'text-red-300':'text-emerald-300'}`}>{loading?'—':formatRupiah(row.profit)}</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 tabular-nums text-white/40">{row.qty}x terjual · omzet {formatRupiah(row.revenue)} · modal {formatRupiah(row.cost)} · margin {marginOf(row.revenue,row.profit)}</p>
        </div>)}
      </div>
    </section>
  </div>;
}
