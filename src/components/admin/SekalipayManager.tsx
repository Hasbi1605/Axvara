// src/components/admin/SekalipayManager.tsx — Tab admin Sekalipay (supplier kedua).
// Setara WarungRebahanManager: saldo + kapasitas, status sync + Force Sync,
// antrean order SK (retry/void + umur antrean), exclusion rules, markup per
// varian, sandbox order. Tab Audit/Alat beserta mutasi saldo, cek akun,
// stock-lock, daftar transaksi, dan detail varian dihapus atas permintaan
// owner (16 November 2026).

"use client";
import { SupplierSyncStatus, syncCompactValue, type SupplierDiffStatus, type SupplierSyncLogRow } from "@/components/admin/SupplierSyncStatus";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, StatCard, Checkbox, Input, NativeSelect, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { BulkMarkupToolbar } from "@/components/admin/BulkMarkupToolbar";
import { SupplierTabs, VariantStatusBadge, type SupplierTabId } from "@/components/admin/SupplierTabs";

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
  error_message?: string | null;
  duration_ms?: number | null;
  trigger?: string;
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
  max_attempts?: number;
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

type ExclusionRow = { id: number; pattern: string; reason: string | null };

type MarkupRow = {
  sk_variant_id: string;
  sk_variant_name: string;
  sk_price: number;
  sk_stock: number;
  sk_order_process: string;
  sk_min_order: number | null;
  sk_status: string | null;
  markup_percent: number;
  markup_fixed: number;
  axvara_sell_price: number;
  axvara_variant_id: number | null;
  sk_product_name: string | null;
  current_price: number | null;
};

/** Umur antrean (cermin WR ageLabel): request_sent_at → created_at → updated_at. */
function ageLabel(order: { request_sent_at?: string | null; created_at?: string | null; updated_at?: string | null }): { text: string; hours: number } | null {
  const raw = order.request_sent_at || order.created_at || order.updated_at;
  if (!raw) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const hours = minutes / 60;
  return { text: minutes < 60 ? `${minutes} mnt` : `${Math.floor(hours)} jam ${minutes % 60} mnt`, hours };
}

const SK_STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu",
  claimed: "Diklaim worker",
  submitted: "Terkirim ke SK",
  ordering: "Dipesan…",
  processing: "Diproses SK",
  completed: "Selesai",
  failed: "Gagal",
  canceled: "Dibatalkan SK",
  retry: "Retry",
  blocked_balance: "Saldo SK habis",
};

