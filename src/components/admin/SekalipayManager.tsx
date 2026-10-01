// src/components/admin/SekalipayManager.tsx — Tab admin Sekalipay (supplier kedua).
// Setara WarungRebahanManager: saldo + kapasitas, status sync + Force Sync,
// antrean order SK (retry/void + umur antrean), exclusion rules, markup per
// varian. Fitur khas SK (tidak dimiliki WR): mutasi saldo audit, cek akun
// (validasi nickname), stock-lock anti-overselling, daftar transaksi SK,
// detail capability per varian, sandbox order.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { formatWibDateTime } from "@/lib/utils";
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

type MutationRow = {
  invoice: string;
  direction: string;
  type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
};

type LockRow = {
  lock_token: string;
  item_id: number;
  quantity: number;
  locked_at: string;
  expires_at: string;
};

type SkTrxRow = {
  invoice: string;
  ref_id: string;
  status: string;
  price: number;
  fees: number;
  amount: number;
  activity: string;
  created_at: string;
};

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return formatWibDateTime(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

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
  const color =
    status === "completed"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
      : status === "failed" || status === "canceled"
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

/** Badge order_process SK (admin saja): AUTO/MANUAL/H2H/SMM/VIP. */
function ProcessBadge({ process }: { process: string }) {
  const p = String(process || "").toLowerCase();
  if (p === "auto") {
    return <span title="AUTO • lisensi langsung" className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">AUTO</span>;
  }
  if (p === "manual") {
    return <span title="MANUAL • diproses admin SK" className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">MANUAL</span>;
  }
  if (p === "h2h" || p === "smm" || p === "vip") {
    return <span title={`${p.toUpperCase()} • belum didukung fase 1`} className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">{p.toUpperCase()}</span>;
  }
  return <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">{process || "?"}</span>;
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
  const [skTab, setSkTab] = useState<Extract<SupplierTabId, "ringkas" | "antrean" | "markup" | "aturan" | "audit" | "alat">>("ringkas");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set(["ringkas"]));
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const ORDER_PER_PAGE = 20;
  const [markupTab, setMarkupTab] = useState<"live" | "hidden" | "off" | "all">("live");
  const [markupPerPage, setMarkupPerPage] = useState<20 | 50 | 100>(20);
  const [markupPage, setMarkupPage] = useState(1);
  // Khas SK: mutasi saldo, validasi akun, stock-lock, transaksi, detail varian.
  const [mutations, setMutations] = useState<MutationRow[]>([]);
  const [mutationsLoading, setMutationsLoading] = useState(false);
  const [mutationDir, setMutationDir] = useState("all");
  const [validateItem, setValidateItem] = useState("");
  const [validateCustomer, setValidateCustomer] = useState("");
  const [validateZone, setValidateZone] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<string | null>(null);
  const [locks, setLocks] = useState<LockRow[]>([]);
  const [lockItem, setLockItem] = useState("");
  const [lockQty, setLockQty] = useState("1");
  const [locking, setLocking] = useState(false);
  const [transactions, setTransactions] = useState<SkTrxRow[]>([]);
  const [trxLoading, setTrxLoading] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailResult, setDetailResult] = useState<string | null>(null);

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
    try {
      const res = await fetch("/api/admin/sekalipay/sync-log?limit=5", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLogs(body.logs || []);
    } catch { /* sync log opsional */ }
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

  const loadMutations = useCallback(async () => {
    setMutationsLoading(true);
    try {
      const res = await fetch(`/api/admin/sekalipay/mutations?per_page=10${mutationDir !== "all" ? `&direction=${mutationDir}` : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat mutasi");
      setMutations(body.mutations || []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat mutasi saldo");
    } finally {
      setMutationsLoading(false);
    }
  }, [mutationDir, toast]);

  const loadLocks = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sekalipay/locks", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setLocks(body.locks || []);
    } catch { /* opsional */ }
  }, []);

  const loadTransactions = useCallback(async () => {
    setTrxLoading(true);
    try {
      const res = await fetch("/api/admin/sekalipay/transactions?per_page=10", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat transaksi");
      setTransactions(body.transactions || []);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal memuat transaksi SK");
    } finally {
      setTrxLoading(false);
    }
  }, [toast]);

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
  const auditKey = mutationDir;
  const lastAuditFetchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!loadedTabs.has("audit")) return;
    const key = `audit|${auditKey}`;
    if (lastAuditFetchKey.current === key) return;
    lastAuditFetchKey.current = key;
    void loadMutations();
    void loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTabs, auditKey]);
  useEffect(() => {
    if (loadedTabs.has("alat")) void loadLocks();
  }, [loadLocks, loadedTabs]);

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

  const runValidate = async () => {
    const itemId = Number(validateItem);
    if (!Number.isInteger(itemId) || itemId <= 0 || !validateCustomer.trim()) {
      toast.error("Isi item_id + customer ID dulu.");
      return;
    }
    setValidating(true);
    setValidateResult(null);
    try {
      const res = await fetch("/api/admin/sekalipay/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, customer_id: validateCustomer.trim(), zone_id: validateZone.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Validasi gagal");
      const r = body.result ?? {};
      setValidateResult(`OK · ${r.display_name ?? r.account_name ?? JSON.stringify(r).slice(0, 200)}${r.region ? ` (${r.region})` : ""}${r.cached ? " · cache" : ""}`);
      toast.success("Akun ditemukan.");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Validasi gagal";
      setValidateResult(`GAGAL · ${msg}`);
      toast.error(msg);
    } finally {
      setValidating(false);
    }
  };

  const createLock = async () => {
    const itemId = Number(lockItem);
    const qty = Math.max(1, Math.floor(Number(lockQty) || 1));
    if (!Number.isInteger(itemId) || itemId <= 0) {
      toast.error("Isi item_id (variant_id SK) dulu.");
      return;
    }
    setLocking(true);
    try {
      const res = await fetch("/api/admin/sekalipay/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, quantity: qty }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Lock gagal");
      toast.success(`Stok dikunci 10 mnt: ${body.lock?.lock_token ?? ""}`);
      await loadLocks();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Lock gagal");
    } finally {
      setLocking(false);
    }
  };

  const releaseLock = async (token: string) => {
    try {
      const res = await fetch(`/api/admin/sekalipay/locks?token=${encodeURIComponent(token)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Release gagal");
      toast.success("Lock dilepas.");
      await loadLocks();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Release gagal");
    }
  };

  const loadDetail = async () => {
    const vid = detailId.trim();
    if (!vid) {
      toast.error("Isi variant_id SK dulu.");
      return;
    }
    setDetailLoading(true);
    setDetailResult(null);
    try {
      const res = await fetch(`/api/admin/sekalipay/variants/${encodeURIComponent(vid)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memuat detail");
      const v = body.variant ?? {};
      const lines = [
        `${v.sk_product_name ?? ""} — ${v.sk_variant_name ?? ""}`,
        `Modal ${formatRupiah(Number(v.sk_price ?? 0))} · Jual ${formatRupiah(Number(v.axvara_sell_price ?? 0))} · Stok ${v.sk_stock} · Min.order ${v.sk_min_order ?? 1} · Status ${v.sk_status ?? "-"}`,
        `Proses ${v.sk_order_process ?? "-"}${v.axvara_product_id ? ` · Katalog #${v.axvara_product_id}` : " · TANPA katalog"}`,
      ];
      if (v.sk_description) lines.push(`Deskripsi: ${String(v.sk_description).slice(0, 200)}`);
      if (v.sk_seller_note) lines.push(`Seller note: ${String(v.sk_seller_note).slice(0, 200)}`);
      if (v.sk_required_fields) lines.push(`Wajib: ${JSON.stringify(v.sk_required_fields).slice(0, 200)}`);
      if (v.sk_validation) lines.push(`Validasi: ${JSON.stringify(v.sk_validation).slice(0, 200)}`);
      setDetailResult(lines.join("\n"));
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Gagal memuat detail";
      setDetailResult(`GAGAL · ${msg}`);
      toast.error(msg);
    } finally {
      setDetailLoading(false);
    }
  };

  const lastLog = logs[0];
  // Sama seperti WR: bedakan sync manual vs cron agar pemilik bisa verifikasi
  // cron berjalan (keduanya menulis baris products).
  const lastProductLog = lastLog && lastLog.sync_type === "products" ? lastLog : null;
  const lastManualLog = logs.find((l) => l.sync_type === "products" && l.trigger !== "cron") ?? null;
  const lastCronLog = logs.find((l) => l.sync_type === "products" && l.trigger === "cron") ?? null;
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

  return (
    <div className="mt-4 space-y-4">
      <SupplierTabs
        tabs={[
          { id: "ringkas", label: "Ringkas" },
          { id: "antrean", label: "Antrean", count: activeOrderCount ?? undefined },
          { id: "markup", label: "Markup", count: markupCounts?.total ?? undefined },
          { id: "aturan", label: "Aturan", count: exclusions.length || undefined },
          { id: "audit", label: "Audit SK" },
          { id: "alat", label: "Alat" },
        ]}
        active={skTab}
        onChange={(tab) => openTab(tab as typeof skTab)}
      />
      {skTab === "ringkas" && (
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
            <p className="mt-1 text-sm font-semibold text-white">{lastProductLog ? `${lastProductLog.status} · ${formatDate(lastProductLog.created_at)}` : lastLog ? `${lastLog.status} · ${formatDate(lastLog.created_at)}` : "Belum pernah"}</p>
            <p className="mt-1 text-[11px] text-white/40">
              {lastProductLog ? `${lastProductLog.products_synced ?? 0} produk · ${lastProductLog.variants_synced ?? 0} varian · ${lastProductLog.products_excluded ?? 0} non-auto` : lastLog ? "sync produk" : "Tekan Force Sync untuk sync pertama."}
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
      )}
      {skTab === "antrean" && (
      <>
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
              <button key={value} onClick={() => { setOrderStatus(value); setOrderPage(1); void loadOrders(1); }} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${orderStatus === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>
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
                    {!["completed", "failed"].includes(order.status) && (() => {
                      const age = ageLabel(order);
                      if (!age) return null;
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
                {canRetrySkLink(order) ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => void retryOrder(order.id)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
                      {retrying === order.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />} Retry
                    </button>
                    <button onClick={() => void voidOrder(order.id, order.order_code)} disabled={retrying === order.id || voiding === order.id} className="inline-flex h-9 items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 text-xs font-bold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40">
                      {voiding === order.id ? <Spinner size={13} /> : null} Batal
                    </button>
                  </div>
                ) : RETRYABLE_SK_STATUS.includes(order.status) ? (
                  <span title="Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan." className="inline-flex h-9 shrink-0 items-center rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-[11px] font-semibold text-red-200">
                    Percobaan habis
                  </span>
                ) : null}
              </article>
            ))}
          </div>
        )}
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
      </>
      )}
      {skTab === "aturan" && (
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Exclusion rules</h3><p className="mt-0.5 text-[11px] text-white/40">Produk yang cocok pola tidak dibuatkan katalog (registry tetap dicatat).</p></header>
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
            <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="cth: pulsa" className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
            <button onClick={() => void addExclusion()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8]">
              <IosIcon name="plus" size={13} tint="black" /> Tambah
            </button>
          </div>
        </div>
      </section>
      )}
      {skTab === "markup" && (
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Markup per varian</h3><p className="mt-0.5 text-[11px] text-white/40">Ubah markup → harga jual Axvara dihitung ulang otomatis.</p></div>
          <input value={markupQuery} onChange={(e) => { setMarkupQuery(e.target.value); setMarkupPage(1); }} placeholder="Cari varian…" className="ml-auto h-9 w-full max-w-[220px] rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
        </header>
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
        {!markups.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada varian SK tersinkron.</p> : markupFiltered.length === 0 ? <p className="p-10 text-center text-sm text-white/40">Tidak ada varian pada tab ini — coba ubah kata kunci.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {markupPaged.map((row) => {
              const edit = editingMarkup[row.sk_variant_id] ?? { percent: String(row.markup_percent), fixed: String(row.markup_fixed) };
              const vStatus = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_status ?? "live";
              const vReason = (row as MarkupRow & { variant_status?: string; variant_reason?: string }).variant_reason ?? "";
              return (
                <article key={row.sk_variant_id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={bulkSelected.has(row.sk_variant_id)}
                        onChange={() => setBulkSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.sk_variant_id)) next.delete(row.sk_variant_id);
                          else next.add(row.sk_variant_id);
                          return next;
                        })}
                        aria-label={`Pilih ${row.sk_variant_name} untuk bulk markup`}
                        className="h-4 w-4 shrink-0 accent-[#00E5FF]"
                      />
                      <p className="truncate text-sm font-semibold text-white">{row.sk_product_name ? `${row.sk_product_name} — ` : ""}{row.sk_variant_name}</p>
                      <ProcessBadge process={row.sk_order_process} />
                      <VariantStatusBadge status={vStatus} reason={vReason} />
                    </div>
                    <p className="mt-1 text-xs text-white/45">Modal {formatRupiah(row.sk_price)} · Jual {formatRupiah(row.axvara_sell_price)} · Stok {row.sk_stock}{row.sk_min_order && Number(row.sk_min_order) > 1 ? ` · Min. ${row.sk_min_order}` : ""}{row.sk_status ? ` · ${row.sk_status}` : ""}{row.axvara_variant_id ? "" : " · TANPA katalog"}{vStatus !== "live" && vReason ? ` · ${vReason}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-white/55">%<input value={edit.percent} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: e.target.value, fixed: edit.fixed } }))} inputMode="numeric" className="h-9 w-16 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <label className="flex items-center gap-1.5 text-xs text-white/55">+Rp<input value={edit.fixed} onChange={(e) => setEditingMarkup((s) => ({ ...s, [row.sk_variant_id]: { percent: edit.percent, fixed: e.target.value } }))} inputMode="numeric" className="h-9 w-24 rounded-lg border border-white/10 bg-black/20 px-2 text-right text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none" /></label>
                    <button onClick={() => void saveMarkup(row)} className="inline-flex h-9 items-center rounded-xl bg-white px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-white/90">Simpan</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
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
      {skTab === "audit" && (
      <>
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Mutasi saldo <span className="ml-1 rounded-full bg-[#00E5FF]/15 px-2 py-0.5 text-[10px] font-bold text-[#5cefff]">KHAS SK</span></h3><p className="mt-0.5 text-[11px] text-white/40">Audit credit/debit + saldo sebelum/sesudah per invoice. WR tidak punya ini.</p></div>
          <div className="ml-auto flex flex-wrap gap-2">
            {[["all", "Semua"], ["credit", "Masuk"], ["debit", "Keluar"]].map(([value, label]) => (
              <button key={value} onClick={() => setMutationDir(value)} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${mutationDir === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>
            ))}
            <button onClick={() => void loadMutations()} disabled={mutationsLoading} className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-40">
              {mutationsLoading ? <Spinner size={12} /> : <IosIcon name="refresh" size={12} tint="white" />} Muat
            </button>
          </div>
        </header>
        {!mutations.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada mutasi — tekan Muat.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {mutations.map((m, i) => (
              <div key={`${m.invoice}-${i}`} className="flex flex-wrap items-center gap-2 p-4">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.direction === "credit" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-red-400/25 bg-red-500/10 text-red-300"}`}>
                  {m.direction === "credit" ? "+" : "−"}{formatRupiah(m.amount)}
                </span>
                <span className="font-mono text-[11px] text-white/45">{m.invoice}</span>
                <span className="text-[11px] text-white/40">{m.type}</span>
                <span className="ml-auto text-[11px] text-white/35 tabular-nums">{formatRupiah(m.balance_before)} → {formatRupiah(m.balance_after)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Transaksi SK <span className="ml-1 rounded-full bg-[#00E5FF]/15 px-2 py-0.5 text-[10px] font-bold text-[#5cefff]">KHAS SK</span></h3><p className="mt-0.5 text-[11px] text-white/40">Daftar transaksi di sisi Sekalipay (audit/refund). WR tidak punya ini.</p></div>
          <button onClick={() => void loadTransactions()} disabled={trxLoading} className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-40">
            {trxLoading ? <Spinner size={12} /> : <IosIcon name="refresh" size={12} tint="white" />} Muat
          </button>
        </header>
        {!transactions.length ? <p className="p-10 text-center text-sm text-white/40">Belum ada data — tekan Muat.</p> : (
          <div className="divide-y divide-white/[0.06]">
            {transactions.map((t) => (
              <div key={t.invoice} className="flex flex-wrap items-center gap-2 p-4">
                <StatusBadge status={t.status} />
                <span className="font-mono text-[11px] text-white/45">{t.invoice}</span>
                <span className="font-mono text-[11px] text-white/35">{t.ref_id}</span>
                <span className="ml-auto text-xs text-white/55 tabular-nums">{formatRupiah(t.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}
      {skTab === "alat" && (
      <>
      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Cek akun <span className="ml-1 rounded-full bg-[#00E5FF]/15 px-2 py-0.5 text-[10px] font-bold text-[#5cefff]">KHAS SK</span></h3><p className="mt-0.5 text-[11px] text-white/40">Validasi nickname/nama sebelum order (game, e-wallet). WR tidak punya ini.</p></header>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <input value={validateItem} onChange={(e) => setValidateItem(e.target.value)} placeholder="item_id" inputMode="numeric" className="h-9 w-28 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <input value={validateCustomer} onChange={(e) => setValidateCustomer(e.target.value)} placeholder="User ID / nomor" className="h-9 min-w-[160px] flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <input value={validateZone} onChange={(e) => setValidateZone(e.target.value)} placeholder="zone/server (opsional)" className="h-9 w-40 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <button onClick={() => void runValidate()} disabled={validating} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
            {validating ? <Spinner size={13} /> : null}{validating ? "Mengecek…" : "Cek akun"}
          </button>
          {validateResult && <p className="w-full font-mono text-[11px] text-white/60">{validateResult}</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h3 className="text-sm font-semibold text-white">Stock lock <span className="ml-1 rounded-full bg-[#00E5FF]/15 px-2 py-0.5 text-[10px] font-bold text-[#5cefff]">KHAS SK</span></h3><p className="mt-0.5 text-[11px] text-white/40">Reservasi stok 10 mnt anti-overselling. WR tidak punya ini.</p></div>
          <button onClick={() => void loadLocks()} className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white">
            <IosIcon name="refresh" size={12} tint="white" /> Muat lock aktif
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <input value={lockItem} onChange={(e) => setLockItem(e.target.value)} placeholder="item_id" inputMode="numeric" className="h-9 w-28 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <input value={lockQty} onChange={(e) => setLockQty(e.target.value)} placeholder="qty" inputMode="numeric" className="h-9 w-20 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <button onClick={() => void createLock()} disabled={locking} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">
            {locking ? <Spinner size={13} /> : null}{locking ? "Mengunci…" : "Kunci 10 mnt"}
          </button>
        </div>
        {locks.length > 0 && (
          <div className="divide-y divide-white/[0.06] border-t border-white/10">
            {locks.map((l) => (
              <div key={l.lock_token} className="flex flex-wrap items-center gap-2 p-4">
                <span className="font-mono text-[11px] text-[#5cefff]">{l.lock_token}</span>
                <span className="text-[11px] text-white/45">item {l.item_id} × {l.quantity}</span>
                <span className="text-[11px] text-white/35">s/d {formatDate(l.expires_at)}</span>
                <button onClick={() => void releaseLock(l.lock_token)} className="ml-auto inline-flex h-8 items-center rounded-lg border border-red-400/30 bg-red-500/10 px-3 text-[11px] font-bold text-red-200 transition hover:bg-red-500/20">Lepas</button>
              </div>
            ))}
          </div>
        )}
      </section>


      <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
        <header className="border-b border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Detail varian</h3><p className="mt-0.5 text-[11px] text-white/40">Capability registry (min.order, status, deskripsi, required fields) + live API.</p></header>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <input value={detailId} onChange={(e) => setDetailId(e.target.value)} placeholder="variant_id SK" inputMode="numeric" className="h-9 w-36 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none" />
          <button onClick={() => void loadDetail()} disabled={detailLoading} className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-white/90 disabled:opacity-40">
            {detailLoading ? <Spinner size={13} /> : null}{detailLoading ? "Memuat…" : "Lihat detail"}
          </button>
          {detailResult && <p className="w-full whitespace-pre-wrap font-mono text-[11px] text-white/60">{detailResult}</p>}
        </div>
      </section>
      </>
      )}
    </div>
  );
}
