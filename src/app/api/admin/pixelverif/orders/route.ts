import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { readJsonBody } from "@/lib/http-body";
import { serializeAdminOrderBuyer } from "@/lib/orders/admin-buyer";
import { isResolvedManuallyFlag, resolvedManuallySql } from "@/lib/supplier/resolved-manually";
import { formatSafePixelverifRevealReceipt, sanitizePixelverifReceiptSummary, safeActivationStatus } from "@/lib/pixelverif/admin";
import { PIXELVERIF_REPOLL_SQL, PIXELVERIF_RETRYABLE_SQL, retryPixelverifOrder } from "@/lib/pixelverif/orders";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  try {
    const rows = await createDatabaseAccess().queryAll(
      `WITH links AS (
         SELECT id, order_code, item_index, flow_type, validity, credit_cost, fx_idr_per_usd,
           provider_order_id, idempotency_key, status, attempt_count,
           request_sent_at, last_error, last_error_code, activation_status, queue_position, progress_step,
           completed_at, created_at, updated_at, receipt_json,
           CASE WHEN receipt_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS has_receipt,
           CASE WHEN (${PIXELVERIF_RETRYABLE_SQL}) OR (${PIXELVERIF_REPOLL_SQL}) THEN 1 ELSE 0 END AS can_retry
         FROM pixelverif_order_links
         ORDER BY id DESC
         LIMIT 100
       )
       SELECT links.*, o.customer_name, o.customer_wa, o.customer_email, o.sales_channel,
         COALESCE(o.supplier_purchase_disabled, 0) AS purchase_disabled,
         ${resolvedManuallySql("links")} AS resolved_manually
       FROM links
       LEFT JOIN orders o ON o.code = links.order_code
       ORDER BY links.id DESC`,
    );
    const items = rows.map((row) => ({
      ...row,
      receipt_json: sanitizePixelverifReceiptSummary(row.receipt_json),
      activation_status: safeActivationStatus(row.activation_status),
      ...serializeAdminOrderBuyer(row),
      resolved_manually: isResolvedManuallyFlag(row.resolved_manually),
    }));
    return json({ ok: true, items });
  } catch {
    return json({ error: "load_failed" }, 503);
  }
}

export async function POST(request: NextRequest) {
  // requireAdmin audits this POST before revealing private encrypted receipts.
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  const raw = await readJsonBody(request, 1024);
  if (!raw.ok) {
    raw.response.headers.set("Cache-Control", "private, no-store");
    return raw.response;
  }
  const parsed = z
    .object({ id: z.number().int().positive(), action: z.enum(["retry", "reveal"]) })
    .strict()
    .safeParse(raw.data);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  try {
    const db = createDatabaseAccess();
    const link = await db.queryFirst("SELECT * FROM pixelverif_order_links WHERE id=?", parsed.data.id);
    if (!link) return json({ error: "not_found" }, 404);
    if (parsed.data.action === "reveal") {
      if (!link.receipt_ciphertext || !link.receipt_iv) return json({ error: "no_receipt" }, 404);
      const rawReceipt = await decryptSecret(String(link.receipt_ciphertext), String(link.receipt_iv));
      return json({ ok: true, receipt: formatSafePixelverifRevealReceipt(rawReceipt, link) });
    }
    if (!(await retryPixelverifOrder(db, Number(link.id)))) return json({ error: "no_safe_retry" }, 409);
    const updated = await db.queryFirst("SELECT status, last_error FROM pixelverif_order_links WHERE id=?", link.id);
    if (updated?.status === "completed") {
      const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
      await schedulePaidFulfillment(String(link.order_code), "apps", "admin_pixelverif", "supplier_settled");
    }
    return json({ ok: true, link: updated });
  } catch {
    return json({ error: "action_deferred" }, 503);
  }
}
