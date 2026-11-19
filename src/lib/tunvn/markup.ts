import type { DatabaseAccess } from "@/lib/db-access";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { tunvnDefaultDescription } from "./families";
import { tunvnBuffSellPriceIdr, tunvnSellPriceIdr } from "./pricing";

export const TUNVN_MIRROR_SELECT = `SELECT id,supplier_product_id,name,description,price_vnd,price_usdt,stock,
  discount_threshold,discount_price_vnd,discount_threshold_usdt,discount_price_usdt,
  axvara_product_id,markup_percent,sell_price_idr,fx_idr_per_usdt,admin_name,admin_description,
  visible,synced_at,created_at,updated_at FROM tunvn_products`;

export const TUNVN_VARIANT_OWNERSHIP_SQL = `
  v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL
  AND v.aivault_service_id IS NULL AND v.storebat_product_id IS NULL AND v.mirai_package_code IS NULL
  AND EXISTS (
    SELECT 1 FROM products p_own WHERE p_own.id = v.product_id
      AND p_own.wr_product_id IS NULL AND p_own.sk_product_id IS NULL
      AND p_own.wr_auto_managed = 0 AND p_own.sk_auto_managed = 0
      AND p_own.aivault_family IS NULL AND p_own.storebat_family IS NULL AND p_own.mirai_family IS NULL
  )`;

export type TunvnProductMarkupInput = {
  markup_percent?: number;
  admin_price_idr?: number | null;
  label?: string;
  is_active?: boolean;
  admin_name?: string | null;
  admin_description?: string | null;
  block_archived?: boolean;
  require_fx_for_formula?: boolean;
  refresh_stock?: boolean;
};

export type TunvnBuffMarkupInput = {
  markup_percent?: number;
  admin_price_idr?: number | null;
  is_active?: boolean;
  label?: string;
  block_archived?: boolean;
  require_fx_for_formula?: boolean;
  refresh_stock?: boolean;
};

export type TunvnMarkupOutcome =
  | { ok: true; fx_missing: boolean; changed: boolean }
  | { ok: false; status: number; error: string; message?: string };

