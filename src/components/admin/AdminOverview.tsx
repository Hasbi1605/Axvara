"use client";
import { Button, Card, Input, Label, Tabs, TabsList, TabsTrigger, Skeleton, PageHeader, StatCard, Popover, PopoverContent, PopoverTrigger } from "@/components/admin/ui";

import { useState, type ReactNode } from "react";
import { formatRupiah } from "@/lib/utils";
import type { PeriodReport, ReportPeriod, SelectedReport } from "@/lib/dashboard-report";
import { reportMonthSelection, resolveReportRange, todayWibDateString, type ReportSelection } from "@/lib/revenue";
import { ProfitChart, ProfitBars, RevenueDonut, type NamedBucket } from "./OverviewCharts";
import { ReportExportActions } from "./ReportExportActions";
import type { ReportFinance } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { IosIcon } from "./AdminIcon";
export { ProfitChart } from "./OverviewCharts";

export type ProfitBucket = { orders: number; revenue: number; cost: number; profit: number };
export type SupplierBucket = ProfitBucket;
export type ChannelBucket = { orders: number; revenue: number; profit: number };

export type AdminOverviewData = {
  /** ISO waktu snapshot penjualan (cache ±5 menit). */
  generated_at?: string;
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
  profit_by_supplier: { wr: SupplierBucket; sk: SupplierBucket; manual: SupplierBucket; pedia?: SupplierBucket; tunvn?: SupplierBucket; aivault?: SupplierBucket; games?: SupplierBucket };
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
    pedia: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    tunvn: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    aivault: { orders: 0, revenue: 0, cost: 0, profit: 0 },
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
  /** Buka panel "Catat pengeluaran". */
  onRecordExpense?: () => void;
  /** Pindah section admin (mis. pengeluaran / pesanan) dengan filter. */
  onNavigate?: (section: "expenses" | "orders", params: Record<string, string>) => void;
};

type FinanceView = Partial<ReportFinance> & { profit: number; revenue: number; cost: number };

function updatedLabel(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace(":", ".");
}

