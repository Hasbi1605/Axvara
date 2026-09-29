// src/components/admin/SekalipayManager.tsx — Tab admin Sekalipay (supplier kedua).
// Cermin WarungRebahanManager: saldo + kapasitas, status sync + Force Sync,
// antrean order SK (retry/void), sandbox order test.

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { formatWibDateTime } from "@/lib/utils";
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

type SkOrderRow = {
  id: number;
  order_code: string;
  sk_invoice: string | null;
  quantity: number;
  sk_cost: number;
  status: string;
  attempt_count: number;
  last_error: string | null;
  sk_account_details?: string | null;
  order_status?: string;
  sales_channel?: string;
  customer_name?: string | null;
  customer_wa?: string | null;
  customer_email?: string | null;
  created_at?: string | null;
  request_sent_at?: string | null;
  updated_at?: string | null;
};

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return formatWibDateTime(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

const SK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  claimed: "Diklaim worker",
  submitted: "Terkirim ke SK",
  ordering: "Dipesan…",
  processing: "Diproses SK",
  completed: "Selesai",
  failed: "Gagal",
  retry: "Retry",
  blocked_balance: "Saldo SK habis",
};

function StatusBadge({ status }: { status: string }) {
  const label = SK_STATUS_LABEL[status] ?? status;
  const color =
    status === "completed"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
      : status === "failed"
        ? "border-red-400/30 bg-red-500/10 text-red-300"
        : status === "blocked_balance"
          ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
          : "border-white/10 bg-white/[0.04] text-white/60";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}
    </span>
  );
}

const RETRYABLE_SK_STATUS = ["pending", "retry", "failed", "blocked_balance"];

function canRetrySkLink(order: { status: string; attempt_count?: number }): boolean {
  if (!RETRYABLE_SK_STATUS.includes(order.status)) return false;
  return Number(order.attempt_count ?? 0) < 3;
}

