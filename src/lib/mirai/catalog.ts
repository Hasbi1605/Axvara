import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { buildSupplierProductInsertSql } from "@/lib/supplier/product-insert";
import { isMiraiConfigured, isMiraiSyncEnabled } from "./client";
import { MIRAI_COPY } from "./copy";
import {
  miraiDefaultDescription,
  miraiFamily,
  miraiSellPriceIdr,
  miraiVariantSortOrder,
  sortMiraiPackagesByQuota,
} from "./families";
import { MIRAI_CATALOG_MIN_INTERVAL_MS, syncMiraiCatalog } from "./sync";

export const MIRAI_LEASE_KEY = "mirai_catalog_lease";
export const MIRAI_LEASE_MS = 45_000;
export const MIRAI_PARENT_REFRESH = `SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
  stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
  ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END`;

/** Fixed publisher statement count, regardless of family count. Copy and activation are admin-owned. */
export async function projectMiraiCatalog(db: DatabaseAccess, fx: number) {
  if (!db.d1 || !db.canSpend(9)) return { ok: false, error: "catalog_budget_exceeded" } as const;
  if (!Number.isFinite(fx) || fx <= 0) return { ok: false, error: "fx_unavailable" } as const;

  const mirrorRaw = await db.queryAll(
    `SELECT m.*,
       v.mirai_admin_price_idr AS admin_price,
       v.mirai_markup_percent AS v_markup_percent,
       v.mirai_cost_usdt AS v_cost_usdt,
       v.mirai_fx_idr_per_usdt AS v_fx,
       v.id AS v_id, v.price AS v_price, v.stock AS v_stock, v.max_qty AS v_max_qty
     FROM mirai_packages m
     LEFT JOIN product_variants v ON v.mirai_package_code = m.package_code AND v.sku = 'MR-' || m.package_code
     ORDER BY m.quota_tokens ASC, m.duration_seconds ASC, m.package_code ASC`,
  );

  type MirrorJoinedRow = Record<string, unknown> & {
    quota_tokens: number;
    duration_seconds: number;
    package_code: string;
  };
  const mirror = sortMiraiPackagesByQuota<MirrorJoinedRow>(
    mirrorRaw.map((r) => ({
      ...r,
      quota_tokens: Number(r.quota_tokens),
      duration_seconds: Number(r.duration_seconds),
      package_code: String(r.package_code),
    })),
  );

  let anyVariantChanged = false;
  const rows = mirror.map((m) => {
    const family = miraiFamily({
      package_code: m.package_code,
      group: String(m.group_key),
      name: String(m.name),
      quota_tokens: m.quota_tokens,
      duration_seconds: m.duration_seconds,
    });
    const costUsdt = Number(m.cost_usdt);
    const vMarkup = m.v_markup_percent == null ? null : Number(m.v_markup_percent);
    const mMarkup = Number(m.markup_percent);
    const effectiveMarkup = vMarkup ?? mMarkup;
    const price = m.admin_price == null ? miraiSellPriceIdr(costUsdt, fx, effectiveMarkup) : Number(m.admin_price);
    const mirrorActive = Number(m.is_active ?? 1);
    const stock = mirrorActive === 1 ? (Number(m.unlimited) === 1 ? -1 : Math.max(0, Number(m.remaining_today ?? 0))) : 0;
    const maxQty = Math.max(1, Math.min(100, Number(m.max_quantity ?? 100)));
    const sortOrder = miraiVariantSortOrder(m.quota_tokens, m.duration_seconds);
    const durationDays =
      m.duration_seconds >= 86400 && m.duration_seconds % 86400 === 0 ? m.duration_seconds / 86400 : null;

    if (
      m.v_id == null ||
      Number(m.v_price) !== price ||
      Number(m.v_stock) !== stock ||
      Number(m.v_cost_usdt ?? 0) !== costUsdt ||
      Number(m.v_fx ?? 0) !== fx ||
      m.v_max_qty == null ||
      Number(m.v_max_qty) > 100
    ) {
      anyVariantChanged = true;
    }

    const sku = `MR-${m.package_code}`;
    const familyCopy = MIRAI_COPY[family.key];
    const variantCopy = familyCopy?.variants[sku];

    return {
      ...family,
      category: familyCopy?.category_id ?? family.category,
      package_code: m.package_code,
      description: familyCopy?.description ?? miraiDefaultDescription(family.name),
      description_en: familyCopy?.description_en ?? null,
      admin_terms: variantCopy?.admin_terms ?? null,
      admin_terms_en: variantCopy?.admin_terms_en ?? null,
      admin_activation: variantCopy?.admin_activation ?? null,
      admin_activation_en: variantCopy?.admin_activation_en ?? null,
      price,
      stock,
      max_qty: maxQty,
      sort_order: sortOrder,
      duration_value: durationDays,
      duration_unit: durationDays != null ? "day" : null,
      admin_price: m.admin_price ?? null,
      v_markup: vMarkup,
      m_markup: mMarkup,
      cost_usdt: costUsdt,
      synced_at: m.synced_at ?? null,
      mirror_active: mirrorActive,
    };
  });

  const json = JSON.stringify(rows);

  const newProdRes = await db.execRun(
    buildSupplierProductInsertSql({
      familyColumn: "mirai_family",
      hasDescriptionEn: true,
      imageExpr:
        "COALESCE((SELECT p.image_url FROM json_each(json_extract(j.value,'$.images')) i JOIN products p ON p.slug=i.value WHERE NULLIF(p.image_url,'') IS NOT NULL ORDER BY CAST(i.key AS INTEGER) LIMIT 1),json_extract(j.value,'$.imageUrl'))",
      conflictMode: "insert_or_ignore",
    }),
    json,
  );

  // Match explicit family ownership, never appropriate an existing WR/SK/TUNVN/AIVault product by name/slug.
  await db.execRun(
    `UPDATE mirai_packages SET axvara_product_id=(
       SELECT p.id FROM products p JOIN json_each(?) j ON p.mirai_family=json_extract(j.value,'$.key')
       WHERE json_extract(j.value,'$.package_code')=mirai_packages.package_code
         AND p.source='manual' AND p.fulfillment_mode='manual'
         AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL
         AND p.wr_auto_managed=0 AND p.sk_auto_managed=0
         AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL
     )
     WHERE package_code IN (SELECT json_extract(value,'$.package_code') FROM json_each(?))`,
    json,
    json,
  );

  const newVarRes = await db.execRun(
    `INSERT OR IGNORE INTO product_variants(product_id,sku,label,duration_value,duration_unit,price,stock,max_qty,fulfillment_mode,is_active,sort_order,mirai_package_code,mirai_markup_percent,mirai_cost_usdt,mirai_fx_idr_per_usdt,admin_terms,admin_terms_en,admin_activation,admin_activation_en)
     SELECT m.axvara_product_id,'MR-'||m.package_code,json_extract(j.value,'$.label'),
       json_extract(j.value,'$.duration_value'),json_extract(j.value,'$.duration_unit'),
       json_extract(j.value,'$.price'),json_extract(j.value,'$.stock'),json_extract(j.value,'$.max_qty'),
       'manual',0,json_extract(j.value,'$.sort_order'),m.package_code,NULL,m.cost_usdt,?,
       json_extract(j.value,'$.admin_terms'),json_extract(j.value,'$.admin_terms_en'),
       json_extract(j.value,'$.admin_activation'),json_extract(j.value,'$.admin_activation_en')
     FROM mirai_packages m JOIN json_each(?) j ON json_extract(j.value,'$.package_code')=m.package_code
     WHERE m.axvara_product_id IS NOT NULL
       AND EXISTS(SELECT 1 FROM products p WHERE p.id=m.axvara_product_id AND p.archived_at IS NULL)`,
    fx,
    json,
  );

  // CAS both admin inputs and mirror snapshot: a concurrent edit/sync cannot overwrite a newer decision.
  const updVarRes = await db.execRun(
    `UPDATE product_variants
     SET price=(SELECT json_extract(j.value,'$.price') FROM json_each(?) j WHERE json_extract(j.value,'$.package_code')=product_variants.mirai_package_code),
         stock=(SELECT json_extract(j.value,'$.stock') FROM json_each(?) j WHERE json_extract(j.value,'$.package_code')=product_variants.mirai_package_code),
         mirai_cost_usdt=(SELECT json_extract(j.value,'$.cost_usdt') FROM json_each(?) j WHERE json_extract(j.value,'$.package_code')=product_variants.mirai_package_code),
         mirai_fx_idr_per_usdt=?,
         max_qty=CASE WHEN max_qty IS NULL OR max_qty > 100 THEN 100 ELSE max_qty END,
         updated_at=datetime('now')
     WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL)
       AND sku='MR-'||mirai_package_code
       AND fulfillment_mode='manual'
       AND wr_variant_id IS NULL AND sk_variant_id IS NULL AND tunvn_buff_quantity_b IS NULL AND aivault_service_id IS NULL AND storebat_product_id IS NULL
       AND EXISTS(
         SELECT 1 FROM mirai_packages m JOIN json_each(?) j ON m.package_code=json_extract(j.value,'$.package_code')
         WHERE m.package_code=product_variants.mirai_package_code
           AND m.axvara_product_id=product_variants.product_id
           AND product_variants.mirai_admin_price_idr IS json_extract(j.value,'$.admin_price')
           AND product_variants.mirai_markup_percent IS json_extract(j.value,'$.v_markup')
           AND m.markup_percent IS json_extract(j.value,'$.m_markup')
           AND m.cost_usdt IS json_extract(j.value,'$.cost_usdt')
           AND m.synced_at IS json_extract(j.value,'$.synced_at')
           AND m.is_active IS json_extract(j.value,'$.mirror_active')
       )`,
    json,
    json,
    json,
    fx,
    json,
  );

  await db.execRun(
    `UPDATE mirai_packages
     SET sell_price_idr=(SELECT v.price FROM product_variants v WHERE v.mirai_package_code=mirai_packages.package_code AND v.product_id=mirai_packages.axvara_product_id),
         fx_idr_per_usdt=?
     WHERE axvara_product_id IS NOT NULL`,
    fx,
  );

  await db.execRun(
    `UPDATE products
     SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
         stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
           ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END
     WHERE products.archived_at IS NULL AND mirai_family IS NOT NULL`,
  );

  if (
    Number(newProdRes.changes ?? 0) > 0 ||
    Number(newVarRes.changes ?? 0) > 0 ||
    (anyVariantChanged && Number(updVarRes.changes ?? 0) > 0)
  ) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }

  return { ok: true, mirrored: rows.length, idr_per_usd: fx, idr_per_usdt: fx } as const;
}

