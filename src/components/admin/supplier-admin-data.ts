import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { isTunvnExcludedProduct, tunvnFallbackFamily, tunvnFamilyForSupplierId } from "@/lib/tunvn/families";

export type Currency = "IDR" | "USD" | "USDT";
export type VariantLiveStatus = "live" | "hidden_loser" | "hidden_nocatalog" | "hidden_soldout" | "off";
type Family = { key: string; name: string; slug?: string; label?: string };
export type MarkupTier = { min_qty: number; markup_percent: number };

type Product = {
  id?: number | string; supplier_product_id?: number | string; service_id?: string; package_code?: string;
  wr_variant_id?: string; sk_variant_id?: string; wr_product_id?: string; sk_product_id?: string;
  wr_variant_name?: string; sk_variant_name?: string; wr_product_name?: string | null; sk_product_name?: string | null;
  wr_price?: number; sk_price?: number; wr_stock?: number; sk_stock?: number;
  wr_delivery_class?: string | null; sk_order_process?: string | null; sk_min_order?: number | null; sk_status?: string | null;
  wr_is_active?: number | null; sk_is_active?: number | null;
  name?: string; stock?: number; price_usd?: number; unit_price_usd?: number;
  cost_usdt?: number | null; price_usdt?: number | null;
  fx_idr_per_usd?: number | null; fx_idr_per_usdt?: number | null;
  markup_percent: number; markup_fixed?: number; admin_price_idr?: number | null;
  tunvn_admin_price_idr?: number | null; aivault_admin_price_idr?: number | null;
  axvara_sell_price?: number | null; current_price?: number | null;
  variant_id?: number | null; axvara_variant_id?: number | null;
  axvara_product_id?: number | null; wp_axvara_product_id?: number | null; sp_axvara_product_id?: number | null; pv_product_id?: number | null;
  variant_price?: number | null; variant_active?: number | null; variant_is_active?: number | null; pv_is_active?: number | null;
  product_active?: number | null; axvara_is_active?: number | null; p_is_active?: number | null; product_archived?: number;
  product_name?: string | null; product_slug?: string | null; axvara_name?: string | null; axvara_slug?: string | null;
  label?: string | null; variant_label?: string | null; family?: Family | string | null; family_key?: string;
  excluded?: number; supplier_description?: string | null; delivery_type?: string;
  variant_status?: VariantLiveStatus | string; variant_reason?: string;
  bulk_markup_tiers?: MarkupTier[] | null; bulk_tiers_preview?: { min_qty: number; unit_price: number }[];
};

export type Catalog = {
  configured: boolean; dispatch_enabled?: boolean; sync_enabled?: boolean;
  items: Product[]; last_sync_at?: string | number | null; last_error?: { at: string | null; error: string } | null;
};
export type Balance = {
  balance?: number; balance_usdt?: number; currency?: Currency; username?: string;
  current?: { balance: number; currency?: string; isLow: boolean; threshold: number };
  capacity?: { balance: number; avgOrderCost: number; estimatedOrders: number };
  history?: { balance: number; source?: string; note?: string | null; created_at: string }[];
  stale?: boolean; stale_reason?: string | null;
};
export type SyncLogCounts = {
  active_variants: number; mapped_variants: number; total_variants: number; families: number;
};
export type BuffData = {
  variants: {
    sku: string; label: string; price: number; is_active: number;
    tunvn_buff_quantity_b: number; tunvn_cost_usdt: number | null; tunvn_markup_percent: number | null;
    tunvn_fx_idr_per_usdt: number | null; tunvn_admin_price_idr: number | null;
    variant_status?: VariantLiveStatus | string; variant_reason?: string;
  }[];
  probe: { cost_per_b_usdt: number; fundable: boolean } | null;
  muse_product: { is_active: number; archived?: number } | null;
};
export type OrderLink = {
  id: number; order_code: string; item_index?: number | null; quantity: number; kind?: string;
  source_product_id?: number | null; provider_batch_id?: string | null; storebat_product_id?: number;
  service_id?: string; package_code?: string; cost_usd?: number | null; cost_usdt?: number | null;
  wr_order_id?: string | null; sk_invoice?: string | null;
  wr_cost?: number | null; sk_cost?: number | null;
  wr_variant_name?: string | null; wr_product_name?: string | null;
  sk_variant_name?: string | null; sk_product_name?: string | null;
  attempt_count?: number; max_attempts?: number;
  status: string; last_error?: string | null; order_status?: string | null; order_payment_status?: string | null;
  customer_name?: string | null; customer_wa?: string | null; customer_email?: string | null; sales_channel?: string | null;
  purchase_disabled?: number; can_retry?: number; has_receipt?: number; resolved_manually?: boolean;
  completed_at?: string | null; request_sent_at?: string | null; updated_at?: string | null; created_at?: string | null;
};
export type ExclusionRow = { id: number; pattern: string; reason: string | null; created_at?: string };

