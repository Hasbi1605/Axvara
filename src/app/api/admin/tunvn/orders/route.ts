import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { schedulePaidFulfillment } from "@/lib/payments/paid-fulfillment";
import { processTunvnOrders, retryTunvnOrder, TUNVN_RETRYABLE_SQL } from "@/lib/tunvn/orders";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({ error: "unauthorized" }, 401);
  try {
    const items = await createDatabaseAccess().queryAll(`SELECT id,order_code,item_index,kind,source_product_id,quantity,cost_usdt,currency,status,attempt_count,request_sent_at,
      provider_order_group,provider_batch_id,provider_order_code,receipt_json,last_error,completed_at,created_at,updated_at,
      CASE WHEN receipt_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS has_receipt,
      (SELECT supplier_purchase_disabled FROM orders WHERE code=tunvn_order_links.order_code) AS purchase_disabled,
      CASE WHEN ${TUNVN_RETRYABLE_SQL} THEN 1 ELSE 0 END AS can_retry
      FROM tunvn_order_links ORDER BY id DESC LIMIT 100`);
    return json({ ok: true, items });
  } catch { return json({ error: "load_failed" }, 503); }
}

export async function POST(request: NextRequest) {
  // requireAdmin audits POST authorization; no receipt, contact or code in telemetry.
  if (!await requireAdmin(request)) return json({ error: "unauthorized" }, 401);
  const bounded = await readJsonBody(request, 2048);
  if (!bounded.ok) return bounded.response;
  const body = bounded.data as { id?: unknown; action?: unknown } | null;
  if (!body || !Number.isSafeInteger(body.id) || Number(body.id) < 1 || !["retry", "reconcile", "reveal"].includes(String(body.action))) return json({ error: "invalid_request" }, 400);
  const budget = createBudgetedDatabase(40, 0);
  try {
    const link = await budget.access.queryFirst("SELECT * FROM tunvn_order_links WHERE id=?", body.id);
    if (!link) return json({ error: "not_found" }, 404);
    if (body.action === "retry") {
      if (!await retryTunvnOrder(budget.access,Number(link.id))) return json({ error: "no_safe_retry", message: "Retry hanya untuk kegagalan sebelum pembelian, tanpa receipt atau pengiriman aktif." },409);
      const updated=await budget.access.queryFirst("SELECT status,last_error FROM tunvn_order_links WHERE id=?",link.id);
      if (updated?.status==="completed") await schedulePaidFulfillment(String(link.order_code),"apps","admin_tunvn","supplier_settled");
      return json({ ok:true,link:updated });
    }
    if (body.action === "reveal") {
      if (!link.receipt_ciphertext || !link.receipt_iv) return json({ error: "no_receipt" }, 404);
      return json({ ok: true, receipt: await decryptSecret(String(link.receipt_ciphertext), String(link.receipt_iv)) });
    }
    if (link.kind !== "buff" || !link.provider_batch_id || !["processing", "needs_admin"].includes(String(link.status))) return json({ error: "no_safe_reconcile" }, 409);
    const processed = await processTunvnOrders(budget.access, { reconcileId: Number(link.id) });
    const updated = await budget.access.queryFirst("SELECT status FROM tunvn_order_links WHERE id=?", link.id);
    if (processed && updated?.status === "completed") await schedulePaidFulfillment(String(link.order_code), "apps", "admin_tunvn_reconcile", "supplier_settled");
    return json({ ok: true });
  } catch { return json({ error: "reconcile_deferred" }, 503); }
}
