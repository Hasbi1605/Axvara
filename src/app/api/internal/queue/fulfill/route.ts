import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst } from "@/lib/db";
import { readJsonBody } from "@/lib/http-body";
import { constantTimeEqual, isValidBuyerOrderCode } from "@/lib/security";
import { fulfillPaidOrder } from "@/lib/payments/paid-fulfillment";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { isQueueExecutionEnabled } from "@/lib/payments/order-queue";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema = z.object({
  v: z.literal(1), kind: z.enum(["order_paid", "supplier_settled"]),
  orderCode: z.string().refine(isValidBuyerOrderCode), orderKind: z.enum(["apps", "pedia", "games"]),
  source: z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/),
  attempt: z.number().int().min(1).max(100), dryRun: z.boolean(),
}).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

type Work = Record<string, unknown>;
function timestamp(value: unknown): number {
  if (!value) return 0;
  const text = String(value);
  return Date.parse(text.includes("T") ? text : text.replace(" ", "T") + "Z") || 0;
}

/** settled means no unstarted work for this pass, NOT all supplier links
 * completed. One link/supplier/pass; remaining pre-send links retry, in-flight
 * async work belongs to cron, and admin-only work is never a transport error. */
async function outcome(order: Work, orderKind: string) {
  const code = String(order.code);
  const work = orderKind === "apps" ? await queryAll(`
    SELECT 'wr' AS domain, CASE WHEN status='completed' AND delivery_status IN ('queued','failed','sending') THEN 'delivery_pending' ELSE status END AS status,
      request_sent_at AS sent, CASE WHEN status='completed' AND delivery_status='sending' THEN delivery_next_attempt_at ELSE lease_expires_at END AS lease,
      next_attempt_at AS next_at FROM wr_order_links WHERE order_code=?
    UNION ALL SELECT 'sk',CASE WHEN l.status='completed' AND EXISTS (
      SELECT 1 FROM fulfillment_items f JOIN orders o ON o.code=f.order_code
      WHERE f.id=l.fulfillment_item_id AND f.status='delivered' AND f.delivered_ciphertext IS NOT NULL
        AND COALESCE(f.last_error,'') NOT LIKE 'manual_handover:%'
        AND ((o.sales_channel='telegram' AND (CAST(COALESCE(o.telegram_chat_id,'0') AS INTEGER)>0 OR
          EXISTS(SELECT 1 FROM telegram_users tu WHERE tu.user_id=o.telegram_user_id AND CAST(tu.chat_id AS INTEGER)>0)))
          OR (COALESCE(o.sales_channel,'web')!='telegram' AND COALESCE(o.customer_email,'') LIKE '%@%'))
        AND NOT EXISTS(SELECT 1 FROM buyer_notice_log b WHERE b.status='sent' AND b.idempotency_key IN (
          'email:sk-credential:'||f.order_code||':'||f.id, 'email:fulfillment-item:'||f.id,
          'telegram:sk-credential:'||f.order_code||':'||f.id))
      ) THEN 'delivery_pending' ELSE l.status END,request_sent_at,lease_expires_at,next_attempt_at FROM sk_order_links l WHERE order_code=?
    UNION ALL SELECT * FROM (
      SELECT 'tunvn',status,request_sent_at,lease_expires_at,next_attempt_at FROM tunvn_order_links WHERE order_code=?
      UNION ALL SELECT 'aivault',status,request_sent_at,lease_expires_at,next_attempt_at FROM aivault_order_links WHERE order_code=?
      UNION ALL SELECT 'storebat',status,request_sent_at,lease_expires_at,next_attempt_at FROM storebat_order_links WHERE order_code=?
      UNION ALL SELECT 'mirai',status,request_sent_at,lease_expires_at,next_attempt_at FROM mirai_order_links WHERE order_code=?
      UNION ALL SELECT 'pixelverif',status,request_sent_at,lease_expires_at,next_attempt_at FROM pixelverif_order_links WHERE order_code=?
    )
    UNION ALL SELECT 'item',CASE WHEN f.status NOT IN ('delivered','failed','manual_required') AND (
      EXISTS(SELECT 1 FROM wr_order_links l WHERE l.order_code=f.order_code AND (l.fulfillment_item_id=f.id OR l.id=f.wr_link_id) AND l.status NOT IN ('completed','failed')) OR
      EXISTS(SELECT 1 FROM sk_order_links l WHERE l.order_code=f.order_code AND (l.fulfillment_item_id=f.id OR l.id=f.sk_link_id) AND l.status NOT IN ('completed','failed')) OR
      EXISTS(SELECT 1 FROM tunvn_order_links l WHERE l.order_code=f.order_code AND l.item_index=f.item_index AND l.status!='completed') OR
      EXISTS(SELECT 1 FROM aivault_order_links l WHERE l.order_code=f.order_code AND l.item_index=f.item_index AND l.status!='completed') OR
      EXISTS(SELECT 1 FROM storebat_order_links l WHERE l.order_code=f.order_code AND l.item_index=f.item_index AND l.status!='completed') OR
      EXISTS(SELECT 1 FROM mirai_order_links l WHERE l.order_code=f.order_code AND l.item_index=f.item_index AND l.status!='completed') OR
      EXISTS(SELECT 1 FROM pixelverif_order_links l WHERE l.order_code=f.order_code AND l.item_index=f.item_index AND l.status!='completed')
    ) THEN 'supplier_owned' ELSE f.status END,NULL,f.locked_until,f.next_attempt_at FROM fulfillment_items f WHERE f.order_code=?`,
  code, code, code, code, code, code, code, code) : await queryAll(
    `SELECT '${orderKind}' AS domain,status,NULL AS sent,lease_until AS lease,NULL AS next_at FROM ${orderKind === "games" ? "games_order_items" : "pedia_order_items"} WHERE order_code=?`, code);
  // Include job + push ledger leases, even if the supplier pass lost a CAS.
  const leases = orderKind === "apps" ? await queryFirst(`SELECT
    (SELECT MAX(locked_until) FROM fulfillment_jobs WHERE order_code=? AND status='sending') AS job_lease,
    (SELECT MAX(strftime('%Y-%m-%dT%H:%M:%fZ',c.updated_at,'+600 seconds')) FROM fulfillment_send_claims c JOIN fulfillment_items i ON i.id=c.item_id
      WHERE i.order_code=? AND c.status='sending') AS send_lease,
    (SELECT MAX(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+600 seconds')) FROM buyer_notice_log
      WHERE order_code=? AND status='sending') AS notice_lease`, code, code, code) : null;
  let retryAt = Math.max(timestamp(leases?.job_lease), timestamp(leases?.send_lease), timestamp(leases?.notice_lease));
  let pending = !work.length, async = false, manual = false;
  if (orderKind === "apps") {
    const items = JSON.parse(String(order.items ?? "[]"));
    pending ||= !Array.isArray(items) || work.filter(row => row.domain === "item").length < expandDeliveryLines(items).length;
  }
  for (const row of work) {
    const status = String(row.status);
    if (["delivered", "completed", "success", "expired", "supplier_owned"].includes(status)) continue;
    if (["failed", "needs_admin", "needs_check", "manual_required", "partial", "canceled"].includes(status)) { manual = true; continue; }
    if (["submitted", "ordering", "processing", "pending", "in_progress"].includes(status)
      && (row.sent || (row.domain === "games" && status === "pending") || ["submitted", "in_progress"].includes(status))) { async = true; continue; }
    if (!["pending", "queued", "retry", "awaiting_payment", "blocked_balance", "delivery_pending", "sending", "submitting", "claimed", "ordering", "processing"].includes(status)) {
      manual = true; continue;
    }
    const lease = timestamp(row.lease);
    if (lease > Date.now()) { pending = true; retryAt = Math.max(retryAt, lease); continue; }
    if (["pending", "queued", "retry", "awaiting_payment", "blocked_balance", "delivery_pending", "sending"].includes(status)) {
      pending = true;
      retryAt = Math.max(retryAt, timestamp(row.next_at));
    } else { manual = true; }
  }
  if (pending || retryAt > Date.now()) return { ok: true, settled: false, retrySec: Math.max(60, Math.ceil((retryAt - Date.now()) / 1000)) };
  return { ok: true, settled: true, state: manual ? "manual_required" : async ? "async_polling" : "done" };
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  const bounded = await readJsonBody(request, 2048);
  if (!bounded.ok) return json({ error: "invalid_request" }, 400);
  const parsed = schema.safeParse(bounded.data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  const body = parsed.data;
  const deadline = Date.now() + 40_000;
  try {
    const order = await queryFirst("SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", body.orderCode);
    if (!order) return json({ ok: true, settled: true, state: "not_paid" });
    if (String(order.order_kind ?? "apps") !== body.orderKind) return json({ error: "order_kind_mismatch" }, 400);
    // Shadow has exactly one read and cannot materialize, claim, notify or send.
    if (body.dryRun) return json({ ok: true, settled: true, state: "dry_run_ok" });
    if (!await isQueueExecutionEnabled(body.orderKind)) return json({ ok: true, settled: true, state: "queue_disabled" });
    await fulfillPaidOrder(body.orderCode, body.orderKind, deadline);
    return json(await outcome(order, body.orderKind));
  } catch {
    console.error(JSON.stringify({ event: "order_fulfillment_origin", kind: body.kind, orderKind: body.orderKind, source: body.source, outcome: "error" }));
    return json({ error: "fulfillment_unavailable" }, 503);
  }
}