const configs = {
  warung: {
    name: "Warung Rebahan",
    currency: "IDR" as const, mode: "fixed" as const, itemId: "wr_variant_id" as const, orderId: "wr_order_id" as const,
    lazy: true, syncPath: "sync", excludedLabel: "excluded", exclusions: true,
    exclusionsPlaceholder: "Mis. canva",
    searchPlaceholder: "Cari invoice WR / kode Axvara…", searchLabel: "Cari invoice WR atau kode Axvara",
    statusFilterLabel: "Filter status order WR", maxMarkup: 500, percentStep: 1,
  },
  sekalipay: {
    name: "Sekalipay",
    currency: "IDR" as const, mode: "fixed" as const, itemId: "sk_variant_id" as const, orderId: "sk_invoice" as const,
    lazy: true, syncPath: "sync", excludedLabel: "non-auto", exclusions: true, sandbox: true,
    exclusionsPlaceholder: "Mis. pulsa",
    searchPlaceholder: "Cari invoice SK / kode Axvara…", searchLabel: "Cari invoice SK atau kode Axvara",
    statusFilterLabel: "Filter status order SK", maxMarkup: 500, percentStep: 1,
  },
  aivault: {
    name: "AIVault",
    currency: "USD" as const, mode: "manual" as const, itemId: "service_id" as const, orderId: "service_id" as const,
    bulk: true, syncPath: "publish", maxMarkup: 1000, percentStep: 0.5,
  },
  tunvn: {
    name: "TUNVN",
    currency: "USDT" as const, mode: "manual" as const, itemId: "supplier_product_id" as const, orderId: "source_product_id" as const,
    buff: true, disclosure: true, syncPath: "publish", maxMarkup: 1000, percentStep: 0.5,
  },
  storebat: {
    name: "StoreBat",
    currency: "USD" as const, mode: "manual" as const, itemId: "id" as const, orderId: "storebat_product_id" as const,
    syncPath: "publish", maxMarkup: 1000, percentStep: 0.5,
  },
  mirai: {
    name: "Mirai",
    currency: "USDT" as const, mode: "manual" as const, itemId: "package_code" as const, orderId: "package_code" as const,
    syncPath: "publish", maxMarkup: 1000, percentStep: 0.5,
  },
};

export type Supplier = keyof typeof configs;
export type SupplierConfig = {
  name: string;
  currency: Currency; mode: "fixed" | "manual";
  itemId: "id" | "supplier_product_id" | "service_id" | "package_code" | "wr_variant_id" | "sk_variant_id";
  orderId: "source_product_id" | "service_id" | "storebat_product_id" | "package_code" | "wr_order_id" | "sk_invoice";
  lazy?: boolean; syncPath: string; excludedLabel?: string; exclusions?: boolean; sandbox?: boolean;
  exclusionsPlaceholder?: string;
  searchPlaceholder?: string; searchLabel?: string; statusFilterLabel?: string;
  maxMarkup: number; percentStep: number;
  bulk?: boolean; buff?: boolean; disclosure?: boolean;
};
export const SUPPLIERS: Record<Supplier, SupplierConfig> = configs;

export function inferVariantStatus(item: {
  variant_status?: string; variant_reason?: string;
  variantActive: boolean; productActive: boolean; product_archived?: number;
  variant_id: number | null; stock: number; minQty?: number;
}): { status: VariantLiveStatus; reason: string } {
  const known = item.variant_status;
  if (known === "live" || known === "hidden_loser" || known === "hidden_nocatalog" || known === "hidden_soldout" || known === "off") {
    return { status: known, reason: item.variant_reason || (known === "live" ? "Tampil di storefront" : "") };
  }
  if (item.product_archived === 1) return { status: "off", reason: "Produk diarsipkan" };
  if (!item.variantActive || !item.productActive) return { status: "off", reason: "Nonaktif manual" };
  if (item.variant_id == null) return { status: "hidden_nocatalog", reason: "Tanpa pasangan katalog — tidak tampil" };
  const minQty = Math.max(1, Number(item.minQty ?? 1) || 1);
  if (!(item.stock === -1 || item.stock >= minQty)) return { status: "hidden_soldout", reason: "Stok habis · restok otomatis tampil" };
  return { status: "live", reason: "Tampil di storefront" };
}

