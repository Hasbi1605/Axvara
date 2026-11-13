// src/components/admin/WarungRebahanManager.tsx — Tab admin Warung Rebahan H2H:
// saldo + estimasi, status sync, antrean order WR, exclusion rules, markup per varian.

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
  claimed: "Diklaim worker",
  submitted: "Terkirim ke WR",
  ordering: "Dipesan…",
  processing: "Diproses WR",
  completed: "Selesai",
  failed: "Gagal",
  retry: "Retry",
  // Bukan kegagalan: order menunggu saldo WR cukup, lalu `reconcileBlockedBalance`
  // membangkitkannya sendiri. Dulu tanpa label sehingga admin melihat teks
  // mentah "blocked_balance" berwarna kuning generik tanpa tahu tindakannya.
  blocked_balance: "Saldo WR habis",
};

/**
 * Status yang diterima `POST /api/admin/warung/orders/[id]/retry`.
 *
 * WAJIB sama dengan `RETRYABLE` di route itu (2026-09-22). Sebelumnya UI
 * memakai daftar sendiri yang justru TERBALIK terhadap API: `blocked_balance`
 * (retryable, `attempt_count` masih 0) tidak pernah dapat tombol, sedangkan
 * `failed` selalu dapat tombol padahal API menolaknya — status `failed` hanya
 * ditulis ketika `attempt >= max_attempts`, tepat kondisi yang ditolak route
 * dengan `max_attempts_reached`.
 */
const RETRYABLE_WR_STATUS = ["pending", "retry", "failed", "blocked_balance"];

/**
 * Retry berguna bila kuota percobaan masih ada, ATAU (2026-10-10) link
 * `failed` karena kegagalan pra-kirim (WR belum pernah menerima order: tanpa
 * wr_order_id/request_sent_at, bukan dibatalkan admin) — API memberi kuota
 * baru untuk kasus ini. Cermin aturan di route retry.
 */
export function canRetryWrLink(order: { status: string; attempt_count?: number; max_attempts?: number; wr_order_id?: string | null; request_sent_at?: string | null; last_error?: string | null }): boolean {
  if (!RETRYABLE_WR_STATUS.includes(order.status)) return false;
  if (order.status === "failed") {
    return !order.wr_order_id && !order.request_sent_at && !String(order.last_error ?? "").startsWith("cancelled_by_admin");
  }
  return Number(order.attempt_count ?? 0) < Number(order.max_attempts ?? 3);
}

const ORDER_FILTERS: [string, string][] = [["all", "Semua"], ["pending", "Pending"], ["submitted", "Terkirim"], ["processing", "Diproses"], ["retry", "Retry"], ["blocked_balance", "Saldo habis"], ["failed", "Gagal"], ["completed", "Selesai"]];

