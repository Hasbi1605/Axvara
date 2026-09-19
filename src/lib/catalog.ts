// src/lib/catalog.ts — Shared catalog service for all channels
// Single source of truth for product + variant queries.
// Web, Telegram, and WhatsApp all use these same functions.

import { queryAll, queryFirst, isD1Mode } from "@/lib/db";

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
  /** Toggle email wajib per produk (migrasi 0033, untuk non-WR). */
  require_email: number;
  price: number;
  compare_price: number | null;
  stock: number;
  /**
   * Minimum pembelian per baris (migrasi 0034, milik admin, default 1).
   * GSuite dikunci 50; produk lain tinggal set angka dari admin bila butuh.
   * Sync WR tidak pernah menulis kolom ini.
   */
  min_qty: number;
  fulfillment_mode: string;
  is_active: number;
  sort_order: number;
};

export type ProductSummary = {
  id: number;
  slug: string;
  name: string;
  whatsappAlias: string | null;
  aliases: string[];
  image: string | null;
  badge: string | null;
  description: string | null;
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
  whatsappAlias: string | null;
  aliases: string[];
  description: string | null;
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
      p.id, p.slug, p.name, p.whatsapp_alias, p.aliases, p.image_url, p.badge, p.description,
      p.admin_description_override, p.category_id,
      MIN(pv.price) as min_price,
      MAX(pv.price) as max_price,
      COUNT(pv.id) as variant_count,
      CASE WHEN SUM(CASE WHEN pv.stock != 0 THEN 1 ELSE 0 END) > 0 THEN 'available' ELSE 'out_of_stock' END as availability
    FROM products p
    INNER JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1
    WHERE p.is_active = 1
    GROUP BY p.id
    HAVING variant_count > 0
    ORDER BY p.sort_order ASC, p.name ASC
  `);

  return rows.map(r => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    whatsappAlias: nullableText(r.whatsapp_alias),
    aliases: parseAliases(r.aliases),
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: displayDescription(r),
    minPrice: Number(r.min_price),
    maxPrice: Number(r.max_price),
    variantCount: Number(r.variant_count),
    availability: String(r.availability) as "available" | "out_of_stock",
    category_id: r.category_id ? Number(r.category_id) : null,
  }));
}

async function listActiveProductsLegacy(): Promise<ProductSummary[]> {
  const rows = await queryAll(
    `SELECT id, slug, name, whatsapp_alias, image_url, badge, description,
            admin_description_override, price, compare_price, stock, category_id
     FROM products WHERE is_active=1 ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(r => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    whatsappAlias: nullableText(r.whatsapp_alias),
    aliases: [],
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: displayDescription(r),
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
    ? await queryFirst(`SELECT * FROM products WHERE id=? AND is_active=1`, Number(slugOrId))
    : await queryFirst(`SELECT * FROM products WHERE slug=? AND is_active=1`, String(slugOrId));

  if (!product) return null;

  const variants = await queryAll(
    `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.duration_value, pv.duration_unit, pv.duration_label,
            pv.warranty_type, pv.warranty_value, pv.warranty_unit, pv.warranty_label,
            pv.price, pv.compare_price, pv.stock, pv.min_qty, pv.fulfillment_mode, pv.is_active, pv.sort_order,
            pv.wr_variant_id AS wr_variant_id, pv.wr_auto_managed AS wr_auto_managed,
            wv.wr_terms AS wr_terms, wv.wr_delivery_terms AS wr_delivery_terms,
            wv.wr_delivery_class AS wr_delivery_class, wv.wr_type AS wr_type,
            COALESCE(p.require_email, 0) AS require_email
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
     WHERE pv.product_id=? AND pv.is_active=1
     ORDER BY pv.sort_order ASC, pv.price ASC, pv.id ASC`,
    Number(product.id)
  );

  return {
    id: Number(product.id),
    slug: String(product.slug),
    name: String(product.name),
    whatsappAlias: nullableText(product.whatsapp_alias),
    aliases: parseAliases(product.aliases),
    description: displayDescription(product),
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: product.sold_count ? Number(product.sold_count) : null,
    category_id: product.category_id ? Number(product.category_id) : null,
    is_active: Number(product.is_active ?? 1),
    variants: variants.map(mapVariant),
  };
}

async function getProductDetailLegacy(slugOrId: string | number): Promise<ProductDetail | null> {
  const isNumeric = typeof slugOrId === "number" || /^\d+$/.test(String(slugOrId));
  const product = isNumeric
    ? await queryFirst(`SELECT * FROM products WHERE id=? AND is_active=1`, Number(slugOrId))
    : await queryFirst(`SELECT * FROM products WHERE slug=? AND is_active=1`, String(slugOrId));

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
    whatsappAlias: nullableText(product.whatsapp_alias),
    aliases: [],
    description: displayDescription(product),
    image: product.image_url ? String(product.image_url) : null,
    images: product.images ? String(product.images) : null,
    badge: product.badge ? String(product.badge) : null,
    sold_count: product.sold_count ? Number(product.sold_count) : null,
    category_id: product.category_id ? Number(product.category_id) : null,
    is_active: Number(product.is_active ?? 1),
    variants: [defaultVariant],
  };
}

