import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readSyncStatusSettings } from "@/lib/sync-status";
import { isAivaultConfigured, isAivaultEnabled, isAivaultSyncEnabled } from "@/lib/aivault/client";
import { aivaultFamily } from "@/lib/aivault/families";
import { parseAivaultBulkMarkup } from "@/lib/aivault/bulk";
import { validateBulkPricing, type BulkTier } from "@/lib/bulk-pricing";
import { computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const db=createDatabaseAccess();
    const items=await db.queryAll(`SELECT m.*,v.id AS variant_id,v.product_id AS pv_product_id,v.label,v.price AS variant_price,v.is_active AS variant_active,v.aivault_admin_price_idr,
      v.stock AS pv_stock,v.min_qty AS pv_min_qty,v.fulfillment_mode AS pv_fulfillment_mode,
      CASE WHEN v.fulfillment_mode='unique' THEN (
        SELECT COUNT(*) FROM fulfillment_inventory fi WHERE fi.product_id=v.product_id AND fi.variant_id=v.id AND fi.status='available'
      ) ELSE NULL END AS inventory_available,
      v.bulk_pricing_enabled,v.bulk_pricing_tiers,
      p.name AS product_name,p.slug AS product_slug,p.is_active AS product_active,p.archived_at AS product_archived_at,p.aivault_family FROM aivault_products m
      LEFT JOIN products p ON p.id=m.axvara_product_id LEFT JOIN product_variants v ON v.aivault_service_id=m.service_id AND v.product_id=p.id ORDER BY m.service_id`);
    const {lastSyncAt,lastError}=await readSyncStatusSettings(db,"aivault_catalog","aivault_catalog_sync_at");
    const loserToWinner = await loadProductGroupLosers(db.queryAll);
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
      const productArchived = row.product_archived_at != null ? 1 : 0;
      const live = computeVariantLiveStatus(
        {
          axvara_product_id: row.pv_product_id ?? row.axvara_product_id,
          variant_id: row.variant_id,
          variant_active: row.variant_active,
          product_active: row.product_active,
          product_archived: productArchived,
          stock: row.pv_stock ?? row.stock,
          min_qty: row.pv_min_qty ?? 1,
          fulfillment_mode: row.pv_fulfillment_mode ?? "manual",
          inventory_available: row.inventory_available,
        },
        loserToWinner,
      );
      return {
        ...row,
        price_usd:Number(row.unit_price_usd),
        admin_price_idr:row.aivault_admin_price_idr ?? null,
        family:aivaultFamily(String(row.service_id),String(row.name)),
        product_archived:productArchived,
        variant_status:live.status,
        variant_reason:live.reason,
        bulk_markup_tiers: bulkMarkupTiers,
        bulk_tiers_preview: bulkTiersPreview,
      };
    }),last_sync_at:lastSyncAt,last_error:lastError},{headers:{"Cache-Control":"private, no-store"}});
  } catch { return NextResponse.json({error:"load_failed"},{status:503}); }
}
