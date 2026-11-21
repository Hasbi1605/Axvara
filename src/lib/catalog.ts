import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";
// src/lib/catalog.ts — Shared catalog service for all channels
// Single source of truth for product + variant queries.
// Web, Telegram, and WhatsApp all use these same functions.

import { queryAll, queryFirst, isD1Mode } from "@/lib/db";
import { bulkOwnerFromJoinedRow, isManualProductForBulk, validateBulkPricing, type BulkTier } from "@/lib/bulk-pricing";
import type { Locale } from "@/lib/i18n/locale";
import { translateVariantLabel } from "@/lib/i18n/variant-copy";
import { hasAutomaticSupplierDelivery } from "@/lib/buyer-fields";
import { isQueuedFulfillment } from "@/lib/warung-rebahan/delivery-class";
import { displaySoldCountSql, notLoserProductSql } from "@/lib/product-groups";
import { purchasableStockSql } from "@/lib/catalog-availability";
import { deriveSkDuration, durationFromSupplierText, labelContainsDuration } from "@/lib/catalog-duration";
export { effectiveVariantStock } from "@/lib/catalog-availability";
export { durationFromSupplierText } from "@/lib/catalog-duration";

// ---- Types ----

export type VariantSummary = {
  id: number;
  product_id: number;
  sku: string;
  label: string;
  duration_value: number | null;
  duration_unit: string | null;
  duration_label: string | null;
  warranty_type: string;
  warranty_value: number | null;
  warranty_unit: string | null;
  warranty_label: string | null;
  /** S&K per varian dari WR (read-only, milik sync — lihat ownership.ts). */
  terms: string | null;
  /** Cara aktivasi/pengiriman dari WR (read-only, null bila WR tidak memberi). */
  delivery_terms: string | null;
  /**
   * S&K + cara aktivasi versi admin (migrasi 0041, milik admin, sync tidak
   * pernah menulis). Hanya dibaca resolver server (product-copy/resolve.ts)
   * dan dikosongkan sebelum dikirim ke storefront.
   */
  admin_terms?: string | null;
  admin_activation?: string | null;
  admin_terms_en?: string | null;
  admin_activation_en?: string | null;
  admin_copy_fingerprint?: string | null;
  /**
   * Kelas pengiriman WR (migrasi 0032): 'restock' (auto) | 'made_by_order'
   * (manual slow) | null (belum dikunci). Label pembeli:
   * restock = "Kirim otomatis", selainnya = "Dikirim admin".
   */
  wr_delivery_class: string | null;
  /** Penanda varian milik sync WR (null/0 = produk non-WR milik admin). */
  wr_variant_id?: string | null;
  wr_auto_managed?: number;
  /** Tipe WR mentah (Invite/Link/Private/Sharing/...) — penentu email wajib. */
  wr_type: string | null;
  /**
   * Penanda varian milik sync SK (null = bukan produk SK). Cermin wr_variant_id.
   * SK auto = lisensi langsung dari stok SK (kelas pembeli: instan).
   * SK manual/h2h/smm (fase 2+) = antrean seperti MBO.
   */
  sk_variant_id?: string | null;
  sk_auto_managed?: number;
  /** order_process SK mentah (auto/manual/h2h/smm/vip) — dari sk_products. */
  sk_order_process?: string | null;
  /** Deskripsi mentah SK dari sk_products (server-only; dihapus oleh withVariantCopy). */
  sk_description?: string | null;
  /** Durasi SK turunan saat kolom duration_* kosong (server-only). */
  sk_duration?: string | null;
  /** Toggle email wajib per produk (migrasi 0033, untuk non-WR). */
  require_email: number;
  price: number;
  bulk_pricing_enabled?: boolean;
  bulk_pricing_tiers?: BulkTier[];
  bulk_pricing_invalid?: boolean;
  compare_price: number | null;
  stock: number;
  /**
   * Unit kredensial TERSISA untuk varian unique (2026-10-02): COUNT inventory
   * `available` milik varian ini (tanpa pool legacy bersama). null = bukan
   * varian unique / tidak dihitung (hindari query N+1 di daftar). PDP + quote
   * memakai `effectiveVariantStock()` dari catalog-availability agar "Sisa" jujur —
   * insiden Head 18 Bulan: stock=2 tapi available=1.
   */
  inventory_available?: number | null;
  /**
   * Minimum pembelian per baris (migrasi 0034, milik admin, default 1).
   * GSuite dikunci 50; produk lain tinggal set angka dari admin bila butuh.
   * Sync WR tidak pernah menulis kolom ini.
   */
  min_qty: number;
  max_qty?: number | null;
  buyer_field_key?: "muse_invite_code" | null;
  automatic_delivery?: boolean;
  /**
   * Modal manual per unit dalam rupiah (migrasi 0058, milik admin, default 0).
   * Untuk produk manual/stok sendiri. Sync WR/SK tidak pernah menulis.
   * Opsional agar fixture/test lama tanpa field ini tetap valid.
   */
  manual_cost?: number;
  fulfillment_mode: string;
  is_active: number;
  sort_order: number;
};