export async function applyTunvnProductMarkupUpdate(
  db: DatabaseAccess,
  mirror: Record<string, unknown>,
  variant: Record<string, unknown> | null,
  product: Record<string, unknown> | null,
  input: TunvnProductMarkupInput,
): Promise<TunvnMarkupOutcome> {
  if (!db.d1) return { ok: false, status: 503, error: "database_unavailable" };
  const supplierId = Number(mirror.supplier_product_id);
  const variantWrites =
    input.admin_price_idr !== undefined || input.label !== undefined || input.is_active !== undefined;
  if (!variant && variantWrites) {
    return {
      ok: false,
      status: 409,
      error: "variant_missing",
      message: "Jalankan Sinkron dulu agar varian TUNVN ini dibuat.",
    };
  }
  const archivedAt = product?.archived_at ?? null;
  if (archivedAt != null && (input.block_archived || input.is_active === true)) {
    return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
  }

  const markup = input.markup_percent ?? Number(mirror.markup_percent ?? 35);
  const rawAdminPrice =
    input.admin_price_idr !== undefined
      ? input.admin_price_idr
      : variant?.tunvn_admin_price_idr != null
        ? Number(variant.tunvn_admin_price_idr)
        : null;
  const adminPrice =
    rawAdminPrice === null || Number(rawAdminPrice) === 0 ? null : Number(rawAdminPrice);
  const fx = Number(mirror.fx_idr_per_usdt ?? 0);
  const cost = Number(mirror.price_usdt ?? 0);
  let sell: number | null = null;
  if (adminPrice !== null) sell = adminPrice;
  else if (fx > 0 && cost > 0) sell = tunvnSellPriceIdr(cost, fx, markup);

  if (input.require_fx_for_formula && sell === null) {
    return { ok: false, status: 409, error: "fx_unavailable" };
  }

  const guard = crypto.randomUUID();
  const guardSql = variant
    ? `INSERT INTO operation_guards(operation_id,valid)
       SELECT ?, CASE WHEN EXISTS(
         SELECT 1 FROM tunvn_products t
         JOIN product_variants v ON v.id=?
         JOIN products p ON p.id=v.product_id
         WHERE t.supplier_product_id=? AND t.markup_percent IS ?
           AND t.fx_idr_per_usdt IS ? AND t.price_usdt IS ?
           AND v.tunvn_admin_price_idr IS ? AND v.is_active IS ? AND v.price IS ?
           AND v.sku IS ? AND v.tunvn_source_product_id IS ? AND p.id=? AND p.archived_at IS ?
           AND (${TUNVN_VARIANT_OWNERSHIP_SQL})
       ) THEN 1 ELSE 0 END`
    : `INSERT INTO operation_guards(operation_id,valid)
       SELECT ?, CASE WHEN EXISTS(
         SELECT 1 FROM tunvn_products t
         WHERE t.supplier_product_id=? AND t.markup_percent IS ?
           AND t.fx_idr_per_usdt IS ? AND t.price_usdt IS ?
           AND (? IS NULL OR EXISTS(SELECT 1 FROM products p WHERE p.id=? AND p.archived_at IS ?))
       ) THEN 1 ELSE 0 END`;

  const guardParams = variant
    ? [
        guard,
        variant.id,
        supplierId,
        mirror.markup_percent ?? null,
        mirror.fx_idr_per_usdt ?? null,
        mirror.price_usdt ?? null,
        variant.tunvn_admin_price_idr ?? null,
        variant.is_active ?? null,
        variant.price ?? null,
        variant.sku,
        variant.tunvn_source_product_id ?? null,
        variant.product_id,
        archivedAt,
      ]
    : [
        guard,
        supplierId,
        mirror.markup_percent ?? null,
        mirror.fx_idr_per_usdt ?? null,
        mirror.price_usdt ?? null,
        product?.id ?? null,
        product?.id ?? null,
        archivedAt,
      ];

  const writes: [string, unknown[]][] = [
    [guardSql, guardParams],
    [
      `UPDATE tunvn_products SET markup_percent=?,admin_name=?,admin_description=?,
         sell_price_idr=COALESCE(?,sell_price_idr),updated_at=datetime('now') WHERE supplier_product_id=?`,
      [
        markup,
        input.admin_name === undefined ? mirror.admin_name : input.admin_name || null,
        input.admin_description === undefined
          ? mirror.admin_description
          : input.admin_description || null,
        sell,
        supplierId,
      ],
    ],
  ];

  if (product) {
    if (input.admin_name !== undefined) {
      writes.push([
        "UPDATE products SET name=? WHERE id=?",
        [input.admin_name || String(product.name), product.id],
      ]);
    }
    if (input.admin_description !== undefined) {
      writes.push([
        "UPDATE products SET description=? WHERE id=?",
        [input.admin_description || tunvnDefaultDescription(String(product.name)), product.id],
      ]);
    }
  }

  if (variant) {
    writes.push([
      `UPDATE product_variants SET label=?, tunvn_admin_price_idr=?,
         price=COALESCE(?,price),
         compare_price=CASE WHEN ? IS NOT NULL AND compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
         is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?`,
      [
        input.label ?? String(variant.label),
        adminPrice,
        sell,
        sell,
        sell,
        input.is_active === undefined ? null : Number(input.is_active),
        variant.id,
      ],
    ]);
  }

  writes.push([
    `UPDATE tunvn_products SET visible=CASE WHEN EXISTS(
       SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
        WHERE pv.tunvn_source_product_id=tunvn_products.supplier_product_id AND pv.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL
     ) THEN 1 ELSE 0 END WHERE supplier_product_id=?`,
    [supplierId],
  ]);

  const refreshProductStock = input.refresh_stock ?? true;
  if (product) {
    if (!refreshProductStock) {
      writes.push([
        `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`,
        [product.id, product.id],
      ]);
    } else {
      writes.push([
        `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1) THEN -1
             ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
           updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`,
        [product.id, product.id, product.id, product.id],
      ]);
    }
  }

  writes.push(["DELETE FROM operation_guards WHERE operation_id=?", [guard]]);

  try {
    await db.d1.batch(writes.map(([sql, values]) => db.d1!.prepare(sql).bind(...values)));
    return { ok: true, fx_missing: !(fx > 0), changed: true };
  } catch (error) {
    if (String(error).includes("product_archived")) {
      return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
    }
    return { ok: false, status: 409, error: "save_failed_or_stale" };
  }
}

