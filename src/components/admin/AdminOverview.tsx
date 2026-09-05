"use client";

import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import type { AdminSection } from "@/components/admin/AdminShell";

export type AdminOverviewData = {
  total_orders: number;
  pending_orders: number;
  paid_orders: number;
  revenue_total: number;
  revenue_today: number;
  revenue_month: number;
  pending_proofs: number;
  payment_attention: number;
  fulfillment_attention: number;
  low_stock: number;
  top_product: null | { name: string; sold_count: number };
  channels: { web: number; telegram: number; whatsapp: number };
  systems: { telegram: boolean; whatsapp: boolean; qris: boolean; fulfillment: boolean };
};

export const EMPTY_ADMIN_OVERVIEW: AdminOverviewData = {
  total_orders: 0, pending_orders: 0, paid_orders: 0, revenue_total: 0,
  revenue_today: 0, revenue_month: 0, pending_proofs: 0,
  payment_attention: 0, fulfillment_attention: 0, low_stock: 0,
  top_product: null, channels: { web: 0, telegram: 0, whatsapp: 0 },
  systems: { telegram: false, whatsapp: false, qris: false, fulfillment: false },
};

export function AdminOverview({ data, loading, onNavigate }: { data: AdminOverviewData; loading: boolean; onNavigate: (section: AdminSection, params?: Record<string, string>) => void }) {
  const metrics = [
    ["Pesanan", String(data.total_orders), "text-white"],
    ["Pending", String(data.pending_orders), "text-[#FFB800]"],
    ["Omzet hari ini", formatRupiah(data.revenue_today), "text-emerald-300"],
    ["Omzet bulan ini", formatRupiah(data.revenue_month), "text-white"],
  ] as const;
  const actions: { title: string; count: number; detail: string; section: AdminSection; params: Record<string, string>; tone: "amber" | "red" }[] = [
    { title: "Pesanan pending", count: data.pending_orders, detail: "Perlu diproses", section: "orders", params: { status: "pending" }, tone: "amber" },
    { title: "Bukti manual", count: data.pending_proofs, detail: "Menunggu pemeriksaan", section: "orders", params: { proof: "submitted", method: "manual" }, tone: "amber" },
    { title: "QRIS perlu dicek", count: data.payment_attention, detail: "Unmatched atau gagal 7 hari", section: "payments", params: { payment_tab: "qris", event_status: "attention" }, tone: "red" },
    { title: "Fulfillment", count: data.fulfillment_attention, detail: "Manual, retry, atau gagal", section: "bot", params: {}, tone: "red" },
    { title: "Stok menipis", count: data.low_stock, detail: "Varian tersisa ≤ 5", section: "products", params: {}, tone: "amber" },
  ];

  return <div className="mt-4 space-y-5">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map(([label, value, tone]) => <div key={label} className="ax-glass rounded-2xl p-4">
        <p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p>
        <p className={`mt-1 font-display text-xl font-bold sm:text-2xl ${tone}`}>{loading ? "—" : value}</p>
      </div>)}
    </div>

    <section className="ax-glass overflow-hidden rounded-[20px]">
      <div className="flex items-center gap-3 border-b border-white/10 p-4 sm:p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/10"><IosIcon name="purchase-order" size={17} tint="#FFB800" /></span>
        <div><h2 className="text-sm font-semibold text-white">Perlu tindakan</h2><p className="mt-0.5 text-xs text-white/40">Antrean operasional yang sebaiknya diselesaikan lebih dulu.</p></div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
        {actions.map((action) => <button key={action.title} onClick={() => onNavigate(action.section, action.params)} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-[#00E5FF]/25 hover:bg-white/[0.06]">
          <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-white/65">{action.title}</p><span className={`min-w-7 rounded-full px-2 py-1 text-center text-xs font-bold ${action.count > 0 ? action.tone === "red" ? "bg-red-500/15 text-red-300" : "bg-[#FFB800]/15 text-[#FFCF55]" : "bg-emerald-500/10 text-emerald-300"}`}>{loading ? "—" : action.count}</span></div>
          <p className="mt-3 text-[11px] leading-5 text-white/35">{action.count > 0 ? action.detail : "Tidak ada antrean"}</p>
        </button>)}
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ax-glass rounded-[20px] p-5"><h2 className="text-sm font-semibold text-white">Kinerja toko</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Total lunas</p><p className="mt-1 font-bold text-emerald-300">{data.paid_orders}</p></div><div className="rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Omzet seluruhnya</p><p className="mt-1 font-bold text-white">{formatRupiah(data.revenue_total)}</p></div><div className="col-span-2 rounded-xl bg-white/[0.04] p-3"><p className="text-[11px] text-white/40">Produk terlaris</p><p className="mt-1 font-semibold text-white">{data.top_product ? `${data.top_product.name} · ${data.top_product.sold_count} terjual` : "Belum ada data"}</p></div></div></section>
      <section className="ax-glass rounded-[20px] p-5"><h2 className="text-sm font-semibold text-white">Kesehatan sistem</h2><div className="mt-4 grid grid-cols-2 gap-3">{Object.entries({ Telegram: data.systems.telegram, WhatsApp: data.systems.whatsapp, "QRIS Hook": data.systems.qris, Fulfillment: data.systems.fulfillment }).map(([label, ok]) => <div key={label} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${ok ? "border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300" : "border-red-400/15 bg-red-500/[0.07] text-red-300"}`}><span className={`mr-2 inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />{label}</div>)}</div></section>
    </div>
  </div>;
}
