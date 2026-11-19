import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { parseStoredSyncError } from "@/lib/sync-status";
import { isStorebatConfigured, isStorebatEnabled, isStorebatSyncEnabled } from "@/lib/storebat/client";
import { STOREBAT_SKU_SQL } from "@/lib/storebat/catalog";
import { storebatFamily } from "@/lib/storebat/families";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (value: unknown,status = 200) => NextResponse.json(value,{ status, headers:{ "Cache-Control":"private, no-store" } });
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({error:"unauthorized"},401);
  try {
    const db = createDatabaseAccess();
    if (!db.d1) return json({error:"database_unavailable"},503);
    const items = await db.queryAll(`WITH feed AS (
      SELECT id,name,price_usd,stock,delivery_type,disappeared,price_tiers_json,warranty_days,pricing_type,standard_price_usd,last_seen_at
      FROM storebat_products WHERE api_test=0 AND id NOT IN (124,129,2147483000)
      UNION ALL SELECT 124,'Muse AI Buff Token',price_per_billion,CASE WHEN available=1 THEN -1 ELSE 0 END,'muse_buff',1-available,'[]',0,'standard',NULL,updated_at
      FROM storebat_services WHERE service='muse_buff'
    ) SELECT f.*,v.id AS variant_id,v.sku,v.label,v.price AS variant_price,v.is_active AS variant_active,
      v.storebat_admin_price_idr AS admin_price_idr,v.storebat_fx_idr_per_usd AS fx_idr_per_usd,
      COALESCE(v.storebat_markup_percent,CASE WHEN f.id=124 THEN 40 ELSE 35 END) AS markup_percent,
      p.id AS axvara_product_id,p.name AS product_name,p.slug AS product_slug,p.is_active AS product_active,p.archived_at AS product_archived_at
      FROM feed f LEFT JOIN product_variants v ON v.storebat_product_id=f.id AND v.sku=${STOREBAT_SKU_SQL("f.id")}
      LEFT JOIN products p ON p.id=v.product_id ORDER BY f.id`);
    const settings = await db.queryAll(`SELECT key,value FROM store_settings WHERE key IN ('storebat_catalog_success_at','storebat_catalog_last_error')`);
    return json({ ok:true, configured:isStorebatConfigured(), dispatch_enabled:isStorebatEnabled(), sync_enabled:isStorebatSyncEnabled(),
      items:items.map(row=>({ ...row,family:storebatFamily(Number(row.id),String(row.name)),product_archived:row.product_archived_at != null ? 1 : 0 })),
      last_sync_at:settings.find(r=>r.key==="storebat_catalog_success_at")?.value ?? null,
      last_error:parseStoredSyncError(settings.find(r=>r.key==="storebat_catalog_last_error")?.value) });
  } catch { return json({error:"load_failed"},503); }
}
