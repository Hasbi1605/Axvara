import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { STOREBAT_PARENT_REFRESH, STOREBAT_SKU_SQL } from "@/lib/storebat/catalog";
import { positiveId } from "@/lib/storebat/client";
import { storebatSellPrice } from "@/lib/storebat/families";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (value: unknown,status = 200) => NextResponse.json(value,{ status, headers:{ "Cache-Control":"private, no-store" } });
const schema = z.object({ markup_percent:z.number().min(0).max(1000).optional(), admin_price_idr:z.number().int().positive().max(1e9).nullable().optional(), is_active:z.boolean().optional() }).strict().refine(v=>Object.keys(v).length>0);
export async function PATCH(request: NextRequest,{params}:{params:Promise<{id:string}>}) {
  if (!await requireAdmin(request)) return json({error:"unauthorized"},401);
  const text = (await params).id, id = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !positiveId(id)) return json({error:"invalid_id"},400);
  const raw = await readJsonBody(request,4096);
  if (!raw.ok) { raw.response.headers.set("Cache-Control","private, no-store"); return raw.response; }
  const parsed = schema.safeParse(raw.data);
  if (!parsed.success) return json({error:"invalid_body"},400);
  const db = createDatabaseAccess(), d1 = db.d1;
  if (!d1) return json({error:"database_unavailable"},503);
  try {
    const row = await db.queryFirst(`SELECT v.*,p.archived_at FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE v.storebat_product_id=? AND v.sku=${STOREBAT_SKU_SQL("v.storebat_product_id")} AND p.storebat_family IS NOT NULL`,id);
    if (!row) return json({error:"not_mapped"},404);
    if (row.archived_at && parsed.data.is_active) return json({error:ARCHIVED_MESSAGE},409);
    const body = parsed.data;
    const markup = body.markup_percent ?? Number(row.storebat_markup_percent ?? (id===124 ? 40 : 35));
    const manual = body.admin_price_idr === undefined ? row.storebat_admin_price_idr : body.admin_price_idr;
    const fx = Number(row.storebat_fx_idr_per_usd), cost = Number(row.storebat_cost_usd);
    if (!(fx>0 && cost>0)) return json({error:"fx_unavailable"},409);
    const price = manual == null ? storebatSellPrice(cost,fx,markup) : Number(manual), active = body.is_active === undefined ? row.is_active : Number(body.is_active);
    if (row.storebat_markup_percent === markup && row.storebat_admin_price_idr === manual && row.price === price && row.is_active === active) return json({ok:true});
    const guard = crypto.randomUUID();
    await d1.batch([
      d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,EXISTS(SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id
        WHERE v.id=? AND p.id=? AND p.storebat_family IS NOT NULL AND p.archived_at IS ? AND v.storebat_product_id=? AND v.sku=?
        AND v.price IS ? AND v.is_active IS ? AND v.storebat_admin_price_idr IS ? AND v.storebat_markup_percent IS ? AND v.storebat_fx_idr_per_usd IS ? AND v.storebat_cost_usd IS ?)`).bind(guard,row.id,row.product_id,row.archived_at,id,row.sku,row.price,row.is_active,row.storebat_admin_price_idr,row.storebat_markup_percent,row.storebat_fx_idr_per_usd,row.storebat_cost_usd),
      d1.prepare("UPDATE product_variants SET price=?,is_active=?,storebat_markup_percent=?,storebat_admin_price_idr=?,updated_at=datetime('now') WHERE id=?").bind(price,active,markup,manual,row.id),
      d1.prepare(`UPDATE products ${STOREBAT_PARENT_REFRESH} WHERE id=? AND archived_at IS NULL`).bind(row.product_id),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    await bumpCatalogRevision("market",db);
    return json({ok:true});
  } catch { return json({error:"save_failed_or_stale"},409); }
}
