import { formatWibDateTime } from "@/lib/utils";
import { isTunvnExcludedProduct, tunvnFallbackFamily, tunvnFamilyForSupplierId } from "@/lib/tunvn/families";

type Currency = "USD" | "USDT";
type Family = { key: string; name: string; slug?: string; label?: string };
export type MarkupTier = { min_qty: number; markup_percent: number };

type Product = {
  id?: number; supplier_product_id?: number; service_id?: string; package_code?: string;
  name: string; stock: number; price_usd?: number; unit_price_usd?: number;
  cost_usdt?: number | null; price_usdt?: number | null;
  fx_idr_per_usd?: number | null; fx_idr_per_usdt?: number | null;
  markup_percent: number; admin_price_idr?: number | null;
  tunvn_admin_price_idr?: number | null; aivault_admin_price_idr?: number | null;
  variant_id: number | null; variant_price: number | null; variant_active?: number | null; variant_is_active?: number | null;
  product_active?: number | null; axvara_is_active?: number | null; product_archived?: number;
  product_name?: string | null; product_slug?: string | null; axvara_name?: string | null; axvara_slug?: string | null;
  label?: string | null; variant_label?: string | null; family?: Family | string | null; family_key?: string;
  excluded?: number; supplier_description?: string | null; delivery_type?: string;
  bulk_markup_tiers?: MarkupTier[] | null; bulk_tiers_preview?: { min_qty: number; unit_price: number }[];
};

export type Catalog = {
  configured: boolean; dispatch_enabled?: boolean; sync_enabled?: boolean;
  items: Product[]; last_sync_at?: string | number | null; last_error?: { at: string | null; error: string } | null;
};
export type Balance = { balance?: number; balance_usdt?: number; currency?: Currency; username?: string };
export type BuffData = {
  variants: {
    sku: string; label: string; price: number; is_active: number;
    tunvn_buff_quantity_b: number; tunvn_cost_usdt: number | null; tunvn_markup_percent: number | null;
    tunvn_fx_idr_per_usdt: number | null; tunvn_admin_price_idr: number | null;
  }[];
  probe: { cost_per_b_usdt: number; fundable: boolean } | null;
  muse_product: { is_active: number; archived?: number } | null;
};
export type OrderLink = {
  id: number; order_code: string; item_index?: number | null; quantity: number; kind?: string;
  source_product_id?: number | null; provider_batch_id?: string | null; storebat_product_id?: number;
  service_id?: string; package_code?: string; cost_usd?: number | null; cost_usdt?: number | null;
  status: string; last_error?: string | null; purchase_disabled?: number; can_retry?: number; has_receipt?: number;
  completed_at?: string | null; request_sent_at?: string | null; updated_at?: string | null; created_at?: string | null;
};

const configs = {
  aivault: { name: "AIVault", currency: "USD", itemId: "service_id", orderId: "service_id", bulk: true },
  tunvn: { name: "TUNVN", currency: "USDT", itemId: "supplier_product_id", orderId: "source_product_id", buff: true, disclosure: true },
  storebat: { name: "StoreBat", currency: "USD", itemId: "id", orderId: "storebat_product_id" },
  mirai: { name: "Mirai", currency: "USDT", itemId: "package_code", orderId: "package_code" },
} satisfies Record<string, {
  name: string; currency: Currency; itemId: keyof Product; orderId: keyof OrderLink;
  bulk?: boolean; buff?: boolean; disclosure?: boolean;
}>;
export type Supplier = keyof typeof configs;
export type SupplierConfig = {
  name: string; currency: Currency; itemId: "id" | "supplier_product_id" | "service_id" | "package_code";
  orderId: "source_product_id" | "service_id" | "storebat_product_id" | "package_code";
  bulk?: boolean; buff?: boolean; disclosure?: boolean;
};
export const SUPPLIERS: Record<Supplier, SupplierConfig> = configs;

