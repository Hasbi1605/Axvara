"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { deriveAivaultBulkTiers, scaleAivaultBulkMarkup } from "@/lib/aivault/bulk";
import { aivaultSellPrice } from "@/lib/aivault/families";
import { formatRupiah } from "@/lib/utils";
import { TUNVN_BUFF_MARKUP_PERCENT } from "@/lib/tunvn/pricing";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import { AsyncConfirmDialog, ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Loading";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, NativeSelect, PageHeader, Skeleton, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger } from "./ui";
import { SupplierTabs, VariantStatusBadge, type SupplierTabId } from "./SupplierTabs";
import { SupplierPriceHeader, SupplierPriceRow, StatusBadges, costWithIdr, type SupplierPriceSave } from "./SupplierPriceRow";
import { BulkMarkupDialog } from "./BulkMarkupDialog";
import { BulkMarkupToolbar } from "./BulkMarkupToolbar";
import { SupplierOrderQueue, supplierOrderError } from "./SupplierOrderQueue";
import { SupplierSyncStatus, syncCompactValue, type SupplierDiffStatus, type SupplierSyncLogRow } from "./SupplierSyncStatus";
import {
  SUPPLIERS, catalogItems, inferVariantStatus, mapSupplierError, supplierMoney, supplierRequest, supplierTime,
  SupplierRequestError, type Balance, type BuffData, type Catalog, type CatalogItem, type ExclusionRow,
  type OrderLink, type Supplier, type SyncLogCounts,
} from "./supplier-admin-data";

const PANEL_TABS: { id: SupplierTabId; label: string }[] = [
  { id: "ringkas", label: "Ringkas" },
  { id: "antrean", label: "Antrean" },
  { id: "markup", label: "Markup" },
  { id: "alat", label: "Alat" },
];

type MarkupSubTab = "live" | "hidden" | "off" | "all";
const WR_SK_ORDER_PER_PAGE = 20;

function aivaultBulkMarkupPreview(item: CatalogItem, nextMarkup: number) {
  const { bulk_markup_tiers: tiers, markup_percent: oldMarkup, cost, fx } = item;
  if (!tiers?.length || oldMarkup <= 0 || cost == null || fx == null) return;
  let price: number;
  try { price = aivaultSellPrice(cost, fx, nextMarkup); }
  catch { return; }
  const preview = deriveAivaultBulkTiers(cost, fx, price, scaleAivaultBulkMarkup(tiers, oldMarkup, nextMarkup));
  return preview.length
    ? `Grosir ikut disesuaikan: ${preview.map(t => `${t.min_qty}+ ${formatRupiah(t.unit_price)}`).join(" · ")}`
    : "Grosir ikut disesuaikan: tidak ada tier aktif pada markup ini.";
}

function DeliveryBadge({ wrClass }: { wrClass?: string | null }) {
  if (wrClass === "restock") return <Badge variant="secondary" title="Kirim otomatis">AUTO</Badge>;
  if (wrClass === "made_by_order") return <Badge variant="warning" title="MANUAL · diproses sesuai antrean">MANUAL</Badge>;
  return null;
}

function ProcessBadge({ process }: { process?: string | null }) {
  const p = String(process || "").toLowerCase();
  if (p === "auto") return <Badge variant="secondary" title="Lisensi langsung">AUTO</Badge>;
  if (p === "manual") return <Badge variant="warning" title="MANUAL · diproses admin SK">MANUAL</Badge>;
  if (p === "h2h" || p === "smm" || p === "vip") return <Badge variant="secondary" title={`${p.toUpperCase()} · belum didukung fase 1`}>{p.toUpperCase()}</Badge>;
  return process ? <Badge variant="secondary">{process}</Badge> : null;
}

function FamilyCard({ title, description, archived, parentInactive, mode = "manual", selectable = false, children }: {
  title: string; description: ReactNode; archived?: boolean; parentInactive?: boolean;
  mode?: "manual" | "fixed"; selectable?: boolean; children: ReactNode;
}) {
  return <Card>
    <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0 p-4 pb-2">
      <CardTitle className="min-w-0 break-words text-base">{title}</CardTitle>
      <StatusBadges archived={archived} parentInactive={parentInactive} />
      <CardDescription className="w-full break-words text-xs">{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-2 p-4 pt-0">
      <SupplierPriceHeader mode={mode} selectable={selectable} />
      {children}
    </CardContent>
  </Card>;
}

function SupplierDescription({ text }: { text: string }) {
  return <details className="text-xs">
    <summary className="min-h-11 cursor-pointer py-2 text-admin-muted hover:text-admin-fg md:min-h-0 md:py-0">Deskripsi supplier</summary>
    <p className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-admin-border bg-admin-subtle/60 p-2.5 leading-5 text-admin-muted">{text}</p>
  </details>;
}

export function SupplierAdminPanel({ supplier }: { supplier: Supplier }) {
  const config = SUPPLIERS[supplier];
  const { name, currency, mode, lazy } = config;
  const isWrSk = Boolean(lazy);

  const [tab, setTab] = useState<SupplierTabId>("ringkas");
  const [loadedTabs, setLoadedTabs] = useState<Set<SupplierTabId>>(() => new Set(["ringkas"]));
  const [query, setQuery] = useState("");
  const [markupQueryLive, setMarkupQueryLive] = useState("");
  const [markupTab, setMarkupTab] = useState<MarkupSubTab>("live");
  const markupTabTouched = useRef(false);
  const [markupPerPage, setMarkupPerPage] = useState<20 | 50 | 100>(20);
  const [markupPage, setMarkupPage] = useState(1);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [links, setLinks] = useState<OrderLink[] | null>(null);
  const [buff, setBuff] = useState<BuffData | null>(null);

  // WR/SK specific state (lazy per tab)
  const [saldoLoading, setSaldoLoading] = useState(isWrSk);
  const [logsLoading, setLogsLoading] = useState(isWrSk);
  const [logs, setLogs] = useState<SupplierSyncLogRow[]>([]);
  const [diffStatus, setDiffStatus] = useState<SupplierDiffStatus>(null);
  const [syncMeta, setSyncMeta] = useState<{ configured?: boolean; dispatch_enabled?: boolean; sync_enabled?: boolean; counts?: SyncLogCounts } | null>(null);
  const [wrSkMarkups, setWrSkMarkups] = useState<Catalog["items"]>([]);
  const [wrSkMarkupTotal, setWrSkMarkupTotal] = useState<number | null>(null);
  const [wrSkMarkupLoading, setWrSkMarkupLoading] = useState(false);
  const [wrSkOrdersLoading, setWrSkOrdersLoading] = useState(false);
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderQueryLive, setOrderQueryLive] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [sandboxProduct, setSandboxProduct] = useState("");
  const [sandboxVariant, setSandboxVariant] = useState("");
  const [sandboxResult, setSandboxResult] = useState<string | null>(null);

  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(!isWrSk);
  const [busy, setBusy] = useState<string | null>(null);
  const [exclusionToDelete, setExclusionToDelete] = useState<ExclusionRow | null>(null);
  const [busyOrderAction, setBusyOrderAction] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ item: CatalogItem; trigger: HTMLButtonElement } | null>(null);
  const [bulkError, setBulkError] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);

  const receiptTrigger = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);
  const actionPending = useRef(false);
  const lastOrderFetchKey = useRef<string | null>(null);
  const lastMarkupFetchKey = useRef<string | null>(null);
  const orderRequest = useRef(0);
  const markupRequest = useRef(0);
  const exclusionsFetched = useRef(false);

  // ---- Non-WR/SK eager loader (AIVault, TUNVN, StoreBat, Mirai) ----
  const loadStandard = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled([
      supplierRequest<Catalog>(supplier, "products", undefined, body => Array.isArray(body.items)),
      supplierRequest<Balance>(supplier, "balance", undefined, body => Number.isFinite(body.balance ?? (config.buff ? body.balance_usdt : undefined)) && (body.currency == null || body.currency === currency)),
      supplierRequest<{ items: OrderLink[] }>(supplier, "orders", undefined, body => Array.isArray(body.items)),
      config.buff ? supplierRequest<BuffData>(supplier, "buff", undefined, body => Array.isArray(body.variants)) : Promise.resolve(null),
    ] as const);
    if (generation.current !== current) return;
    const loadedCatalog = results[0].status === "fulfilled" ? results[0].value : null;
    const loadedBuff = results[3].status === "fulfilled" ? results[3].value : null;
    if (loadedCatalog) setCatalog(loadedCatalog);
    if (results[1].status === "fulfilled") setBalance(results[1].value);
    if (results[2].status === "fulfilled") setLinks(results[2].value.items.filter(link => !config.buff || !isTunvnExcludedProduct(Number(link.source_product_id))).slice(0, 100));
    if (results[3].status === "fulfilled") setBuff(loadedBuff);

    if (!markupTabTouched.current && (loadedCatalog || loadedBuff)) {
      const normalized = loadedCatalog ? catalogItems(loadedCatalog.items, config) : [];
      const hasLiveItem = normalized.some(i => i.variantStatus === "live");
      const hasLiveBuff = (loadedBuff?.variants ?? []).some(v => {
        const status = inferVariantStatus({
          variant_status: v.variant_status,
          variant_reason: v.variant_reason,
          variantActive: v.is_active === 1,
          productActive: (loadedBuff?.muse_product?.is_active ?? 1) === 1,
          product_archived: loadedBuff?.muse_product?.archived,
          variant_id: 1,
          stock: -1,
        }).status;
        return status === "live";
      });
      setMarkupTab(hasLiveItem || hasLiveBuff ? "live" : "all");
    }

    const sections = ["Katalog", "Saldo", "Antrean", "Probe Buff"];
    setLoadErrors(results.flatMap((result, i) => result.status === "rejected"
      ? [`${sections[i]}: ${result.reason instanceof SupplierRequestError ? result.reason.message : "Koneksi tidak tersedia."}`] : []));
    setLoading(false);
  }, [config, currency, supplier]);

  // ---- WR/SK lazy loaders ----
  const loadWrSkSaldo = useCallback(async () => {
    setSaldoLoading(true);
    try {
      const res = await fetch(`/api/admin/${supplier}/saldo`, { cache: "no-store" });
      const body = await res.json().catch(() => ({})) as Balance & { error?: string };
      if (!res.ok) throw new Error(mapSupplierError(body.error, `Gagal memuat saldo ${name}`));
      setBalance(body);
      setLoadErrors(prev => prev.filter(e => !e.startsWith("Saldo:")));
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : `Gagal memuat saldo ${name}`;
      setLoadErrors(prev => [...prev.filter(e => !e.startsWith("Saldo:")), `Saldo: ${msg}`]);
    } finally {
      setSaldoLoading(false);
    }
  }, [name, supplier]);

  const loadWrSkLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/admin/${supplier}/sync-log?limit=5`, { cache: "no-store" });
      const body = await res.json().catch(() => ({})) as {
        logs?: SupplierSyncLogRow[]; diff?: SupplierDiffStatus;
        configured?: boolean; dispatch_enabled?: boolean; sync_enabled?: boolean; counts?: SyncLogCounts;
      };
      if (res.ok) {
        setLogs(body.logs ?? []);
        setDiffStatus(body.diff ?? null);
        if (body.configured !== undefined || body.dispatch_enabled !== undefined || body.sync_enabled !== undefined || body.counts !== undefined) {
          setSyncMeta({
            configured: body.configured,
            dispatch_enabled: body.dispatch_enabled,
            sync_enabled: body.sync_enabled,
            counts: body.counts,
          });
        }
        setLoadErrors(prev => prev.filter(e => !e.startsWith("Status sinkron:")));
      } else {
        setLoadErrors(prev => [...prev.filter(e => !e.startsWith("Status sinkron:")), "Status sinkron: Gagal memuat status sinkron."]);
      }
    } catch {
      setLoadErrors(prev => [...prev.filter(e => !e.startsWith("Status sinkron:")), "Status sinkron: Gagal memuat status sinkron."]);
    } finally {
      setLogsLoading(false);
    }
  }, [supplier]);

  const loadWrSkOrders = useCallback(async (page = 1) => {
    const request = ++orderRequest.current;
    setWrSkOrdersLoading(true);
    try {
      const res = await fetch(
        `/api/admin/${supplier}/orders?status=${encodeURIComponent(orderStatus)}&per_page=${WR_SK_ORDER_PER_PAGE}&page=${page}${orderQueryLive ? `&q=${encodeURIComponent(orderQueryLive)}` : ""}`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => ({})) as { orders?: OrderLink[]; total?: number; page?: number; error?: string };
      if (request !== orderRequest.current) return;
      if (!res.ok) throw new Error(mapSupplierError(body.error, `Gagal memuat antrean ${name}`));
      setLinks(body.orders ?? []);
      setOrderTotal(Number(body.total ?? 0));
      setOrderPage(Number(body.page ?? page));
      setLoadErrors(prev => prev.filter(e => !e.startsWith("Antrean:")));
    } catch (cause) {
      if (request !== orderRequest.current) return;
      const msg = cause instanceof Error ? cause.message : `Gagal memuat antrean ${name}`;
      setLoadErrors(prev => [...prev.filter(e => !e.startsWith("Antrean:")), `Antrean: ${msg}`]);
    } finally {
      if (request === orderRequest.current) setWrSkOrdersLoading(false);
    }
  }, [name, orderQueryLive, orderStatus, supplier]);

  const loadWrSkMarkups = useCallback(async () => {
    const request = ++markupRequest.current;
    setWrSkMarkupLoading(true);
    try {
      const res = await fetch(
        `/api/admin/${supplier}/markup?limit=500${markupQueryLive ? `&q=${encodeURIComponent(markupQueryLive)}` : ""}`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => ({})) as { variants?: Catalog["items"]; total?: number; error?: string };
      if (request !== markupRequest.current) return;
      if (!res.ok) throw new Error(mapSupplierError(body.error, `Gagal memuat markup ${name}`));
      const variants = body.variants ?? [];
      setWrSkMarkups(variants);
      setWrSkMarkupTotal(Number(body.total ?? variants.length));
      setLoadErrors(prev => prev.filter(e => !e.startsWith("Markup:")));
    } catch (cause) {
      if (request !== markupRequest.current) return;
      const msg = cause instanceof Error ? cause.message : `Gagal memuat markup ${name}`;
      setLoadErrors(prev => [...prev.filter(e => !e.startsWith("Markup:")), `Markup: ${msg}`]);
    } finally {
      if (request === markupRequest.current) setWrSkMarkupLoading(false);
    }
  }, [markupQueryLive, name, supplier]);

  const loadWrSkExclusions = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${supplier}/exclusions`, { cache: "no-store" });
      const body = await res.json().catch(() => ({})) as { exclusions?: ExclusionRow[] };
      if (res.ok) setExclusions(body.exclusions ?? []);
    } catch { /* opsional */ }
  }, [supplier]);

  // Mount effect
  useEffect(() => {
    if (isWrSk) {
      void loadWrSkSaldo();
      void loadWrSkLogs();
      return;
    }
    const token = generation;
    void loadStandard();
    return () => { token.current++; };
  }, [isWrSk, loadStandard, loadWrSkLogs, loadWrSkSaldo]);

  // Debounced search for WR/SK
  useEffect(() => {
    if (!isWrSk) return;
    const timer = setTimeout(() => setOrderQueryLive(orderQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [isWrSk, orderQuery]);

  useEffect(() => {
    if (!isWrSk) return;
    const timer = setTimeout(() => setMarkupQueryLive(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [isWrSk, query]);

  // WR/SK lazy tab effects
  useEffect(() => {
    if (!isWrSk || !loadedTabs.has("antrean")) return;
    const key = `antrean|${orderStatus}|${orderQueryLive}`;
    if (lastOrderFetchKey.current === key) return;
    lastOrderFetchKey.current = key;
    setOrderPage(1);
    void loadWrSkOrders(1);
  }, [isWrSk, loadedTabs, loadWrSkOrders, orderQueryLive, orderStatus]);

  useEffect(() => {
    if (!isWrSk || !loadedTabs.has("markup")) return;
    const key = `markup|${markupQueryLive}`;
    if (lastMarkupFetchKey.current === key) return;
    lastMarkupFetchKey.current = key;
    void loadWrSkMarkups();
  }, [isWrSk, loadedTabs, loadWrSkMarkups, markupQueryLive]);

  useEffect(() => {
    if (!isWrSk || !loadedTabs.has("alat") || exclusionsFetched.current) return;
    exclusionsFetched.current = true;
    void loadWrSkExclusions();
  }, [isWrSk, loadedTabs, loadWrSkExclusions]);

  const openTab = useCallback((next: SupplierTabId) => {
    setTab(next);
    setLoadedTabs(prev => {
      if (prev.has(next)) return prev;
      const copy = new Set(prev);
      copy.add(next);
      return copy;
    });
    if (next === "markup") setMarkupPage(1);
  }, []);

  const refreshActive = useCallback(() => {
    setActionError("");
    setSuccess("");
    if (!isWrSk) {
      void loadStandard();
      return;
    }
    void loadWrSkSaldo();
    void loadWrSkLogs();
    if (tab === "antrean") void loadWrSkOrders(orderPage);
    if (tab === "markup") void loadWrSkMarkups();
    if (tab === "alat") void loadWrSkExclusions();
  }, [isWrSk, loadStandard, loadWrSkExclusions, loadWrSkLogs, loadWrSkMarkups, loadWrSkOrders, loadWrSkSaldo, orderPage, tab]);

  // Clear checked selections when visible markup slice changes so bulk never hits invisible pages/tabs.
  useEffect(() => {
    setBulkSelected(new Set());
  }, [markupTab, markupPage, markupPerPage, query]);

  // ---- Standard (other 4) mutations ----
  async function mutateStandard(section: string, path: string, body: object, message: string, options: { patch?: boolean; bulk?: boolean } = {}) {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(path);
    setActionError("");
    setBulkError("");
    setSuccess("");
    const version = generation.current;
    try {
      const result = await supplierRequest<{ receipt?: string; link?: { status?: string; last_error?: string }; status?: string }>(supplier, path, {
        method: options.patch ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (generation.current !== version) return false;
      if ("action" in body && body.action === "reveal") {
        if (!result.receipt) { setActionError("Receipt: Data tidak tersedia."); return false; }
        setReceipt(result.receipt);
        return true;
      }
      await loadStandard();
      if (generation.current !== version + 1) return false;
      if ((result.link?.status ?? result.status) === "needs_admin") setActionError(`Antrean: ${supplierOrderError(result.link?.last_error, config.buff) ?? "Pesanan masih perlu diperiksa."}`);
      else setSuccess(message);
      return true;
    } catch (error) {
      if (generation.current === version) {
        if (options.bulk) setBulkError(error instanceof SupplierRequestError ? error.detail : "Gagal menyimpan harga grosir.");
        else setActionError(`${section}: ${error instanceof SupplierRequestError ? error.message : "Koneksi tidak tersedia."}`);
      }
      return false;
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  // ---- WR/SK mutations ----
  async function runWrSkSync() {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy("sync");
    setActionError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/${supplier}/sync`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as {
        error?: string; status?: string; synced?: number; variantsSynced?: number; errors?: string[];
      };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Sync gagal"));
      const ringkas = `${body.synced ?? 0} produk, ${body.variantsSynced ?? 0} varian`;
      const errors = Array.isArray(body.errors) ? body.errors : [];
      if (body.status === "failed") {
        throw new Error(errors[0] || "Sync gagal tanpa satu pun produk tersimpan.");
      } else if (body.status === "partial") {
        const sebab = errors.length ? `${errors.length} error — ${errors[0]}` : "berhenti di batas budget, lanjut otomatis di cron berikutnya";
        setActionError(`Sync sebagian: ${ringkas}. ${sebab}`);
      } else {
        setSuccess(`Sync selesai: ${ringkas}.`);
      }
      await Promise.all([loadWrSkLogs(), loadWrSkSaldo()]);
      if (loadedTabs.has("markup")) await loadWrSkMarkups();
    } catch (cause) {
      setActionError(`Sinkron: ${cause instanceof Error ? cause.message : "Sync gagal"}`);
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  async function runWrSkOrderAction(link: OrderLink, action: "retry" | "void") {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusyOrderAction(`${action}:${link.id}`);
    setActionError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/${supplier}/orders/${link.id}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) throw new Error(mapSupplierError(body.error, body.message || (action === "retry" ? "Retry gagal" : "Void gagal")));
      setSuccess(action === "retry" ? "Order dijadwalkan ulang." : "Order dibatalkan.");
      await loadWrSkOrders(orderPage);
    } catch (cause) {
      setActionError(`Antrean: ${cause instanceof Error ? cause.message : "Operasi gagal."}`);
      await loadWrSkOrders(orderPage);
    } finally {
      actionPending.current = false;
      setBusyOrderAction(null);
    }
  }

  async function saveWrSkMarkup(item: CatalogItem, payload: SupplierPriceSave) {
    if (actionPending.current) return;
    actionPending.current = true;
    const key = `markup/${item.id}`;
    setBusy(key);
    setActionError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/${supplier}/markup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [config.itemId]: item.id,
          markup_percent: payload.markup_percent,
          markup_fixed: payload.markup_fixed ?? 0,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; sell_price?: number };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Gagal menyimpan markup"));
      setSuccess(`Harga jual baru ${formatRupiah(Number(body.sell_price ?? 0))}.`);
      await loadWrSkMarkups();
    } catch (cause) {
      setActionError(`Markup: ${cause instanceof Error ? cause.message : "Gagal menyimpan markup"}`);
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  async function applyBulkMarkup({ variantIds, percent, resetFixed }: { variantIds: string[]; percent: number; resetFixed: boolean }) {
    if (actionPending.current) throw new Error("Tunggu operasi yang sedang berjalan.");
    actionPending.current = true;
    setBusy("markup/bulk");
    setActionError("");
    setSuccess("");
    try {
      const payload = isWrSk
        ? { variant_ids: variantIds, markup_percent: percent, markup_fixed: 0, update_fixed: resetFixed }
        : { variant_ids: variantIds, markup_percent: percent, reset_manual: resetFixed };
      const res = await fetch(`/api/admin/${supplier}/markup/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; updated?: number; failed?: { id: string; error: string }[] };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Bulk markup gagal"));
      const updated = Number(body.updated ?? 0);
      const failed = Array.isArray(body.failed) ? body.failed : [];
      if (failed.length) {
        setActionError(`Bulk: ${updated} berubah, ${failed.length} gagal (cth. ${failed[0].id}: ${mapSupplierError(failed[0].error, failed[0].error)}).`);
      } else {
        setSuccess(`Bulk markup ${percent}% ke ${updated} varian.`);
      }
      if (isWrSk) await loadWrSkMarkups();
      else await loadStandard();
    } finally {
      actionPending.current = false;
      setBusy(null);
    }
  }

  async function addExclusion() {
    const pattern = newPattern.trim();
    if (pattern.length < 2) {
      setActionError("Aturan: Pola minimal 2 karakter.");
      return;
    }
    setBusy("exclusions:add");
    setActionError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/${supplier}/exclusions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Gagal menambah exclusion"));
      setNewPattern("");
      setSuccess("Exclusion ditambahkan.");
      await loadWrSkExclusions();
    } catch (cause) {
      setActionError(`Aturan: ${cause instanceof Error ? cause.message : "Gagal menambah exclusion"}`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteExclusion(id: number) {
    setBusy(`exclusions:del:${id}`);
    setActionError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/${supplier}/exclusions?id=${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Gagal menghapus exclusion"));
      setSuccess("Exclusion dihapus.");
      await loadWrSkExclusions();
    } finally {
      setBusy(null);
    }
  }

  async function runSandbox() {
    const productId = Number(sandboxProduct);
    const variantId = Number(sandboxVariant);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(variantId) || variantId <= 0) {
      setActionError("Sandbox: Isi product_id + variant_id SK (angka dari daftar varian).");
      return;
    }
    setBusy("sandbox");
    setActionError("");
    setSuccess("");
    setSandboxResult(null);
    try {
      const res = await fetch("/api/admin/sekalipay/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, variant_id: variantId, quantity: 1 }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; ref_id?: string; result?: unknown };
      if (!res.ok) throw new Error(mapSupplierError(body.error, "Sandbox gagal"));
      setSandboxResult(`OK · ref ${body.ref_id} · ${JSON.stringify(body.result).slice(0, 300)}`);
      setSuccess("Sandbox order berhasil (saldo tidak terpotong).");
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Sandbox gagal";
      setSandboxResult(`GAGAL · ${msg}`);
      setActionError(`Sandbox: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  // ---- Derived catalog + Buff rows + filtering + pagination ----
  const items = useMemo(() => catalogItems(isWrSk ? wrSkMarkups : (catalog?.items ?? []), config),
    [catalog?.items, config, isWrSk, wrSkMarkups]);

  const allFamilies = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const rows = map.get(item.family.key);
      if (rows) rows.push(item);
      else map.set(item.family.key, [item]);
    }
    return map;
  }, [items]);

  const needle = query.trim().toLowerCase();

  type UnifiedEntry =
    | { kind: "item"; bulkId: string; familyKey: string; familyName: string; status: string; item: CatalogItem }
    | { kind: "buff"; bulkId: string; familyKey: string; familyName: string; status: string; reason: string; variant: BuffData["variants"][number] };

  const searchMatchedEntries = useMemo<UnifiedEntry[]>(() => {
    const out: UnifiedEntry[] = [];
    for (const item of items) {
      const matches = !needle || [item.bulkId, item.name, item.label, item.productName, item.productSlug, item.family.name, item.family.slug]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
      if (!matches) continue;
      out.push({
        kind: "item",
        bulkId: item.bulkId,
        familyKey: item.family.key,
        familyName: item.productName || item.family.name,
        status: item.variantStatus,
        item,
      });
    }
    if (config.buff && buff?.variants.length) {
      for (const variant of buff.variants) {
        const matches = !needle || `${variant.sku} ${variant.label} Buff Token Muse`.toLowerCase().includes(needle);
        if (!matches) continue;
        const live = inferVariantStatus({
          variant_status: variant.variant_status,
          variant_reason: variant.variant_reason,
          variantActive: variant.is_active === 1,
          productActive: (buff.muse_product?.is_active ?? 1) === 1,
          product_archived: buff.muse_product?.archived,
          variant_id: 1,
          stock: -1,
        });
        out.push({
          kind: "buff",
          bulkId: variant.sku,
          familyKey: "__buff__",
          familyName: "Buff Token Muse",
          status: live.status,
          reason: live.reason,
          variant,
        });
      }
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "buff" ? 1 : -1;
      const f = a.familyName.localeCompare(b.familyName);
      if (f !== 0) return f;
      const aLabel = a.kind === "item" ? a.item.label : a.variant.label;
      const bLabel = b.kind === "item" ? b.item.label : b.variant.label;
      return aLabel.localeCompare(bLabel);
    });
    return out;
  }, [buff, config.buff, items, needle]);

  const markupCounts = useMemo(() => {
    let live = 0, hidden = 0, off = 0;
    for (const entry of searchMatchedEntries) {
      if (entry.status === "live") live++;
      else if (entry.status === "off") off++;
      else hidden++;
    }
    return { live, hidden, off, total: searchMatchedEntries.length };
  }, [searchMatchedEntries]);

  const markupFiltered = useMemo(() => searchMatchedEntries.filter(entry => {
    if (markupTab === "live") return entry.status === "live";
    if (markupTab === "hidden") return entry.status === "hidden_loser" || entry.status === "hidden_nocatalog" || entry.status === "hidden_soldout";
    if (markupTab === "off") return entry.status === "off";
    return true;
  }), [markupTab, searchMatchedEntries]);

  const markupTotalPages = Math.max(1, Math.ceil(markupFiltered.length / markupPerPage));
  const markupSafePage = Math.min(markupPage, markupTotalPages);
  const markupPaged = useMemo(
    () => markupFiltered.slice((markupSafePage - 1) * markupPerPage, markupSafePage * markupPerPage),
    [markupFiltered, markupPerPage, markupSafePage],
  );
  const markupPagedIds = useMemo(() => markupPaged.map(e => e.bulkId), [markupPaged]);

  const pagedGroups = useMemo(() => {
    const groups: { key: string; name: string; archived: boolean; inactive: boolean; items: CatalogItem[] }[] = [];
    const byKey = new Map<string, (typeof groups)[number]>();
    const buffRows: (Extract<UnifiedEntry, { kind: "buff" }>)[] = [];
    for (const entry of markupPaged) {
      if (entry.kind === "buff") {
        buffRows.push(entry);
        continue;
      }
      let g = byKey.get(entry.familyKey);
      if (!g) {
        const familyRows = allFamilies.get(entry.familyKey) ?? [entry.item];
        g = {
          key: entry.familyKey,
          name: entry.familyName,
          archived: familyRows.some(r => r.product_archived === 1),
          inactive: !familyRows.some(r => r.productActive),
          items: [],
        };
        byKey.set(entry.familyKey, g);
        groups.push(g);
      }
      g.items.push(entry.item);
    }
    return { groups, buffRows };
  }, [allFamilies, markupPaged]);

  const active = items.filter(item => item.variantActive && item.productActive && item.product_archived !== 1).length;
  const mapped = items.filter(item => item.variant_id != null).length;
  const wrSkCounts: SyncLogCounts | null = syncMeta?.counts ?? (loadedTabs.has("markup")
    ? { active_variants: active, mapped_variants: mapped, total_variants: items.length, families: allFamilies.size }
    : null);

  const locked = isWrSk
    ? (busy !== null || busyOrderAction !== null)
    : (loading || busy !== null);

  const configured = isWrSk ? syncMeta?.configured : catalog?.configured;
  const syncEnabled = isWrSk ? (syncMeta?.sync_enabled ?? syncMeta?.configured) : (catalog?.sync_enabled ?? catalog?.configured);
  const dispatchEnabled = isWrSk ? (syncMeta?.dispatch_enabled ?? syncMeta?.configured) : (catalog?.dispatch_enabled ?? catalog?.configured);
  const syncDisabled = isWrSk
    ? (syncMeta?.configured !== undefined && (!syncMeta.configured || syncEnabled === false))
    : (catalog != null && (!catalog.configured || !syncEnabled));
  const lastErrorAt = supplierTime(catalog?.last_error?.at);
  const wrSkBalance = balance?.current?.balance ?? balance?.capacity?.balance ?? null;
  const partialMarkupLoad = isWrSk && wrSkMarkupTotal != null && wrSkMarkupTotal > wrSkMarkups.length;

  const orderLabels = useMemo(() => new Map(items.map(item => [item.id, item.label])), [items]);

  function priceRow(row: {
    key: string; id: string; bulkId: string; path: string; title: string; selectLabel?: string;
    meta: ReactNode; badges?: ReactNode; details?: ReactNode;
    markupPreview?: (value: number) => string | undefined;
    active: boolean; canEdit: boolean; manual: number | null; fixed: number; price: number | null; markup: number;
    item?: CatalogItem;
  }) {
    return <SupplierPriceRow
      key={row.key}
      id={row.id}
      title={row.title}
      selectLabel={row.selectLabel ?? row.title}
      meta={row.meta}
      badges={row.badges}
      details={row.details}
      markupPreview={row.markupPreview}
      mode={mode}
      markup={row.markup}
      manual={row.manual}
      fixed={row.fixed}
      price={row.price}
      active={row.active}
      canEdit={row.canEdit}
      locked={locked}
      busy={busy === row.path}
      selectable
      selected={bulkSelected.has(row.bulkId)}
      onSelectChange={checked => setBulkSelected(prev => {
        const next = new Set(prev);
        if (checked) next.add(row.bulkId);
        else next.delete(row.bulkId);
        return next;
      })}
      onToggle={isWrSk ? undefined : () => void mutateStandard("Markup", row.path, { is_active: !row.active }, `${row.title} ${row.active ? "dinonaktifkan" : "diaktifkan"}.`, { patch: true })}
      onSave={async body => {
        if (isWrSk && row.item) await saveWrSkMarkup(row.item, body);
        else await mutateStandard("Markup", row.path, body, `Harga ${row.title} disimpan.`, { patch: true });
      }}
    />;
  }

  return <div className="min-w-0 space-y-4 [&_[role=tab]]:min-h-11 md:[&_[role=tab]]:min-h-9">
    <PageHeader
      title={name}
      className="min-h-0 flex-row items-center justify-between md:min-h-0"
      actions={<Button variant="outline" className="min-h-11 md:min-h-0" disabled={locked || (isWrSk && saldoLoading)} onClick={refreshActive}>
        {isWrSk && saldoLoading ? <Spinner size={13} /> : <RefreshCw />} Muat ulang
      </Button>}
    />
    <SupplierTabs tabs={PANEL_TABS} active={tab} onChange={openTab}>
      <div aria-live="polite" className="space-y-1 text-sm empty:hidden [&:not(:empty)]:my-3">
        {!isWrSk && loading && <p role="status" className="text-admin-muted">Memuat data {name}…</p>}
        {busy && (isWrSk || !loading) && <p role="status" className="text-admin-muted">Memproses…</p>}
        {loadErrors.map(error => <p role="alert" key={error} className="break-words text-admin-danger">{error}</p>)}
        {isWrSk && balance?.stale && <p role="alert" className="break-words text-admin-warning">Saldo live gagal — menampilkan terakhir tercatat.</p>}
        {actionError && <p role="alert" className="break-words text-admin-danger">{actionError}</p>}
        {success && <p role="status" className="text-admin-success">{success}</p>}
      </div>

      <TabsContent value="ringkas" className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4 [&>div]:p-3 sm:[&>div]:p-4 [&>div>div]:break-words [&>div>div]:text-lg sm:[&>div>div]:text-2xl">
          {isWrSk ? (
            <>
              <StatCard
                label="Saldo"
                value={saldoLoading ? <Skeleton className="h-7 w-28 max-w-full" /> : wrSkBalance != null ? formatRupiah(wrSkBalance) : "—"}
                hint={saldoLoading
                  ? "Memuat kapasitas…"
                  : wrSkBalance == null
                    ? "Muat ulang untuk cek saldo."
                    : <>
                        {balance?.capacity && <><span>~{balance.capacity.estimatedOrders} order</span> · {formatRupiah(balance.capacity.avgOrderCost)}/order</>}
                        {balance?.current?.isLow && <span className="block">Di bawah batas {formatRupiah(balance.current.threshold)}</span>}
                      </>}
                tone={balance?.current?.isLow ? "warning" : "secondary"}
              />
              <StatCard
                label="Varian aktif"
                value={logsLoading ? <Skeleton className="h-8 w-20" /> : (wrSkCounts ? wrSkCounts.active_variants : "—")}
                hint={wrSkCounts ? `${wrSkCounts.mapped_variants} dipetakan · ${wrSkCounts.total_variants} di katalog` : undefined}
              />
              <StatCard
                label="Keluarga produk"
                value={logsLoading ? <Skeleton className="h-8 w-20" /> : (wrSkCounts ? wrSkCounts.families : "—")}
              />
              <StatCard
                label="Sinkron terakhir"
                value={logsLoading ? <Skeleton className="h-7 w-28 max-w-full" /> : syncCompactValue(logs, diffStatus)}
                hint={logsLoading ? "Memuat status sinkron…" : undefined}
              />
            </>
          ) : (
            <>
              <StatCard label="Saldo" value={supplierMoney(currency, balance?.balance ?? balance?.balance_usdt, true)} hint={balance?.username ? `akun ${balance.username}` : undefined} />
              <StatCard label="Varian aktif" value={catalog ? active : "—"} hint={catalog ? `${mapped} dipetakan · ${items.length} di katalog` : undefined} />
              <StatCard label="Keluarga produk" value={catalog ? allFamilies.size : "—"} />
              <StatCard label="Sinkron terakhir" value={supplierTime(catalog?.last_sync_at) ?? (catalog ? "Belum pernah" : "—")} />
            </>
          )}
        </div>
        {(isWrSk ? syncMeta?.configured !== undefined : catalog != null) && (
          <div className="flex flex-wrap gap-2" aria-label={`Status ${name}`}>
            {!configured && <Badge variant="warning">Belum dikonfigurasi</Badge>}
            <Badge variant={dispatchEnabled ? "secondary" : "warning"}>Pengiriman otomatis {dispatchEnabled ? "aktif" : "nonaktif"}</Badge>
            <Badge variant={syncEnabled ? "secondary" : "warning"}>Sinkron otomatis {syncEnabled ? "aktif" : "nonaktif"}</Badge>
          </div>
        )}
        {isWrSk ? (
          <Card>
            <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <SupplierSyncStatus logs={logs} diff={diffStatus} excludedLabel={config.excludedLabel ?? "excluded"} loading={logsLoading} />
              </div>
              <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" onClick={() => void runWrSkSync()} disabled={locked || syncDisabled}>
                {busy === "sync" ? <Spinner size={13} /> : <RefreshCw />}
                {busy === "sync" ? "Menyinkronkan…" : "Sinkron sekarang"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          catalog?.last_error && <p role="alert" className="break-words text-sm text-admin-danger">Sinkron gagal{lastErrorAt ? ` (${lastErrorAt})` : ""}. Coba sinkronkan kembali dari tab Alat.</p>
        )}
      </TabsContent>

      <TabsContent value="antrean" className="mt-4">
        <SupplierOrderQueue
          supplier={supplier}
          links={links}
          config={config}
          labels={orderLabels}
          locked={locked}
          loading={isWrSk ? wrSkOrdersLoading : loading}
          orderQuery={orderQuery}
          onOrderQueryChange={setOrderQuery}
          orderStatus={orderStatus}
          onOrderStatusChange={value => { setOrderStatus(value); setOrderPage(1); }}
          orderPage={orderPage}
          orderTotal={orderTotal}
          orderPerPage={WR_SK_ORDER_PER_PAGE}
          onPageChange={page => void loadWrSkOrders(page)}
          busyOrderAction={busyOrderAction}
          onAction={(link, action, trigger) => {
            if (isWrSk) {
              if (action === "retry" || action === "void") void runWrSkOrderAction(link, action);
              return;
            }
            if (action === "reveal") receiptTrigger.current = trigger;
            void mutateStandard(
              action === "reveal" ? "Receipt" : "Antrean",
              "orders",
              { id: link.id, action },
              action === "reconcile" ? "Status pesanan diperiksa." : "Pesanan diproses ulang.",
            );
          }}
        />
      </TabsContent>

      <TabsContent value="markup" className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Input className="min-h-11 min-w-0 flex-1 sm:max-w-sm md:min-h-0" value={query} onChange={event => { setQuery(event.target.value); setMarkupPage(1); }} placeholder="Cari varian…" aria-label="Cari varian" />
          <NativeSelect value={markupPerPage} onChange={event => { setMarkupPerPage(Number(event.target.value) as 20 | 50 | 100); setMarkupPage(1); }} aria-label="Jumlah per halaman" className="min-h-11 w-[110px] shrink-0 md:min-h-0">
            <option value={20}>20 / hal</option>
            <option value={50}>50 / hal</option>
            <option value={100}>100 / hal</option>
          </NativeSelect>
        </div>

        <Tabs value={markupTab} onValueChange={value => { markupTabTouched.current = true; setMarkupTab(value as MarkupSubTab); setMarkupPage(1); }}>
          <TabsList aria-label="Status tampil varian">
            {([
              ["live", `Live (${markupCounts.live})`],
              ["hidden", `Disembunyikan otomatis (${markupCounts.hidden})`],
              ["off", `Nonaktif manual (${markupCounts.off})`],
              ["all", `Semua (${partialMarkupLoad ? `${markupCounts.total} / ${wrSkMarkupTotal}` : markupCounts.total})`],
            ] as const).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        {partialMarkupLoad && (
          <p role="status" className="text-xs text-admin-warning">
            Menampilkan {wrSkMarkups.length} dari {wrSkMarkupTotal} varian. Gunakan pencarian untuk menyaring katalog lengkap.
          </p>
        )}

        {markupPagedIds.length > 0 && <BulkMarkupToolbar
          selectionOnly
          visibleIds={markupPagedIds}
          totalCount={markupFiltered.length}
          selected={bulkSelected}
          maxPercent={config.maxMarkup}
          allowDecimal={mode === "manual"}
          percentStep={config.percentStep}
          resetLabel={mode === "fixed" ? "reset Rp ke 0" : "reset harga manual ke rumus"}
          resetTitle={mode === "fixed" ? "Nolkan markup nominal." : "Hapus harga manual dari varian terpilih."}
          resetConfirmText={mode === "fixed" ? " + reset Rp ke 0" : " + reset harga manual ke rumus"}
          disabled={locked || wrSkMarkupLoading}
          confirmApply={message => new Promise<boolean>(resolve => setBulkConfirm({ message, resolve }))}
          onToggleOne={id => setBulkSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          onToggleAllVisible={checked => setBulkSelected(checked ? new Set(markupPagedIds) : new Set())}
          onClear={() => setBulkSelected(new Set())}
          onApply={applyBulkMarkup}
          onError={error => setActionError(error instanceof Error ? error.message : "Bulk markup gagal.")}
        />}

        {isWrSk && wrSkMarkupLoading && wrSkMarkups.length === 0 && (
          <p role="status" className="text-sm text-admin-muted">Memuat varian {name}…</p>
        )}
        {(isWrSk ? (!wrSkMarkupLoading && !items.length) : (catalog != null && !items.length && !buff?.variants.length)) && (
          <p className="text-sm text-admin-muted">{isWrSk ? `Belum ada varian ${supplier === "warung" ? "WR" : "SK"} tersinkron.` : "Sinkronkan katalog dari tab Alat untuk memulai."}</p>
        )}
        {(items.length > 0 || Boolean(buff?.variants.length)) && markupPaged.length === 0 && (
          <p className="text-sm text-admin-muted">{needle ? "Tidak ada varian yang cocok." : "Tidak ada varian pada tab ini."}</p>
        )}

        {pagedGroups.groups.map(group => <FamilyCard key={group.key} title={group.name}
          description={`${group.items.length} varian`}
          archived={group.archived} parentInactive={group.inactive} mode={mode} selectable>
          {group.items.map(item => {
            if (isWrSk) {
              const canEdit = item.product_archived !== 1;
              const stockText = item.stock === -1 ? "∞" : String(item.stock);
              const extraReason = item.variantStatus === "hidden_loser" && item.variantReason ? ` · ${item.variantReason}` : "";
              return priceRow({
                key: `${supplier}-${item.id}`,
                id: `${supplier}-${item.id}`,
                bulkId: item.bulkId,
                path: `markup/${item.id}`,
                title: item.label,
                selectLabel: item.name || item.label,
                meta: <>
                  Modal {formatRupiah(Number(item.cost ?? 0))} · stok {stockText}
                  {supplier === "sekalipay" && item.sk_min_order && Number(item.sk_min_order) > 1 ? ` · Min. ${item.sk_min_order}` : ""}
                  {supplier === "sekalipay" && item.sk_status ? ` · ${item.sk_status}` : ""}
                  {item.name && item.name !== item.label ? ` · ${item.name}` : ""}
                  {extraReason}
                </>,
                badges: <>
                  {supplier === "warung" ? <DeliveryBadge wrClass={item.wr_delivery_class} /> : <ProcessBadge process={item.sk_order_process} />}
                  <VariantStatusBadge status={item.variantStatus} reason={item.variantReason} />
                </>,
                markup: Number(item.markup_percent),
                manual: null,
                fixed: item.fixed,
                price: item.sellPrice,
                active: item.variantActive,
                canEdit,
                item,
              });
            }
            const canEdit = item.variant_id != null && item.product_archived !== 1;
            const { cost, fx, label } = item;
            const price = item.variant_price ?? item.manual ?? (cost != null && cost > 0 && fx != null && fx > 0 ? Math.ceil(cost * fx * (1 + item.markup_percent / 100) / 100) * 100 : null);
            return priceRow({
              key: `${supplier}-${item.id}`,
              id: `${supplier}-${item.id}`,
              bulkId: item.bulkId,
              path: `products/${encodeURIComponent(String(item.id))}`,
              title: label,
              meta: <>{item.name && item.name !== label ? `${item.name} · ` : ""}Modal {costWithIdr(supplierMoney(currency, cost), cost, fx)}{item.delivery_type === "muse_buff" ? " per 1 miliar token" : ""} · stok {item.stock === -1 ? "∞" : item.stock}
                {config.bulk && !!item.bulk_tiers_preview?.length && <span className="mt-1 block">Grosir: {item.bulk_tiers_preview.map(t => `${t.min_qty}+ ${formatRupiah(t.unit_price)}`).join(" · ")}</span>}
                {item.variantStatus === "hidden_loser" && item.variantReason ? ` · ${item.variantReason}` : ""}
              </>,
              badges: <>
                <VariantStatusBadge status={item.variantStatus} reason={item.variantReason} />
                {item.variant_id == null && item.variantStatus !== "hidden_nocatalog" ? <Badge variant="warning">Belum dipetakan</Badge> : config.bulk && canEdit
                  ? <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={locked} onClick={event => { setBulkError(""); setBulk({ item, trigger: event.currentTarget }); }}>Grosir</Button> : null}
              </>,
              details: config.disclosure && item.supplier_description?.trim() ? <SupplierDescription text={item.supplier_description} /> : undefined,
              markupPreview: config.bulk && item.bulk_markup_tiers?.length ? value => aivaultBulkMarkupPreview(item, value) : undefined,
              markup: Number(item.markup_percent),
              manual: item.manual,
              fixed: 0,
              price,
              active: item.variantActive,
              canEdit,
            });
          })}
        </FamilyCard>)}

        {config.buff && pagedGroups.buffRows.length > 0 && <FamilyCard title="Buff Token Muse" archived={buff?.muse_product?.archived === 1}
          parentInactive={buff?.muse_product?.is_active === 0} mode="manual" selectable description={buff?.probe
            ? <>Modal terverifikasi {supplierMoney("USDT", buff.probe.cost_per_b_usdt)}/1B · layanan <span className={buff.probe.fundable ? "text-admin-success" : "text-admin-warning"}>{buff.probe.fundable ? "bisa diproses" : "sementara tidak bisa"}</span></>
            : <span className="text-admin-warning">Probe tidak tersedia; harga memakai snapshot terakhir.</span>}>
          {pagedGroups.buffRows.map(({ variant, status, reason }) => priceRow({
            key: `buff-${variant.sku}`,
            id: `buff-${variant.sku}`,
            bulkId: variant.sku,
            path: `buff/${encodeURIComponent(variant.sku)}`,
            title: variant.label,
            meta: <>Per {variant.tunvn_buff_quantity_b} miliar token · modal {costWithIdr(supplierMoney("USDT", variant.tunvn_cost_usdt), variant.tunvn_cost_usdt, variant.tunvn_fx_idr_per_usdt)}{status === "hidden_loser" && reason ? ` · ${reason}` : ""}</>,
            badges: <VariantStatusBadge status={status} reason={reason} />,
            markup: Number(variant.tunvn_markup_percent ?? TUNVN_BUFF_MARKUP_PERCENT),
            manual: variant.tunvn_admin_price_idr,
            fixed: 0,
            price: variant.price,
            active: variant.is_active === 1,
            canEdit: buff?.muse_product?.archived !== 1,
          }))}
        </FamilyCard>}

        {markupFiltered.length > markupPerPage && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">Hal {markupSafePage} dari {markupTotalPages} · {markupFiltered.length} varian</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={markupSafePage <= 1} onClick={() => setMarkupPage(p => Math.max(1, p - 1))}><ChevronLeft /> Sebelumnya</Button>
              <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={markupSafePage >= markupTotalPages} onClick={() => setMarkupPage(p => Math.min(markupTotalPages, p + 1))}>Berikutnya <ChevronRight /></Button>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="alat" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Sinkron katalog</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <p className="text-sm leading-5 text-admin-muted">
              {supplier === "warung"
                ? "Perbarui katalog dan harga jual. Produk baru aktif otomatis."
                : supplier === "sekalipay"
                  ? "Perbarui katalog Aplikasi Premium dan harga jual. Varian AUTO baru aktif otomatis."
                  : "Perbarui katalog dan harga jual. Produk dan varian baru tetap nonaktif."}
            </p>
            <Button className="min-h-11 md:min-h-0" disabled={locked || syncDisabled}
              onClick={() => isWrSk ? void runWrSkSync() : void mutateStandard("Sinkron", "publish", {}, "Sinkron katalog selesai.")}>
              <Zap aria-hidden="true" />{(busy === "publish" || busy === "sync") ? "Menyinkronkan…" : "Sinkronkan katalog"}
            </Button>
            {syncDisabled && <p className="text-xs text-admin-muted">{configured ? "Sinkronisasi dinonaktifkan." : `${name} belum dikonfigurasi.`}</p>}
          </CardContent>
        </Card>

        {config.exclusions && (
          <Card className="overflow-hidden">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">Pengecualian katalog</CardTitle>
              <CardDescription className="mt-1 text-xs">Produk yang cocok dengan pola dilewati saat sinkronisasi.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {exclusions.length === 0 ? <p className="text-sm text-admin-muted">Belum ada pengecualian.</p> : (
                <div className="rounded-md border border-admin-border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Pola</TableHead><TableHead>Alasan</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {exclusions.map(rule => <TableRow key={rule.id}>
                        <TableCell className="font-mono text-xs text-admin-fg">{rule.pattern}</TableCell>
                        <TableCell className="text-xs text-admin-muted">{rule.reason ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button variant="ghost" size="icon" className="min-h-11 min-w-11 text-admin-danger md:min-h-0 md:min-w-0" disabled={locked}
                              title="Hapus exclusion" onClick={() => setExclusionToDelete(rule)} aria-label={`Hapus exclusion ${rule.pattern}`}><Trash2 /></Button>
                          </div>
                        </TableCell>
                      </TableRow>)}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder={config.exclusionsPlaceholder}
                  aria-label="Pola exclusion baru" className="min-w-0 flex-1" />
                <Button disabled={locked} onClick={() => void addExclusion()}><Plus /> Tambah</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {config.sandbox && (
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">Uji pesanan sandbox</CardTitle>
              <CardDescription className="mt-1 text-xs">Gunakan ID produk dan varian dari SK. Saldo tidak terpotong.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={sandboxProduct} onChange={e => setSandboxProduct(e.target.value)} placeholder="product_id" inputMode="numeric" aria-label="product_id sandbox" className="w-32" />
                <Input value={sandboxVariant} onChange={e => setSandboxVariant(e.target.value)} placeholder="variant_id" inputMode="numeric" aria-label="variant_id sandbox" className="w-32" />
                <Button className="min-h-11 md:min-h-0" onClick={() => void runSandbox()} disabled={locked}>
                  {busy === "sandbox" ? <Spinner size={13} /> : null}
                  {busy === "sandbox" ? "Mengirim…" : "Kirim sandbox"}
                </Button>
              </div>
              {sandboxResult && <p className="break-all font-mono text-xs text-admin-muted">{sandboxResult}</p>}
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </SupplierTabs>

    <Dialog open={receipt !== null} onOpenChange={open => { if (!open) setReceipt(null); }}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); receiptTrigger.current?.focus(); receiptTrigger.current = null; }}>
        <DialogHeader><DialogTitle>Receipt {name}</DialogTitle><DialogDescription>Data privat untuk pemeriksaan admin.</DialogDescription></DialogHeader>
        <pre className="min-w-0 whitespace-pre-wrap break-all rounded-lg border border-admin-border bg-admin-subtle p-3 text-xs text-admin-muted">{receipt}</pre>
      </DialogContent>
    </Dialog>

    {bulk && <BulkMarkupDialog item={bulk.item} trigger={bulk.trigger} busy={locked} failure={bulkError} onClose={() => setBulk(null)}
      onSave={tiers => mutateStandard("Markup", `products/${encodeURIComponent(String(bulk.item.id))}`, { bulk_markup_tiers: tiers }, `Harga grosir ${bulk.item.label} disimpan.`, { patch: true, bulk: true })} />}

    {exclusionToDelete && <AsyncConfirmDialog title={`Hapus aturan ${name}?`} description={`Exclusion “${exclusionToDelete.pattern}” tidak lagi berlaku saat sinkronisasi.`}
      onClose={() => setExclusionToDelete(null)} onConfirm={() => deleteExclusion(exclusionToDelete.id)} />}

    <ConfirmDialog
      open={bulkConfirm !== null}
      title="Terapkan bulk markup?"
      description={bulkConfirm?.message ?? ""}
      variant="default"
      confirmLabel="Terapkan markup"
      cancelLabel="Batal"
      onClose={() => { bulkConfirm?.resolve(false); setBulkConfirm(null); }}
      onConfirm={() => { bulkConfirm?.resolve(true); setBulkConfirm(null); }}
    />
  </div>;
}
