// src/components/admin/WarungRebahanManager.tsx — Tab admin Warung Rebahan H2H:
// saldo + estimasi, status sync, antrean order WR, exclusion rules, markup per varian.
// Mengikuti pola PaymentReconciliation (fetch per section, toast error, gaya ax-glass).

"use client";
import { SupplierSyncStatus, type SupplierDiffStatus, type SupplierSyncLogRow } from "@/components/admin/SupplierSyncStatus";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
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

export function WarungRebahanManager() {
  const toast = useToast();
  const [saldo, setSaldo] = useState<SaldoData>({});
  const [saldoLoading, setSaldoLoading] = useState(true);
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
    try {
      const res = await fetch("/api/admin/warung/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setLogs(body.logs || []); setDiffStatus(body.diff ?? null); }
    } catch { /* sync log opsional */ }
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

    const setDeliveryClass = async (row: MarkupRow, deliveryClass: "restock" | "made_by_order") => {
    try {
      const res = await fetch("/api/admin/warung/markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wr_variant_id: row.wr_variant_id, delivery_class: deliveryClass }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal mengunci kelas");
      toast.success(deliveryClass === "restock"
        ? "Dikunci: RESTOK • auto (dicatat 'kunci admin'; sync berikutnya tetap mengikuti delivery_mode API WR bila varian ini memilikinya)."
        : "Dikunci: MBO • manual (dicatat 'kunci admin'; sync berikutnya tetap mengikuti delivery_mode API WR bila varian ini memilikinya).");
      await loadMarkups();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal mengunci kelas");
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

  return (
    <div className="mt-4 space-y-4">
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
            <SupplierSyncStatus logs={logs as SupplierSyncLogRow[]} diff={diffStatus} excludedLabel="excluded" />
            <button onClick={() => void forceSync()} disabled={syncing} className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
              {syncing ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />}{syncing ? "Sync…" : "Force Sync Now"}
            </button>
          </div>
        </div>
      </section>
      )}
      {wrTab === "antrean" && (
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Antrean order WR</h3><p className="mt-0.5 text-[11px] text-white/40">Order lunas yang diteruskan ke Warung Rebahan. Cari by invoice WR (#RBHN-…) atau kode Axvara untuk forward manual email WR ke buyer.</p></div>
          <input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Cari invoice WR / kode Axvara…" className="h-9 w-full max-w-[240px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none sm:ml-auto" />
          <div className="flex flex-wrap gap-2">
            {[["all", "Semua"], ["pending", "Pending"], ["submitted", "Terkirim"], ["processing", "Diproses"], ["retry", "Retry"], ["blocked_balance", "Saldo habis"], ["failed", "Gagal"], ["completed", "Selesai"]].map(([value, label]) => (
              <button key={value} onClick={() => { setOrderStatus(value); setOrderPage(1); void loadOrders(1); }} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${orderStatus === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>
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
                {canRetryWrLink(order) ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
                      {retrying === order.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />} Retry
                    </button>
                    <button onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 text-xs font-bold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40">
                      {voiding === order.id ? <Spinner size={13} /> : <IosIcon name="close" size={13} tint="#FCA5A5" />} Batal
                    </button>
                  </div>
                ) : RETRYABLE_WR_STATUS.includes(order.status) ? (
                  // Non-preSend `failed` (sudah terkirim ke WR / dibatalkan
                  // admin) memang tidak bisa retry — beli ulang = dobel bayar.
                  <span title={order.status === "failed" ? "Order ini sudah pernah terkirim ke WR atau dibatalkan admin — retry = beli ulang (dobel bayar). Serahkan manual dari tab Pesanan." : "Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan, atau naikkan batas percobaan."} className="inline-flex h-9 shrink-0 items-center rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-[11px] font-semibold text-red-200">
                    {order.status === "failed" ? "Tak bisa retry" : "Percobaan habis"}
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {/* Pagination antrean (2026-10-01): halaman 2+ dulu hilang. */}
        {orderTotal > ORDER_PER_PAGE && (
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <p className="text-xs text-white/40">Hal {orderPage} dari {Math.max(1, Math.ceil(orderTotal / ORDER_PER_PAGE))} • {orderTotal} order</p>
            <div className="flex items-center gap-1.5">
              <button disabled={orderPage <= 1} onClick={() => void loadOrders(orderPage - 1)} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"><IosIcon name="chevron-left" size={12} tint="white" /> Sebelumnya</button>
              <button disabled={orderPage >= Math.ceil(orderTotal / ORDER_PER_PAGE)} onClick={() => void loadOrders(orderPage + 1)} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">Berikutnya <IosIcon name="chevron-right" size={12} tint="white" /></button>
            </div>
          </div>
        )}
      </section>
      )}
      {wrTab === "aturan" && (
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
      )}
      {wrTab === "markup" && (
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Markup per varian</h3><p className="mt-0.5 text-[11px] text-white/40">Ubah markup → harga jual Axvara dihitung ulang otomatis.</p></div>
          <input value={markupQuery} onChange={(e) => { setMarkupQuery(e.target.value); setMarkupPage(1); }} placeholder="Cari varian…" className="ml-auto h-9 w-full max-w-[220px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
        </header>
        {/* Sub-tab status (cermin tab Live halaman Produk): default Live. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3" role="tablist" aria-label="Status tampil varian">
          {([["live", `Live (${markupCountsLocal.live})`], ["hidden", `Disembunyikan otomatis (${markupCountsLocal.hidden})`], ["off", `Nonaktif manual (${markupCountsLocal.off})`], ["all", `Semua (${markups.length})`]] as const).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={markupTab === value}
              onClick={() => { setMarkupTab(value); setMarkupPage(1); }}
              className={`h-8 whitespace-nowrap rounded-full px-3.5 text-[11px] font-bold transition ${markupTab === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
          <select
            value={markupPerPage}
            onChange={(e) => { setMarkupPerPage(Number(e.target.value) as 20 | 50 | 100); setMarkupPage(1); }}
            aria-label="Jumlah per halaman"
            className="ml-auto h-8 shrink-0 rounded-full bg-white/[0.06] border border-white/10 px-2.5 text-[11px] font-semibold text-white/70 focus:outline-none focus:border-[#00E5FF]/40"
          >
            <option value={20}>20 / hal</option>
            <option value={50}>50 / hal</option>
            <option value={100}>100 / hal</option>
          </select>
        </div>
        <div className="border-b border-white/10 p-3">
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
        {!markups.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada varian WR tersinkron.</p> : markupFiltered.length === 0 ? <p className="p-10 text-center text-sm text-white/40">Tidak ada varian pada tab ini — coba ubah kata kunci.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {markupPaged.map((row) => {
              const edit = editingMarkup[row.wr_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
              const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
              const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
              return (
                <article key={row.wr_variant_id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={bulkSelected.has(row.wr_variant_id)}
                        onChange={() => setBulkSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.wr_variant_id)) next.delete(row.wr_variant_id);
                          else next.add(row.wr_variant_id);
                          return next;
                        })}
                        aria-label={`Pilih ${row.wr_variant_name} untuk bulk markup`}
                        className="h-4 w-4 shrink-0 accent-[#00E5FF]"
                      />
                      <p className="truncate text-sm font-semibold text-white">{row.wr_product_name ? `${row.wr_product_name} — ` : ""}{row.wr_variant_name}</p>
                      <DeliveryBadge wrClass={row.wr_delivery_class} source={row.wr_delivery_source} />
                      <VariantStatusBadge status={vStatus} reason={vReason} />
                    </div>
                    <p className="mt-1 text-xs text-white/45">Modal {formatRupiah(row.wr_price)} · Jual {formatRupiah(row.axvara_sell_price)} · Stok {row.wr_stock}{vStatus !== "live" && vReason ? ` · ${vReason}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-white/55">%<input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" className="h-9 w-16 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <label className="flex items-center gap-1.5 text-xs text-white/55">+Rp<input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.wr_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" className="h-9 w-24 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <button onClick={() => void saveMarkup(row)} className="inline-flex h-9 items-center rounded-xl bg-white px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-white/90">Simpan</button>
                    <button onClick={() => void setDeliveryClass(row, "restock")} title="Kunci sebagai RESTOK (auto) — sync berikutnya ikut delivery_mode API WR bila ada" className="inline-flex h-9 items-center rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-2.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/20">AUTO</button>
                    <button onClick={() => void setDeliveryClass(row, "made_by_order")} title="Kunci sebagai MBO (manual) — sync berikutnya ikut delivery_mode API WR bila ada" className="inline-flex h-9 items-center rounded-xl border border-[#FFB800]/25 bg-[#FFB800]/10 px-2.5 text-[11px] font-bold text-[#FFD66B] transition hover:bg-[#FFB800]/20">MANUAL</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {/* Pagination markup lokal (cermin halaman Produk). */}
        {markupFiltered.length > markupPerPage && (
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <p className="text-xs text-white/40">Hal {markupSafePage} dari {markupTotalPages} • {markupFiltered.length} varian</p>
            <div className="flex items-center gap-1.5">
              <button disabled={markupSafePage <= 1} onClick={() => setMarkupPage((p) => Math.max(1, p - 1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none"><IosIcon name="chevron-left" size={12} tint="white" /> Sebelumnya</button>
              <span className="text-xs text-white/40 px-1">{markupSafePage} / {markupTotalPages}</span>
              <button disabled={markupSafePage >= markupTotalPages} onClick={() => setMarkupPage((p) => Math.min(markupTotalPages, p + 1))} className="inline-flex h-8 items-center gap-1 px-3 rounded-full ax-glass text-xs font-semibold text-white/70 disabled:opacity-40 disabled:pointer-events-none">Berikutnya <IosIcon name="chevron-right" size={12} tint="white" /></button>
            </div>
          </div>
        )}
      </section>
      )}
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

