// src/components/admin/WarungRebahanManager.tsx — Tab admin Warung Rebahan H2H:
// saldo + estimasi, status sync, antrean order WR, exclusion rules, markup per varian.
// Mengikuti pola PaymentReconciliation (fetch per section, toast error, gaya ax-glass).

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import { useToast } from "@/components/ui/Toast";

type SaldoData = {
  current?: { balance: number; isLow: boolean; threshold: number };
  capacity?: { balance: number; avgOrderCost: number; estimatedOrders: number };
  history?: { balance: number; created_at: string }[];
};

type SyncLogRow = {
  id: number;
  sync_type: string;
  status: string;
  products_total: number | null;
  products_synced: number | null;
  products_excluded: number | null;
  products_new: number | null;
  variants_synced: number | null;
  stock_changes: number | null;
  price_changes: number | null;
  created_at: string;
};

type WrOrderRow = {
  id: number;
  order_code: string;
  wr_order_id: string | null;
  quantity: number;
  wr_cost: number;
  status: string;
  attempt_count: number;
  last_error: string | null;
  order_status?: string;
  sales_channel?: string;
  customer_name?: string | null;
  customer_wa?: string | null;
  customer_email?: string | null;
  created_at?: string | null;
  request_sent_at?: string | null;
  updated_at?: string | null;
  aging_alerted_at?: string | null;
};

type ExclusionRow = { id: number; pattern: string; reason: string | null };

type MarkupRow = {
  wr_variant_id: string;
  wr_variant_name: string;
  wr_price: number;
  wr_stock: number;
  markup_percent: number;
  markup_fixed: number;
  axvara_sell_price: number;
  wr_product_name: string | null;
  wr_delivery_class: string | null;
  wr_delivery_source: string | null;
};

/** Umur antrean, dihitung dari saat request dikirim ke upstream (fallback
 *  created_at). Kelas antrean dikerjakan manusia 6–12 jam, jadi umur adalah
 *  satu-satunya sinyal cepat "ini sudah kelamaan" di panel. */
function ageLabel(order: { request_sent_at?: string | null; created_at?: string | null; updated_at?: string | null }): { text: string; hours: number } | null {
  const raw = order.request_sent_at || order.created_at || order.updated_at;
  if (!raw) return null;
  // D1 menyimpan datetime('now') UTC tanpa zona — perlakukan sebagai UTC.
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const hours = minutes / 60;
  return { text: minutes < 60 ? `${minutes} mnt` : `${Math.floor(hours)} jam ${minutes % 60} mnt`, hours };
}

const WR_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  ordering: "Dipesan…",
  processing: "Diproses WR",
  completed: "Selesai",
  failed: "Gagal",
  retry: "Retry",
};

