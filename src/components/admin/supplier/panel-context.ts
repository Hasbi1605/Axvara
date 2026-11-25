import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import type { SupplierTabId } from "../SupplierTabs";
import type { SupplierPriceSave } from "../SupplierPriceRow";
import { supplierOrderError } from "../SupplierOrderQueue";
import type { SupplierDiffStatus, SupplierSyncLogRow } from "../SupplierSyncStatus";
import {
  SUPPLIERS, catalogItems, inferVariantStatus, mapSupplierError, supplierRequest, supplierTime,
  SupplierRequestError, type Balance, type BuffData, type Catalog, type CatalogItem, type ExclusionRow,
  type OrderLink, type Supplier, type SyncLogCounts,
} from "../supplier-admin-data";

export type MarkupSubTab = "live" | "hidden" | "off" | "all";
const WR_SK_ORDER_PER_PAGE = 20;

export function useSupplierPanel(supplier: Supplier) {
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
  const markupPagedIds = useMemo(() => markupPaged.flatMap(e => e.kind === "item" && e.item.pixel_observed_state ? [] : [e.bulkId]), [markupPaged]);

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

  return {
    supplier, config, isWrSk, name, currency, mode, locked, busy, loading, catalog, balance, items,
    saldoLoading, wrSkBalance, logsLoading, wrSkCounts, logs, diffStatus, active, mapped, allFamilies, syncMeta,
    configured, dispatchEnabled, syncEnabled, syncDisabled, runWrSkSync, lastErrorAt,
    links, orderLabels, wrSkOrdersLoading, orderQuery, setOrderQuery, orderStatus, setOrderStatus, setOrderPage,
    orderPage, orderTotal, loadWrSkOrders, busyOrderAction, runWrSkOrderAction, receiptTrigger, mutateStandard,
    orderPerPage: WR_SK_ORDER_PER_PAGE,
    query, setQuery, setMarkupPage, markupPerPage, setMarkupPerPage, markupTab, markupTabTouched, setMarkupTab,
    markupCounts, partialMarkupLoad, wrSkMarkupTotal, markupPagedIds, markupFiltered, bulkSelected,
    wrSkMarkupLoading, setBulkConfirm, setBulkSelected, applyBulkMarkup, setActionError, wrSkMarkups, buff,
    markupPaged, needle, pagedGroups, setBulk, setBulkError, markupTotalPages, markupSafePage, saveWrSkMarkup,
    exclusions, setExclusionToDelete, newPattern, setNewPattern, addExclusion, sandboxProduct, setSandboxProduct,
    sandboxVariant, setSandboxVariant, runSandbox, sandboxResult,
    tab, openTab, refreshActive, loadErrors, actionError, success, receipt, setReceipt, bulk, bulkError,
    exclusionToDelete, deleteExclusion, bulkConfirm,
  };
}

export const SupplierPanelContext = createContext<ReturnType<typeof useSupplierPanel> | null>(null);

export function useSupplierPanelContext() {
  const panel = useContext(SupplierPanelContext);
  if (!panel) throw new Error("Missing SupplierPanelContext");
  return panel;
}
