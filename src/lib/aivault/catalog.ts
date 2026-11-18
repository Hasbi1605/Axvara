import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { mapSkCategory } from "@/lib/sekalipay/sync";
import { isAivaultConfigured, isAivaultSyncEnabled } from "./client";
import { AIVAULT_CATALOG_MIN_INTERVAL_MS, syncAivaultCatalog } from "./sync";
import { aivaultFamily, aivaultSellPrice, aivaultDefaultDescription } from "./families";
import { deriveAivaultBulkTiers, parseAivaultBulkMarkup } from "./bulk";

/** Fixed publisher statement count, regardless of family count. Copy and activation are admin-owned. */
export async function projectAivaultCatalog(db: DatabaseAccess, fx: number) {
  if (!db.d1 || !db.canSpend(9)) return { ok: false, error: "catalog_budget_exceeded" } as const;
  if (!Number.isFinite(fx) || fx <= 0) return { ok: false, error: "fx_unavailable" } as const;
  const mirror = await db.queryAll(`SELECT m.*,v.aivault_admin_price_idr AS admin_price,
    v.id AS v_id,v.price AS v_price,v.stock AS v_stock,v.bulk_pricing_enabled AS v_bulk_enabled,
    v.bulk_pricing_tiers AS v_bulk_tiers,v.max_qty AS v_max_qty
    FROM aivault_products m
    LEFT JOIN product_variants v ON v.aivault_service_id=m.service_id AND v.sku='AV-'||m.service_id`);
  let anyVariantChanged = false;
  const rows = mirror.map(m => {
    const family = aivaultFamily(String(m.service_id),String(m.name));
    const unitPrice = Number(m.unit_price_usd);
    const markup = Number(m.markup_percent);
    const price = m.admin_price == null ? aivaultSellPrice(unitPrice,fx,markup) : Number(m.admin_price);
    const bulkMarkupRaw = m.bulk_markup_tiers_json == null ? null : String(m.bulk_markup_tiers_json);
    const parsedBulk = parseAivaultBulkMarkup(m.bulk_markup_tiers_json);
    const derivedBulk = parsedBulk ? deriveAivaultBulkTiers(unitPrice,fx,price,parsedBulk) : [];
    const stock = Number(m.stock);
    const bulkEnabled = derivedBulk.length > 0 ? 1 : 0;
    const bulkTiersJson = derivedBulk.length > 0 ? JSON.stringify(derivedBulk) : "[]";
    if (m.v_id == null
      || Number(m.v_price) !== price
      || Number(m.v_stock) !== stock
      || Number(m.v_bulk_enabled ?? 0) !== bulkEnabled
      || String(m.v_bulk_tiers ?? "[]") !== bulkTiersJson
      || m.v_max_qty == null
      || Number(m.v_max_qty) > 100) {
      anyVariantChanged = true;
    }
    return { ...family, service_id:m.service_id, description:aivaultDefaultDescription(family.name), category:mapSkCategory(family.name),
      price,
      stock, admin_price:m.admin_price ?? null, markup, unit_price:unitPrice, synced_at:m.synced_at,
      bulk_markup:bulkMarkupRaw, bulk_enabled:bulkEnabled, bulk_tiers:bulkTiersJson };
  });
  const json = JSON.stringify(rows);
  const newProdRes = await db.execRun(`INSERT OR IGNORE INTO products(category_id,name,slug,description,price,image_url,stock,is_active,source,fulfillment_mode,telegram_enabled,aivault_family)
    SELECT COALESCE((SELECT id FROM categories WHERE id=json_extract(j.value,'$.category')),(SELECT id FROM categories ORDER BY id LIMIT 1)),
      json_extract(j.value,'$.name'),json_extract(j.value,'$.slug'),json_extract(j.value,'$.description'),MIN(json_extract(j.value,'$.price')),
      (SELECT p.image_url FROM json_each(json_extract(j.value,'$.images')) i JOIN products p ON p.slug=i.value WHERE p.image_url IS NOT NULL AND p.image_url<>'' ORDER BY CAST(i.key AS INTEGER) LIMIT 1),
      0,0,'manual','manual',1,json_extract(j.value,'$.key') FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.aivault_family=json_extract(j.value,'$.key')) GROUP BY json_extract(j.value,'$.key')`, json);
  // Match explicit family ownership, never appropriate an existing WR/SK/TUNVN product by name/slug.
  await db.execRun(`UPDATE aivault_products SET axvara_product_id=(SELECT p.id FROM products p JOIN json_each(?) j ON p.aivault_family=json_extract(j.value,'$.key')
    WHERE json_extract(j.value,'$.service_id')=aivault_products.service_id AND p.source='manual' AND p.fulfillment_mode='manual' AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0)
    WHERE service_id IN (SELECT json_extract(value,'$.service_id') FROM json_each(?))`,json,json);
  const newVarRes = await db.execRun(`INSERT OR IGNORE INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id)
    SELECT m.axvara_product_id,'AV-'||m.service_id,json_extract(j.value,'$.label'),json_extract(j.value,'$.price'),m.stock,'manual',0,m.service_id
    FROM aivault_products m JOIN json_each(?) j ON json_extract(j.value,'$.service_id')=m.service_id WHERE m.axvara_product_id IS NOT NULL AND EXISTS(SELECT 1 FROM products p WHERE p.id=m.axvara_product_id AND p.archived_at IS NULL)`,json);
  // CAS both admin inputs and mirror snapshot: a concurrent edit/sync cannot overwrite a newer decision.
  const updVarRes = await db.execRun(`UPDATE product_variants SET price=(SELECT json_extract(j.value,'$.price') FROM json_each(?) j WHERE json_extract(j.value,'$.service_id')=product_variants.aivault_service_id),
    stock=(SELECT m.stock FROM aivault_products m WHERE m.service_id=product_variants.aivault_service_id),
    bulk_pricing_enabled=(SELECT json_extract(j.value,'$.bulk_enabled') FROM json_each(?) j WHERE json_extract(j.value,'$.service_id')=product_variants.aivault_service_id),
    bulk_pricing_tiers=(SELECT json_extract(j.value,'$.bulk_tiers') FROM json_each(?) j WHERE json_extract(j.value,'$.service_id')=product_variants.aivault_service_id),
    max_qty=CASE WHEN max_qty IS NULL OR max_qty > 100 THEN 100 ELSE max_qty END,
    updated_at=datetime('now')
    WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND sku='AV-'||aivault_service_id AND fulfillment_mode='manual' AND wr_variant_id IS NULL AND sk_variant_id IS NULL AND tunvn_buff_quantity_b IS NULL
    AND EXISTS(SELECT 1 FROM aivault_products m JOIN json_each(?) j ON m.service_id=json_extract(j.value,'$.service_id')
      WHERE m.service_id=product_variants.aivault_service_id AND m.axvara_product_id=product_variants.product_id
      AND product_variants.aivault_admin_price_idr IS json_extract(j.value,'$.admin_price') AND m.markup_percent IS json_extract(j.value,'$.markup')
      AND m.unit_price_usd IS json_extract(j.value,'$.unit_price') AND m.synced_at IS json_extract(j.value,'$.synced_at')
      AND m.bulk_markup_tiers_json IS json_extract(j.value,'$.bulk_markup'))`,json,json,json,json);
  await db.execRun(`UPDATE aivault_products SET sell_price_idr=(SELECT v.price FROM product_variants v WHERE v.aivault_service_id=aivault_products.service_id AND v.product_id=aivault_products.axvara_product_id),fx_idr_per_usd=? WHERE axvara_product_id IS NOT NULL`,fx);
  await db.execRun(`UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
    stock=COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0)
    WHERE products.archived_at IS NULL AND aivault_family IS NOT NULL`);
  if (Number(newProdRes.changes ?? 0) > 0 || Number(newVarRes.changes ?? 0) > 0 || (anyVariantChanged && Number(updVarRes.changes ?? 0) > 0)) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
  }
  return { ok: true, mirrored:rows.length, idr_per_usd:fx } as const;
}
export async function publishAivaultCatalog(db: DatabaseAccess, fx: number, opts: { force?: boolean; now?: number } = {}) {
  if (!db.d1 || !isAivaultConfigured() || !isAivaultSyncEnabled()) return { skipped: "not_configured" } as const;
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(fx) || fx <= 0) {
    await recordSyncError(db, "aivault_catalog", "fx_unavailable", now);
    return { ok:false, error:"fx_unavailable" } as const;
  }
  if (!db.canSpend(22)) {
    await recordSyncError(db, "aivault_catalog", "catalog_budget_exceeded", now);
    return { ok:false,error:"catalog_budget_exceeded" } as const;
  }
  const lease = JSON.stringify({ owner:crypto.randomUUID(), until:now+45_000 });
  const claim = await db.execRun(`INSERT INTO store_settings(key,value) VALUES('aivault_catalog_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(store_settings.value,'$.until')<=?`,lease,now);
  if (claim.changes !== 1) return { skipped:"claimed_elsewhere" } as const;
  const fail = catalogFailureRecorder(db,"aivault_catalog",now,AIVAULT_CATALOG_MIN_INTERVAL_MS,{key:"aivault_catalog_lease",value:lease});
  try {
    const result = await syncAivaultCatalog(db,{...opts, now, onFailure: fail});
    if (!("ok" in result) || !result.ok) return result;
    const projected = await projectAivaultCatalog(db,fx);
    if (!projected.ok) {
      return await fail(projected.error);
    }
    await recordSyncSuccess(db, "aivault_catalog", now);
    return projected;
  } catch (error) {
    return await fail(catalogWriteFailure(error));
  } finally { await db.execRun("DELETE FROM store_settings WHERE key='aivault_catalog_lease' AND value=?",lease).catch(() => undefined); }
}
