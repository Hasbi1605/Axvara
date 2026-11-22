import type { DatabaseAccess } from "@/lib/db-access";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { PIXELVERIF_PARENT_REFRESH } from "./catalog";
import { PIXELVERIF_DEFAULT_MARKUP_PERCENT, pixelverifSellPriceIdr } from "./pricing";

const PIXELVERIF_MARKUP_OWNER = `v.sku IN ('PV-NORMAL-3','PV-FULL-3')
    AND p.pixelverif_family IS NOT NULL
    AND p.source = 'manual'
    AND p.fulfillment_mode = 'manual'
    AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL
    AND p.wr_auto_managed = 0 AND p.sk_auto_managed = 0
    AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL AND p.mirai_family IS NULL
    AND v.fulfillment_mode = 'manual'
    AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL
    AND v.tunvn_source_product_id IS NULL AND v.tunvn_buff_quantity_b IS NULL
    AND v.aivault_service_id IS NULL AND v.storebat_product_id IS NULL AND v.mirai_package_code IS NULL
    AND v.pixelverif_flow_type IS NOT NULL`;

export const PIXELVERIF_MARKUP_SELECT_FROM = `
  SELECT v.*, p.archived_at, s.credit_cost AS mirror_cost, s.available AS mirror_available
  FROM product_variants v JOIN products p ON p.id = v.product_id
  LEFT JOIN pixelverif_services s ON s.service_key = (CASE WHEN v.pixelverif_flow_type='normal' THEN 'normal_3' ELSE 'full_3' END)
  WHERE ${PIXELVERIF_MARKUP_OWNER}`;

export type PixelverifMarkupUpdateInput = {
  markup_percent?: number;
  admin_price_idr?: number | null;
  is_active?: boolean;
  block_archived?: boolean;
};

export type PixelverifMarkupOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

export async function applyPixelverifMarkupUpdate(
  db: DatabaseAccess,
  row: Record<string, unknown>,
  input: PixelverifMarkupUpdateInput,
): Promise<PixelverifMarkupOutcome> {
  if (!db.d1) return { ok: false, status: 503, error: "database_unavailable" };

  if (row.archived_at != null && (input.block_archived || input.is_active === true)) {
    return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
  }

  const markup =
    input.markup_percent ??
    Number(row.pixelverif_markup_percent ?? PIXELVERIF_DEFAULT_MARKUP_PERCENT);
  const manual = input.admin_price_idr === undefined ? row.pixelverif_admin_price_idr : input.admin_price_idr;
  const fx = Number(row.pixelverif_fx_idr_per_usd);
  const cost = Number(row.pixelverif_cost_usd ?? row.mirror_cost);
  if (!(fx > 0 && cost > 0)) return { ok: false, status: 409, error: "fx_unavailable" };

  const price = manual == null ? pixelverifSellPriceIdr(cost, fx, markup) : Number(manual);
  const active = input.is_active === undefined ? row.is_active : Number(input.is_active);
  if (
    row.pixelverif_markup_percent === markup &&
    row.pixelverif_admin_price_idr === manual &&
    row.price === price &&
    row.is_active === active
  ) {
    return { ok: true, changed: false };
  }

  const guard = crypto.randomUUID();
  const parentRefreshSql =
    input.is_active === undefined
      ? `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price), updated_at=datetime('now') WHERE id=? AND archived_at IS NULL`
      : `UPDATE products ${PIXELVERIF_PARENT_REFRESH} WHERE id=? AND archived_at IS NULL`;

  const statements = [
    db.d1
      .prepare(
        `INSERT INTO operation_guards(operation_id, valid)
         SELECT ?, EXISTS(
           SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
           WHERE (${PIXELVERIF_MARKUP_OWNER}) AND v.id=? AND p.id=? AND p.archived_at IS ?
             AND v.sku=? AND v.pixelverif_flow_type=? AND v.pixelverif_validity=?
             AND v.price IS ? AND v.is_active IS ?
             AND v.pixelverif_admin_price_idr IS ? AND v.pixelverif_markup_percent IS ?
             AND v.pixelverif_fx_idr_per_usd IS ? AND v.pixelverif_cost_usd IS ?
         )`,
      )
      .bind(
        guard,
        row.id,
        row.product_id,
        row.archived_at ?? null,
        row.sku,
        row.pixelverif_flow_type,
        row.pixelverif_validity,
        row.price,
        row.is_active,
        row.pixelverif_admin_price_idr ?? null,
        row.pixelverif_markup_percent ?? null,
        row.pixelverif_fx_idr_per_usd ?? null,
        row.pixelverif_cost_usd ?? null,
      ),
    db.d1
      .prepare(
        `UPDATE product_variants
         SET price=?,
             compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
             is_active=?, pixelverif_markup_percent=?, pixelverif_admin_price_idr=?, updated_at=datetime('now')
         WHERE id=?`,
      )
      .bind(price, price, active, markup, manual ?? null, row.id),
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