export type ProductSummary = {
  id: number;
  slug: string;
  name: string;
  nameEn: string | null;
  whatsappAlias: string | null;
  aliases: string[];
  image: string | null;
  badge: string | null;
  description: string | null;
  descriptionEn: string | null;
  minPrice: number;
  maxPrice: number;
  variantCount: number;
  availability: "available" | "out_of_stock";
  category_id: number | null;
};

export type ProductDetail = {
  id: number;
  slug: string;
  name: string;
  nameEn: string | null;
  whatsappAlias: string | null;
  aliases: string[];
  description: string | null;
  descriptionEn: string | null;
  long_description?: string | null;
  image: string | null;
  images: string | null;
  badge: string | null;
  sold_count: number | null;
  category_id: number | null;
  is_active: number;
  variants: VariantSummary[];
};

// ---- Feature flag helpers ----

export function isVariantsReadEnabled(): boolean {
  return process.env.PRODUCT_VARIANTS_READ === "true";
}

export function isVariantsWriteEnabled(): boolean {
  return process.env.PRODUCT_VARIANTS_WRITE === "true";
}

// ---- Product list (all channels) ----

export async function listActiveProducts(): Promise<ProductSummary[]> {
  if (!isD1Mode() || !isVariantsReadEnabled()) {
    return listActiveProductsLegacy();
  }

  const rows = await queryAll(`
    SELECT
      p.id, p.slug, p.name, p.name_en, p.whatsapp_alias, p.aliases, p.image_url, p.badge, p.description,
      p.admin_description_override, p.description_en, p.category_id,
      MIN(pv.price) as min_price,
      MAX(pv.price) as max_price,
      COUNT(pv.id) as variant_count,
      CASE WHEN SUM(CASE WHEN ${purchasableStockSql("pv")} THEN 1 ELSE 0 END) > 0 THEN 'available' ELSE 'out_of_stock' END as availability
    FROM products p
    INNER JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1 AND ${wrNewSaleSql("pv")}
    WHERE p.is_active = 1 AND ${notLoserProductSql("p")}
    GROUP BY p.id
    HAVING variant_count > 0
    ORDER BY p.sort_order ASC, p.name ASC
  `);

  return rows.map(r => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    nameEn: nullableText(r.name_en),
    whatsappAlias: nullableText(r.whatsapp_alias),
    aliases: parseAliases(r.aliases),
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: displayDescription(r),
    descriptionEn: displayDescriptionEn(r),
    minPrice: Number(r.min_price),
    maxPrice: Number(r.max_price),
    variantCount: Number(r.variant_count),
    availability: String(r.availability) as "available" | "out_of_stock",
    category_id: r.category_id ? Number(r.category_id) : null,
  }));
}

