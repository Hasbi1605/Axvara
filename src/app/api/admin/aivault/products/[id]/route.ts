import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { validServiceId } from "@/lib/aivault/client";
import { aivaultSellPrice } from "@/lib/aivault/families";
import {
  deriveAivaultBulkTiers,
  parseAivaultBulkMarkup,
  validateAivaultBulkAgainstBase,
  type AivaultBulkMarkupTier,
} from "@/lib/aivault/bulk";
export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema=z.object({
  markup_percent:z.number().min(0).max(1000).optional(),
  admin_price_idr:z.number().int().positive().max(1000000000).nullable().optional(),
  is_active:z.boolean().optional(),
  bulk_markup_tiers:z.unknown().optional(),
}).strict().refine(v=>Object.keys(v).length>0);
export async function PATCH(request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  if (!await requireAdmin(request)) return NextResponse.json({error:"unauthorized"},{status:401});
  const id=(await params).id;
  if (!validServiceId(id)) return NextResponse.json({error:"invalid_id"},{status:400});
  const raw=await readJsonBody(request,4096);
  if (!raw.ok) return raw.response;
  const parsed=schema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({error:"invalid_body"},{status:400});
  const hasBulkInput = Object.prototype.hasOwnProperty.call(raw.data as object, "bulk_markup_tiers");
  let requestedBulkTiers: AivaultBulkMarkupTier[] | null | undefined = undefined;
  if (hasBulkInput) {
    if (parsed.data.bulk_markup_tiers === null) {
      requestedBulkTiers = null;
    } else {
      if (!Array.isArray(parsed.data.bulk_markup_tiers)) {
        return NextResponse.json({ error: "invalid_bulk_markup" }, { status: 400 });
      }
      const validTiers = parseAivaultBulkMarkup(parsed.data.bulk_markup_tiers);
      if (!validTiers) {
        return NextResponse.json({ error: "invalid_bulk_markup" }, { status: 400 });
      }
      requestedBulkTiers = validTiers;
    }
  }
  const db=createDatabaseAccess();
  if (!db.d1) return NextResponse.json({error:"database_unavailable"},{status:503});
  try {
    const row=await db.queryFirst(`SELECT m.*,v.id AS vid,v.aivault_admin_price_idr,v.is_active FROM aivault_products m JOIN product_variants v ON v.aivault_service_id=m.service_id AND v.sku='AV-'||m.service_id AND v.product_id=m.axvara_product_id WHERE m.service_id=?`,id);
    if (!row) return NextResponse.json({error:"not_mapped"},{status:404});
    if (parsed.data.is_active === true && await db.queryFirst("SELECT id FROM products WHERE id=? AND archived_at IS NOT NULL", row.axvara_product_id)) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });
    const body=parsed.data,markup=body.markup_percent ?? Number(row.markup_percent), manual=body.admin_price_idr===undefined ? row.aivault_admin_price_idr : body.admin_price_idr;
    const fx=Number(row.fx_idr_per_usd);
    if (!(fx>0)) return NextResponse.json({error:"fx_unavailable"},{status:409});
    const unitPriceUsd = Number(row.unit_price_usd);
    const price=manual==null ? aivaultSellPrice(unitPriceUsd,fx,markup) : Number(manual);
    const effectiveBulkTiers = hasBulkInput
      ? requestedBulkTiers ?? null
      : (row.bulk_markup_tiers_json == null ? null : parseAivaultBulkMarkup(row.bulk_markup_tiers_json));
    if (effectiveBulkTiers) {
      const baseCheck = validateAivaultBulkAgainstBase(
        effectiveBulkTiers,
        markup,
        manual == null ? null : Number(manual),
      );
      if (baseCheck !== "ok") {
        return NextResponse.json({ error: "bulk_markup_not_below_base" }, { status: 400 });
      }
    }
    const nextBulkMarkupJson = hasBulkInput
      ? (requestedBulkTiers === null ? null : JSON.stringify(requestedBulkTiers))
      : (row.bulk_markup_tiers_json == null ? null : String(row.bulk_markup_tiers_json));
    const derivedBulk = effectiveBulkTiers
      ? deriveAivaultBulkTiers(unitPriceUsd, fx, price, effectiveBulkTiers)
      : [];
    const bulkEnabled = derivedBulk.length > 0 ? 1 : 0;
    const bulkTiersJson = derivedBulk.length > 0 ? JSON.stringify(derivedBulk) : "[]";
    const guard=crypto.randomUUID();
    await db.d1.batch([
      db.d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM aivault_products m JOIN product_variants v ON v.aivault_service_id=m.service_id WHERE m.service_id=? AND m.markup_percent IS ? AND m.fx_idr_per_usd IS ? AND m.unit_price_usd IS ? AND m.bulk_markup_tiers_json IS ? AND v.id=? AND v.aivault_admin_price_idr IS ? AND v.is_active IS ?) THEN 1 ELSE 0 END`).bind(guard,id,row.markup_percent,row.fx_idr_per_usd,row.unit_price_usd,row.bulk_markup_tiers_json ?? null,row.vid,row.aivault_admin_price_idr,row.is_active),
      db.d1.prepare("UPDATE aivault_products SET markup_percent=?,sell_price_idr=?,bulk_markup_tiers_json=?,updated_at=datetime('now') WHERE service_id=?").bind(markup,price,nextBulkMarkupJson,id),
      db.d1.prepare("UPDATE product_variants SET aivault_admin_price_idr=?,price=?,is_active=?,bulk_pricing_enabled=?,bulk_pricing_tiers=?,max_qty=CASE WHEN max_qty IS NULL OR max_qty > 100 THEN 100 ELSE max_qty END,updated_at=datetime('now') WHERE id=?").bind(manual,price,body.is_active===undefined ? row.is_active : Number(body.is_active),bulkEnabled,bulkTiersJson,row.vid),
      db.d1.prepare(`UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),stock=COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) WHERE id=?`).bind(row.axvara_product_id),
      db.d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    return NextResponse.json({ok:true});
  } catch (error) { if (String(error).includes("product_archived")) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 }); return NextResponse.json({error:"save_failed_or_stale"},{status:409}); }
}
