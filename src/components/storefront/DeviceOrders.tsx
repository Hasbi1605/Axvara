"use client";

// "Pesanan di perangkat ini" di /lacak-pesanan, tujuan tab Pesanan bottom nav
// (2026-09-25). Sumbernya salinan lokal checkout (tanpa WA/email). Status
// selalu dari server lewat GET /api/orders?code= (endpoint yang sama dengan
// halaman pesanan, cukup kode), maksimal DEVICE_ORDERS_MAX pesanan terbaru
// agar hemat kuota orders:lookup; yang sudah batal/kedaluwarsa tidak dicek ulang.
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { IosIcon } from "@/components/ui/IosIcon";
import { readLocalOrders, removeLocalOrder, settleLocalOrder, type LocalOrder } from "@/lib/local-orders";

export const DEVICE_ORDERS_MAX = 5;
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const FINAL_LOCAL = new Set(["dibatalkan", "kadaluarsa"]);

type Live = { status: string; fulfillment: string | null; total: number | null };
type Row = { local: LocalOrder & { code: string }; live: Live | "loading" | "error" };

const TONE = {
  gold: "border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFD66B]",
  green: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  cyan: "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#5cefff]",
  red: "border-red-400/25 bg-red-500/10 text-red-300",
  muted: "border-white/10 bg-white/[0.05] text-white/55",
} as const;

export function deviceOrderStatus(live: Row["live"]): { label: string; tone: keyof typeof TONE; pay: boolean } {
  if (live === "loading") return { label: "Memeriksa status…", tone: "muted", pay: false };
  if (live === "error") return { label: "Status belum termuat", tone: "muted", pay: false };
  switch (live.status) {
    case "pending": return { label: "Menunggu pembayaran", tone: "gold", pay: true };
    case "lunas":
      if (live.fulfillment === "delivered") return { label: "Selesai", tone: "green", pay: false };
      if (live.fulfillment === "failed") return { label: "Pengiriman bermasalah", tone: "red", pay: false };
      if (!live.fulfillment || live.fulfillment === "not_required") return { label: "Lunas", tone: "green", pay: false };
      return { label: "Lunas · sedang diproses", tone: "cyan", pay: false };
    case "dibatalkan": return { label: "Dibatalkan", tone: "muted", pay: false };
    case "kadaluarsa": return { label: "Kedaluwarsa", tone: "muted", pay: false };
    default: return { label: live.status || "Status tidak dikenal", tone: "muted", pay: false };
  }
}

function recentLocalOrders(now: number): (LocalOrder & { code: string })[] {
  return readLocalOrders()
    .filter((o): o is LocalOrder & { code: string } => typeof o.code === "string" && o.code.length > 0 && o.status !== "missing")
    .map((o) => ({ order: o, created: Date.parse(String(o.createdAt || "")) }))
    .filter(({ created }) => Number.isFinite(created) && now - created < MAX_AGE_MS)
    .sort((a, b) => b.created - a.created)
    .slice(0, DEVICE_ORDERS_MAX)
    .map(({ order }) => order);
}

export function DeviceOrders() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    const list = recentLocalOrders(Date.now());
    setRows(list.map((local) => ({
      local,
      live: FINAL_LOCAL.has(String(local.status)) ? { status: String(local.status), fulfillment: null, total: null } : "loading",
    })));
    const update = (code: string, live: Row["live"]) => {
      if (!cancelled) setRows((current) => current.map((row) => (row.local.code === code ? { ...row, live } : row)));
    };
    for (const local of list) {
      if (FINAL_LOCAL.has(String(local.status))) continue;
      void (async () => {
        try {
          const response = await fetchWithTimeout(`/api/orders?code=${encodeURIComponent(local.code)}`, { cache: "no-store" }, 15_000);
          if (response.status === 404) {
            settleLocalOrder(local.code, "missing");
            if (!cancelled) setRows((current) => current.filter((row) => row.local.code !== local.code));
            return;
          }
          // 429/5xx: tampilkan data lokal apa adanya, tanpa klaim status.
          if (!response.ok) { update(local.code, "error"); return; }
          const { order } = (await response.json()) as { order?: Record<string, unknown> };
          if (!order) { update(local.code, "error"); return; }
          const qris = order.qris as { payable_amount?: unknown } | null | undefined;
          const total = Number(qris?.payable_amount ?? order.subtotal);
          const status = String(order.status ?? "");
          if (status && status !== "pending") settleLocalOrder(local.code, status);
          update(local.code, {
            status,
            fulfillment: order.fulfillment_status ? String(order.fulfillment_status) : null,
            total: Number.isFinite(total) ? total : null,
          });
        } catch {
          update(local.code, "error");
        }
      })();
    }
    return () => { cancelled = true; };
  }, []);

  if (!rows.length) return null;

  return (
    <section aria-labelledby="device-orders-title" className="ax-glass-card mt-6 rounded-[24px] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="device-orders-title" className="text-sm font-semibold text-white">Pesanan di perangkat ini</h2>
        <span className="text-[11px] text-white/35">Status langsung dari server</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map(({ local, live }) => {
          const view = deviceOrderStatus(live);
          const items = (local.items ?? []).map((item) => `${item.name ?? "Produk"} ×${Math.max(1, Number(item.qty ?? 1) || 1)}`).join(", ") || "Pesanan";
          const total = live !== "loading" && live !== "error" && live.total != null ? live.total : Number(local.subtotal ?? 0);
          const created = formatWibDateTime(local.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
          return (
            <li key={local.code} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{items}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-bold text-[#00E5FF]/85">{local.code}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">{created ? `${created} · ` : ""}{formatRupiah(total)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { removeLocalOrder(local.code); setRows((current) => current.filter((row) => row.local.code !== local.code)); }}
                  aria-label={`Sembunyikan ${local.code} dari perangkat ini`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
                >
                  <IosIcon name="close" size={14} tint="white" />
                </button>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${TONE[view.tone]}`}>{view.label}</span>
                <Link
                  href={`/pesanan/${encodeURIComponent(local.code)}`}
                  className={view.pay
                    ? "inline-flex h-9 items-center rounded-full bg-[#00E5FF] px-4 text-xs font-bold text-[#080C1E] transition hover:bg-[#00D0E8]"
                    : "inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.05] px-4 text-xs font-semibold text-white/80 transition hover:bg-white/10"}
                >
                  {view.pay ? "Bayar sekarang" : "Lihat pesanan"}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
