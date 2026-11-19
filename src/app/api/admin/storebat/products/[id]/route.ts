import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { positiveId } from "@/lib/storebat/client";
import { applyStorebatMarkupUpdate, STOREBAT_MARKUP_SELECT_FROM } from "@/lib/storebat/markup";

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
  const db = createDatabaseAccess();
  if (!db.d1) return json({error:"database_unavailable"},503);
  try {
    const row = await db.queryFirst(`${STOREBAT_MARKUP_SELECT_FROM} AND v.storebat_product_id=?`,id);
    if (!row) return json({error:"not_mapped"},404);
    const outcome = await applyStorebatMarkupUpdate(db, row, parsed.data);
    if (!outcome.ok) return json({error:outcome.error},outcome.status);
    if (outcome.changed) await bumpCatalogRevision("market",db);
    return json({ok:true});
  } catch { return json({error:"save_failed_or_stale"},409); }
}
