"use client";

import { useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import type { PeriodReport, ReportPeriod, SelectedReport } from "@/lib/dashboard-report";
import { reportMonthSelection, resolveReportRange, todayWibDateString, type ReportSelection } from "@/lib/revenue";
import { ProfitChart, ProfitBars, RevenueDonut, type NamedBucket } from "./OverviewCharts";
import { ReportExportActions } from "./ReportExportActions";
export { ProfitChart } from "./OverviewCharts";

export type ProfitBucket = { orders: number; revenue: number; cost: number; profit: number };
export type SupplierBucket = ProfitBucket;
export type ChannelBucket = { orders: number; revenue: number; profit: number };

export type AdminOverviewData = {
  selected_report?: SelectedReport;
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

export type ReportExportProps = { report: SelectedReport; disabled: boolean };
export type AdminOverviewProps = {
  data: AdminOverviewData; loading: boolean; error?: string | null; onRetry?: () => void;
  selection?: ReportSelection; onSelectionChange?: (selection: ReportSelection) => void;
  renderReportActions?: (props: ReportExportProps) => ReactNode;
};

export function AdminOverview({ data, loading, error, onRetry, selection, onSelectionChange, renderReportActions }: AdminOverviewProps) {
  const [period, setPeriod] = useState<Period>("week");
  const [month, setMonth] = useState(todayWibDateString().slice(0, 7));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const active = selection ?? period;
  const report = selection ? data.selected_report : data.period_reports?.[period];
  const label = typeof active === "string" ? PERIOD_LABEL[active] : `${active.date_from} – ${active.date_to} WIB`;
  const choose = (value: ReportSelection) => {
    setRangeError(null);
    if (onSelectionChange) onSelectionChange(value);
    else if (typeof value === "string") setPeriod(value);
  };
  const apply = (value: ReportSelection) => {
    try {
      resolveReportRange(value);
      choose(value);
    } catch (error) { setRangeError(error instanceof Error ? error.message : "Rentang tidak valid."); }
  };
  const changeMonth = (value: string) => {
    setMonth(value);
    setRangeError(null);
    if (!value) return;
    try { apply(reportMonthSelection(value)); }
    catch (error) { setRangeError(error instanceof Error ? error.message : "Bulan tidak valid."); }
  };
  const changeDates = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    setRangeError(null);
    // Wait for both dates; incomplete edits keep the last applied report.
    if (nextFrom && nextTo) apply({ date_from: nextFrom, date_to: nextTo });
  };
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
          <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => choose(key)}
            className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${active === key ? "bg-[#00E5FF] text-[#07101f]" : "text-white/55 hover:text-white"}`}>
            {PERIOD_LABEL[key]}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filter dan unduhan laporan">
      {onSelectionChange && <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-white/60">
        <label className="sr-only" htmlFor="report-month">Bulan historis</label>
        <input id="report-month" type="month" max={todayWibDateString().slice(0, 7)} value={month} onChange={e => changeMonth(e.target.value)} className="h-9 min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-white [color-scheme:dark]" />
        <div className="flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="report-from">Tanggal awal</label>
          <input id="report-from" type="date" max={todayWibDateString()} value={from} onChange={e => changeDates(e.target.value, to)} className="h-9 min-w-0 w-[136px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-white [color-scheme:dark]" />
          <span aria-hidden="true">–</span>
          <label className="sr-only" htmlFor="report-to">Tanggal akhir</label>
          <input id="report-to" type="date" max={todayWibDateString()} value={to} onChange={e => changeDates(from, e.target.value)} className="h-9 min-w-0 w-[136px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-white [color-scheme:dark]" />
        </div>
      </div>}
      {!loading && !error && data.selected_report && selection && (
        renderReportActions ? renderReportActions({ report: data.selected_report, disabled: false }) : <ReportExportActions report={data.selected_report} disabled={false} />
      )}
      </div>
    </div>
    {rangeError && <p role="alert" className="text-sm text-red-200">{rangeError}</p>}
    {error ? <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-5"><p className="text-sm text-red-200">{error}</p><button type="button" onClick={onRetry} disabled={loading} className="mt-3 rounded-xl bg-[#00E5FF] px-4 py-2 text-xs font-bold text-[#080C1E]">Muat ulang ringkasan</button></div>
      : loading ? <p role="status" className="py-8 text-sm text-white/50">Memuat laporan {label}…</p>
      : <>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {metrics.map(([label, value, tone]) => <div key={label} className="ax-glass rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
        <p className={`mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>{loading ? "—" : value}</p>
      </div>)}
    </div>
    {report && <p className="text-xs leading-5 text-white/45">Pembayaran merchant {formatRupiah(report.merchant_paid ?? report.revenue)} · Kredit digunakan {formatRupiah(report.credit_used ?? 0)}. Untung produk belum dikurangi MDR dan biaya operasional.</p>}

    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <ProfitChart series={report?.series ?? data.daily_series} loading={loading} label={label} />
      <RevenueDonut rows={supplierRows} loading={loading} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ProfitBars title="Untung per supplier" rows={supplierRows} loading={loading} />
      <ProfitBars title="Untung per channel" rows={channelRows} loading={loading} />
    </div>
    <section className="ax-glass rounded-[20px] p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-white">Top 5 penyumbang untung</h2>
      <p className="mt-1 text-xs text-white/40">{label} · modal dihitung per item sesuai asal produk</p>
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
    </>}
  </div>;
}