export function catalogItems(rows: Product[], config: SupplierConfig) {
  return rows.flatMap(item => {
    const id = item[config.itemId] ?? (config.buff ? item.id : undefined);
    if (id == null || item.excluded === 1 || (config.buff && isTunvnExcludedProduct(Number(id)))) return [];
    const family: Family = typeof item.family === "object" && item.family != null ? item.family : (() => {
      const mapped = config.buff ? tunvnFamilyForSupplierId(Number(id)) : null;
      const fallback = tunvnFallbackFamily(Number(id), item.name);
      return { key: item.family_key ?? mapped?.family.key ?? fallback.key,
        name: mapped?.family.name ?? fallback.name, slug: mapped?.family.slug ?? fallback.slug, label: mapped?.member.label };
    })();
    return [{
      ...item, id, family,
      label: item.label ?? item.variant_label ?? family.label ?? item.name,
      productName: item.product_name ?? item.axvara_name,
      productSlug: item.product_slug ?? item.axvara_slug,
      productActive: (item.product_active ?? item.axvara_is_active) === 1,
      variantActive: (item.variant_active ?? item.variant_is_active) === 1,
      manual: item.admin_price_idr ?? item.aivault_admin_price_idr ?? item.tunvn_admin_price_idr ?? null,
      cost: config.currency === "USD" ? item.price_usd ?? item.unit_price_usd : item.cost_usdt ?? item.price_usdt,
      fx: config.currency === "USD" ? item.fx_idr_per_usd : item.fx_idr_per_usdt,
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
  return currency === "USD" ? (balance ? usdBalance : usdCost).format(value) : `${(balance ? usdtBalance : usdtCost).format(value)} USDT`;
}

export function supplierTime(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const epoch = Number(value);
  if (Number.isFinite(epoch) && Math.abs(epoch) > 8.64e15) return null;
  return formatWibDateTime(Number.isFinite(epoch) ? new Date(epoch).toISOString() : value,
    { year: "numeric", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const errorLabels: Record<string, string> = {
  not_configured: "Supplier belum dikonfigurasi atau sinkronisasi nonaktif.",
  claimed_elsewhere: "Sinkron sedang berjalan di proses lain.",
  throttled: "Sinkron baru saja berjalan. Tunggu sebentar lalu coba lagi.",
  unauthorized: "Sesi admin tidak tersedia. Masuk kembali.",
  balance_unavailable: "Saldo belum dapat dibaca.",
  fx_unavailable: "Kurs belum tersedia.",
  variant_missing: "Varian belum dipetakan. Jalankan sinkronisasi terlebih dahulu.",
  "Pulihkan dari Arsip dulu": "Pulihkan dari Arsip dulu.",
  save_failed_or_stale: "Data berubah atau gagal disimpan. Muat ulang lalu coba lagi.",
  no_safe_retry: "Pesanan ini tidak dapat dicoba ulang dengan aman.",
  no_safe_reconcile: "Tidak ada batch yang bisa diperiksa.",
  bulk_markup_not_below_base: "Markup tier harus lebih kecil dari markup dasar.",
  invalid_bulk_markup: "Tier harga grosir tidak valid. Periksa jumlah dan markup.",
};

export class SupplierRequestError extends Error {
  constructor(readonly status: number, readonly detail: string) { super(`HTTP ${status}: ${detail}`); }
}

export async function supplierRequest<T>(supplier: Supplier, path: string, init?: RequestInit, valid?: (body: T) => boolean): Promise<T> {
  const response = await fetch(`/api/admin/${supplier}/${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null);
  const reason = body?.skipped ?? body?.error;
  if (!response.ok || body?.ok === false || typeof reason === "string") {
    throw new SupplierRequestError(response.status, Object.hasOwn(errorLabels, reason) ? errorLabels[reason] : "Permintaan gagal.");
  }
  if (!body || typeof body !== "object" || (valid && !valid(body))) throw new SupplierRequestError(response.status, "Respons tidak valid.");
  return body as T;
}