export function WarungRebahanManager() {
  const toast = useToast();
  const [saldo, setSaldo] = useState<SaldoData>({});
  const [saldoLoading, setSaldoLoading] = useState(true);
  // D6: sampai sync-log selesai, "Sinkron terakhir" harus Skeleton — bukan "Belum pernah".
  const [logsLoading, setLogsLoading] = useState(true);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [diffStatus, setDiffStatus] = useState<SupplierDiffStatus>(null);
  const [syncing, setSyncing] = useState(false);
  const [orders, setOrders] = useState<WrOrderRow[]>([]);
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderQueryLive, setOrderQueryLive] = useState("");
  const [retrying, setRetrying] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [markups, setMarkups] = useState<MarkupRow[]>([]);
  const [markupQuery, setMarkupQuery] = useState("");
  const [markupQueryLive, setMarkupQueryLive] = useState("");
  const [editingMarkup, setEditingMarkup] = useState<Record<string, { percent: string; fixed: string }>>({});
  // Seleksi bulk markup (2026-10-01): checklist per baris + preset %.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  // Tab dalam-halaman (2026-10-01, cermin SystemTabs): Ringkas default.
  // State lokal — pindah menu kembali ke Ringkas, tanpa routing/URL.
  const [wrTab, setWrTab] = useState<Extract<SupplierTabId, "ringkas" | "antrean" | "markup" | "aturan">>("ringkas");
  // Lazy-load per tab: fetch saat tab dibuka pertama, cache selama sesi.
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set(["ringkas"]));
  // Pagination antrean (2026-10-01): limit=20 tanpa total/halaman = hal. 2+ hilang.
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const ORDER_PER_PAGE = 20;
  // Sub-tab status markup (2026-10-01, cermin tab Live halaman Produk) +
  // pagination lokal 20/50/100.
  const [markupTab, setMarkupTab] = useState<"live" | "hidden" | "off" | "all">("live");
  const [markupPerPage, setMarkupPerPage] = useState<20 | 50 | 100>(20);
  const [markupPage, setMarkupPage] = useState(1);

  const loadSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const res = await fetch("/api/admin/warung/saldo", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      // Kontrak 2026-09-30: endpoint fallback cache + flag stale bila live
      // gagal (proxy tidur/timeout) — tampilkan angka terakhir, bukan toast
      // merah yang menutupi panel saat search/panel sibuk.
      if (!res.ok) throw new Error(body.error || "Gagal memuat saldo WR");
      setSaldo(body);
      if (body.stale) toast.error("Saldo live gagal — menampilkan terakhir tercatat.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat saldo WR");
    } finally {
      setSaldoLoading(false);
    }
  }, [toast]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/admin/warung/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setLogs(body.logs || []); setDiffStatus(body.diff ?? null); }
    } catch { /* sync log opsional */ }
    finally { setLogsLoading(false); }
  }, []);

  const loadOrders = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`/api/admin/warung/orders?status=${encodeURIComponent(orderStatus)}&per_page=${ORDER_PER_PAGE}&page=${page}${orderQueryLive ? `&q=${encodeURIComponent(orderQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat antrean WR");
      setOrders(body.orders || []);
      setOrderTotal(Number(body.total ?? 0));
      setOrderPage(Number(body.page ?? page));
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
      // Fetch 1x semua (limit 200): filter + tab status + pagination murni
      // klien cermin halaman Produk. Search server (q) tetap dipakai agar
      // konsisten dengan kontrak API lama.
      const res = await fetch(`/api/admin/warung/markup?limit=200${markupQueryLive ? `&q=${encodeURIComponent(markupQueryLive)}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setMarkups(body.variants || []);
    } catch { /* opsional */ }
  }, [markupQueryLive]);

  // Lazy-load: mount hanya Ringkas (saldo+log+exclusion ringan). Tab lain
  // fetch via effect di bawah saat loadedTabs berubah (SATU jalur fetch —
  // jangan fetch juga di sini agar tidak dobel).
  const openTab = useCallback((tab: typeof wrTab) => {
    setWrTab(tab);
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
    // Markup hanya refetch bila tab-nya pernah dibuka (lazy) — cegah fetch
    // sia-sia saat search berubah di tab lain.
    if (loadedTabs.has("markup")) void loadMarkups();
  }, [loadMarkups, loadedTabs]);
  useEffect(() => {
    // Aturan: exclusion ringan tapi tetap lazy (konsisten + hemat 1 request).
    if (loadedTabs.has("aturan")) void loadExclusions();
  }, [loadExclusions, loadedTabs]);
  // Antrean: SATU jalur fetch — effect ini untuk buka-tab-pertama DAN
  // filter/search berubah (keduanya reset ke halaman 1). loadOrders(page>1)
  // hanya dari tombol pagination (tidak lewat effect ini). Guard ref cegah
  // fetch ganda saat tab dibuka ulang dengan filter yang sama (cache).
  const orderFilterKey = `${orderStatus}|${orderQueryLive}`;
  const lastOrderFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedTabs.has("antrean")) return;
    const key = `antrean|${orderFilterKey}`;
    if (lastOrderFetchKey.current === key) return;
    lastOrderFetchKey.current = key;
    setOrderPage(1);
    void loadOrders(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTabs, orderFilterKey]);

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

  // Void: batalkan link WR tertahan (pending/retry/blocked_balance) agar
  // tidak auto-revive diam-diam. Konfirmasi dulu — void = terminal `failed`.
  const voidOrder = async (id: number, orderCode: string) => {
    if (!window.confirm(`Batalkan order WR ${orderCode}? Link tidak akan diproses lagi (terminal failed).`)) return;
    setVoiding(id);
    try {
      const res = await fetch(`/api/admin/warung/orders/${id}/void`, { method: "POST" });
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

  // Bulk markup (2026-10-01): 1 request untuk N varian via endpoint bulk.
  // Hasil jujur: updated + daftar gagal (bukan all-or-nothing diam).
  const applyBulkMarkup = async ({ variantIds, percent, resetFixed }: { variantIds: string[]; percent: number; resetFixed: boolean }) => {
    const res = await fetch("/api/admin/warung/markup/bulk", {
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
  // Hitungan tab Markup: dari data yang sudah di-fetch (bila belum load,
  // badge tanpa angka — bukan 0 yang menipu).
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

  // Filter tab status markup (cermin tab Live halaman Produk). Default
  // Live = yang tampil di toko; Hidden = kalah/tanpa-katalog/habis.
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
      <PageHeader title="Saldo Warung Rebahan" description="Saldo, kapasitas, dan sinkronisasi katalog supplier." actions={<Button variant="outline" onClick={() => void loadSaldo()} disabled={saldoLoading}>{saldoLoading ? <Spinner size={13} /> : <RefreshCw />} Muat ulang</Button>} />
      <SupplierTabs
        tabs={[
          { id: "ringkas", label: "Ringkas" },
          { id: "antrean", label: "Antrean", count: activeOrderCount ?? undefined },
          { id: "markup", label: "Markup", count: markupCounts?.total ?? undefined },
          { id: "aturan", label: "Aturan", count: exclusions.length || undefined },
        ]}
        active={wrTab}
        onChange={(tab) => openTab(tab as typeof wrTab)}
      />
      {wrTab === "ringkas" && (
      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Saldo saat ini" value={saldoLoading ? <Skeleton className="h-8 w-32" /> : balance != null ? formatRupiah(balance) : "—"} hint={balance == null ? "Saldo belum diketahui — muat ulang untuk memeriksa." : saldo.current?.isLow ? `Di bawah batas ${formatRupiah(saldo.current.threshold)} — segera top up.` : "Di atas batas aman operasional."} tone={saldo.current?.isLow ? "warning" : "secondary"} />
          <StatCard label="Estimasi kapasitas" value={saldoLoading ? <Skeleton className="h-8 w-28" /> : `~${saldo.capacity?.estimatedOrders ?? 0} order`} hint={saldoLoading ? "Memuat kapasitas…" : `Rata-rata modal ${formatRupiah(saldo.capacity?.avgOrderCost ?? 0)}/order.`} />
          <StatCard label="Sinkron terakhir" value={logsLoading ? <Skeleton className="h-8 w-28" /> : syncCompactValue(logs as SupplierSyncLogRow[], diffStatus)} hint={logsLoading ? "Memuat status sinkron…" : "Detail di bawah"} />
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1"><SupplierSyncStatus logs={logs as SupplierSyncLogRow[]} diff={diffStatus} excludedLabel="excluded" loading={logsLoading} /></div>
            <Button variant="outline" size="sm" onClick={() => void forceSync()} disabled={syncing}>{syncing ? <Spinner size={13} /> : <RefreshCw />}{syncing ? "Menyinkronkan…" : "Sinkron sekarang"}</Button>
          </CardContent>
        </Card>
      </section>
      )}
      {wrTab === "antrean" && (
      <Card className="overflow-hidden">
        <CardHeader className="gap-3 p-4">
          <div className="min-w-0">
            <CardTitle className="text-base">Antrean order WR</CardTitle>
            <CardDescription className="mt-1 text-xs">Order lunas yang diteruskan ke Warung Rebahan. Cari by invoice WR (#RBHN-…) atau kode Axvara untuk forward manual email WR ke buyer.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Cari invoice WR / kode Axvara…" aria-label="Cari invoice WR atau kode Axvara" className="w-full max-w-[260px]" />
            <NativeSelect value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); void loadOrders(1); }} aria-label="Filter status order WR" className="w-[180px]">
              {ORDER_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </div>
        </CardHeader>
        {!orders.length ? <p className="border-t border-admin-border p-10 text-center text-sm text-admin-muted">Belum ada order WR pada filter ini.</p> : <>
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
                  const retryable = canRetryWrLink(order);
                  return <TableRow key={order.id}>
                    <TableCell><StatusBadge status={order.status} /></TableCell>
                    <TableCell>
                      <p className="font-mono text-xs font-semibold text-admin-accent">{order.order_code}</p>
                      {order.wr_order_id && <p className="mt-1 font-mono text-xs text-admin-muted">{order.wr_order_id}</p>}
                      {order.last_error && <p className="mt-1 font-mono text-xs text-admin-danger">{order.last_error}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatRupiah(order.wr_cost)}</TableCell>
                    <TableCell className="text-xs text-admin-muted">{[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ") || "—"}{order.sales_channel ? ` · ${order.sales_channel}` : ""}</TableCell>
                    <TableCell>{age ? <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge> : <span className="text-xs text-admin-muted">—</span>}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {retryable ? <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id}>{retrying === order.id ? <Spinner size={13} /> : <RefreshCw />} Retry</Button>
                          <Button size="sm" variant="outline" className="border-admin-danger/30 text-admin-danger" onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id}>{voiding === order.id ? <Spinner size={13} /> : <X />} Batal</Button>
                        </div> : RETRYABLE_WR_STATUS.includes(order.status) ? <BlockedRetry order={order} /> : null}
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
              const retryable = canRetryWrLink(order);
              return <article key={order.id} className="space-y-2 rounded-md border border-admin-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={order.status} />
                  {age && <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge>}
                </div>
                <p className="font-mono text-xs font-semibold text-admin-accent">{order.order_code}</p>
                <p className="text-xs text-admin-muted">{formatRupiah(order.wr_cost)} modal{order.wr_order_id ? ` · ${order.wr_order_id}` : ""}</p>
                {(order.customer_name || order.customer_wa || order.customer_email) && <p className="text-xs text-admin-muted">{[order.customer_name, order.customer_wa, order.customer_email].filter(Boolean).join(" · ")}{order.sales_channel ? ` · ${order.sales_channel}` : ""}</p>}
                {order.last_error && <p className="font-mono text-xs text-admin-danger">{order.last_error}</p>}
                {retryable ? <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id}>{retrying === order.id ? <Spinner size={13} /> : <RefreshCw />} Retry</Button>
                  <Button size="sm" variant="outline" className="border-admin-danger/30 text-admin-danger" onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id}>{voiding === order.id ? <Spinner size={13} /> : <X />} Batal</Button>
                </div> : RETRYABLE_WR_STATUS.includes(order.status) ? <BlockedRetry order={order} /> : null}
              </article>;
            })}
          </div>
        </>}
        {/* Pagination antrean (2026-10-01): halaman 2+ dulu hilang. */}
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
      )}
      {wrTab === "aturan" && (
      <Card className="overflow-hidden">
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Exclusion rules</CardTitle><CardDescription className="mt-1 text-xs">Produk yang cocok pola tidak masuk katalog (mis. Canva &amp; Gemini).</CardDescription></CardHeader>
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
            <Input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="cth: canva" aria-label="Pola exclusion baru" className="min-w-0 flex-1" />
            <Button onClick={() => void addExclusion()}><Plus /> Tambah</Button>
          </div>
        </CardContent>
      </Card>
      )}
      {wrTab === "markup" && (
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
        {/* Sub-tab status (cermin tab Live halaman Produk): default Live. */}
        <div className="border-t border-admin-border px-4 py-3">
          <Tabs value={markupTab} onValueChange={value => { setMarkupTab(value as typeof markupTab); setMarkupPage(1); }}>
            <TabsList aria-label="Status tampil varian">
              {([["live", `Live (${markupCountsLocal.live})`], ["hidden", `Disembunyikan otomatis (${markupCountsLocal.hidden})`], ["off", `Nonaktif manual (${markupCountsLocal.off})`], ["all", `Semua (${markups.length})`]] as const).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <div className="border-y border-admin-border px-4 py-3">
          <BulkMarkupToolbar
            visibleIds={markupPaged.map((r) => (r as MarkupRow).wr_variant_id)}
            totalCount={markupFiltered.length}
            selected={bulkSelected}
            onToggleOne={(id) => setBulkSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onToggleAllVisible={(checked) => setBulkSelected(checked ? new Set(markupPaged.map((r) => (r as MarkupRow).wr_variant_id)) : new Set())}
            onClear={() => setBulkSelected(new Set())}
            onApply={applyBulkMarkup}
          />
        </div>
        {!markups.length ? <p className="p-10 text-center text-sm text-admin-muted">Belum ada varian WR tersinkron.</p> : markupFiltered.length === 0 ? <p className="p-10 text-center text-sm text-admin-muted">Tidak ada varian pada tab ini — coba ubah kata kunci.</p> : <>
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
                  const edit = editingMarkup[row.wr_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
                  const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
                  const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
                  return <TableRow key={row.wr_variant_id}>
                    <TableCell>
                      <Checkbox checked={bulkSelected.has(row.wr_variant_id)} aria-label={`Pilih ${row.wr_variant_name} untuk bulk markup`} onCheckedChange={() => setBulkSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.wr_variant_id)) next.delete(row.wr_variant_id);
                        else next.add(row.wr_variant_id);
                        return next;
                      })} />
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <p className="truncate text-sm font-semibold text-admin-fg">{row.wr_product_name ? `${row.wr_product_name} — ` : ""}{row.wr_variant_name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2"><DeliveryBadge wrClass={row.wr_delivery_class} /><VariantStatusBadge status={vStatus} reason={vReason} /></div>
                      {vStatus !== "live" && vReason && <p className="mt-1 text-xs text-admin-muted">{vReason}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatRupiah(row.wr_price)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs font-semibold tabular-nums text-admin-fg">{formatRupiah(row.axvara_sell_price)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">{row.wr_stock}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" aria-label={`Markup persen ${row.wr_variant_name}`} className="w-16 text-right tabular-nums" />
                        <Input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" aria-label={`Markup nominal ${row.wr_variant_name}`} className="w-24 text-right tabular-nums" />
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
              const edit = editingMarkup[row.wr_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
              const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
              const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
              return <article key={row.wr_variant_id} className="space-y-2 rounded-md border border-admin-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox checked={bulkSelected.has(row.wr_variant_id)} aria-label={`Pilih ${row.wr_variant_name} untuk bulk markup`} onCheckedChange={() => setBulkSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(row.wr_variant_id)) next.delete(row.wr_variant_id);
                    else next.add(row.wr_variant_id);
                    return next;
                  })} />
                  <p className="truncate text-sm font-semibold text-admin-fg">{row.wr_product_name ? `${row.wr_product_name} — ` : ""}{row.wr_variant_name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><DeliveryBadge wrClass={row.wr_delivery_class} /><VariantStatusBadge status={vStatus} reason={vReason} /></div>
                <p className="text-xs text-admin-muted">Modal {formatRupiah(row.wr_price)} · Jual {formatRupiah(row.axvara_sell_price)} · Stok {row.wr_stock}{vStatus !== "live" && vReason ? ` · ${vReason}` : ""}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" aria-label={`Markup persen ${row.wr_variant_name}`} className="w-16 text-right tabular-nums" />
                  <Input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" aria-label={`Markup nominal ${row.wr_variant_name}`} className="w-24 text-right tabular-nums" />
                  <Button size="sm" onClick={() => void saveMarkup(row)}>Simpan</Button>
                </div>
              </article>;
            })}
          </div>
        </>}
        {/* Pagination markup lokal (cermin halaman Produk). */}
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