// ---- Variant by ID ----

export async function getActiveVariant(variantId: number): Promise<VariantSummary | null> {
  if (!isD1Mode() || !isVariantsReadEnabled()) return null;

  const row = await queryFirst(
    `SELECT pv.*, p.is_active as product_active,
            p.require_email AS require_email,
            wv.wr_terms AS wr_terms, wv.wr_delivery_terms AS wr_delivery_terms,
            wv.wr_delivery_class AS wr_delivery_class, wv.wr_type AS wr_type
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
     WHERE pv.id=? AND pv.is_active=1 AND p.is_active=1`,
    variantId
  );
  if (!row) return null;
  return mapVariant(row);
}

// ---- Bot name search (Telegram/WhatsApp) ----

export async function searchProductByName(input: string): Promise<{ exact: ProductSummary | null; candidates: ProductSummary[] }> {
  const normalized = normalizeInput(input);
  const products = await listActiveProducts();

  // 1. Exact name match
  const exactName = products.find(p => normalizeInput(p.name) === normalized);
  if (exactName) return { exact: exactName, candidates: [] };

  // 2. Exact slug match
  const exactSlug = products.find(p =>
    p.slug.toLowerCase() === input.trim().toLowerCase()
    || normalizeInput(p.slug) === normalized
  );
  if (exactSlug) return { exact: exactSlug, candidates: [] };

  // 3. Exact search-keyword alias match
  const exactAlias = products.find(p => p.aliases.some(a => normalizeInput(a) === normalized));
  if (exactAlias) return { exact: exactAlias, candidates: [] };

  // 4. WhatsApp display aliases may intentionally be shared by related
  // products. A unique exact match can open directly; duplicates remain a
  // candidate list instead of silently selecting the first product.
  const displayAliasMatches = products.filter(
    p => p.whatsappAlias && normalizeInput(p.whatsappAlias) === normalized,
  );
  if (displayAliasMatches.length === 1) {
    return { exact: displayAliasMatches[0], candidates: [] };
  }
  if (displayAliasMatches.length > 1) {
    return { exact: null, candidates: displayAliasMatches.slice(0, 5) };
  }

  // 5. Prefix/contains match (max 5 candidates)
  const candidates = products.filter(p => {
    const n = normalizeInput(p.name);
    return n.includes(normalized) || normalized.includes(n) ||
      (p.whatsappAlias ? normalizeInput(p.whatsappAlias).includes(normalized) || normalized.includes(normalizeInput(p.whatsappAlias)) : false) ||
      p.aliases.some(a => {
        const na = normalizeInput(a);
        return na.includes(normalized) || normalized.includes(na);
      });
  }).slice(0, 5);

  return { exact: null, candidates };
}

// ---- Format helpers ----

export function formatDuration(v: VariantSummary): string {
  if (v.duration_label) return v.duration_label;
  if (!v.duration_value || !v.duration_unit) return "";
  const unitMap: Record<string, string> = { day: "Hari", month: "Bulan", year: "Tahun", lifetime: "Selamanya", custom: "" };
  if (v.duration_unit === "lifetime") return "Selamanya";
  return `${v.duration_value} ${unitMap[v.duration_unit] || v.duration_unit}`;
}

/**
 * Label varian untuk pembeli (2026-09-19, direvisi malam hari).
 *
 * Aturan final — HANYA varian WR yang digabung label + durasi:
 * - WR: sync menulis label = nama API verbatim ("Meitu VIP") dan durasi di
 *   kolom `duration_*` ("7 Hari"); web WR menggabung ("Meitu VIP - 7 Hari").
 *   Guard includes mencegah duplikasi bila nama sudah mengandung durasi.
 * - Non-WR: label diketik manual oleh admin di modal ("Invite Lifetime",
 *   "Head 1 Bulan", "GSuite 1 Hari") — SUDAH final, JANGAN di-append apa pun.
 *   Kolom duration_* non-WR ganda dengan garansi (warranty_value/unit SAMA
 *   PERSIS: 6/6, 14/14) dan bukan sumber kebenaran display (DB Canva:
 *   Invite Lifetime duration 6 month, Head 1 Bulan duration 14 day — salah
 *   semua bila ditempel). Insiden 2026-09-19: helper lama menggabung untuk
 *   semua produk → "Invite Lifetime - 6 Bulan", "Head 1 Bulan - 14 Hari".
 */