async function listActiveProductsLegacy(): Promise<ProductSummary[]> {
  const rows = await queryAll(
    `SELECT id, slug, name, name_en, whatsapp_alias, image_url, badge, description,
            admin_description_override, description_en, price, compare_price, stock, category_id
     FROM products WHERE is_active=1 ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(r => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    nameEn: nullableText(r.name_en),
    whatsappAlias: nullableText(r.whatsapp_alias),
    aliases: [],
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: displayDescription(r),
    descriptionEn: displayDescriptionEn(r),
    minPrice: Number(r.price),
    maxPrice: Number(r.price),
    variantCount: 1,
    availability: Number(r.stock ?? -1) !== 0 ? "available" as const : "out_of_stock" as const,
    category_id: r.category_id ? Number(r.category_id) : null,
  }));
}

// ---- Product detail (all channels) ----

export async function getProductDetail(slugOrId: string | number): Promise<ProductDetail | null> {
  if (!isD1Mode() || !isVariantsReadEnabled()) {
    return getProductDetailLegacy(slugOrId);
  }

  const isNumeric = typeof slugOrId === "number" || /^\d+$/.test(String(slugOrId));
  const product = isNumeric
    ? await queryFirst(`SELECT p.*, ${displaySoldCountSql("p")} AS display_sold_count FROM products p WHERE p.id=? AND p.is_active=1`, Number(slugOrId))
    : await queryFirst(`SELECT p.*, ${displaySoldCountSql("p")} AS display_sold_count FROM products p WHERE p.slug=? AND p.is_active=1`, String(slugOrId));

  if (!product) return null;

  const variants = await queryAll(
    `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.duration_value, pv.duration_unit, pv.duration_label,
            pv.warranty_type, pv.warranty_value, pv.warranty_unit, pv.warranty_label,
            pv.price, pv.compare_price, pv.stock, pv.min_qty, pv.max_qty, pv.buyer_field_key, pv.tunvn_buff_quantity_b, pv.tunvn_source_product_id, pv.aivault_service_id,p.aivault_family,pv.storebat_product_id,p.storebat_family,pv.mirai_package_code,p.mirai_family,p.slug AS product_slug, pv.manual_cost, pv.fulfillment_mode, pv.is_active, pv.sort_order,
            pv.bulk_pricing_enabled, pv.bulk_pricing_tiers,
            p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
            p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed,
            pv.wr_variant_id AS wr_variant_id, pv.wr_auto_managed AS wr_auto_managed,
            pv.sk_variant_id AS sk_variant_id, pv.sk_auto_managed AS sk_auto_managed,
            pv.admin_terms, pv.admin_activation, pv.admin_terms_en, pv.admin_activation_en, pv.admin_copy_fingerprint,
            wv.wr_terms AS wr_terms, wv.wr_delivery_terms AS wr_delivery_terms,
            wv.wr_delivery_class AS wr_delivery_class, wv.wr_type AS wr_type,
            sp.sk_order_process AS sk_order_process,
            sp.sk_description AS sk_description, sp.sk_seller_note AS sk_seller_note,
            -- Unit kredensial tersisa khusus unique (2026-10-02): hanya milik
            -- varian ini (tanpa pool legacy) + reserved ikut dihitung agar
            -- angka "Sisa" jujur selama ada order pending (reserved = sudah
            -- diklaim order lain, bukan milik pembeli ini).
            (SELECT COUNT(*) FROM fulfillment_inventory fi
              WHERE fi.product_id = pv.product_id
                AND fi.variant_id = pv.id
                AND fi.status = 'available'
                AND pv.fulfillment_mode = 'unique') AS inventory_available,
            COALESCE(p.require_email, 0) AS require_email
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
     LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
     WHERE pv.product_id=? AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
     ORDER BY pv.sort_order ASC, pv.price ASC, pv.id ASC`,
    Number(product.id)
  );

  return {
    id: Number(product.id),
    slug: String(product.slug),
    name: String(product.name),
    nameEn: nullableText(product.name_en),
    whatsappAlias: nullableText(product.whatsapp_alias),
    aliases: parseAliases(product.aliases),
    description: displayDescription(product),
    descriptionEn: displayDescriptionEn(product),
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: (product.display_sold_count ?? product.sold_count) ? Number(product.display_sold_count ?? product.sold_count) : null,
    category_id: product.category_id ? Number(product.category_id) : null,
    is_active: Number(product.is_active ?? 1),
    variants: variants.map(mapVariant),
  };
}

async function getProductDetailLegacy(slugOrId: string | number): Promise<ProductDetail | null> {
  const isNumeric = typeof slugOrId === "number" || /^\d+$/.test(String(slugOrId));
  const product = isNumeric
    ? await queryFirst(`SELECT p.*, ${displaySoldCountSql("p")} AS display_sold_count FROM products p WHERE p.id=? AND p.is_active=1`, Number(slugOrId))
    : await queryFirst(`SELECT p.*, ${displaySoldCountSql("p")} AS display_sold_count FROM products p WHERE p.slug=? AND p.is_active=1`, String(slugOrId));

  if (!product) return null;

  // Build a synthetic "default" variant from product-level fields
  const defaultVariant: VariantSummary = {
    id: 0,
    product_id: Number(product.id),
    sku: `DEFAULT-${product.id}`,
    label: "Default",
    duration_value: null,
    duration_unit: null,
    duration_label: null,
    warranty_type: "none",
    warranty_value: null,
    warranty_unit: null,
    warranty_label: null,
    terms: null,
    delivery_terms: null,
    // Varian sintetis legacy (non-WR / tanpa join wr_variants): tidak ada
    // kelas → label pembeli jatuh ke "✋ Dikirim admin" (default aman).
    wr_delivery_class: null,
    wr_type: null,
    require_email: Number((product as Record<string, unknown>).require_email ?? 0),
    min_qty: 1,
    manual_cost: 0,
    price: Number(product.price),
    compare_price: product.compare_price ? Number(product.compare_price) : null,
    stock: Number(product.stock ?? -1),
    fulfillment_mode: String(product.fulfillment_mode || "manual"),
    is_active: 1,
    sort_order: 0,
  };

  return {
    id: Number(product.id),
    slug: String(product.slug),
    name: String(product.name),
    nameEn: nullableText(product.name_en),
    whatsappAlias: nullableText(product.whatsapp_alias),
    aliases: [],
    description: displayDescription(product),
    descriptionEn: displayDescriptionEn(product),
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: (product.display_sold_count ?? product.sold_count) ? Number(product.display_sold_count ?? product.sold_count) : null,
    category_id: product.category_id ? Number(product.category_id) : null,
    is_active: Number(product.is_active ?? 1),
    variants: [defaultVariant],
  };
}

// ---- Variant by ID ----

export async function getActiveVariant(variantId: number): Promise<VariantSummary | null> {
  if (!isD1Mode() || !isVariantsReadEnabled()) return null;

  const row = await queryFirst(
    `SELECT pv.*, p.is_active as product_active, p.aivault_family,p.storebat_family,p.mirai_family,p.slug AS product_slug,
            p.require_email AS require_email,
            p.source AS p_source, p.wr_product_id AS p_wr_product_id, p.wr_auto_managed AS p_wr_auto_managed,
            p.sk_product_id AS p_sk_product_id, p.sk_auto_managed AS p_sk_auto_managed,
            wv.wr_terms AS wr_terms, wv.wr_delivery_terms AS wr_delivery_terms,
            wv.wr_delivery_class AS wr_delivery_class, wv.wr_type AS wr_type,
            sp.sk_order_process AS sk_order_process,
            sp.sk_description AS sk_description, sp.sk_seller_note AS sk_seller_note,
            (SELECT COUNT(*) FROM fulfillment_inventory fi
              WHERE fi.product_id = pv.product_id
                AND fi.variant_id = pv.id
                AND fi.status = 'available') AS inventory_available
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
     LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
     WHERE pv.id=? AND pv.is_active=1 AND p.is_active=1 AND ${wrNewSaleSql("pv")}`,
    variantId
  );
  if (!row) return null;
  return mapVariant(row);
}

// ---- Format helpers ----

export function formatDuration(v: Partial<Pick<VariantSummary, "duration_label" | "duration_value" | "duration_unit">>): string {
  if (v.duration_label) return v.duration_label;
  if (!v.duration_value || !v.duration_unit) return "";
  const unitMap: Record<string, string> = { day: "Hari", month: "Bulan", year: "Tahun", lifetime: "Selamanya", custom: "" };
  if (v.duration_unit === "lifetime") return "Selamanya";
  return `${v.duration_value} ${unitMap[v.duration_unit] || v.duration_unit}`;
}

/**
 * Label varian untuk pembeli (2026-09-19, direvisi malam hari; diperluas SK 2026-11-20).
 *
 * Aturan final — HANYA varian WR dan SK yang digabung label + durasi:
 * - WR: sync menulis label = nama API verbatim ("Meitu VIP") dan durasi di
 *   kolom `duration_*` ("7 Hari"); web WR menggabung ("Meitu VIP - 7 Hari").
 *   Guard includes mencegah duplikasi bila nama sudah mengandung durasi.
 * - SK: bila seluruh kolom `duration_label/value/unit` kosong, durasi diturunkan
 *   dari `sk_description` ("DURASI 1 BULAN" -> "1 Bulan") dan digabung
 *   "label - dur" kecuali label sudah memuat token durasi; `duration_*` yang
 *   diisi admin selalu menang.
 * - Non-WR/non-SK: label diketik manual oleh admin di modal ("Invite Lifetime",
 *   "Head 1 Bulan", "GSuite 1 Hari") — SUDAH final, JANGAN di-append apa pun.
 *   Kolom duration_* non-WR ganda dengan garansi (warranty_value/unit SAMA
 *   PERSIS: 6/6, 14/14) dan bukan sumber kebenaran display (DB Canva:
 *   Invite Lifetime duration 6 month, Head 1 Bulan duration 14 day — salah
 *   semua bila ditempel). Insiden 2026-09-19: helper lama menggabung untuk
 *   semua produk → "Invite Lifetime - 6 Bulan", "Head 1 Bulan - 14 Hari".
 */
/** Keluarga supplier dari kolom mentah, tidak ikut diserialisasi. */
export function supplierVariantOf(v: { wr_variant_id?: unknown; sk_variant_id?: unknown }): "wr" | "sk" | null {
  if (String(v.wr_variant_id ?? "").trim()) return "wr";
  return String(v.sk_variant_id ?? "").trim() ? "sk" : null;
}

type VariantLabelInput = Pick<VariantSummary, "label">
  & Partial<Pick<VariantSummary, "duration_label" | "duration_value" | "duration_unit" | "terms" | "sk_description" | "sk_duration">>
  & { wr_variant_id?: unknown; sk_variant_id?: unknown; supplier_variant?: boolean; label_duration?: string | null };

export function variantLabelDuration(v: VariantLabelInput): string | null {
  if (v.supplier_variant !== undefined) return v.supplier_variant ? v.label_duration ?? null : null;
  const label = String(v.label || "").trim();
  const kind = supplierVariantOf(v);
  let duration = "";
  if (kind === "wr") {
    duration = formatDuration(v).trim();
  } else if (kind === "sk" && !labelContainsDuration(label)) {
    const hasAdminDuration =
      (v.duration_label != null && String(v.duration_label).trim() !== "")
      || (v.duration_value != null && Number(v.duration_value) > 0)
      || (v.duration_unit != null && String(v.duration_unit).trim() !== "");
    duration = hasAdminDuration
      ? formatDuration(v).trim()
      : durationFromSupplierText(v.sk_description ?? v.terms ?? null) ?? String(v.sk_duration ?? "").trim();
  }
  return duration && !label.toLowerCase().includes(duration.toLowerCase()) ? duration : null;
}

export function formatVariantLabel(v: VariantLabelInput, locale: Locale = "id"): string {
  const label = String(v.label || "").trim();
  const duration = variantLabelDuration(v);
  return translateVariantLabel(duration ? `${label} - ${duration}` : label, locale);
}

/**
 * Kelas pengiriman PEMBELI per varian (2026-09-19, diperluas SK 2026-09-30):
 * WR ikut `wr_delivery_class` (restock = instan, selainnya = antrean);
 * SK ikut `sk_order_process` (auto = instan/lisensi langsung, selainnya =
 * antrean seperti MBO — FAKTA API: 82 auto vs 6008 h2h vs 4 manual);
 * TUNVN/AIVault/StoreBat/Mirai eligible memakai marker otomatis, bukan janji selesai instan;
 * non-supplier lain ikut `fulfillment_mode` (shared/unique = instan dari stok
 * sendiri, manual = dikerjakan admin). Satu fungsi agar PDP/modal/checkout
 * tidak menebak per layar.
 */
export type BuyerDeliveryKind = "instant" | "queued";

type BuyerDeliveryInput = {
  fulfillment_mode?: unknown; wr_delivery_class?: unknown; sk_order_process?: unknown;
  wr_variant_id?: unknown; sk_variant_id?: unknown; automatic_delivery?: boolean;
  delivery_kind?: BuyerDeliveryKind; automatic_processing?: boolean; queue_has_eta?: boolean;
};

export function buyerDeliveryKind(v: BuyerDeliveryInput): BuyerDeliveryKind {
  if (v.delivery_kind === "instant" || v.delivery_kind === "queued") return v.delivery_kind;
  return isQueuedFulfillment({
    wrVariantId: v.wr_variant_id, wrClass: v.wr_delivery_class,
    skVariantId: v.sk_variant_id, skOrderProcess: v.sk_order_process,
    fulfillmentMode: v.fulfillment_mode, automaticDelivery: v.automatic_delivery,
  }) ? "queued" : "instant";
}

/** Badge pembeli: "Kirim otomatis" (instan) atau "Made By Order" (antrean). */
export function buyerDeliveryBadge(v: BuyerDeliveryInput): string {
  // WR3 Jaspay: dibuat otomatis (bukan disiapkan admin), tapi tetap antrean
  // (bukan instan/stok). Tanpa brand supplier di copy pembeli.
  if (hasAutomaticProcessing(v)) return "Diproses otomatis";
  return buyerDeliveryKind(v) === "instant" ? "Kirim otomatis" : "Made By Order";
}

export function hasAutomaticProcessing(v: Pick<BuyerDeliveryInput, "automatic_processing" | "wr_variant_id">): boolean {
  return v.automatic_processing ?? String(v.wr_variant_id ?? "").trim().startsWith("jaspay:");
}

/**
 * ETA Jaspay untuk pembeli (owner 18 Nov 2026): made by order oleh bot, estimasi 15 menit–1 jam.
 * Tetap kelas queued (bukan instan) — tanpa janji stok, tanpa brand supplier.
 */
export function buyerDeliveryEtaJaspay(): string {
  return "Made by order — dibuat otomatis oleh bot setelah pembayaran. Estimasi 15 menit–1 jam.";
}

/** True bila varian unique kehabisan kredensial walau kolom stock > 0. */
export function isUniqueInventoryEmpty(
  v: Pick<VariantSummary, "stock" | "fulfillment_mode"> & Partial<Pick<VariantSummary, "inventory_available">>,
): boolean {
  return String(v.fulfillment_mode ?? "manual").trim().toLowerCase() === "unique"
    && v.inventory_available != null
    && Number(v.inventory_available) <= 0
    && Number(v.stock ?? 0) !== 0;
}

/**
 * Kalimat ekspektasi pengiriman pembeli untuk varian NON-WR manual
 * (2026-09-19): tidak boleh meminjam estimasi supplier WR (6–12 jam) karena
 * pengerjaannya oleh admin Axvara sendiri. Kalimat jujur tanpa angka: admin
 * yang pegang antreannya, bukan supplier.
 */
export function buyerDeliveryEtaNonWr(): string {
  return "Made By Order — disiapkan admin setelah pembayaran dikonfirmasi, dikerjakan sesuai antrean pada jam layanan";
}

export function formatWarranty(v: Pick<VariantSummary, "warranty_type" | "warranty_value" | "warranty_unit" | "warranty_label">): string {
  // Tipe limited: SELALU bentuk kanonis "Garansi X Unit" dari field
  // terstruktur — JANGAN pulangkan warranty_label mentah ("12 Hari" ambigu:
  // pembeli tak bisa bedakan itu durasi atau garansi). Label mentah hanya
  // dipakai untuk tipe custom yang memang tak terstruktur.
  if (v.warranty_type === "limited") {
    if (v.warranty_value && v.warranty_unit) {
      return `Garansi ${v.warranty_value} ${unitMap(v.warranty_unit)}`;
    }
    return "Garansi";
  }
  if (v.warranty_type === "none") return "Tanpa Garansi";
  if (v.warranty_label) return v.warranty_label;
  if (v.warranty_type === "full") {
    if (v.warranty_value && v.warranty_unit) {
      return `Full Garansi ${v.warranty_value} ${unitMap(v.warranty_unit)}`;
    }
    return "Full Garansi";
  }
  if (v.warranty_type === "custom") return v.warranty_label || "Custom";
  return "";
}

/**
 * Label garansi untuk PEMBELI di bot (Telegram/WA, 2026-10-04 — paritas PDP
 * web yang sudah menyembunyikan tipe `none`). Varian tanpa data garansi
 * terstruktur — terutama SK yang menulis garansinya di deskripsi/S&K, bukan
 * kolom — TIDAK boleh tampil "Tanpa Garansi": itu vonis palsu. String kosong
 * = jangan render baris/segmen garansi sama sekali.
 */
export function buyerWarrantyLabel(v: VariantSummary): string {
  if (!v.warranty_type || v.warranty_type === "none") return "";
  return formatWarranty(v);
}

function unitMap(unit: string): string {
  const map: Record<string, string> = { day: "Hari", month: "Bulan", year: "Tahun", lifetime: "Selamanya" };
  return map[unit] || unit;
}

export function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

// ---- Internal helpers ----

function parseAliases(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function nullableText(raw: unknown): string | null {
  const value = raw == null ? "" : String(raw).trim();
  return value || null;
}

/**
 * Deskripsi yang TAMPIL untuk pembeli. `admin_description_override`
 * (migrasi 0030) milik admin dan menang atas `description` milik sync WR.
 * Dipakai seluruh kanal — web, Telegram, WhatsApp — agar teks yang dilihat
 * pembeli sama di mana pun; tanpa ini override hanya berlaku di web.
 */
export function displayDescription(row: Record<string, unknown>): string | null {
  return nullableText(row.admin_description_override) ?? nullableText(row.description);
}

/**
 * Deskripsi efektif versi Inggris (migrasi 0103): `description_en` milik admin
 * bila terisi; kosong/NULL → teks ID yang sama dengan displayDescription().
 */
export function displayDescriptionEn(row: Record<string, unknown>): string | null {
  return nullableText(row.description_en) ?? displayDescription(row);
}

function mapVariant(row: Record<string, unknown>): VariantSummary {
  // Harga grosir hanya untuk produk manual (keputusan owner 2026-11-08):
  // data tersimpan pada varian produk supplier (WR/SK) tidak pernah dipakai.
  const bulkOwner = bulkOwnerFromJoinedRow(row);
  const bulkAllowed = !bulkOwner || isManualProductForBulk(bulkOwner);
  let bulk = null;
  try {
    const enabled = bulkAllowed ? Number(row.bulk_pricing_enabled ?? 0) : 0;
    if (enabled === 0 || enabled === 1) bulk = validateBulkPricing({ enabled: enabled === 1, tiers: JSON.parse(String(row.bulk_pricing_tiers ?? "[]")) }, Number(row.price));
  } catch { /* Corrupt configuration is reported, never used. */ }
  return {
    id: Number(row.id),
    product_id: Number(row.product_id || 0),
    sku: /^(TUNVN-|AV-)/.test(String(row.sku ?? "")) ? "" : String(row.sku),
    label: String(row.label),
    duration_value: row.duration_value != null ? Number(row.duration_value) : null,
    duration_unit: row.duration_unit ? String(row.duration_unit) : null,
    duration_label: row.duration_label ? String(row.duration_label) : null,
    warranty_type: String(row.warranty_type || "none"),
    warranty_value: row.warranty_value != null ? Number(row.warranty_value) : null,
    warranty_unit: row.warranty_unit ? String(row.warranty_unit) : null,
    warranty_label: row.warranty_label ? String(row.warranty_label) : null,
    terms: nullableText(row.wr_terms) ?? nullableText(row.sk_description),
    delivery_terms: nullableText(row.wr_delivery_terms) ?? nullableText(row.sk_seller_note),
    admin_terms: nullableText(row.admin_terms),
    admin_activation: nullableText(row.admin_activation),
    admin_terms_en: nullableText(row.admin_terms_en),
    admin_activation_en: nullableText(row.admin_activation_en),
    admin_copy_fingerprint: row.admin_copy_fingerprint == null ? null : String(row.admin_copy_fingerprint),
    wr_delivery_class: row.wr_delivery_class ? String(row.wr_delivery_class) : null,
    wr_variant_id: row.wr_variant_id != null ? String(row.wr_variant_id) : null,
    wr_auto_managed: row.wr_auto_managed != null ? Number(row.wr_auto_managed) : 0,
    wr_type: row.wr_type ? String(row.wr_type) : null,
    sk_variant_id: row.sk_variant_id != null ? String(row.sk_variant_id) : null,
    sk_auto_managed: row.sk_auto_managed != null ? Number(row.sk_auto_managed) : 0,
    sk_order_process: row.sk_order_process ? String(row.sk_order_process) : null,
    sk_description: nullableText(row.sk_description),
    sk_duration: deriveSkDuration({
      sk_variant_id: row.sk_variant_id,
      duration_label: row.duration_label ? String(row.duration_label) : null,
      duration_value: row.duration_value != null ? Number(row.duration_value) : null,
      duration_unit: row.duration_unit ? String(row.duration_unit) : null,
      sk_description: nullableText(row.sk_description),
    }),
    inventory_available: row.inventory_available != null ? Number(row.inventory_available) : null,
    require_email: Number(row.require_email ?? 0),
    price: Number(row.price),
    bulk_pricing_enabled: bulk?.enabled ?? false,
    bulk_pricing_tiers: bulk?.enabled ? bulk.tiers : [],
    // Produk supplier tidak dianggap "rusak" — grosir memang tidak berlaku.
    bulk_pricing_invalid: bulkAllowed && !bulk,
    compare_price: row.compare_price != null ? Number(row.compare_price) : null,
    stock: Number(row.stock ?? -1),
    min_qty: Math.max(1, Number(row.min_qty ?? 1) || 1),
    max_qty: row.max_qty == null ? null : Number(row.max_qty),
    buyer_field_key: row.buyer_field_key === "muse_invite_code" ? "muse_invite_code" : null,
    ...(hasAutomaticSupplierDelivery(row) ? { automatic_delivery:true } : {}),
    manual_cost: Math.max(0, Math.floor(Number(row.manual_cost ?? 0) || 0)),
    fulfillment_mode: String(row.fulfillment_mode || "manual"),
    is_active: Number(row.is_active ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}