export function catalogItems(rows: Product[], config: SupplierConfig) {
  return rows.flatMap(item => {
    const id = item[config.itemId] ?? (config.buff ? item.id : undefined);
    if (id == null || item.excluded === 1 || (config.buff && isTunvnExcludedProduct(Number(id)))) return [];
    const isFixed = config.mode === "fixed";
    const axPid = item.axvara_product_id ?? item.wp_axvara_product_id ?? item.sp_axvara_product_id ?? item.pv_product_id;
    const supPid = item.supplier_product_id ?? item.wr_product_id ?? item.sk_product_id;
    const rawProductName = item.product_name ?? item.axvara_name ?? item.wr_product_name ?? item.sk_product_name ?? null;
    const family: Family = isFixed ? {
      key: axPid != null ? `axvara:${axPid}` : supPid != null ? `supplier:${supPid}` : `name:${rawProductName ?? id}`,
      name: rawProductName || "Lainnya",
      slug: item.product_slug ?? item.axvara_slug ?? undefined,
    } : typeof item.family === "object" && item.family != null ? item.family : (() => {
      const mapped = config.buff ? tunvnFamilyForSupplierId(Number(id)) : null;
      const fallback = tunvnFallbackFamily(Number(id), item.name ?? String(id));
      return { key: item.family_key ?? mapped?.family.key ?? fallback.key,
        name: mapped?.family.name ?? fallback.name, slug: mapped?.family.slug ?? fallback.slug, label: mapped?.member.label };
    })();
    const rawVariantName = item.wr_variant_name ?? item.sk_variant_name ?? item.name ?? String(id);
    const label = item.variant_label ?? item.label ?? family.label ?? rawVariantName;
    const variantId = item.variant_id ?? item.axvara_variant_id ?? null;
    const productActive = (item.product_active ?? item.axvara_is_active ?? item.p_is_active ?? 1) === 1;
    const variantActive = (item.variant_active ?? item.variant_is_active ?? item.pv_is_active ?? 1) === 1
      && (item.wr_is_active == null || item.wr_is_active === 1)
      && (item.sk_is_active == null || item.sk_is_active === 1);
    const stock = Number(item.stock ?? item.wr_stock ?? item.sk_stock ?? 0);
    const minQty = Number(item.sk_min_order ?? 1);
    const live = inferVariantStatus({
      variant_status: item.variant_status, variant_reason: item.variant_reason,
      variantActive, productActive, product_archived: item.product_archived,
      variant_id: variantId, stock, minQty,
    });
    return [{
      ...item,
      id,
      bulkId: String(id),
      name: rawVariantName,
      stock,
      family,
      label,
      variant_id: variantId,
      productName: item.product_name ?? item.axvara_name ?? item.wr_product_name ?? item.sk_product_name ?? null,
      productSlug: item.product_slug ?? item.axvara_slug ?? null,
      productActive,
      variantActive,
      manual: isFixed ? null : (item.admin_price_idr ?? item.aivault_admin_price_idr ?? item.tunvn_admin_price_idr ?? null),
      fixed: Number(item.markup_fixed ?? 0),
      sellPrice: item.axvara_sell_price ?? item.variant_price ?? null,
      cost: config.currency === "IDR" ? Number(item.wr_price ?? item.sk_price ?? 0)
        : config.currency === "USD" ? (item.price_usd ?? item.unit_price_usd)
        : (item.cost_usdt ?? item.price_usdt),
      fx: config.currency === "USD" ? item.fx_idr_per_usd : item.fx_idr_per_usdt,
      variantStatus: live.status,
      variantReason: live.reason,
    }];
  });
}
export type CatalogItem = ReturnType<typeof catalogItems>[number];