export async function publishMiraiCatalog(
  db: DatabaseAccess,
  fx: number,
  opts: { force?: boolean; now?: number } = {},
) {
  if (!db.d1 || !isMiraiConfigured() || !isMiraiSyncEnabled()) {
    return { skipped: "not_configured" } as const;
  }
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(fx) || fx <= 0) {
    await recordSyncError(db, "mirai_catalog", "fx_unavailable", now);
    return { ok: false, error: "fx_unavailable" } as const;
  }
  if (!db.canSpend(22)) {
    await recordSyncError(db, "mirai_catalog", "catalog_budget_exceeded", now);
    return { ok: false, error: "catalog_budget_exceeded" } as const;
  }

  const lease = JSON.stringify({ owner: crypto.randomUUID(), until: now + MIRAI_LEASE_MS });
  const claim = await db.execRun(
    `INSERT INTO store_settings(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(store_settings.value,'$.until')<=?`,
    MIRAI_LEASE_KEY,
    lease,
    now,
  );
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" } as const;
  const fail = catalogFailureRecorder(db, "mirai_catalog", now, MIRAI_CATALOG_MIN_INTERVAL_MS, { key: MIRAI_LEASE_KEY, value: lease });

  try {
    const result = await syncMiraiCatalog(db, { ...opts, now, onFailure: fail });
    if (!("ok" in result) || !result.ok) return result;
    const projected = await projectMiraiCatalog(db, fx);
    if (!projected.ok) {
      return await fail(projected.error);
    }
    await recordSyncSuccess(db, "mirai_catalog", now);
    return projected;
  } catch (error) {
    return await fail(catalogWriteFailure(error));
  } finally {
    await db.execRun("DELETE FROM store_settings WHERE key=? AND value=?", MIRAI_LEASE_KEY, lease).catch(() => undefined);
  }
}