export function formatVariantLabel(v: Pick<VariantSummary, "label"> & Partial<Pick<VariantSummary, "duration_label" | "duration_value" | "duration_unit">> & { wr_variant_id?: unknown }): string {
  const label = String(v.label || "").trim();
  const wrId = (v as { wr_variant_id?: unknown }).wr_variant_id;
  if (wrId == null || String(wrId).trim() === "") return label;
  const dur = formatDuration(v as VariantSummary).trim();
  if (!dur) return label;
  if (label.toLowerCase().includes(dur.toLowerCase())) return label;
  return `${label} - ${dur}`;
}

/**
 * Kelas pengiriman PEMBELI per varian (2026-09-19): WR ikut `wr_delivery_class`
 * (restock = instan, selainnya = antrean); non-WR ikut `fulfillment_mode`
 * (shared/unique = instan dari stok sendiri, manual = dikerjakan admin).
 * Satu fungsi agar PDP/modal/checkout tidak menebak per layar — dan agar
 * produk non-WR seperti Canva/Gsuite (semua `manual` hari ini) tidak
 * diklaim "instan" secara diam-diam.
 */
export type BuyerDeliveryKind = "instant" | "queued";

export function buyerDeliveryKind(v: Pick<VariantSummary, "fulfillment_mode"> & Partial<Pick<VariantSummary, "wr_delivery_class">> & { wr_variant_id?: unknown }): BuyerDeliveryKind {
  const wrId = v.wr_variant_id == null ? "" : String(v.wr_variant_id).trim();
  if (wrId) {
    return String(v.wr_delivery_class ?? "").trim() === "restock" ? "instant" : "queued";
  }
  const mode = String(v.fulfillment_mode ?? "manual").trim().toLowerCase();
  return mode === "shared" || mode === "unique" ? "instant" : "queued";
}

/** Badge pembeli: "Kirim otomatis" (instan) atau "Made By Order" (antrean). */
export function buyerDeliveryBadge(v: Parameters<typeof buyerDeliveryKind>[0]): string {
  return buyerDeliveryKind(v) === "instant" ? "Kirim otomatis" : "Made By Order";
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

export function formatWarranty(v: VariantSummary): string {
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

function unitMap(unit: string): string {
  const map: Record<string, string> = { day: "Hari", month: "Bulan", year: "Tahun", lifetime: "Selamanya" };
  return map[unit] || unit;
}

export function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

// ---- Internal helpers ----

function normalizeInput(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\w\s]/g, "");
}

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

function mapVariant(row: Record<string, unknown>): VariantSummary {
  return {
    id: Number(row.id),
    product_id: Number(row.product_id || 0),
    sku: String(row.sku),
    label: String(row.label),
    duration_value: row.duration_value != null ? Number(row.duration_value) : null,
    duration_unit: row.duration_unit ? String(row.duration_unit) : null,
    duration_label: row.duration_label ? String(row.duration_label) : null,
    warranty_type: String(row.warranty_type || "none"),
    warranty_value: row.warranty_value != null ? Number(row.warranty_value) : null,
    warranty_unit: row.warranty_unit ? String(row.warranty_unit) : null,
    warranty_label: row.warranty_label ? String(row.warranty_label) : null,
    terms: nullableText(row.wr_terms),
    delivery_terms: nullableText(row.wr_delivery_terms),
    wr_delivery_class: row.wr_delivery_class ? String(row.wr_delivery_class) : null,
    wr_variant_id: row.wr_variant_id != null ? String(row.wr_variant_id) : null,
    wr_auto_managed: row.wr_auto_managed != null ? Number(row.wr_auto_managed) : 0,
    wr_type: row.wr_type ? String(row.wr_type) : null,
    require_email: Number(row.require_email ?? 0),
    price: Number(row.price),
    compare_price: row.compare_price != null ? Number(row.compare_price) : null,
    stock: Number(row.stock ?? -1),
    min_qty: Math.max(1, Number(row.min_qty ?? 1) || 1),
    fulfillment_mode: String(row.fulfillment_mode || "manual"),
    is_active: Number(row.is_active ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}
