import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { readJsonBody } from "@/lib/http-body";
import { formatSafeMiraiRevealReceipt, sanitizeMiraiReceiptSummary } from "@/lib/mirai/admin";
import { MIRAI_RETRYABLE_SQL, retryMiraiOrder } from "@/lib/mirai/orders";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  try {
    const rows = await createDatabaseAccess().queryAll(
      `SELECT id, order_code, item_index, package_code, quantity, cost_usdt, fx_idr_per_usdt,
         external_order_id, idempotency_key, provider_order_code, status, attempt_count,
         request_sent_at, last_error, completed_at, receipt_json,
         CASE WHEN receipt_ciphertext IS NOT NULL THEN 1 ELSE 0 END AS has_receipt,
         CASE WHEN ${MIRAI_RETRYABLE_SQL} THEN 1 ELSE 0 END AS can_retry
       FROM mirai_order_links
       ORDER BY id DESC
       LIMIT 100`,
    );
    const items = rows.map((row) => ({
      ...row,
      receipt_json: sanitizeMiraiReceiptSummary(row.receipt_json),
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
    const db = createBudgetedDatabase(40, 0).access;
    const link = await db.queryFirst("SELECT * FROM mirai_order_links WHERE id=?", parsed.data.id);
    if (!link) return json({ error: "not_found" }, 404);
    if (parsed.data.action === "reveal") {
      if (!link.receipt_ciphertext || !link.receipt_iv) return json({ error: "no_receipt" }, 404);
      const rawReceipt = await decryptSecret(String(link.receipt_ciphertext), String(link.receipt_iv));
      return json({ ok: true, receipt: formatSafeMiraiRevealReceipt(rawReceipt, link) });
    }
    if (!(await retryMiraiOrder(db, Number(link.id)))) return json({ error: "no_safe_retry" }, 409);
    const updated = await db.queryFirst("SELECT status, last_error FROM mirai_order_links WHERE id=?", link.id);
    if (updated?.status === "completed") {
      const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
      await schedulePaidFulfillment(String(link.order_code), "apps", "admin_mirai", "supplier_settled");
    }
    return json({ ok: true, link: updated });
  } catch {
    return json({ error: "action_deferred" }, 503);
  }
}