const usdCost = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const usdBalance = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdtCost = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const usdtBalance = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function supplierMoney(currency: Currency, value: number | null | undefined, balance = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency === "IDR") return formatRupiah(value);
  return currency === "USD" ? (balance ? usdBalance : usdCost).format(value) : `${(balance ? usdtBalance : usdtCost).format(value)} USDT`;
}

export function supplierTime(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const epoch = Number(value);
  if (Number.isFinite(epoch) && Math.abs(epoch) > 8.64e15) return null;
  return formatWibDateTime(Number.isFinite(epoch) ? new Date(epoch).toISOString() : value,
    { year: "numeric", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ageLabel(order: { request_sent_at?: string | null; created_at?: string | null; updated_at?: string | null }): { text: string; hours: number } | null {
  const raw = order.request_sent_at || order.created_at || order.updated_at;
  if (!raw) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const hours = minutes / 60;
  return { text: minutes < 60 ? `${minutes} mnt` : `${Math.floor(hours)} jam ${minutes % 60} mnt`, hours };
}

const errorLabels: Record<string, string> = {
  not_configured: "Supplier belum dikonfigurasi atau sinkronisasi nonaktif.",
  claimed_elsewhere: "Sinkron sedang berjalan di proses lain.",
  throttled: "Sinkron baru saja berjalan. Tunggu sebentar lalu coba lagi.",
  unauthorized: "Sesi admin tidak tersedia. Masuk kembali.",
  balance_unavailable: "Saldo belum dapat dibaca.",
  fx_unavailable: "Kurs belum tersedia.",
  variant_missing: "Varian belum dipetakan. Jalankan sinkronisasi terlebih dahulu.",
  variant_not_found: "Varian tidak ditemukan.",
  "Pulihkan dari Arsip dulu": "Pulihkan dari Arsip dulu.",
  save_failed_or_stale: "Data berubah atau gagal disimpan. Muat ulang lalu coba lagi.",
  no_safe_retry: "Pesanan ini tidak dapat dicoba ulang dengan aman.",
  no_safe_reconcile: "Tidak ada batch yang bisa diperiksa.",
  bulk_markup_not_below_base: "Markup tier harus lebih kecil dari markup dasar.",
  invalid_bulk_markup: "Tier harga grosir tidak valid. Periksa jumlah dan markup.",
  warung_rebahan_disabled: "Pengiriman otomatis Warung Rebahan sedang nonaktif.",
  sekalipay_disabled: "Pengiriman otomatis Sekalipay sedang nonaktif.",
  reconciliation_required: "Permintaan sudah dikirim ke Sekalipay. Gunakan rekonsiliasi, bukan retry pembelian.",
  not_retryable: "Pesanan tidak dapat di-retry (dibatalkan, belum lunas, atau sudah dikirim).",
  max_attempts_reached: "Batas percobaan retry sudah habis.",
  retry_race_lost: "Status pesanan berubah di proses lain. Muat ulang untuk memeriksa.",
  not_voidable: "Pesanan sudah selesai atau tidak dapat dibatalkan.",
  void_race_lost: "Status pesanan berubah saat membatalkan. Muat ulang untuk memeriksa.",
  pattern_exists: "Pola exclusion sudah ada.",
  invalid_product_variant: "product_id atau variant_id SK tidak valid.",
  rate_limited: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
};

export function mapSupplierError(reason: unknown, fallback = "Permintaan gagal."): string {
  if (typeof reason === "string" && Object.hasOwn(errorLabels, reason)) return errorLabels[reason];
  if (typeof reason === "string" && reason.trim()) return reason;
  return fallback;
}

export class SupplierRequestError extends Error {
  constructor(readonly status: number, readonly detail: string, readonly rawReason?: string) { super(`HTTP ${status}: ${detail}`); }
}

export async function supplierRequest<T>(supplier: Supplier, path: string, init?: RequestInit, valid?: (body: T) => boolean): Promise<T> {
  const response = await fetch(`/api/admin/${supplier}/${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  const reason = body?.skipped ?? body?.error;
  if (!response.ok || body?.ok === false || typeof reason === "string") {
    throw new SupplierRequestError(response.status, mapSupplierError(reason), typeof reason === "string" ? reason : undefined);
  }
  if (!body || typeof body !== "object" || (valid && !valid(body))) throw new SupplierRequestError(response.status, "Respons tidak valid.");
  return body as T;
}
