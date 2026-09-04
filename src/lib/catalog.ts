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
  price: number;
  compare_price: number | null;
  stock: number;
  fulfillment_mode: string;
  is_active: number;
  sort_order: number;
};

export type ProductSummary = {
  id: number;
  slug: string;
  name: string;
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
      p.id, p.slug, p.name, p.aliases, p.image_url, p.badge, p.description, p.category_id,
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
    aliases: parseAliases(r.aliases),
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: r.description ? String(r.description) : null,
    minPrice: Number(r.min_price),
    maxPrice: Number(r.max_price),
    variantCount: Number(r.variant_count),
    availability: String(r.availability) as "available" | "out_of_stock",
    category_id: r.category_id ? Number(r.category_id) : null,
  }));
}

async function listActiveProductsLegacy(): Promise<ProductSummary[]> {
  const rows = await queryAll(
    `SELECT id, slug, name, image_url, badge, description, price, compare_price, stock, category_id
     FROM products WHERE is_active=1 ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(r => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    aliases: [],
    image: r.image_url ? String(r.image_url) : null,
    badge: r.badge ? String(r.badge) : null,
    description: r.description ? String(r.description) : null,
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
    `SELECT id, product_id, sku, label, duration_value, duration_unit, duration_label,
            warranty_type, warranty_value, warranty_unit, warranty_label,
            price, compare_price, stock, fulfillment_mode, is_active, sort_order
     FROM product_variants
     WHERE product_id=? AND is_active=1
     ORDER BY sort_order ASC, price ASC, id ASC`,
    Number(product.id)
  );

  return {
    id: Number(product.id),
    slug: String(product.slug),
    name: String(product.name),
    aliases: parseAliases(product.aliases),
    description: product.description ? String(product.description) : null,
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
    aliases: [],
    description: product.description ? String(product.description) : null,
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
    `SELECT pv.*, p.is_active as product_active
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
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

  // 3. Exact alias match
  const exactAlias = products.find(p => p.aliases.some(a => normalizeInput(a) === normalized));
  if (exactAlias) return { exact: exactAlias, candidates: [] };

  // 4. Prefix/contains match (max 5 candidates)
  const candidates = products.filter(p => {
    const n = normalizeInput(p.name);
    return n.includes(normalized) || normalized.includes(n) ||
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

export function formatWarranty(v: VariantSummary): string {
  if (v.warranty_label) return v.warranty_label;
  if (v.warranty_type === "none") return "Tanpa Garansi";
  if (v.warranty_type === "full") return "Full Garansi";
  if (v.warranty_type === "limited" && v.warranty_value && v.warranty_unit) {
    const unitMap: Record<string, string> = { day: "Hari", month: "Bulan", year: "Tahun", lifetime: "Selamanya" };
    return `${v.warranty_value} ${unitMap[v.warranty_unit] || v.warranty_unit}`;
  }
  if (v.warranty_type === "custom") return v.warranty_label || "Custom";
  return "";
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
    price: Number(row.price),
    compare_price: row.compare_price != null ? Number(row.compare_price) : null,
    stock: Number(row.stock ?? -1),
    fulfillment_mode: String(row.fulfillment_mode || "manual"),
    is_active: Number(row.is_active ?? 1),
    sort_order: Number(row.sort_order ?? 0),
  };
}