/** Alasan retry tidak tersedia — jangan sembunyikan tombol tanpa penjelasan. */
function BlockedRetry({ order }: { order: WrOrderRow }) {
  const reason = order.status === "failed"
    ? "Order ini sudah pernah terkirim ke WR atau dibatalkan admin — retry = beli ulang (dobel bayar). Serahkan manual dari tab Pesanan."
    : "Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan, atau naikkan batas percobaan.";
  return <div className="space-y-1 text-right">
    <Badge variant="destructive">{order.status === "failed" ? "Tak bisa retry" : "Percobaan habis"}</Badge>
    <p className="max-w-[260px] text-xs leading-4 text-admin-muted">{reason}</p>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "completed" ? "success"
    : status === "failed" ? "destructive"
    : status === "processing" || status === "ordering" ? "info"
    : "warning";
  return <Badge variant={variant}>{WR_STATUS_LABEL[status] ?? status}</Badge>;
}

/** Badge kelas pengiriman WR (admin saja): hanya AUTO/MANUAL, dari API WR. */
function DeliveryBadge({ wrClass }: { wrClass: string | null }) {
  if (wrClass === "restock") return <Badge variant="success" title="AUTO · kirim otomatis">AUTO</Badge>;
  if (wrClass === "made_by_order") return <Badge variant="warning" title="MANUAL · diproses sesuai antrean">MANUAL</Badge>;
  return <Badge variant="secondary" title="Kelas pengiriman belum diketahui">?</Badge>;
}
