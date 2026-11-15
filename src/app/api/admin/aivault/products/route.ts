import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isAivaultConfigured } from "@/lib/aivault/client";
import { aivaultFamily } from "@/lib/aivault/families";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  try {
    const db=createDatabaseAccess();
    const items=await db.queryAll(`SELECT m.*,v.id AS variant_id,v.label,v.price AS variant_price,v.is_active AS variant_active,v.aivault_admin_price_idr,
      p.name AS product_name,p.is_active AS product_active,p.archived_at AS product_archived_at,p.aivault_family FROM aivault_products m
      LEFT JOIN products p ON p.id=m.axvara_product_id LEFT JOIN product_variants v ON v.aivault_service_id=m.service_id AND v.product_id=p.id ORDER BY m.service_id`);
    const last=await db.queryFirst("SELECT value FROM store_settings WHERE key='aivault_catalog_sync_at'");
    return NextResponse.json({ok:true,configured:isAivaultConfigured(),items:items.map(row=>({...row,family:aivaultFamily(String(row.service_id),String(row.name)),product_archived:row.product_archived_at!=null?1:0})),last_sync_at:last?.value ?? null},{headers:{"Cache-Control":"private, no-store"}});
  } catch { return NextResponse.json({error:"load_failed"},{status:503}); }
}