export function SekalipayManager() {
  const toast = useToast();
  const [saldo, setSaldo] = useState<SaldoData>({});
  const [saldoLoading, setSaldoLoading] = useState(true);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [orders, setOrders] = useState<SkOrderRow[]>([]);
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderQueryLive, setOrderQueryLive] = useState("");
  const [retrying, setRetrying] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [sandboxProduct, setSandboxProduct] = useState("");
  const [sandboxVariant, setSandboxVariant] = useState("");
  const [sandboxing, setSandboxing] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<string | null>(null);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const res = await fetch("/api/admin/sekalipay/saldo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat saldo SK");
      setSaldo(body);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat saldo SK");
    } finally {
      setSaldoLoading(false);
    }
  }, [toast]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sekalipay/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLogs(body.logs || []);
    } catch { /* sync log opsional */ }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sekalipay/orders?status=${encodeURIComponent(orderStatus)}&limit=20${orderQueryLive ? `&q=${encodeURIComponent(orderQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat antrean SK");
      setOrders(body.orders || []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat antrean SK");
    }
  }, [orderStatus, orderQueryLive, toast]);

  useEffect(() => {
    void loadSaldo();
    void loadLogs();
  }, [loadSaldo, loadLogs]);
  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const timer = setTimeout(() => setOrderQueryLive(orderQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [orderQuery]);

  const forceSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/sekalipay/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sync gagal");
      const ringkas = `${body.synced} varian, ${body.newProducts} produk baru`;
      const errors: string[] = Array.isArray(body.errors) ? body.errors : [];
      if (body.status === "failed") throw new Error(errors[0] || "Sync gagal tanpa satu pun varian tersimpan.");
      else if (body.status === "partial") {
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
      const res = await fetch(`/api/admin/sekalipay/orders/${id}/retry`, { method: "POST" });
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

  const voidOrder = async (id: number, orderCode: string) => {
    if (!window.confirm(`Batalkan order SK ${orderCode}? Link tidak akan diproses lagi (terminal failed).`)) return;
    setVoiding(id);
    try {
      const res = await fetch(`/api/admin/sekalipay/orders/${id}/void`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Void gagal");
      toast.success("Order dibatalkan.");
      await loadOrders();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Void gagal");
    } finally {
      setVoiding(null);
    }
  };

  const runSandbox = async () => {
    const productId = Number(sandboxProduct);
    const variantId = Number(sandboxVariant);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(variantId) || variantId <= 0) {
      toast.error("Isi product_id + variant_id SK (angka dari daftar varian).");
      return;
    }
    setSandboxing(true);
    setSandboxResult(null);
    try {
      const res = await fetch("/api/admin/sekalipay/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, variant_id: variantId, quantity: 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sandbox gagal");
      setSandboxResult(`OK · ref ${body.ref_id} · ${JSON.stringify(body.result).slice(0, 300)}`);
      toast.success("Sandbox order berhasil (saldo tidak terpotong).");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Sandbox gagal";
      setSandboxResult(`GAGAL · ${msg}`);
      toast.error(msg);
    } finally {
      setSandboxing(false);
    }
  };

  const lastLog = logs[0];
  const balance = saldo.current?.balance ?? saldo.capacity?.balance ?? null;

  return (
    <div className="mt-4 space-y-4">
      <section className="ax-glass overflow-hidden rounded-[20px]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">Saldo Sekalipay</h2>
            <p className="mt-0.5 text-xs text-white/40">Diambil real-time dari API SK setiap dibuka. Supplier kedua paralel WR.</p>
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
            <p className="mt-1 text-sm font-semibold text-white">{lastLog ? `${lastLog.status} · ${formatDate(lastLog.created_at)}` : "Belum pernah"}</p>
            <p className="mt-1 text-[11px] text-white/40">
              {lastLog ? `${lastLog.products_synced ?? 0} varian · ${lastLog.products_new ?? 0} produk baru · ${lastLog.products_excluded ?? 0} non-auto` : "Tekan Force Sync untuk sync pertama."}
            </p>
            <button onClick={() => void forceSync()} disabled={syncing} className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
              {syncing ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />}{syncing ? "Sync…" : "Force Sync Now"}
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Uji sandbox order</h3><p className="mt-0.5 text-[11px] text-white/40">Tanpa potong saldo. Isi product_id + variant_id SK (lihat respons sync / daftar item).</p></div>
        </header>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <input value={sandboxProduct} onChange={(e) => setSandboxProduct(e.target.value)} placeholder="product_id" inputMode="numeric" className="h-9 w-32 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <input value={sandboxVariant} onChange={(e) => setSandboxVariant(e.target.value)} placeholder="variant_id" inputMode="numeric" className="h-9 w-32 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <button onClick={() => void runSandbox()} disabled={sandboxing} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
            {sandboxing ? <Spinner size={13} /> : null}{sandboxing ? "Mengirim…" : "Kirim sandbox"}
          </button>
          {sandboxResult && <p className="w-full font-mono text-[11px] text-white/60">{sandboxResult}</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Antrean order SK</h3><p className="mt-0.5 text-[11px] text-white/40">Order lunas yang diteruskan ke Sekalipay. Cari by invoice SK atau kode Axvara.</p></div>
          <input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Cari invoice SK / kode Axvara…" className="h-9 w-full max-w-[240px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none sm:ml-auto" />
          <div className="flex flex-wrap gap-2">
            {[["all", "Semua"], ["pending", "Pending"], ["submitted", "Terkirim"], ["processing", "Diproses"], ["retry", "Retry"], ["blocked_balance", "Saldo habis"], ["failed", "Gagal"], ["completed", "Selesai"]].map(([value, label]) => (
              <button key={value} onClick={() => setOrderStatus(value)} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${orderStatus === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>
            ))}
          </div>
        </header>
        {!orders.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada order SK pada filter ini.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {orders.map((order) => (
              <article key={order.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={order.status} />
                    <span className="font-mono text-xs font-semibold text-[#5cefff]">{order.order_code}</span>
                    <span className="text-xs text-white/45">{formatRupiah(order.sk_cost)} modal</span>
                    {order.sk_invoice && <span className="font-mono text-[11px] text-white/35">{order.sk_invoice}</span>}
                  </div>
                  {(order.customer_name || order.customer_wa || order.customer_email) && (
                    <p className="mt-1 text-[11px] text-white/55">
                      {[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ")}
                      {order.sales_channel ? ` · ${order.sales_channel}` : ""}
                    </p>
                  )}
                  {order.last_error && <p className="mt-1 font-mono text-[10px] text-red-300/70">{order.last_error}</p>}
                </div>
                {canRetrySkLink(order) ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
                      {retrying === order.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />} Retry
                    </button>
                    <button onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 text-xs font-bold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40">
                      {voiding === order.id ? <Spinner size={13} /> : null} Batal
                    </button>
                  </div>
                ) : order.status === "completed" || order.status === "failed" ? (
                  <StatusBadge status={order.status} />
                ) : (
                  <button onClick={() => void voidOrder(order.id, order.order_code)} disabled={voiding === order.id} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 text-xs font-bold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40">
                    {voiding === order.id ? <Spinner size={13} /> : null} Batal
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
