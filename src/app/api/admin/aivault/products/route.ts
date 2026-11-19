import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readSyncStatusSettings } from "@/lib/sync-status";
import { isAivaultConfigured, isAivaultEnabled, isAivaultSyncEnabled } from "@/lib/aivault/client";
import { aivaultFamily } from "@/lib/aivault/families";
import { parseAivaultBulkMarkup } from "@/lib/aivault/bulk";
import { validateBulkPricing, type BulkTier } from "@/lib/bulk-pricing";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const db=createDatabaseAccess();
    const items=await db.queryAll(`SELECT m.*,v.id AS variant_id,v.label,v.price AS variant_price,v.is_active AS variant_active,v.aivault_admin_price_idr,
      v.bulk_pricing_enabled,v.bulk_pricing_tiers,
      p.name AS product_name,p.slug AS product_slug,p.is_active AS product_active,p.archived_at AS product_archived_at,p.aivault_family FROM aivault_products m
      LEFT JOIN products p ON p.id=m.axvara_product_id LEFT JOIN product_variants v ON v.aivault_service_id=m.service_id AND v.product_id=p.id ORDER BY m.service_id`);
    const {lastSyncAt,lastError}=await readSyncStatusSettings(db,"aivault_catalog","aivault_catalog_sync_at");
    return NextResponse.json({ok:true,configured:isAivaultConfigured(),dispatch_enabled:isAivaultEnabled(),sync_enabled:isAivaultSyncEnabled(),items:items.map(row=>{
      const bulkMarkupTiers = parseAivaultBulkMarkup(row.bulk_markup_tiers_json);
      let bulkTiersPreview: BulkTier[] = [];
      if (Number(row.bulk_pricing_enabled ?? 0) === 1 && row.bulk_pricing_tiers && row.variant_price != null) {
        try {
          const parsedPreview = JSON.parse(String(row.bulk_pricing_tiers));
          const checked = validateBulkPricing({ enabled: true, tiers: parsedPreview }, Number(row.variant_price));
          if (checked) bulkTiersPreview = checked.tiers;
        } catch {
          bulkTiersPreview = [];
        }
      }
      return {
        ...row,
        price_usd:Number(row.unit_price_usd),
        admin_price_idr:row.aivault_admin_price_idr ?? null,
        family:aivaultFamily(String(row.service_id),String(row.name)),
        product_archived:row.product_archived_at!=null?1:0,
        bulk_markup_tiers: bulkMarkupTiers,
        bulk_tiers_preview: bulkTiersPreview,
      };
    }),last_sync_at:lastSyncAt,last_error:lastError},{headers:{"Cache-Control":"private, no-store"}});
  } catch { return NextResponse.json({error:"load_failed"},{status:503}); }
}
