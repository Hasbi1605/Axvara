import type { DatabaseAccess } from "@/lib/db-access";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import {
  deriveAivaultBulkTiers,
  parseAivaultBulkMarkup,
  scaleAivaultBulkMarkup,
  validateAivaultBulkAgainstBase,
  type AivaultBulkMarkupTier,
} from "./bulk";
import { aivaultSellPrice } from "./families";

const AIVAULT_MARKUP_FROM = `
  FROM aivault_products m
  JOIN product_variants v ON v.aivault_service_id = m.service_id
    AND v.sku = 'AV-' || m.service_id AND v.product_id = m.axvara_product_id
  JOIN products p ON p.id = v.product_id`;

const AIVAULT_MARKUP_OWNER = `p.source = 'manual'
    AND p.fulfillment_mode = 'manual'
    AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL
    AND p.wr_auto_managed = 0 AND p.sk_auto_managed = 0
    AND p.tunvn_family IS NULL AND p.storebat_family IS NULL AND p.mirai_family IS NULL
    AND v.fulfillment_mode = 'manual'
    AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL
    AND v.tunvn_source_product_id IS NULL AND v.tunvn_buff_quantity_b IS NULL
    AND v.storebat_product_id IS NULL AND v.mirai_package_code IS NULL`;

export const AIVAULT_MARKUP_SELECT_FROM = `
  SELECT m.*, v.id AS vid, v.aivault_admin_price_idr, v.is_active, v.price AS v_price,
         p.archived_at AS p_archived_at
  ${AIVAULT_MARKUP_FROM} WHERE ${AIVAULT_MARKUP_OWNER}`;

export type AivaultMarkupUpdateInput = {
  markup_percent?: number;
  admin_price_idr?: number | null;
  is_active?: boolean;
  bulk_markup_tiers?: AivaultBulkMarkupTier[] | null;
  has_bulk_input?: boolean;
  block_archived?: boolean;
  refresh_stock?: boolean;
};

export type MarkupUpdateOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

export async function applyAivaultMarkupUpdate(
  db: DatabaseAccess,
  row: Record<string, unknown>,
  input: AivaultMarkupUpdateInput,
): Promise<MarkupUpdateOutcome> {
  if (!db.d1) return { ok: false, status: 503, error: "database_unavailable" };

  const archivedAt = row.p_archived_at ?? null;
  if (archivedAt != null && (input.block_archived || input.is_active === true)) {
    return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
  }

  const oldMarkup = Number(row.markup_percent);
  const markup = input.markup_percent ?? oldMarkup;
  const manual =
    input.admin_price_idr === undefined ? row.aivault_admin_price_idr : input.admin_price_idr;
  const fx = Number(row.fx_idr_per_usd);
  if (!(fx > 0)) return { ok: false, status: 409, error: "fx_unavailable" };

  const unitPriceUsd = Number(row.unit_price_usd);
  if (!(unitPriceUsd > 0)) return { ok: false, status: 409, error: "fx_unavailable" };

  const price = manual == null ? aivaultSellPrice(unitPriceUsd, fx, markup) : Number(manual);
  const storedBulkTiers = parseAivaultBulkMarkup(row.bulk_markup_tiers_json);
  const scaledBulkTiers = !input.has_bulk_input && manual == null && storedBulkTiers
    ? scaleAivaultBulkMarkup(storedBulkTiers, oldMarkup, markup)
    : storedBulkTiers;
  const effectiveBulkTiers = input.has_bulk_input ? input.bulk_markup_tiers ?? null : scaledBulkTiers;

  if (effectiveBulkTiers) {
    const baseCheck = validateAivaultBulkAgainstBase(
      effectiveBulkTiers,
      markup,
      manual == null ? null : Number(manual),
    );
    if (baseCheck !== "ok") {
      return { ok: false, status: 400, error: "bulk_markup_not_below_base" };
    }
  }

  const nextBulkMarkupJson = input.has_bulk_input || scaledBulkTiers !== storedBulkTiers
    ? effectiveBulkTiers?.length ? JSON.stringify(effectiveBulkTiers) : null
    : row.bulk_markup_tiers_json == null
      ? null
      : String(row.bulk_markup_tiers_json);

  const derivedBulk = effectiveBulkTiers
    ? deriveAivaultBulkTiers(unitPriceUsd, fx, price, effectiveBulkTiers)
    : [];
  const bulkEnabled = derivedBulk.length > 0 ? 1 : 0;
  const bulkTiersJson = derivedBulk.length > 0 ? JSON.stringify(derivedBulk) : "[]";
  const nextActive = input.is_active === undefined ? row.is_active : Number(input.is_active);
  const serviceId = String(row.service_id);
  const guard = crypto.randomUUID();

  const refreshStock = input.refresh_stock ?? input.is_active !== undefined;
  const parentRefreshSql =
    !refreshStock
      ? `UPDATE products
         SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
             updated_at=datetime('now')
         WHERE id=? AND archived_at IS NULL`
      : `UPDATE products
         SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
             stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
               ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END,
             updated_at=datetime('now')
         WHERE id=? AND archived_at IS NULL`;

  try {
    await db.d1.batch([
      db.d1
        .prepare(
          `INSERT INTO operation_guards(operation_id,valid)
           SELECT ?,CASE WHEN EXISTS(
             SELECT 1 ${AIVAULT_MARKUP_FROM}
             WHERE (${AIVAULT_MARKUP_OWNER})
               AND m.service_id=? AND m.markup_percent IS ? AND m.fx_idr_per_usd IS ?
               AND m.unit_price_usd IS ? AND m.bulk_markup_tiers_json IS ?
               AND v.id=? AND v.aivault_admin_price_idr IS ? AND v.is_active IS ? AND v.price IS ?
               AND p.id=? AND p.archived_at IS ?
           ) THEN 1 ELSE 0 END`,
        )
        .bind(
          guard,
          serviceId,
          row.markup_percent,
          row.fx_idr_per_usd,
          row.unit_price_usd,
          row.bulk_markup_tiers_json ?? null,
          row.vid,
          row.aivault_admin_price_idr,
          row.is_active,
          row.v_price,
          row.axvara_product_id,
          archivedAt,
        ),
      db.d1
        .prepare(
          "UPDATE aivault_products SET markup_percent=?,sell_price_idr=?,bulk_markup_tiers_json=?,updated_at=datetime('now') WHERE service_id=?",
        )
        .bind(markup, price, nextBulkMarkupJson, serviceId),
      db.d1
        .prepare(
          `UPDATE product_variants
           SET aivault_admin_price_idr=?,
               price=?,
               compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
               is_active=?,
               bulk_pricing_enabled=?,
               bulk_pricing_tiers=?,
               max_qty=CASE WHEN max_qty IS NULL OR max_qty > 100 THEN 100 ELSE max_qty END,
               updated_at=datetime('now')
           WHERE id=?`,
        )
        .bind(manual, price, price, nextActive, bulkEnabled, bulkTiersJson, row.vid),
      db.d1.prepare(parentRefreshSql).bind(row.axvara_product_id),
      db.d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    return { ok: true, changed: true };
  } catch (error) {
    if (String(error).includes("product_archived")) {
      return { ok: false, status: 409, error: ARCHIVED_MESSAGE };
    }
    return { ok: false, status: 409, error: "save_failed_or_stale" };
  }
}
