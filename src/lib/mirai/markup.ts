import type { DatabaseAccess } from "@/lib/db-access";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { MIRAI_PARENT_REFRESH } from "./catalog";
import { MIRAI_DEFAULT_MARKUP_PERCENT, miraiSellPriceIdr } from "./pricing";

const MIRAI_MARKUP_OWNER = `v.sku = 'MR-' || v.mirai_package_code
    AND p.mirai_family IS NOT NULL
    AND p.source = 'manual'
    AND p.fulfillment_mode = 'manual'
    AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL
    AND p.wr_auto_managed = 0 AND p.sk_auto_managed = 0
    AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL
    AND v.fulfillment_mode = 'manual'
    AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL
    AND v.tunvn_source_product_id IS NULL AND v.tunvn_buff_quantity_b IS NULL
    AND v.aivault_service_id IS NULL AND v.storebat_product_id IS NULL`;

export const MIRAI_MARKUP_SELECT_FROM = `
  SELECT v.*, p.archived_at, m.markup_percent AS mirror_markup_percent, m.package_code AS mirror_package_code
  FROM product_variants v JOIN products p ON p.id = v.product_id
  LEFT JOIN mirai_packages m ON m.package_code = v.mirai_package_code
  WHERE ${MIRAI_MARKUP_OWNER}`;

export type MiraiMarkupUpdateInput = {
  markup_percent?: number;
  admin_price_idr?: number | null;
  is_active?: boolean;
  block_archived?: boolean;
};

export type MiraiMarkupOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

export async function applyMiraiMarkupUpdate(
  db: DatabaseAccess,
  row: Record<string, unknown>,
  input: MiraiMarkupUpdateInput,
): Promise<MiraiMarkupOutcome> {
  if (!db.d1) return { ok: false, status: 503, error: "database_unavailable" };

  if (row.archived_at != null && (input.block_archived || input.is_active === true)) {
    return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
  }

  const packageCode = String(row.mirai_package_code);
  const markup =
    input.markup_percent ??
    Number(row.mirai_markup_percent ?? row.mirror_markup_percent ?? MIRAI_DEFAULT_MARKUP_PERCENT);
  const manual = input.admin_price_idr === undefined ? row.mirai_admin_price_idr : input.admin_price_idr;
  const fx = Number(row.mirai_fx_idr_per_usdt);
  const cost = Number(row.mirai_cost_usdt);
  if (!(fx > 0 && cost > 0)) return { ok: false, status: 409, error: "fx_unavailable" };

  const price = manual == null ? miraiSellPriceIdr(cost, fx, markup) : Number(manual);
  const active = input.is_active === undefined ? row.is_active : Number(input.is_active);
  if (
    row.mirai_markup_percent === markup &&
    row.mirai_admin_price_idr === manual &&
    row.price === price &&
    row.is_active === active &&
    (row.mirror_markup_percent === undefined || row.mirror_markup_percent === markup)
  ) {
    return { ok: true, changed: false };
  }

  const guard = crypto.randomUUID();
  const parentRefreshSql =
    input.is_active === undefined
      ? `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price), updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`
      : `UPDATE products ${MIRAI_PARENT_REFRESH} WHERE id=? AND archived_at IS NULL`;

  const statements = [
    db.d1
      .prepare(
        `INSERT INTO operation_guards(operation_id, valid)
         SELECT ?, EXISTS(
           SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE (${MIRAI_MARKUP_OWNER}) AND v.id=? AND p.id=? AND p.archived_at IS ?
             AND v.mirai_package_code=? AND v.sku=?
             AND v.price IS ? AND v.is_active IS ?
             AND v.mirai_admin_price_idr IS ? AND v.mirai_markup_percent IS ?
             AND v.mirai_fx_idr_per_usdt IS ? AND v.mirai_cost_usdt IS ?
         )`,
      )
      .bind(
        guard,
        row.id,
        row.product_id,
        row.archived_at ?? null,
        packageCode,
        row.sku,
        row.price,
        row.is_active,
        row.mirai_admin_price_idr ?? null,
        row.mirai_markup_percent ?? null,
        row.mirai_fx_idr_per_usdt ?? null,
        row.mirai_cost_usdt ?? null,
      ),
    db.d1
      .prepare(
        `UPDATE product_variants
         SET price=?,
             compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
             is_active=?, mirai_markup_percent=?, mirai_admin_price_idr=?, updated_at=datetime('now')
         WHERE id=?`,
      )
      .bind(price, price, active, markup, manual ?? null, row.id),
    db.d1
      .prepare(
        `UPDATE mirai_packages SET markup_percent=?, sell_price_idr=?, updated_at=datetime('now') WHERE package_code=?`,
      )
      .bind(markup, price, packageCode),
    db.d1.prepare(parentRefreshSql).bind(row.product_id),
    db.d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
  ];

  try {
    await db.d1.batch(statements);
    return { ok: true, changed: true };
  } catch (error) {
    if (String(error).includes("product_archived")) {
      return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
    }
    return { ok: false, status: 409, error: "save_failed_or_stale" };
  }
}