function NetProfitCard({ bucket, label, onOpenExpenses }: { bucket: FinanceView; label: string; onOpenExpenses?: (category: "refund_replace" | "operational") => void }) {
  const hasFinance = bucket.net_profit !== undefined;
  const fees = bucket.payment_fees ?? 0, refunds = bucket.refund_expenses ?? 0, operational = bucket.operational_expenses ?? 0;
  const net = hasFinance ? bucket.net_profit! : bucket.profit;
  const rows: { label: string; value: number; sign: "" | "−" | "="; strong?: boolean; action?: () => void; hint?: string }[] = [
    { label: "Omzet", value: bucket.revenue, sign: "" },
    { label: "Modal produk", value: bucket.cost, sign: "−" },
    { label: "Untung kotor", value: bucket.profit, sign: "=", strong: true },
    ...(hasFinance ? [
      { label: "Biaya pembayaran", value: fees, sign: "−" as const, hint: "Biaya gateway + MDR QRIS" },
      { label: "Refund & replace", value: refunds, sign: "−" as const, action: onOpenExpenses ? () => onOpenExpenses("refund_replace") : undefined },
      { label: "Operasional", value: operational, sign: "−" as const, action: onOpenExpenses ? () => onOpenExpenses("operational") : undefined },
    ] : []),
  ];
  return <Card className="admin-surface min-w-0 rounded-xl p-4 sm:p-5" aria-label={`Untung bersih ${label}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-sm font-medium text-admin-muted">{hasFinance ? "Untung bersih" : "Untung Produk"}</p>
        <p className={cn("mt-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl", net < 0 ? "text-admin-danger" : "text-admin-success")}>{formatRupiah(net)}</p>
      </div>
      <p className="rounded-full bg-admin-subtle px-2.5 py-1 text-xs font-semibold tabular-nums text-admin-fg">margin {marginOf(bucket.revenue, net)}</p>
    </div>
    <dl className="mt-4 divide-y divide-admin-border/70 text-sm">
      {rows.map((row) => {
        const content = <>
          <dt className={cn("flex min-w-0 items-center gap-2", row.strong ? "font-semibold text-admin-fg" : "text-admin-muted")}>
            <span aria-hidden="true" className="w-3 shrink-0 text-center tabular-nums text-admin-muted">{row.sign}</span>
            <span className="truncate" title={row.hint}>{row.label}</span>
          </dt>
          <dd className={cn("flex shrink-0 items-center gap-1 tabular-nums", row.strong ? "font-semibold text-admin-fg" : "text-admin-fg")}>
            {formatRupiah(row.value)}{row.action && <span aria-hidden="true" className="text-admin-muted">›</span>}
          </dd>
        </>;
        return row.action
          ? <Button key={row.label} type="button" variant="ghost" onClick={row.action} className="-mx-2 flex h-auto w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm font-normal" aria-label={`${row.label} ${formatRupiah(row.value)}, lihat rincian di Pengeluaran`}>{content}</Button>
          : <div key={row.label} className="flex items-center justify-between gap-3 py-2">{content}</div>;
      })}
    </dl>
    {hasFinance && <p className="mt-3 text-xs leading-5 text-admin-muted">Pengeluaran dihitung pada tanggal dibayar.</p>}
  </Card>;
}

function EstimatedNotice({ count, codes, jaspayCodes, onOpenOrder }: { count: number; codes: string[]; jaspayCodes?: string[]; onOpenOrder?: (code: string) => void }) {
  if (!count) return null;
  return <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-admin-warning/30 bg-admin-warning/[0.07] px-4 py-2.5 text-sm">
    <span className="flex items-center gap-1.5 text-admin-fg"><IosIcon name="info" size={16} className="text-admin-warning" />{count} order modalnya masih estimasi</span>
    {codes.length > 0 && <Popover>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="ml-auto h-8 px-2 text-xs font-semibold">Tinjau ›</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pb-1.5 pt-1 text-xs text-admin-muted">Order dengan modal estimasi{count > codes.length ? ` (${codes.length} dari ${count})` : ""}</p>
        <ul className="max-h-64 overflow-y-auto">
          {codes.map((code) => <li key={code}><Button type="button" variant="ghost" size="sm" onClick={() => onOpenOrder?.(code)} disabled={!onOpenOrder} className="h-auto min-h-8 w-full flex-col items-start justify-center gap-0.5 px-2 py-1.5 text-xs font-normal">
            <span className="font-mono">{code}</span>
            {jaspayCodes?.includes(code) && <span className="text-admin-muted">Menunggu konfirmasi tagihan supplier</span>}
          </Button></li>)}
        </ul>
      </PopoverContent>
    </Popover>}
  </div>;
}

export function AdminOverview({ data, loading, error, onRetry, selection, onSelectionChange, renderReportActions, onRecordExpense, onNavigate }: AdminOverviewProps) {
  const [period, setPeriod] = useState<Period>("week");
  const [month, setMonth] = useState(todayWibDateString().slice(0, 7));
  const [from, setFrom] = useState(typeof selection === "object" ? selection.date_from : "");
  const [to, setTo] = useState(typeof selection === "object" ? selection.date_to : "");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [custom, setCustom] = useState(typeof selection === "object");
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
    try { const range = reportMonthSelection(value); resolveReportRange(range); if (typeof range === "object") { setFrom(range.date_from); setTo(range.date_to); } apply(range); }
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
    { label: "Warung Rebahan", color: "rgb(var(--admin-info))", ...suppliers.wr },
    { label: "Sekalipay", color: "rgb(var(--admin-accent))", ...suppliers.sk },
    { label: "Stok sendiri", color: "rgb(var(--admin-warning))", ...suppliers.manual },
    ...(suppliers.pedia?.orders ? [{ label: "Pedia", color: "rgb(var(--admin-success))", ...suppliers.pedia }] : []),
    ...(suppliers.games?.orders ? [{ label: "Games", color: "rgb(var(--admin-accent))", ...suppliers.games }] : []),
    ...(suppliers.tunvn?.orders ? [{ label: "TUNVN", color: "rgb(var(--admin-danger))", ...suppliers.tunvn }] : []),
    ...(suppliers.aivault?.orders ? [{ label: "AIVault", color: "rgb(var(--admin-info))", ...suppliers.aivault }] : []),
  ];
  const channelRows = Object.entries({ Web: channels.web, Telegram: channels.telegram, WhatsApp: channels.whatsapp })
    .map(([label,r])=>({ ...r, label, cost: r.revenue-r.profit, color: "rgb(var(--admin-accent))" }));
  const finance = bucket as FinanceView;
  const hasFinance = finance.net_profit !== undefined;
  const metrics = [
    ["Pesanan lunas", String(bucket.orders), undefined],
    ["Rata2 / order", bucket.orders ? formatRupiah(Math.round(bucket.revenue / bucket.orders)) : "—", undefined],
    ...(hasFinance ? [["Bonus kode unik", formatRupiah(finance.unique_code_bonus ?? 0), "Sudah termasuk omzet"]] as const : []),
  ] as const;
  const updated = updatedLabel(data.generated_at ?? (report as SelectedReport | undefined)?.generated_at);
  const openExpenses = onNavigate ? (category: "refund_replace" | "operational") => onNavigate("expenses", { ...resolveReportRange(active), category }) : undefined;
  const series = (report?.series ?? data.daily_series).map(point => {
    const net = (point as { net_profit?: number }).net_profit;
    return hasFinance && net !== undefined ? { ...point, profit: net } : point;
  });

  const exportActions = !loading && !error && data.selected_report && selection ? (renderReportActions ? renderReportActions({ report: data.selected_report, disabled: false }) : <ReportExportActions report={data.selected_report} disabled={false} />) : null;
  return <div className="mt-4 space-y-6"><PageHeader title="Ringkasan"
    actions={(onRecordExpense || exportActions) ? <div className="flex flex-wrap items-center gap-2">{onRecordExpense && <Button type="button" onClick={onRecordExpense} className="min-h-9 rounded-xl px-3 text-xs font-semibold">+ Catat pengeluaran</Button>}{exportActions}</div> : undefined} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs value={custom || typeof active !== "string" ? "custom" : active} onValueChange={value => { setCustom(value === "custom"); if (value !== "custom") choose(value as Period); }}><TabsList aria-label="Periode laporan" className="h-auto flex-wrap">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => (
          <TabsTrigger key={key} value={key}>
            {PERIOD_LABEL[key]}
          </TabsTrigger>
        ))}
        {onSelectionChange && <TabsTrigger value="custom">Kustom</TabsTrigger>}
      </TabsList></Tabs>
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filter dan unduhan laporan">
      {updated && !error && <p className="flex items-center gap-1 text-xs text-admin-muted" aria-live="polite">Diperbarui {updated}{onRetry && <Button type="button" variant="ghost" size="sm" onClick={onRetry} disabled={loading} aria-label="Muat ulang ringkasan" className="h-7 w-7 p-0 text-admin-muted">↻</Button>}</p>}
      {onSelectionChange && custom && <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-admin-muted">
        <Label className="sr-only" htmlFor="report-month">Bulan historis</Label>
        <Input id="report-month" type="month" max={todayWibDateString().slice(0, 7)} value={month} onChange={e => changeMonth(e.target.value)} className="h-9 w-[180px] min-w-0 rounded-lg border border-admin-border bg-admin-subtle px-2 text-admin-fg [color-scheme:inherit]" />
        <div className="flex min-w-0 items-center gap-2">
          <Label className="sr-only" htmlFor="report-from">Tanggal awal</Label>
          <Input id="report-from" type="date" max={todayWibDateString()} value={from} onChange={e => changeDates(e.target.value, to)} className="h-9 min-w-0 w-[136px] rounded-lg border border-admin-border bg-admin-subtle px-2 text-admin-fg [color-scheme:inherit]" />
          <span aria-hidden="true">–</span>
          <Label className="sr-only" htmlFor="report-to">Tanggal akhir</Label>
          <Input id="report-to" type="date" max={todayWibDateString()} value={to} onChange={e => changeDates(from, e.target.value)} className="h-9 min-w-0 w-[136px] rounded-lg border border-admin-border bg-admin-subtle px-2 text-admin-fg [color-scheme:inherit]" />
        </div>
      </div>}
      </div>
    </div>
    {rangeError && <p role="alert" className="text-sm text-admin-danger">{rangeError}</p>}
    {error ? <div role="alert" className="rounded-xl border border-admin-danger/20 bg-admin-danger/[0.06] p-5"><p className="text-sm text-admin-danger">{error}</p><Button variant="default" type="button" onClick={onRetry} disabled={loading} className="mt-3 rounded-xl bg-admin-primary px-4 py-2 text-xs font-semibold text-admin-inverse">Muat ulang ringkasan</Button></div>
      : loading ? <div role="status" className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /><span className="sr-only">Memuat laporan {label}…</span></div>
      : <>
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)]">
      <NetProfitCard bucket={finance} label={label} onOpenExpenses={openExpenses} />
      <div className="grid grid-cols-2 content-start gap-3 lg:grid-cols-1">
        {metrics.map(([name, value, hint]) => <StatCard key={name} label={name} value={value} hint={hint} />)}
      </div>
    </div>
    <EstimatedNotice count={report?.estimated_orders ?? data.profit_estimated_orders} codes={finance.estimated_order_codes ?? []} jaspayCodes={finance.estimated_jaspay_order_codes} onOpenOrder={onNavigate ? code => onNavigate("orders", { q: code }) : undefined} />
    {report && <p className="text-xs leading-5 text-admin-muted">Pembayaran merchant {formatRupiah(report.merchant_paid ?? report.revenue)} · Kredit digunakan {formatRupiah(report.credit_used ?? 0)}.{hasFinance ? "" : " Untung produk belum dikurangi biaya pembayaran dan operasional."}</p>}

    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <ProfitChart series={series} loading={loading} label={label} profitLabel={hasFinance ? "Untung bersih" : "Untung"} />
      <RevenueDonut rows={supplierRows} loading={loading} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <ProfitBars title="Untung per supplier" rows={supplierRows} loading={loading} />
      <ProfitBars title="Untung per channel" rows={channelRows} loading={loading} />
    </div>
    <Card className="admin-surface rounded-xl p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-admin-fg">Top 5 penyumbang untung</h2>
      <p className="mt-1 text-xs text-admin-muted">{label} · modal dihitung per item sesuai asal produk</p>
      <div className="mt-4 space-y-2.5">
        {!top.length && <p className="text-xs text-admin-muted">{loading ? "Memuat…" : "Belum ada transaksi pada periode ini"}</p>}
        {top.map((row,i)=><div key={`${row.name}:${i}`} className="rounded-xl bg-admin-subtle p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold leading-5 text-admin-fg"><span className="mr-2 text-admin-muted">{i+1}.</span>{row.name}</p>
             <p className="shrink-0 text-sm font-semibold tabular-nums text-admin-fg">{formatRupiah(row.profit)}</p>
          </div>
          <p className="mt-1 text-xs leading-5 tabular-nums text-admin-muted">{row.qty}x terjual · omzet {formatRupiah(row.revenue)} · modal {formatRupiah(row.cost)} · margin {marginOf(row.revenue,row.profit)}</p>
        </div>)}
      </div>
    </Card>
    </>}
  </div>;
}