export function WarungRebahanManager() {
  const toast = useToast();
  const [saldo, setSaldo] = useState<SaldoData>({});
  const [saldoLoading, setSaldoLoading] = useState(true);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [orders, setOrders] = useState<WrOrderRow[]>([]);
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderQueryLive, setOrderQueryLive] = useState("");
  const [retrying, setRetrying] = useState<number | null>(null);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [markups, setMarkups] = useState<MarkupRow[]>([]);
  const [markupQuery, setMarkupQuery] = useState("");
  const [editingMarkup, setEditingMarkup] = useState<Record<string, { percent: string; fixed: string }>>({});

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const res = await fetch("/api/admin/warung/saldo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat saldo WR");
      setSaldo(body);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat saldo WR");
    } finally {
      setSaldoLoading(false);
    }
  }, [toast]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/warung/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLogs(body.logs || []);
    } catch { /* sync log opsional */ }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/warung/orders?status=${encodeURIComponent(orderStatus)}&limit=20${orderQueryLive ? `&q=${encodeURIComponent(orderQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat antrean WR");
      setOrders(body.orders || []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat antrean WR");
    }
  }, [orderStatus, orderQueryLive, toast]);

  const loadExclusions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/warung/exclusions", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setExclusions(body.exclusions || []);
    } catch { /* opsional */ }
  }, []);

  const loadMarkups = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/warung/markup?limit=30${markupQuery ? `&q=${encodeURIComponent(markupQuery)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMarkups(body.variants || []);
    } catch { /* opsional */ }
  }, [markupQuery]);

  useEffect(() => {
    void loadSaldo();
    void loadLogs();
    void loadExclusions();
    void loadMarkups();
  }, [loadSaldo, loadLogs, loadExclusions, loadMarkups]);
  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // Cari manual email WR: debounce 400ms agar paste invoice #RBHN-... tidak
  // menembak API per karakter. Inilah jembatan manual sementara sebelum bot
  // email otomatis (fase 2) — paste invoice WR langsung ketemu buyer Axvara.
  useEffect(() => {
    const timer = setTimeout(() => setOrderQueryLive(orderQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [orderQuery]);

  const forceSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/warung/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sync gagal");
      const ringkas = `${body.synced} produk, ${body.variantsSynced} varian`;
      const errors: string[] = Array.isArray(body.errors) ? body.errors : [];
      if (body.status === "failed") throw new Error(errors[0] || "Sync gagal tanpa satu pun produk tersimpan.");
      else if (body.status === "partial") {
        // Sukses palsu dihapus: batch yang berhenti karena budget atau menyimpan
        // error harus terlihat berbeda dari sync yang benar-benar tuntas.
        const sebab = errors.length ? `${errors.length} error — ${errors[0]}` : "berhenti di batas budget, lanjut otomatis di cron berikutnya";
        toast.error(`Sync sebagian: ${ringkas}. ${sebab}`);
      } else toast.success(`Sync selesai: ${ringkas}.`);
      await Promise.all([loadLogs(), loadSaldo()]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Sync gagal");
    } finally {
      setSyncing(false);
    }
  };

  const retryOrder = async (id: number) => {
    setRetrying(id);
    try {
      const res = await fetch(`/api/admin/warung/orders/${id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Retry gagal");
      toast.success("Order dijadwalkan ulang.");
      await loadOrders();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Retry gagal");
    } finally {
      setRetrying(null);
    }
  };

  const addExclusion = async () => {
    const pattern = newPattern.trim();
    if (pattern.length < 2) {
      toast.error("Pola minimal 2 karakter.");
      return;
    }
    try {
      const res = await fetch("/api/admin/warung/exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menambah exclusion");
      setNewPattern("");
      toast.success("Exclusion ditambahkan.");
      await loadExclusions();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menambah exclusion");
    }
  };

  const deleteExclusion = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/warung/exclusions?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus");
      toast.success("Exclusion dihapus.");
      await loadExclusions();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menghapus");
    }
  };

  const saveMarkup = async (row: MarkupRow) => {
    const edit = editingMarkup[row.wr_variant_id];
    const percent = Number(edit?.percent ?? row.markup_percent);
    const fixed = Number(edit?.fixed ?? row.markup_fixed);
    if (!Number.isInteger(percent) || percent < 0 || percent > 500 || !Number.isInteger(fixed) || fixed < 0) {
      toast.error("Markup tidak valid (0–500% + nominal).");
      return;
    }
    try {
      const res = await fetch("/api/admin/warung/markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wr_variant_id: row.wr_variant_id, markup_percent: percent, markup_fixed: fixed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan markup");
      toast.success(`Harga jual baru ${formatRupiah(body.sell_price)}.`);
      await loadMarkups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan markup");
    }
  };

  const setDeliveryClass = async (row: MarkupRow, deliveryClass: "restock" | "made_by_order") => {
    try {
      const res = await fetch("/api/admin/warung/markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wr_variant_id: row.wr_variant_id, delivery_class: deliveryClass }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal mengunci kelas");
      toast.success(deliveryClass === "restock" ? "Dikunci: RESTOK • auto." : "Dikunci: MBO • manual.");
      await loadMarkups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal mengunci kelas");
    }
  };

  const lastLog = logs[0];
  // logs[0] adalah sync PRODUK terakhir (endpoint memfilter baris saldo).
  // Bila endpoint lama masih mengembalikan baris saldo (products_synced
  // NULL), jangan tampilkan 0/0/0 — tampilkan strip agar tidak menipu.
  const lastProductLog = lastLog && lastLog.sync_type === "products" ? lastLog : null;
  // Sync manual menutupi jejak cron (keduanya menulis baris products):
  // tampilkan keduanya agar pemilik bisa verifikasi cron berjalan.
  const lastManualLog = logs.find((l) => l.sync_type === "products" && (l as SyncLogRow & { trigger?: string }).trigger !== "cron") ?? null;
  const lastCronLog = logs.find((l) => l.sync_type === "products" && (l as SyncLogRow & { trigger?: string }).trigger === "cron") ?? null;
  const balance = saldo.current?.balance ?? saldo.capacity?.balance ?? null;

  return (
    <div className="mt-4 space-y-4">
      <section className="ax-glass overflow-hidden rounded-[20px]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Saldo Warung Rebahan</h2>
            <p className="mt-0.5 text-xs text-white/40">Diambil real-time dari API WR setiap dibuka.</p>
          </div>
          <button onClick={() => void loadSaldo()} disabled={saldoLoading} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-40">
            <IosIcon name="refresh" size={13} tint="white" /> Muat ulang
          </button>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
          <div className={`rounded-2xl border p-4 ${saldo.current?.isLow ? "border-red-400/20 bg-red-500/[0.06]" : "border-emerald-400/15 bg-emerald-400/[0.06]"}`}>
            <p className="text-[11px] uppercase tracking-wide text-white/40">Saldo saat ini</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${saldo.current?.isLow ? "text-red-300" : "text-emerald-300"}`}>
              {saldoLoading ? "…" : balance != null ? formatRupiah(balance) : "—"}
            </p>
            {saldo.current?.isLow && <p className="mt-1 text-[11px] text-red-300">Di bawah batas {formatRupiah(saldo.current.threshold)} — segera top up.</p>}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/40">Estimasi kapasitas</p>
            <p className="mt-1 text-lg font-bold text-white tabular-nums">~{saldo.capacity?.estimatedOrders ?? 0} order</p>
            <p className="mt-1 text-[11px] text-white/40">Rata-rata modal {formatRupiah(saldo.capacity?.avgOrderCost ?? 0)}/order.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/40">Sync terakhir</p>
            <p className="mt-1 text-sm font-semibold text-white">{lastProductLog ? `${lastProductLog.status} · ${formatDate(lastProductLog.created_at)}` : lastLog ? `${lastLog.status} · ${formatDate(lastLog.created_at)}` : "Belum pernah"}</p>
            <p className="mt-1 text-[11px] text-white/40">
              {lastProductLog ? `${lastProductLog.products_synced ?? 0} produk · ${lastProductLog.variants_synced ?? 0} varian · ${lastProductLog.products_excluded ?? 0} excluded` : lastLog ? "sync produk" : "Tekan Force Sync untuk sync pertama."}
            </p>
            {(lastManualLog || lastCronLog) && (
              <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[11px] text-white/40">
                <p>🔵 Manual: {lastManualLog ? `${lastManualLog.status} · ${formatDate(lastManualLog.created_at)} · ${lastManualLog.products_synced ?? 0}p/${lastManualLog.variants_synced ?? 0}v` : "—"}</p>
                <p>🟢 Otomatis: {lastCronLog ? `${lastCronLog.status} · ${formatDate(lastCronLog.created_at)} · ${lastCronLog.products_synced ?? 0}p/${lastCronLog.variants_synced ?? 0}v` : "—"}</p>
              </div>
            )}
            <button onClick={() => void forceSync()} disabled={syncing} className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
              {syncing ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />}{syncing ? "Sync…" : "Force Sync Now"}
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Antrean order WR</h3><p className="mt-0.5 text-[11px] text-white/40">Order lunas yang diteruskan ke Warung Rebahan. Cari by invoice WR (#RBHN-…) atau kode Axvara untuk forward manual email WR ke buyer.</p></div>
          <input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Cari invoice WR / kode Axvara…" className="h-9 w-full max-w-[240px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none sm:ml-auto" />
          <div className="flex flex-wrap gap-2">
            {[["all", "Semua"], ["pending", "Pending"], ["processing", "Diproses"], ["retry", "Retry"], ["failed", "Gagal"], ["completed", "Selesai"]].map(([value, label]) => (
              <button key={value} onClick={() => setOrderStatus(value)} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${orderStatus === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>
            ))}
          </div>
        </header>
        {!orders.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada order WR pada filter ini.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {orders.map((order) => (
              <article key={order.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={order.status} />
                    <span className="font-mono text-xs font-semibold text-[#5cefff]">{order.order_code}</span>
                    <span className="text-xs text-white/45">{formatRupiah(order.wr_cost)} modal</span>
                    {order.wr_order_id && <span className="font-mono text-[11px] text-white/35">{order.wr_order_id}</span>}
                    {!["completed", "failed"].includes(order.status) && (() => {
                      const age = ageLabel(order);
                      if (!age) return null;
                      // >13 jam = melewati ambang internal (plafon pembeli 12 jam).
                      const late = age.hours >= 13;
                      return (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${late ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-white/10 bg-white/[0.04] text-white/45"}`}>
                          {age.text}{late ? " · lewat batas" : ""}
                        </span>
                      );
                    })()}
                  </div>
                  {(order.customer_name || order.customer_wa || order.customer_email) && (
                    <p className="mt-1 text-[11px] text-white/55">
                      {[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ")}
                      {order.sales_channel ? ` · ${order.sales_channel}` : ""}
                    </p>
                  )}
                  {order.last_error && <p className="mt-1 font-mono text-[10px] text-red-300/70">{order.last_error}</p>}
                </div>
                {["pending", "retry", "failed"].includes(order.status) && (
                  <button onClick={() => void retryOrder(order.id)} disabled={retrying === order.id} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
                    {retrying === order.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />} Retry
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Exclusion rules</h3><p className="mt-0.5 text-[11px] text-white/40">Produk yang cocok pola tidak masuk katalog (mis. Canva & Gemini).</p></header>
        <div className="space-y-2 p-4">
          {exclusions.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
              <span className="min-w-0 flex-1 font-mono text-xs text-white/75">{rule.pattern}</span>
              {rule.reason && <span className="hidden max-w-[40%] truncate text-[11px] text-white/40 sm:inline">{rule.reason}</span>}
              <button onClick={() => void deleteExclusion(rule.id)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-300 transition hover:bg-red-500/20" aria-label={`Hapus exclusion ${rule.pattern}`}>
                <IosIcon name="close" size={13} tint="#F87171" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="cth: canva" className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
            <button onClick={() => void addExclusion()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8]">
              <IosIcon name="plus" size={13} tint="black" /> Tambah
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Markup per varian</h3><p className="mt-0.5 text-[11px] text-white/40">Ubah markup → harga jual Axvara dihitung ulang otomatis.</p></div>
          <input value={markupQuery} onChange={(e) => setMarkupQuery(e.target.value)} placeholder="Cari varian…" className="ml-auto h-9 w-full max-w-[220px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
        </header>
        {!markups.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada varian WR tersinkron.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {markups.slice(0, 30).map((row) => {
              const edit = editingMarkup[row.wr_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
              return (
                <article key={row.wr_variant_id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{row.wr_product_name ? `${row.wr_product_name} — ` : ""}{row.wr_variant_name}</p>
                      <DeliveryBadge wrClass={row.wr_delivery_class} source={row.wr_delivery_source} />
                    </div>
                    <p className="mt-1 text-xs text-white/45">Modal {formatRupiah(row.wr_price)} · Jual {formatRupiah(row.axvara_sell_price)} · Stok {row.wr_stock}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-white/55">%<input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" className="h-9 w-16 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <label className="flex items-center gap-1.5 text-xs text-white/55">+Rp<input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" className="h-9 w-24 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <button onClick={() => void saveMarkup(row)} className="inline-flex h-9 items-center rounded-xl bg-white px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-white/90">Simpan</button>
                    <button onClick={() => void setDeliveryClass(row, "restock")} title="Kunci sebagai RESTOK (auto)" className="inline-flex h-9 items-center rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-2.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/20">AUTO</button>
                    <button onClick={() => void setDeliveryClass(row, "made_by_order")} title="Kunci sebagai MBO (manual)" className="inline-flex h-9 items-center rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2.5 text-[11px] font-bold text-[#FFD66B] transition hover:bg-[#FFB800]/20">MANUAL</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "completed" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
    : status === "failed" ? "border-red-400/25 bg-red-500/10 text-red-300"
    : status === "processing" || status === "ordering" ? "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#5cefff]"
    : "border-[#FFB800]/25 bg-[#FFB800]/10 text-[#FFD66B]";
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${tone}`}>{WR_STATUS_LABEL[status] ?? status}</span>;
}

/** Badge kelas pengiriman WR (admin saja): RESTOK/MBO + sumber kunci. */
function DeliveryBadge({ wrClass, source }: { wrClass: string | null; source: string | null }) {
  if (wrClass === "restock") {
    const src = source === "admin" ? "kunci admin" : source === "screenshot" ? "daftar WR" : source === "system" ? "tebakan" : "";
    return <span title={src ? `RESTOK • auto • ${src}` : "RESTOK • auto"} className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">RESTOK{src ? ` • ${src}` : ""}</span>;
  }
  if (wrClass === "made_by_order") {
    const src = source === "admin" ? "kunci admin" : source === "screenshot" ? "daftar WR" : source === "system" ? "tebakan" : "";
    return <span title={src ? `MBO • manual • ${src}` : "MBO • manual"} className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">MBO{src ? ` • ${src}` : ""}</span>;
  }
  return <span title="Belum dikunci — label pembeli = Dikirim admin" className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">? belum dikunci</span>;
}

function formatDate(value: string): string {
  // Parsing di sini sudah benar sejak awal; dipindah ke helper kanonis agar
  // zona tampilan ikut dikunci ke WIB (admin dari perangkat non-WIB pun
  // melihat jam operasional toko yang sama).
  return formatWibDateTime(value, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) ?? String(value);
}
