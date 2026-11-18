import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess,createBudgetedDatabase } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { retryAivaultOrder,AIVAULT_RETRYABLE_SQL } from "@/lib/aivault/orders";
export const runtime = "edge";
export const dynamic = "force-dynamic";
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({error:"unauthorized"},401);
  try {
    const items=await createDatabaseAccess().queryAll(`SELECT id,order_code,item_index,service_id,quantity,cost_usd,external_order_id,provider_order_id,status,attempt_count,request_sent_at,last_error,completed_at,receipt_json,
      CASE WHEN receipt_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS has_receipt,
      CASE WHEN ${AIVAULT_RETRYABLE_SQL} THEN 1 ELSE 0 END AS can_retry FROM aivault_order_links ORDER BY id DESC LIMIT 100`);
    return json({ok:true,items});
  } catch { return json({error:"load_failed"},503); }
}
export async function POST(request: NextRequest) {
  // requireAdmin audits this POST before revealing private encrypted receipts.
  if (!await requireAdmin(request)) return json({error:"unauthorized"},401);
  const raw=await readJsonBody(request,1024);
  if (!raw.ok) return raw.response;
  const parsed=z.object({id:z.number().int().positive(),action:z.enum(["retry","reveal"])}).strict().safeParse(raw.data);
  if (!parsed.success) return json({error:"invalid_request"},400);
  try {
    const db=createBudgetedDatabase(40,0).access;
    const link=await db.queryFirst("SELECT * FROM aivault_order_links WHERE id=?",parsed.data.id);
    if (!link) return json({error:"not_found"},404);
    if (parsed.data.action==="reveal") {
      if (!link.receipt_ciphertext || !link.receipt_iv) return json({error:"no_receipt"},404);
      return json({ok:true,receipt:await decryptSecret(String(link.receipt_ciphertext),String(link.receipt_iv))});
    }
    if (!await retryAivaultOrder(db,Number(link.id))) return json({error:"no_safe_retry"},409);
    const updated=await db.queryFirst("SELECT status,last_error FROM aivault_order_links WHERE id=?",link.id);
    if (updated?.status==="completed") {
      const { schedulePaidFulfillment }=await import("@/lib/payments/paid-fulfillment");
      await schedulePaidFulfillment(String(link.order_code),"apps","admin_aivault","supplier_settled");
    }
    return json({ok:true,link:updated});
  } catch { return json({error:"action_deferred"},503); }
}