function StatusBadge({ status }: { status: string }) {
  const label = SK_STATUS_LABEL[status] ?? status;
  const variant = status === "completed" ? "success"
    : status === "failed" || status === "canceled" ? "destructive"
    : status === "blocked_balance" ? "warning"
    : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

/** Badge order_process SK (admin saja): AUTO/MANUAL/H2H/SMM/VIP. */
function ProcessBadge({ process }: { process: string }) {
  const p = String(process || "").toLowerCase();
  if (p === "auto") return <Badge variant="success" title="AUTO · lisensi langsung">AUTO</Badge>;
  if (p === "manual") return <Badge variant="warning" title="MANUAL · diproses admin SK">MANUAL</Badge>;
  if (p === "h2h" || p === "smm" || p === "vip") return <Badge variant="secondary" title={`${p.toUpperCase()} · belum didukung fase 1`}>{p.toUpperCase()}</Badge>;
  return <Badge variant="secondary">{process || "?"}</Badge>;
}

const RETRYABLE_SK_STATUS = ["pending", "retry", "failed", "blocked_balance"];

/**
 * Retry hanya bila kuota percobaan masih ada (API menolak bila habis).
 * Cermin canRetryWrLink — memakai max_attempts dari baris, bukan konstanta.
 */
function canRetrySkLink(order: { status: string; attempt_count?: number; max_attempts?: number }): boolean {
  if (!RETRYABLE_SK_STATUS.includes(order.status)) return false;
  return Number(order.attempt_count ?? 0) < Number(order.max_attempts ?? 3);
}

const ORDER_FILTERS: [string, string][] = [["all", "Semua"], ["pending", "Pending"], ["submitted", "Terkirim"], ["processing", "Diproses"], ["retry", "Retry"], ["blocked_balance", "Saldo habis"], ["failed", "Gagal"], ["completed", "Selesai"]];

export function SekalipayManager() {
  const toast = useToast();
  const [saldo, setSaldo] = useState<SaldoData>({});
  const [saldoLoading, setSaldoLoading] = useState(true);
  // D6: sampai sync-log selesai, "Sinkron terakhir" harus Skeleton — bukan "Belum pernah".
  const [logsLoading, setLogsLoading] = useState(true);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [diffStatus, setDiffStatus] = useState<SupplierDiffStatus>(null);
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
  // Setara WR: exclusion rules + markup per varian.
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [markups, setMarkups] = useState<MarkupRow[]>([]);
  const [markupQuery, setMarkupQuery] = useState("");
  // Markup search di-debounce 400ms (cermin orderQueryLive di bawah): tanpa
  // ini tiap ketikan menembak /markup + me-remount daftar saat saldo live
  // (2–4 dtk) sedang jalan — tabrakan render pemicu "gagal memuat" beruntun.
  const [markupQueryLive, setMarkupQueryLive] = useState("");
  const [editingMarkup, setEditingMarkup] = useState<Record<string, { percent: string; fixed: string }>>({});
  // Seleksi bulk markup (2026-10-01, cermin WR): checklist per baris + preset %.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  // Tab dalam-halaman (2026-10-01, cermin SystemTabs + WR): Ringkas default.
  const [skTab, setSkTab] = useState<Extract<SupplierTabId, "ringkas" | "antrean" | "markup" | "aturan">>("ringkas");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set(["ringkas"]));
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const ORDER_PER_PAGE = 20;
  const [markupTab, setMarkupTab] = useState<"live" | "hidden" | "off" | "all">("live");
  const [markupPerPage, setMarkupPerPage] = useState<20 | 50 | 100>(20);
  const [markupPage, setMarkupPage] = useState(1);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const res = await fetch("/api/admin/sekalipay/saldo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      // Kontrak 2026-09-30: endpoint fallback cache + flag stale bila live
      // gagal (proxy tidur/timeout) — tampilkan angka terakhir, bukan toast
      // merah yang menutupi panel saat search/panel sibuk.
      if (!res.ok) throw new Error(body.error || "Gagal memuat saldo SK");
      setSaldo(body);
      if (body.stale) toast.error("Saldo live gagal — menampilkan terakhir tercatat.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat saldo SK");
    } finally {
      setSaldoLoading(false);
    }
  }, [toast]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/admin/sekalipay/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setLogs(body.logs || []); setDiffStatus(body.diff ?? null); }
    } catch { /* sync log opsional */ }
    finally { setLogsLoading(false); }
  }, []);

  const loadOrders = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`/api/admin/sekalipay/orders?status=${encodeURIComponent(orderStatus)}&per_page=${ORDER_PER_PAGE}&page=${page}${orderQueryLive ? `&q=${encodeURIComponent(orderQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat antrean SK");
      setOrders(body.orders || []);
      setOrderTotal(Number(body.total ?? 0));
      setOrderPage(Number(body.page ?? page));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat antrean SK");
    }
  }, [orderStatus, orderQueryLive, toast]);

  const loadExclusions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sekalipay/exclusions", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setExclusions(body.exclusions || []);
    } catch { /* opsional */ }
  }, []);

  const loadMarkups = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sekalipay/markup?limit=200${markupQueryLive ? `&q=${encodeURIComponent(markupQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMarkups(body.variants || []);
    } catch { /* opsional */ }
  }, [markupQueryLive]);

  // Lazy-load per tab (cermin WR): SATU jalur fetch via effect di bawah.
  // openTab hanya tandai loaded + reset halaman (jangan fetch di sini agar
  // tidak dobel dengan effect).
  const openTab = useCallback((tab: typeof skTab) => {
    setSkTab(tab);
    setLoadedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    if (tab === "antrean") setOrderPage(1);
    if (tab === "markup") setMarkupPage(1);
  }, []);

  useEffect(() => {
    void loadSaldo();
    void loadLogs();
  }, [loadSaldo, loadLogs]);
  useEffect(() => {
    const timer = setTimeout(() => setMarkupQueryLive(markupQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [markupQuery]);
  useEffect(() => {
    if (loadedTabs.has("markup")) void loadMarkups();
  }, [loadMarkups, loadedTabs]);
  useEffect(() => {
    if (loadedTabs.has("aturan")) void loadExclusions();
  }, [loadExclusions, loadedTabs]);
  const skOrderFilterKey = `${orderStatus}|${orderQueryLive}`;
  const lastSkOrderFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedTabs.has("antrean")) return;
    const key = `antrean|${skOrderFilterKey}`;
    if (lastSkOrderFetchKey.current === key) return;
    lastSkOrderFetchKey.current = key;
    setOrderPage(1);
    void loadOrders(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTabs, skOrderFilterKey]);

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
      // Angka cermin WR: produk + varian (bukan "varian" ganda seperti dulu).
      const ringkas = `${body.synced ?? 0} produk, ${body.variantsSynced ?? 0} varian`;
      const errors: string[] = Array.isArray(body.errors) ? body.errors : [];
      if (body.status === "failed") throw new Error(errors[0] || "Sync gagal tanpa satu pun produk tersimpan.");
      else if (body.status === "partial") {
        // Sukses palsu dihapus (cermin WR): partial karena budget vs error
        // dibedakan agar "lanjut otomatis di cron" tidak menutupi error nyata.
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

  const addExclusion = async () => {
    const pattern = newPattern.trim();
    if (pattern.length < 2) {
      toast.error("Pola minimal 2 karakter.");
      return;
    }
    try {
      const res = await fetch("/api/admin/sekalipay/exclusions", {
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
      const res = await fetch(`/api/admin/sekalipay/exclusions?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus");
      toast.success("Exclusion dihapus.");
      await loadExclusions();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menghapus");
    }
  };

  const saveMarkup = async (row: MarkupRow) => {
    const edit = editingMarkup[row.sk_variant_id];
    const percent = Number(edit?.percent ?? row.markup_percent);
    const fixed = Number(edit?.fixed ?? row.markup_fixed);
    if (!Number.isInteger(percent) || percent < 0 || percent > 500 || !Number.isInteger(fixed) || fixed < 0) {
      toast.error("Markup tidak valid (0–500% + nominal).");
      return;
    }
    try {
      const res = await fetch("/api/admin/sekalipay/markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sk_variant_id: row.sk_variant_id, markup_percent: percent, markup_fixed: fixed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan markup");
      toast.success(`Harga jual baru ${formatRupiah(body.sell_price)}.`);
      await loadMarkups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan markup");
    }
  };


  // Bulk markup (2026-10-01, cermin WR): 1 request untuk N varian.
  const applyBulkMarkup = async ({ variantIds, percent, resetFixed }: { variantIds: string[]; percent: number; resetFixed: boolean }) => {
    const res = await fetch("/api/admin/sekalipay/markup/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variant_ids: variantIds,
        markup_percent: percent,
        markup_fixed: 0,
        update_fixed: resetFixed,
      }),
    });
    const body = await res.json().catch(() => ({})) as { error?: string; updated?: number; failed?: { id: string; error: string }[] };
    if (!res.ok) throw new Error(body.error || "Bulk markup gagal");
    const updated = Number(body.updated ?? 0);
    const failed = Array.isArray(body.failed) ? body.failed : [];
    if (failed.length) toast.error(`Bulk: ${updated} berubah, ${failed.length} gagal (cth. ${failed[0].id}: ${failed[0].error}).`);
    else toast.success(`Bulk markup ${percent}% ke ${updated} varian.`);
    await loadMarkups();
  };

  // Kartu "Sync terakhir" dirender SupplierSyncStatus (diff VPS + sweep penuh + manual).
  const balance = saldo.current?.balance ?? saldo.capacity?.balance ?? null;
  const markupCounts = loadedTabs.has("markup") ? (() => {
    let live = 0, hidden = 0, off = 0;
    for (const m of markups as (MarkupRow & { variant_status?: string })[]) {
      const s = m.variant_status ?? "live";
      if (s === "live") live++;
      else if (s === "off") off++;
      else hidden++;
    }
    return { live, hidden, off, total: markups.length };
  })() : null;
  const activeOrderCount = orderTotal > 0 ? orderTotal : null;
  const markupFiltered = (markups as (MarkupRow & { variant_status?: string })[]).filter((m) => {
    const s = m.variant_status ?? "live";
    if (markupTab === "live") return s === "live";
    if (markupTab === "hidden") return s === "hidden_loser" || s === "hidden_nocatalog" || s === "hidden_soldout";
    if (markupTab === "off") return s === "off";
    return true;
  });
  const markupCountsLocal = markupCounts ?? { live: 0, hidden: 0, off: 0 };
  const markupTotalPages = Math.max(1, Math.ceil(markupFiltered.length / markupPerPage));
  const markupSafePage = Math.min(markupPage, markupTotalPages);
  const markupPaged = markupFiltered.slice((markupSafePage - 1) * markupPerPage, markupSafePage * markupPerPage);
  const orderPages = Math.max(1, Math.ceil(orderTotal / ORDER_PER_PAGE));

  return (
    <div className="mt-4 space-y-6">
      <PageHeader title="Saldo Sekalipay" description="Saldo, kapasitas, dan sinkronisasi katalog supplier." actions={<Button variant="outline" onClick={() => void loadSaldo()} disabled={saldoLoading}>{saldoLoading ? <Spinner size={13} /> : <RefreshCw />} Muat ulang</Button>} />
      <SupplierTabs
        tabs={[
          { id: "ringkas", label: "Ringkas" },
          { id: "antrean", label: "Antrean", count: activeOrderCount ?? undefined },
          { id: "markup", label: "Markup", count: markupCounts?.total ?? undefined },
          { id: "aturan", label: "Aturan", count: exclusions.length || undefined },
        ]}
        active={skTab}
        onChange={(tab) => openTab(tab as typeof skTab)}
      />
      {skTab === "ringkas" && (
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Saldo saat ini" value={saldoLoading ? <Skeleton className="h-8 w-32" /> : balance != null ? formatRupiah(balance) : "—"} hint={balance == null ? "Saldo belum diketahui — muat ulang untuk memeriksa." : saldo.current?.isLow ? `Di bawah batas ${formatRupiah(saldo.current.threshold)} — segera top up.` : "Di atas batas aman operasional."} tone={saldo.current?.isLow ? "warning" : "secondary"} />
          <StatCard label="Estimasi kapasitas" value={saldoLoading ? <Skeleton className="h-8 w-28" /> : `~${saldo.capacity?.estimatedOrders ?? 0} order`} hint={saldoLoading ? "Memuat kapasitas…" : `Rata-rata modal ${formatRupiah(saldo.capacity?.avgOrderCost ?? 0)}/order.`} />
          <StatCard label="Sinkron terakhir" value={logsLoading ? <Skeleton className="h-8 w-28" /> : syncCompactValue(logs as SupplierSyncLogRow[], diffStatus)} hint={logsLoading ? "Memuat status sinkron…" : "Detail di bawah"} />
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1"><SupplierSyncStatus logs={logs as SupplierSyncLogRow[]} diff={diffStatus} excludedLabel="non-auto" loading={logsLoading} /></div>
            <Button variant="outline" size="sm" onClick={() => void forceSync()} disabled={syncing}>{syncing ? <Spinner size={13} /> : <RefreshCw />}{syncing ? "Menyinkronkan…" : "Sinkron sekarang"}</Button>
          </CardContent>
        </Card>
      </section>
      )}
      {skTab === "antrean" && (
      <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Uji sandbox order</CardTitle><CardDescription className="mt-1 text-xs">Tanpa potong saldo. Isi product_id + variant_id SK (lihat respons sync / daftar item).</CardDescription></CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={sandboxProduct} onChange={(e) => setSandboxProduct(e.target.value)} placeholder="product_id" inputMode="numeric" aria-label="product_id sandbox" className="w-32" />
            <Input value={sandboxVariant} onChange={(e) => setSandboxVariant(e.target.value)} placeholder="variant_id" inputMode="numeric" aria-label="variant_id sandbox" className="w-32" />
            <Button onClick={() => void runSandbox()} disabled={sandboxing}>{sandboxing ? <Spinner size={13} /> : null}{sandboxing ? "Mengirim…" : "Kirim sandbox"}</Button>
          </div>
          {sandboxResult && <p className="font-mono text-xs text-admin-muted">{sandboxResult}</p>}
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="gap-3 p-4">
          <div className="min-w-0"><CardTitle className="text-base">Antrean order SK</CardTitle><CardDescription className="mt-1 text-xs">Order lunas yang diteruskan ke Sekalipay. Cari by invoice SK atau kode Axvara.</CardDescription></div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Cari invoice SK / kode Axvara…" aria-label="Cari invoice SK atau kode Axvara" className="w-full max-w-[260px]" />
            <NativeSelect value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); void loadOrders(1); }} aria-label="Filter status order SK" className="w-[180px]">
              {ORDER_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </div>
        </CardHeader>
        {!orders.length ? <p className="border-t border-admin-border p-10 text-center text-sm text-admin-muted">Belum ada order SK pada filter ini.</p> : <>
          <div className="hidden border-t border-admin-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Modal</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead>Umur antrean</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const age = ["completed", "failed"].includes(order.status) ? null : ageLabel(order);
                  const late = age ? age.hours >= 13 : false;
                  const retryable = canRetrySkLink(order);
                  return <TableRow key={order.id}>
                    <TableCell><StatusBadge status={order.status} /></TableCell>
                    <TableCell>
                      <p className="font-mono text-xs font-semibold text-admin-accent">{order.order_code}</p>
                      {order.sk_invoice && <p className="mt-1 font-mono text-xs text-admin-muted">{order.sk_invoice}</p>}
                      {order.last_error && <p className="mt-1 font-mono text-xs text-admin-danger">{order.last_error}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatRupiah(order.sk_cost)}</TableCell>
                    <TableCell className="text-xs text-admin-muted">{[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ") || "—"}{order.sales_channel ? ` · ${order.sales_channel}` : ""}</TableCell>
                    <TableCell>{age ? <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge> : <span className="text-xs text-admin-muted">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {retryable ? <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id}>{retrying === order.id ? <Spinner size={13} /> : <RefreshCw />} Retry</Button>
                          <Button size="sm" variant="outline" className="border-admin-danger/30 text-admin-danger" onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id}>{voiding === order.id ? <Spinner size={13} /> : <X />} Batal</Button>
                        </div> : RETRYABLE_SK_STATUS.includes(order.status) ? <div className="space-y-1 text-right">
                          <Badge variant="destructive">Percobaan habis</Badge>
                          <p className="max-w-[260px] text-xs leading-4 text-admin-muted">Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan.</p>
                        </div> : null}
                      </div>
                    </TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 border-t border-admin-border p-4 md:hidden">
            {orders.map((order) => {
              const age = ["completed", "failed"].includes(order.status) ? null : ageLabel(order);
              const late = age ? age.hours >= 13 : false;
              const retryable = canRetrySkLink(order);
              return <article key={order.id} className="space-y-2 rounded-md border border-admin-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={order.status} />
                  {age && <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge>}
                </div>
                <p className="font-mono text-xs font-semibold text-admin-accent">{order.order_code}</p>
                <p className="text-xs text-admin-muted">{formatRupiah(order.sk_cost)} modal{order.sk_invoice ? ` · ${order.sk_invoice}` : ""}</p>
                {(order.customer_name || order.customer_wa || order.customer_email) && <p className="text-xs text-admin-muted">{[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ")}{order.sales_channel ? ` · ${order.sales_channel}` : ""}</p>}
                {order.last_error && <p className="font-mono text-xs text-admin-danger">{order.last_error}</p>}
                {retryable ? <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id}>{retrying === order.id ? <Spinner size={13} /> : <RefreshCw />} Retry</Button>
                  <Button size="sm" variant="outline" className="border-admin-danger/30 text-admin-danger" onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id}>{voiding === order.id ? <Spinner size={13} /> : <X />} Batal</Button>
                </div> : RETRYABLE_SK_STATUS.includes(order.status) ? <div className="space-y-1">
                  <Badge variant="destructive">Percobaan habis</Badge>
                  <p className="text-xs leading-4 text-admin-muted">Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan.</p>
                </div> : null}
              </article>;
            })}
          </div>
        </>}
        {orderTotal > ORDER_PER_PAGE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">Hal {orderPage} dari {orderPages} · {orderTotal} order</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={orderPage <= 1} onClick={() => void loadOrders(orderPage - 1)}><ChevronLeft /> Sebelumnya</Button>
              <Button variant="outline" size="sm" disabled={orderPage >= orderPages} onClick={() => void loadOrders(orderPage + 1)}>Berikutnya <ChevronRight /></Button>
            </div>
          </div>
        )}
      </Card>
      </div>
      )}
      {skTab === "aturan" && (
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Exclusion rules</CardTitle><CardDescription className="mt-1 text-xs">Produk yang cocok pola tidak dibuatkan katalog (registry tetap dicatat).</CardDescription></CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {exclusions.length === 0 ? <p className="text-sm text-admin-muted">Belum ada aturan exclusion.</p> : <div className="rounded-md border border-admin-border">
            <Table>
              <TableHeader><TableRow><TableHead>Pola</TableHead><TableHead>Alasan</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
              <TableBody>
                {exclusions.map((rule) => <TableRow key={rule.id}>
                  <TableCell className="font-mono text-xs text-admin-fg">{rule.pattern}</TableCell>
                  <TableCell className="text-xs text-admin-muted">{rule.reason ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-admin-danger" onClick={() => void deleteExclusion(rule.id)} aria-label={`Hapus exclusion ${rule.pattern}`}><Trash2 /></Button>
                      </TooltipTrigger><TooltipContent>Hapus exclusion</TooltipContent></Tooltip>
                    </div>
                  </TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
          </div>}
          <div className="flex flex-wrap gap-2">
            <Input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="cth: pulsa" aria-label="Pola exclusion baru" className="min-w-0 flex-1" />
            <Button onClick={() => void addExclusion()}><Plus /> Tambah</Button>
          </div>
        </CardContent>
      </Card>
      )}
      {skTab === "markup" && (
      <Card className="overflow-hidden">
        <CardHeader className="gap-3 p-4">
          <div className="min-w-0"><CardTitle className="text-base">Markup per varian</CardTitle><CardDescription className="mt-1 text-xs">Ubah markup → harga jual Axvara dihitung ulang otomatis.</CardDescription></div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={markupQuery} onChange={(e) => { setMarkupQuery(e.target.value); setMarkupPage(1); }} placeholder="Cari varian…" aria-label="Cari varian" className="w-full max-w-[240px]" />
            <NativeSelect value={markupPerPage} onChange={(e) => { setMarkupPerPage(Number(e.target.value) as 20 | 50 | 100); setMarkupPage(1); }} aria-label="Jumlah per halaman" className="w-[110px]">
              <option value={20}>20 / hal</option>
              <option value={50}>50 / hal</option>
              <option value={100}>100 / hal</option>
            </NativeSelect>
          </div>
        </CardHeader>
        <div className="border-t border-admin-border px-4 py-3">
          <Tabs value={markupTab} onValueChange={value => { setMarkupTab(value as typeof markupTab); setMarkupPage(1); }}>
            <TabsList aria-label="Status tampil varian">
              {([["live", `Live (${markupCountsLocal.live})`], ["hidden", `Disembunyikan otomatis (${markupCountsLocal.hidden})`], ["off", `Nonaktif manual (${markupCountsLocal.off})`], ["all", `Semua (${markups.length})`]] as const).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <div className="border-y border-admin-border px-4 py-3">
          <BulkMarkupToolbar
            visibleIds={markupPaged.map((r) => (r as MarkupRow).sk_variant_id)}
            totalCount={markupFiltered.length}
            selected={bulkSelected}
            onToggleOne={(id) => setBulkSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onToggleAllVisible={(checked) => setBulkSelected(checked ? new Set(markupPaged.map((r) => (r as MarkupRow).sk_variant_id)) : new Set())}
            onClear={() => setBulkSelected(new Set())}
            onApply={applyBulkMarkup}
          />
        </div>
        {!markups.length ? <p className="p-10 text-center text-sm text-admin-muted">Belum ada varian SK tersinkron.</p> : markupFiltered.length === 0 ? <p className="p-10 text-center text-sm text-admin-muted">Tidak ada varian pada tab ini — coba ubah kata kunci.</p> : <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><span className="sr-only">Pilih</span></TableHead>
                  <TableHead>Varian</TableHead>
                  <TableHead>Modal</TableHead>
                  <TableHead>Jual</TableHead>
                  <TableHead>Stok</TableHead>
                  <TableHead>Markup</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {markupPaged.map((row) => {
                  const edit = editingMarkup[row.sk_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
                  const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
                  const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
                  return <TableRow key={row.sk_variant_id}>
                    <TableCell>
                      <Checkbox checked={bulkSelected.has(row.sk_variant_id)} aria-label={`Pilih ${row.sk_variant_name} untuk bulk markup`} onCheckedChange={() => setBulkSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.sk_variant_id)) next.delete(row.sk_variant_id);
                        else next.add(row.sk_variant_id);
                        return next;
                      })} />
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <p className="truncate text-sm font-semibold text-admin-fg">{row.sk_product_name ? `${row.sk_product_name} — ` : ""}{row.sk_variant_name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><ProcessBadge process={row.sk_order_process} /><VariantStatusBadge status={vStatus} reason={vReason} /></div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatRupiah(row.sk_price)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums text-admin-fg">{formatRupiah(row.axvara_sell_price)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{row.sk_stock}{row.sk_min_order && Number(row.sk_min_order) > 1 ? <p className="text-admin-muted">Min. {row.sk_min_order}</p> : null}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" aria-label={`Markup persen ${row.sk_variant_name}`} className="w-16 text-right tabular-nums" />
                        <Input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" aria-label={`Markup nominal ${row.sk_variant_name}`} className="w-24 text-right tabular-nums" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end"><Button size="sm" onClick={() => void saveMarkup(row)}>Simpan</Button></div>
                    </TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 p-4 md:hidden">
            {markupPaged.map((row) => {
              const edit = editingMarkup[row.sk_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
              const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
              const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
              return <article key={row.sk_variant_id} className="space-y-2 rounded-md border border-admin-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={bulkSelected.has(row.sk_variant_id)} aria-label={`Pilih ${row.sk_variant_name} untuk bulk markup`} onCheckedChange={() => setBulkSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.sk_variant_id)) next.delete(row.sk_variant_id);
                    else next.add(row.sk_variant_id);
                    return next;
                  })} />
                  <p className="truncate text-sm font-semibold text-admin-fg">{row.sk_product_name ? `${row.sk_product_name} — ` : ""}{row.sk_variant_name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><ProcessBadge process={row.sk_order_process} /><VariantStatusBadge status={vStatus} reason={vReason} /></div>
                <p className="text-xs text-admin-muted">Modal {formatRupiah(row.sk_price)} · Jual {formatRupiah(row.axvara_sell_price)} · Stok {row.sk_stock}{row.sk_min_order && Number(row.sk_min_order) > 1 ? ` · Min. ${row.sk_min_order}` : ""}{row.sk_status ? ` · ${row.sk_status}` : ""}{row.axvara_variant_id ? "" : " · TANPA katalog"}{vStatus !== "live" && vReason ? ` · ${vReason}` : ""}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" aria-label={`Markup persen ${row.sk_variant_name}`} className="w-16 text-right tabular-nums" />
                  <Input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" aria-label={`Markup nominal ${row.sk_variant_name}`} className="w-24 text-right tabular-nums" />
                  <Button size="sm" onClick={() => void saveMarkup(row)}>Simpan</Button>
                </div>
              </article>;
            })}
          </div>
        </>}
        {markupFiltered.length > markupPerPage && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">Hal {markupSafePage} dari {markupTotalPages} · {markupFiltered.length} varian</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={markupSafePage <= 1} onClick={() => setMarkupPage((p) => Math.max(1, p - 1))}><ChevronLeft /> Sebelumnya</Button>
              <span className="text-xs tabular-nums text-admin-muted">{markupSafePage} / {markupTotalPages}</span>
              <Button variant="outline" size="sm" disabled={markupSafePage >= markupTotalPages} onClick={() => setMarkupPage((p) => Math.min(markupTotalPages, p + 1))}>Berikutnya <ChevronRight /></Button>
            </div>
          </div>
        )}
      </Card>
      )}
    </div>
  );
}
