"use client";

import { useMemo, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import type { AdminSection } from "@/components/admin/AdminShell";

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
 * Grafik garis 30 hari: omzet vs untung (SVG murni, tanpa library).
 * Skala = nilai maksimum dari kedua garis agar perbandingan jujur.
 */
export function ProfitChart({ series, loading }: { series: AdminOverviewData["daily_series"]; loading: boolean }) {
  const points = useMemo(() => series.slice(-30), [series]);
  const max = Math.max(1, ...points.map((d) => Math.max(d.revenue, d.profit)));
  const W = 600; const H = 160; const PAD = 8;
  const x = (i: number) => (points.length <= 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (points.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = (pick: (d: (typeof points)[number]) => number) =>
    points.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <section className="ax-glass rounded-[20px] p-5" aria-label="Grafik omzet dan untung 30 hari">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div><h2 className="text-sm font-semibold text-white">Omzet vs Untung — 30 hari</h2>
        <p className="mt-0.5 text-xs text-white/40">Kalender WIB · {loading ? "memuat…" : last ? `terakhir ${last.date} · untung ${formatRupiah(last.profit)}` : "belum ada data"}</p></div>
        <div className="flex items-center gap-3 text-[11px] text-white/50">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 rounded bg-[#00E5FF]" /> Omzet</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 rounded bg-emerald-400" /> Untung</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-40 w-full" role="img" aria-label="Grafik garis omzet dan untung 30 hari terakhir">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />)}
        {points.length > 1 && <>
          <path d={line((d) => d.revenue)} fill="none" stroke="#00E5FF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
          <path d={line((d) => d.profit)} fill="none" stroke="#34D399" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </>}
        {points.length <= 1 && <text x={W / 2} y={H / 2} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="12">Belum cukup data harian</text>}
      </svg>
    </section>
  );
}

export function AdminOverview({ data, loading, onNavigate }: { data: AdminOverviewData; loading: boolean; onNavigate: (section: AdminSection, params?: Record<string, string>) => void }) {
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
  const actions: { title: string; count: number; detail: string; section: AdminSection; params: Record<string, string>; tone: "amber" | "red" }[] = [
    { title: "Pesanan pending", count: data.pending_orders, detail: "Perlu diproses", section: "orders", params: { status: "pending" }, tone: "amber" },
    { title: "Bukti manual", count: data.pending_proofs, detail: "Menunggu pemeriksaan", section: "orders", params: { proof: "submitted", method: "manual" }, tone: "amber" },
    { title: "QRIS perlu dicek", count: data.payment_attention, detail: "Unmatched atau gagal 7 hari", section: "payments", params: { payment_tab: "qris", event_status: "attention" }, tone: "red" },
    { title: "Fulfillment", count: data.fulfillment_attention, detail: "Manual, retry, atau gagal", section: "bot", params: {}, tone: "red" },
    { title: "Stok menipis", count: data.low_stock, detail: "Varian tersisa ≤ 5", section: "products", params: { low_stock: "1" }, tone: "amber" },
  ];

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
      <p className="text-[11px] text-white/35">Minggu = Senin–Minggu WIB · Total pesanan {data.total_orders} · Pending {data.pending_orders}</p>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {metrics.map(([label, value, tone]) => <div key={label} className="ax-glass rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
        <p className={`mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>{loading ? "—" : value}</p>
      </div>)}
    </div>
    <p className="text-[11px] text-white/35">Untung Produk = omzet − modal supplier (WR/SK saat order lunas) − modal manual varian. Produk stok sendiri tanpa modal dihitung untung penuh. Belum termasuk biaya operasional (domain, VPS, Resend).{data.profit_estimated_orders > 0 ? ` ${data.profit_estimated_orders} order lunas masih menunggu supplier (estimasi, modal belum kepotong).` : ""}</p>

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

    <section className="ax-glass overflow-hidden rounded-[20px]">
      <div className="border-b border-white/10 p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Perlu tindakan</h2>
        <p className="mt-0.5 text-xs text-white/40">Antrean operasional yang sebaiknya diselesaikan lebih dulu.</p>
      </div>      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
        {actions.map((action) => <button key={action.title} onClick={() => onNavigate(action.section, action.params)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-[#00E5FF]/25 hover:bg-white/[0.06]">
          <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-white/65">{action.title}</p><span className={`min-w-7 shrink-0 rounded-full px-2 py-1 text-center text-xs font-bold tabular-nums ${action.count > 0 ? action.tone === "red" ? "bg-red-500/15 text-red-300" : "bg-[#FFB800]/15 text-[#FFCF55]" : "bg-emerald-500/10 text-emerald-300"}`}>{loading ? "—" : action.count}</span></div>
          <p className="mt-3 text-[11px] leading-5 text-white/35">{action.count > 0 ? action.detail : "Tidak ada antrean"}</p>
        </button>)}
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ax-glass rounded-[20px] p-5"><h2 className="text-sm font-semibold text-white">Kinerja toko</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Total lunas</p><p className="mt-1 font-bold tabular-nums text-emerald-300">{data.paid_orders}</p></div><div className="rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Omzet seluruhnya</p><p className="mt-1 font-bold text-white">{formatRupiah(data.revenue_total)}</p></div><div className="col-span-2 rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Produk terlaris</p><p className="mt-1 font-semibold text-white">{data.top_product ? `${data.top_product.name} · ${data.top_product.sold_count} terjual` : "Belum ada data"}</p></div></div></section>
      <section className="ax-glass rounded-[20px] p-5"><h2 className="text-sm font-semibold text-white">Kesehatan sistem</h2><div className="mt-4 grid grid-cols-2 gap-3">{Object.entries({ Telegram: data.systems.telegram, WhatsApp: data.systems.whatsapp, "QRIS Hook": data.systems.qris, Fulfillment: data.systems.fulfillment }).map(([label, ok]) => {
        const key = label === "Telegram" ? "telegram" : label === "WhatsApp" ? "whatsapp" : label === "QRIS Hook" ? "qris" : "fulfillment";
        const detail = data.system_details?.[key as keyof NonNullable<typeof data.system_details>];
        const tone = detail?.level === "degraded" ? "red" : detail?.level === "unknown" ? "amber" : ok ? "emerald" : "red";
        const dot = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-[#FFB800]" : "bg-red-400";
        return <div key={label} title={detail?.detail || detail?.level || (ok ? "sehat" : "perlu perhatian")} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${tone === "emerald" ? "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300" : tone === "amber" ? "border-[#FFB800]/20 bg-[#FFB800]/[0.07] text-[#FFCF55]" : "border-red-400/15 bg-red-500/[0.07] text-red-300"}`}><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${dot}`} />{label}{detail && detail.level !== "healthy" ? <span className="ml-1 opacity-70">· {detail.level}</span> : null}</div>;
      })}</div>{data.system_details && <p className="mt-3 text-[11px] leading-5 text-white/35" title="Detail status tiap layanan">configured = siap tapi belum ada pengukuran · unknown = belum bisa dinilai · degraded = perlu tindakan.</p>}</section>
    </div>
  </div>;
}
