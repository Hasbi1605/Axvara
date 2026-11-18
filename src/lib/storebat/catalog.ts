import type { DatabaseAccess } from "@/lib/db-access";
import { catalogFailureRecorder, catalogWriteFailure, recordSyncError } from "@/lib/sync-status";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { mapSkCategory } from "@/lib/sekalipay/sync";
import { isStorebatConfigured, isStorebatSyncEnabled, STOREBAT_BUFF_ID } from "./client";
import { STOREBAT_COPY } from "./copy";
import { storebatDefaultDescription, storebatFamily, storebatSellPrice } from "./families";
import { STOREBAT_CATALOG_MIN_INTERVAL_MS, STOREBAT_ETAG_KEY, STOREBAT_LEASE_KEY, STOREBAT_SYNC_KEY, storebatLeaseGuard, syncStorebatCatalog } from "./sync";

export const STOREBAT_SKU_SQL = (id: string) => `CASE WHEN (${id})=124 THEN 'SB-BUFF' ELSE 'SB-'||(${id}) END`;
export const STOREBAT_PARENT_REFRESH = `SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
  stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
  ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END`;

/** Project as one bounded batch. All descriptive copy and activation remain admin-owned. */
export async function projectStorebatCatalog(db: DatabaseAccess, fx: number, lease: string) {
  if (!db.d1 || !db.canSpend(11)) return { ok:false,error:"catalog_budget_exceeded" } as const;
  if (!Number.isFinite(fx) || fx <= 0) return { ok:false,error:"fx_unavailable" } as const;
  const d1 = db.d1;
  const mirror = await db.queryAll(`WITH feed AS (
    SELECT id,name,price_usd,CASE WHEN disappeared=1 OR api_test=1 THEN 0 ELSE stock END stock,
      disappeared=0 AND api_test=0 AS can_create FROM storebat_products WHERE id<>124
    UNION ALL SELECT 124,'Muse AI Buff Token',price_per_billion,CASE WHEN available=1 THEN -1 ELSE 0 END,available
      FROM storebat_services WHERE service='muse_buff'
  ) SELECT f.*, v.id AS variant_id,v.storebat_admin_price_idr AS manual_price,v.storebat_markup_percent AS markup
    FROM feed f LEFT JOIN product_variants v ON v.storebat_product_id=f.id WHERE f.can_create=1 OR v.id IS NOT NULL`);
  const rows = mirror.map(m => {
    const id = Number(m.id), buff = id === STOREBAT_BUFF_ID, family = storebatFamily(id,String(m.name));
    const cost = Number(m.price_usd), markup = Number(m.markup ?? (buff ? 40 : 35));
    const sku = buff ? "SB-BUFF" : `SB-${id}`;
    const familyCopy = STOREBAT_COPY[family.key];
    const variantCopy = familyCopy?.variants[sku];
    return { ...family, id,
      description:familyCopy?.description ?? storebatDefaultDescription(family.name),
      description_en:familyCopy?.description_en ?? null,
      category:familyCopy?.category_id ?? family.category ?? mapSkCategory(family.name),
      admin_terms:variantCopy?.admin_terms ?? null,
      admin_terms_en:variantCopy?.admin_terms_en ?? null,
      admin_activation:variantCopy?.admin_activation ?? null,
      admin_activation_en:variantCopy?.admin_activation_en ?? null,
      price:m.manual_price ?? storebatSellPrice(cost,fx,markup), cost, fx, stock:m.stock, create:m.can_create, markup,
      markup_cas:m.markup ?? null, manual_price:m.manual_price ?? null, variant_id:m.variant_id ?? null, max_qty:buff ? 30 : 100, buyer_field:buff ? "muse_invite_code" : null };
  });
  const json = JSON.stringify(rows), guard = crypto.randomUUID();
  const owned = "p.source='manual' AND p.fulfillment_mode='manual' AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0 AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.mirai_family IS NULL";
  const batch = await d1.batch([
    d1.prepare(storebatLeaseGuard).bind(guard,lease),
    d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,NOT EXISTS(
      SELECT 1 FROM json_each(?) j JOIN product_variants v ON v.id=j.value->>'variant_id'
      WHERE v.storebat_admin_price_idr IS NOT (j.value->>'manual_price') OR v.storebat_markup_percent IS NOT (j.value->>'markup_cas'))`).bind(`${guard}:inputs`,json),
    d1.prepare(`INSERT INTO products(category_id,name,slug,description,description_en,price,image_url,stock,is_active,source,fulfillment_mode,telegram_enabled,storebat_family)
      SELECT COALESCE((SELECT id FROM categories WHERE id=j.value->>'category'),(SELECT id FROM categories ORDER BY id LIMIT 1)),
      j.value->>'name',j.value->>'slug',j.value->>'description',j.value->>'description_en',MIN(j.value->>'price'),
      COALESCE((SELECT p.image_url FROM json_each(j.value->'images') i JOIN products p ON p.slug=i.value WHERE NULLIF(p.image_url,'') IS NOT NULL ORDER BY CAST(i.key AS INTEGER) LIMIT 1),j.value->>'imageUrl'),
      0,0,'manual','manual',1,j.value->>'key' FROM json_each(?) j WHERE j.value->>'create'=1 GROUP BY j.value->>'key'
      ON CONFLICT DO NOTHING`).bind(json),
    d1.prepare(`INSERT INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id,storebat_markup_percent,storebat_cost_usd,storebat_fx_idr_per_usd,max_qty,buyer_field_key,admin_terms,admin_terms_en,admin_activation,admin_activation_en)
      SELECT p.id,${STOREBAT_SKU_SQL("j.value->>'id'")},j.value->>'label',j.value->>'price',j.value->>'stock','manual',0,j.value->>'id',j.value->>'markup',j.value->>'cost',j.value->>'fx',j.value->>'max_qty',j.value->>'buyer_field',j.value->>'admin_terms',j.value->>'admin_terms_en',j.value->>'admin_activation',j.value->>'admin_activation_en'
      FROM json_each(?) j JOIN products p ON p.storebat_family=j.value->>'key' WHERE j.value->>'create'=1 AND p.archived_at IS NULL AND ${owned}
      ON CONFLICT DO NOTHING`).bind(json),
    d1.prepare(`UPDATE product_variants AS v SET price=j.value->>'price',stock=j.value->>'stock',storebat_cost_usd=j.value->>'cost',storebat_fx_idr_per_usd=j.value->>'fx',updated_at=datetime('now')
      FROM json_each(?) j JOIN products p ON p.storebat_family=j.value->>'key'
      WHERE p.id=v.product_id AND p.archived_at IS NULL AND ${owned} AND v.id=j.value->>'variant_id' AND v.storebat_product_id=j.value->>'id'
        AND v.sku=${STOREBAT_SKU_SQL("v.storebat_product_id")} AND v.fulfillment_mode='manual'
        AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL AND v.tunvn_source_product_id IS NULL AND v.tunvn_buff_quantity_b IS NULL AND v.aivault_service_id IS NULL AND v.mirai_package_code IS NULL
        AND v.storebat_admin_price_idr IS (j.value->>'manual_price') AND v.storebat_markup_percent IS (j.value->>'markup_cas')
        AND (v.price IS NOT (j.value->>'price') OR v.stock IS NOT (j.value->>'stock') OR v.storebat_cost_usd IS NOT (j.value->>'cost') OR v.storebat_fx_idr_per_usd IS NOT (j.value->>'fx'))`).bind(json),
    d1.prepare(`UPDATE products ${STOREBAT_PARENT_REFRESH} WHERE archived_at IS NULL AND storebat_family IS NOT NULL
      AND (price IS NOT COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price)
      OR stock IS NOT (SELECT CASE WHEN MIN(stock)=-1 THEN -1 ELSE COALESCE(SUM(MAX(stock,0)),0) END FROM product_variants WHERE product_id=products.id AND is_active=1))`),
    d1.prepare("DELETE FROM operation_guards WHERE operation_id IN (?,?)").bind(guard,`${guard}:inputs`),
  ]);
  const changed = batch.slice(2,6).reduce((n,res) => n+Number(res.meta?.changes ?? 0),0);
  if (changed) await bumpCatalogRevision("market", db);
  return { ok:true, mirrored:rows.length, changed, idr_per_usd:fx } as const;
}

export async function publishStorebatCatalog(db: DatabaseAccess, fx: number, opts: { force?: boolean; now?: number } = {}) {
  if (!db.d1 || !isStorebatConfigured() || !isStorebatSyncEnabled()) return { skipped:"not_configured" } as const;
  const now = opts.now ?? Date.now();
  if (!Number.isFinite(fx) || fx <= 0 || !db.canSpend(24)) {
    const error = !Number.isFinite(fx) || fx <= 0 ? "fx_unavailable" : "catalog_budget_exceeded";
    await recordSyncError(db,"storebat_catalog",error,now);
    return { ok:false,error } as const;
  }
  const settings = await db.queryAll("SELECT key,value FROM store_settings WHERE key IN (?,?)",STOREBAT_SYNC_KEY,STOREBAT_ETAG_KEY);
  const last = Number(settings.find(r=>r.key===STOREBAT_SYNC_KEY)?.value);
  if (!opts.force && now-last >= 0 && now-last < STOREBAT_CATALOG_MIN_INTERVAL_MS) return { skipped:"throttled" } as const;
  const lease = JSON.stringify({ owner:crypto.randomUUID(), until:now+45_000 });
  const claim = await db.execRun(`INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(store_settings.value,'$.until')<=?`,STOREBAT_LEASE_KEY,lease,now);
  if (claim.changes !== 1) return { skipped:"claimed_elsewhere" } as const;
  const fail = catalogFailureRecorder(db,"storebat_catalog",now,STOREBAT_CATALOG_MIN_INTERVAL_MS,{key:STOREBAT_LEASE_KEY,value:lease});
  try {
    const throttle = await db.execRun(`INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE ?=1 OR CAST(store_settings.value AS INTEGER)<=?`,STOREBAT_SYNC_KEY,String(now),Number(!!opts.force),now-STOREBAT_CATALOG_MIN_INTERVAL_MS);
    if (throttle.changes !== 1) return { skipped:"throttled" } as const;
    const etag = settings.find(r=>r.key===STOREBAT_ETAG_KEY)?.value;
    const result = await syncStorebatCatalog(db,lease,now,!opts.force && typeof etag === "string" ? etag : null);
    if ("error" in result) return await fail(result.error ?? "catalog_sync_failed");
    if ("unchanged" in result) {
      const committed = await db.execRun(
        `INSERT INTO store_settings(key,value,updated_at)
         SELECT j.value->>0,j.value->>1,datetime('now') FROM json_each(?) j
         WHERE EXISTS(SELECT 1 FROM store_settings WHERE key=? AND value=? AND json_extract(value,'$.until')>unixepoch('now')*1000)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        JSON.stringify([["storebat_catalog_success_at",String(now)],["storebat_catalog_last_error",""]]),
        STOREBAT_LEASE_KEY,lease,
      );
      if (committed.changes !== 2) return await fail("catalog_lease_lost");
      return { ok:true, unchanged:true, changed:0 } as const;
    }
    const projected = await projectStorebatCatalog(db,fx,lease);
    if (!projected.ok) return await fail(projected.error);
    // An ETag must never acknowledge an unprojected mirror; failed projection is fetched again.
    const committed = await db.execRun(`INSERT INTO store_settings(key,value,updated_at)
      SELECT j.value->>0,j.value->>1,datetime('now') FROM json_each(?) j
      WHERE EXISTS(SELECT 1 FROM store_settings WHERE key=? AND value=? AND json_extract(value,'$.until')>unixepoch('now')*1000)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,JSON.stringify([[STOREBAT_ETAG_KEY,result.etag],["storebat_catalog_success_at",String(now)],["storebat_catalog_last_error",""]]),STOREBAT_LEASE_KEY,lease);
    if (committed.changes !== 3) return await fail("catalog_lease_lost");
    return projected;
  } catch (error) { return await fail(catalogWriteFailure(error)); }
  finally { await db.execRun("DELETE FROM store_settings WHERE key=? AND value=?",STOREBAT_LEASE_KEY,lease).catch(() => undefined); }
}
