import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError, recordSyncSuccess } from "@/lib/sync-status";
import { buildSupplierProductInsertSql } from "@/lib/supplier/product-insert";
import { isPixelverifConfigured, isPixelverifSyncEnabled } from "./client";
import { PIXELVERIF_COPY } from "./copy";
import { PIXELVERIF_FAMILY, PIXELVERIF_VARIANTS } from "./families";
import { pixelverifSellPriceIdr } from "./pricing";
import { PIXELVERIF_CATALOG_MIN_INTERVAL_MS, syncPixelverifCatalog } from "./sync";

export const PIXELVERIF_LEASE_KEY = "pixelverif_catalog_lease";
export const PIXELVERIF_LEASE_MS = 45_000;
export const PIXELVERIF_PARENT_REFRESH = `SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
  stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
  ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END`;

export async function projectPixelverifCatalog(db: DatabaseAccess, fx: number) {
  if (!db.d1 || !db.canSpend(9)) return { ok: false, error: "catalog_budget_exceeded" } as const;
  if (!Number.isFinite(fx) || fx <= 0) return { ok: false, error: "fx_unavailable" } as const;

  const services = await db.queryAll(`SELECT * FROM pixelverif_services ORDER BY service_key ASC`);
  // If no services yet, use variant specs with pricing from copy? But need credit_cost.
  // If services empty, we still need to project from hardcoded variants with cost from services fallback.
  const byKey = new Map<string, Record<string, unknown>>();
  for (const s of services) byKey.set(String(s.service_key), s as Record<string, unknown>);

  // Build rows for each variant spec
  const familyKey = PIXELVERIF_FAMILY.key;
  const familyCopy = PIXELVERIF_COPY[PIXELVERIF_FAMILY.key];

  // Fetch existing variant state for CAS price/stock
  const existing = await db.queryAll(
    `SELECT v.pixelverif_flow_type, v.pixelverif_validity, v.price AS v_price, v.stock AS v_stock,
            v.pixelverif_cost_usd AS v_cost, v.pixelverif_fx_idr_per_usd AS v_fx,
            v.pixelverif_admin_price_idr AS admin_price, v.pixelverif_markup_percent AS v_markup,
            v.id AS v_id, s.credit_cost AS s_cost, s.available AS s_available
     FROM (SELECT 'normal' AS flow, 3 AS val UNION ALL SELECT 'full', 3) f
     LEFT JOIN pixelverif_services s ON s.service_key = f.flow || '_' || f.val
     LEFT JOIN product_variants v ON v.pixelverif_flow_type = f.flow AND v.pixelverif_validity = f.val
     ORDER BY f.flow ASC`,
  );

  // Map variant -> pricing
  const rows: Array<Record<string, unknown> & { flow_type: string; validity: number; sku: string; label: string; price: number; stock: number; cost_usd: number; sort_order: number; admin_price: number | null; v_markup: number | null }> = [];
  let anyVariantChanged = false;

  for (const spec of PIXELVERIF_VARIANTS) {
    const svc = byKey.get(spec.service_key);
    const creditCost = svc ? Number(svc.credit_cost) : spec.flow_type === "normal" ? 1 : 1.5;
    // Join existing row for this flow
    const ex = existing.find((r) => String(r.pixelverif_flow_type) === spec.flow_type && Number(r.pixelverif_validity) === 3) as Record<string, unknown> | undefined;
    const vMarkup = ex?.v_markup == null ? null : Number(ex.v_markup);
    // services table doesn't have markup_percent; use default 35 or variant markup
    const effectiveMarkup = vMarkup ?? 35;
    const adminPrice = ex?.admin_price ?? null;
    const price = adminPrice == null ? pixelverifSellPriceIdr(creditCost, fx, effectiveMarkup) : Number(adminPrice);
    const available = svc ? Number(svc.available) : 1;
    const stock = available === 1 ? 1 : 0;
    const sortOrder = spec.flow_type === "normal" ? 1 : 2;

    if (
      ex?.v_id == null ||
      Number(ex.v_price) !== price ||
      Number(ex.v_stock) !== stock ||
      Number(ex.v_cost ?? 0) !== creditCost ||
      Number(ex.v_fx ?? 0) !== fx
    ) {
      anyVariantChanged = true;
    }

    rows.push({
      key: familyKey,
      name: PIXELVERIF_FAMILY.name,
      slug: PIXELVERIF_FAMILY.slug,
      description: familyCopy?.description ?? PIXELVERIF_FAMILY.description,
      description_en: familyCopy?.description_en ?? PIXELVERIF_FAMILY.description_en,
      category: familyCopy?.category_id ?? PIXELVERIF_FAMILY.category,
      imageUrl: PIXELVERIF_FAMILY.imageUrl,
      images: [] as string[],
      label: spec.label,
      flow_type: spec.flow_type,
      validity: spec.validity,
      sku: spec.sku,
      price,
      stock,
      min_qty: 1,
      max_qty: 1,
      sort_order: sortOrder,
      duration_value: 90,
      duration_unit: "day",
      admin_terms: ((familyCopy?.variants as Record<string, { admin_terms: string | null }>)?.[spec.sku]?.admin_terms ?? null) as string | null,
      admin_terms_en: ((familyCopy?.variants as Record<string, { admin_terms_en: string | null }>)?.[spec.sku]?.admin_terms_en ?? null) as string | null,
      admin_activation: ((familyCopy?.variants as Record<string, { admin_activation: string | null }>)?.[spec.sku]?.admin_activation ?? null) as string | null,
      admin_activation_en: ((familyCopy?.variants as Record<string, { admin_activation_en: string | null }>)?.[spec.sku]?.admin_activation_en ?? null) as string | null,
      cost_usd: creditCost as number,
      admin_price: adminPrice as number | null,
      v_markup: vMarkup as number | null,
    });
  }

  const json = JSON.stringify(rows);

  const newProdRes = await db.execRun(
    buildSupplierProductInsertSql({
      familyColumn: "pixelverif_family",
      hasDescriptionEn: true,
      imageExpr: "json_extract(j.value,'$.imageUrl')",
      conflictMode: "insert_or_ignore",
    }),
    json,
  );

  // Link services to product: find product id via family column then join
  // For pixelverif, services don't need axvara_product_id; but keep product linkage via product_variants.

  const newVarRes = await db.execRun(
    `INSERT OR IGNORE INTO product_variants(product_id,sku,label,duration_value,duration_unit,price,stock,min_qty,max_qty,fulfillment_mode,is_active,sort_order,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,pixelverif_fx_idr_per_usd,admin_terms,admin_terms_en,admin_activation,admin_activation_en)
     SELECT p.id, json_extract(j.value,'$.sku'), json_extract(j.value,'$.label'),
       json_extract(j.value,'$.duration_value'), json_extract(j.value,'$.duration_unit'),
       json_extract(j.value,'$.price'), json_extract(j.value,'$.stock'), 1, 1,
       'manual', 0, json_extract(j.value,'$.sort_order'),
       json_extract(j.value,'$.flow_type'), json_extract(j.value,'$.validity'),
       json_extract(j.value,'$.cost_usd'), ?,
       json_extract(j.value,'$.admin_terms'), json_extract(j.value,'$.admin_terms_en'),
       json_extract(j.value,'$.admin_activation'), json_extract(j.value,'$.admin_activation_en')
     FROM products p JOIN json_each(?) j ON p.pixelverif_family = json_extract(j.value,'$.key')
     WHERE p.source='manual' AND p.fulfillment_mode='manual'
       AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL
       AND p.wr_auto_managed=0 AND p.sk_auto_managed=0
       AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL AND p.mirai_family IS NULL
       AND p.archived_at IS NULL`,
    fx,
    json,
  );

  // Telegram sells this family too (owner decision 2026-11-22): the product
  // insert is born telegram_enabled=1. Deliberately NO force-update here:
  // an admin may switch the Telegram channel off and sync must respect it
  // (other suppliers never override an admin channel toggle either).

  // CAS the admin price and markup read above. If an admin edits either, the next sync retries.
  const updVarRes = await db.execRun(
    `UPDATE product_variants
     SET price=(SELECT json_extract(j.value,'$.price') FROM json_each(?) j WHERE json_extract(j.value,'$.sku')=product_variants.sku),
         stock=(SELECT json_extract(j.value,'$.stock') FROM json_each(?) j WHERE json_extract(j.value,'$.sku')=product_variants.sku),
         pixelverif_cost_usd=(SELECT json_extract(j.value,'$.cost_usd') FROM json_each(?) j WHERE json_extract(j.value,'$.sku')=product_variants.sku),
         pixelverif_fx_idr_per_usd=?,
         min_qty=1,
         max_qty=1,
         compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= (SELECT json_extract(j.value,'$.price') FROM json_each(?) j WHERE json_extract(j.value,'$.sku')=product_variants.sku) THEN NULL ELSE compare_price END,
         updated_at=datetime('now')
     WHERE EXISTS(SELECT 1 FROM products pp WHERE pp.id=product_variants.product_id AND pp.archived_at IS NULL AND pp.pixelverif_family IS NOT NULL)
       AND sku IN ('PV-NORMAL-3','PV-FULL-3')
       AND fulfillment_mode='manual'
       AND wr_variant_id IS NULL AND sk_variant_id IS NULL AND tunvn_buff_quantity_b IS NULL AND aivault_service_id IS NULL AND storebat_product_id IS NULL AND mirai_package_code IS NULL
        AND EXISTS(
          SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.sku')=product_variants.sku
            AND product_variants.pixelverif_flow_type=json_extract(j.value,'$.flow_type')
            AND product_variants.pixelverif_validity=json_extract(j.value,'$.validity')
            AND product_variants.pixelverif_admin_price_idr IS json_extract(j.value,'$.admin_price')
           AND product_variants.pixelverif_markup_percent IS json_extract(j.value,'$.v_markup')
       )`,
    json,
    json,
    json,
    fx,
    json,
    json,
  );

  await db.execRun(
    `UPDATE products
     SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
         stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
           ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END
     WHERE products.archived_at IS NULL AND pixelverif_family IS NOT NULL`,
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

export async function publishPixelverifCatalog(
  db: DatabaseAccess,
  fx: number,
  opts: { force?: boolean; now?: number } = {},
) {
  if (!db.d1 || !isPixelverifConfigured() || !isPixelverifSyncEnabled()) {
    return { skipped: "not_configured" } as const;
  }
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(fx) || fx <= 0) {
    await recordSyncError(db, "pixelverif_catalog", "fx_unavailable", now);
    return { ok: false, error: "fx_unavailable" } as const;
  }
  if (!db.canSpend(22)) {
    await recordSyncError(db, "pixelverif_catalog", "catalog_budget_exceeded", now);
    return { ok: false, error: "catalog_budget_exceeded" } as const;
  }

  const lease = JSON.stringify({ owner: crypto.randomUUID(), until: now + PIXELVERIF_LEASE_MS });
  const claim = await db.execRun(
    `INSERT INTO store_settings(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(store_settings.value,'$.until')<=?`,
    PIXELVERIF_LEASE_KEY,
    lease,
    now,
  );
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" } as const;
  const fail = catalogFailureRecorder(db, "pixelverif_catalog", now, PIXELVERIF_CATALOG_MIN_INTERVAL_MS, { key: PIXELVERIF_LEASE_KEY, value: lease });

  try {
    const result = await syncPixelverifCatalog(db, { ...opts, now, onFailure: fail });
    if (!("ok" in result) || !result.ok) return result;
    const projected = await projectPixelverifCatalog(db, fx);
    if (!projected.ok) {
      return await fail(projected.error);
    }
    await recordSyncSuccess(db, "pixelverif_catalog", now);
    return projected;
  } catch (error) {
    return await fail(catalogWriteFailure(error));
  } finally {
    await db.execRun("DELETE FROM store_settings WHERE key=? AND value=?", PIXELVERIF_LEASE_KEY, lease).catch(() => undefined);
  }
}