export async function applyTunvnBuffMarkupUpdate(
  db: DatabaseAccess,
  variant: Record<string, unknown>,
  productArchivedAt: unknown,
  input: TunvnBuffMarkupInput,
): Promise<TunvnMarkupOutcome> {
  if (!db.d1) return { ok: false, status: 503, error: "database_unavailable" };
  if (productArchivedAt != null && (input.block_archived || input.is_active === true)) {
    return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
  }

  const sku = String(variant.sku);
  const quantityB = Number(variant.tunvn_buff_quantity_b ?? 0);
  const markup =
    input.markup_percent !== undefined
      ? input.markup_percent
      : Number(variant.tunvn_markup_percent ?? 40);
  const rawAdminPrice =
    input.admin_price_idr !== undefined
      ? input.admin_price_idr
      : variant.tunvn_admin_price_idr ?? null;
  const adminPrice =
    rawAdminPrice === null || Number(rawAdminPrice) === 0 ? null : Number(rawAdminPrice);
  const fx = Number(variant.tunvn_fx_idr_per_usdt ?? 0);
  const cost = Number(variant.tunvn_cost_usdt ?? 0);
  const hasFx =
    Number.isFinite(fx) && fx > 0 && quantityB >= 1 && Number.isFinite(cost) && cost > 0;
  const sell =
    adminPrice !== null
      ? adminPrice
      : hasFx
        ? tunvnBuffSellPriceIdr(quantityB, fx, { markupPercent: markup, costUsdtPerB: cost / quantityB })
        : null;

  if (
    sell === null &&
    ((input.admin_price_idr !== undefined && adminPrice === null) || input.require_fx_for_formula)
  ) {
    return {
      ok: false,
      status: 409,
      error: "fx_missing",
      message: "Kurs tersimpan belum ada; jalankan Publikasi sekali atau isi harga manual.",
    };
  }

  const nextActive =
    input.is_active !== undefined ? (input.is_active ? 1 : 0) : Number(variant.is_active ?? 0);
  const nextLabel = input.label !== undefined ? input.label : String(variant.label);
  const guard = crypto.randomUUID();

  const refreshBuffStock = input.refresh_stock ?? true;
  const parentRefreshSql =
    !refreshBuffStock
      ? `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`
      : `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1) THEN -1
             ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
           updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`;
  const parentRefreshParams =
    !refreshBuffStock
      ? [variant.product_id, variant.product_id]
      : [variant.product_id, variant.product_id, variant.product_id, variant.product_id];

  try {
    await db.d1.batch([
      db.d1
        .prepare(
          `INSERT INTO operation_guards(operation_id,valid)
           SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM product_variants v
             JOIN products p ON p.id=v.product_id
             WHERE v.id=? AND v.sku=? AND v.tunvn_buff_quantity_b IS ?
               AND v.tunvn_cost_usdt IS ? AND v.tunvn_fx_idr_per_usdt IS ?
               AND v.tunvn_markup_percent IS ? AND v.tunvn_admin_price_idr IS ?
               AND v.price IS ? AND v.is_active IS ?
               AND p.id=? AND p.archived_at IS ?
               AND (${TUNVN_VARIANT_OWNERSHIP_SQL})
           ) THEN 1 ELSE 0 END`,
        )
        .bind(
          guard,
          variant.id,
          sku,
          variant.tunvn_buff_quantity_b ?? null,
          variant.tunvn_cost_usdt ?? null,
          variant.tunvn_fx_idr_per_usdt ?? null,
          variant.tunvn_markup_percent ?? null,
          variant.tunvn_admin_price_idr ?? null,
          variant.price ?? null,
          variant.is_active ?? null,
          variant.product_id,
          productArchivedAt ?? null,
        ),
      db.d1
        .prepare(
          `UPDATE product_variants
           SET tunvn_markup_percent=?, tunvn_admin_price_idr=?,
               price=COALESCE(?, price),
               compare_price=CASE WHEN ? IS NOT NULL AND compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
               is_active=?, label=?, updated_at=datetime('now')
           WHERE sku=?`,
        )
        .bind(markup, adminPrice, sell, sell, sell, nextActive, nextLabel, sku),
      db.d1.prepare(parentRefreshSql).bind(...parentRefreshParams),
      db.d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    return { ok: true, fx_missing: !hasFx, changed: true };
  } catch (error) {
    if (String(error).includes("product_archived")) {
      return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
    }
    return { ok: false, status: 409, error: "save_failed_or_stale" };
  }
}
