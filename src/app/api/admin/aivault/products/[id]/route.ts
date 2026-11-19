import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { validServiceId } from "@/lib/aivault/client";
import {
  parseAivaultBulkMarkup,
  type AivaultBulkMarkupTier,
} from "@/lib/aivault/bulk";
import { AIVAULT_MARKUP_SELECT_FROM, applyAivaultMarkupUpdate } from "@/lib/aivault/markup";
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
    const row=await db.queryFirst(`${AIVAULT_MARKUP_SELECT_FROM} AND m.service_id=?`,id);
    if (!row) return NextResponse.json({error:"not_mapped"},{status:404});
    const outcome = await applyAivaultMarkupUpdate(db, row, {
      markup_percent: parsed.data.markup_percent,
      admin_price_idr: parsed.data.admin_price_idr,
      is_active: parsed.data.is_active,
      bulk_markup_tiers: requestedBulkTiers,
      has_bulk_input: hasBulkInput,
    });
    if (!outcome.ok) return NextResponse.json({error:outcome.error},{status:outcome.status});
    if (outcome.changed) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("market", db);
    }
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:"save_failed_or_stale"},{status:409}); }
}
