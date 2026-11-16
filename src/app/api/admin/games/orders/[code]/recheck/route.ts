import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { applySkTransactionDetail, fetchSkGamesStatus, parseSkH2hOutcome } from "@/lib/games/sk-dispatch";
import { parseGamesSkTargetSnapshot } from "@/lib/games/registry";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** GET-only supplier recovery; no transaction creation, retry or refund. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!rateLimit(rateLimitKey(request, "games:admin-recheck"), 10)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  }
  // requireAdmin also emits the existing sanitized admin_authorized audit.
  if (!await requireAdmin(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const { code } = await params;
  if (!/^AXG-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "invalid_code" }, { status: 400, headers });
  const db = createDatabaseAccess();
  try {
    const item = await db.queryFirst(
      `SELECT o.status AS order_status,o.payment_status,i.status, i.supplier, i.sk_variant_id, i.target_snapshot,
              i.sk_invoice AS item_invoice, a.sk_invoice, a.ref_id
         FROM orders o JOIN games_order_items i ON i.order_code=o.code
         LEFT JOIN games_dispatch_attempts a ON a.order_code=i.order_code AND a.attempt_no=i.attempt_no
        WHERE o.code=? AND o.order_kind='games'`, code,
    );
    if (!item) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    if (item.supplier !== "sekalipay") return NextResponse.json({ error: "legacy_supplier" }, { status: 409, headers });
    if (item.order_status !== "lunas" || item.payment_status !== "paid") return NextResponse.json({ error: "payment_required" }, { status: 409, headers });
    if (!["needs_check", "pending", "submitting"].includes(String(item.status)) || !item.ref_id) {
      return NextResponse.json({ error: "not_recheckable" }, { status: 409, headers });
    }
    if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503, headers });
    let detail;
    try { detail = await fetchSkGamesStatus(String(item.ref_id)); }
    catch { return NextResponse.json({ error: "upstream_unreachable" }, { status: 502, headers }); }
    const parsed = parseSkH2hOutcome(detail, {
      refId: String(item.ref_id), variantId: Number(item.sk_variant_id),
      invoice: String(item.sk_invoice || item.item_invoice || "") || null,
      target: parseGamesSkTargetSnapshot(item.target_snapshot),
    });
    const applied = await applySkTransactionDetail(db, detail, { refId: String(item.ref_id), adminRecheck: true });
    const current = await db.queryFirst("SELECT status,sn FROM games_order_items WHERE order_code=?", code);
    const costRejected = parsed.kind === "success" && applied === "needs_check";
    return NextResponse.json({
      ok: applied !== "ignored" && applied !== "unknown_ref",
      outcome: costRejected ? "needs_check" : parsed.kind,
      item_status: String(current?.status ?? item.status),
      ...(current?.status === "success" && current.sn ? { sn: String(current.sn) } : {}),
      message: costRejected ? "Biaya aktual tidak dapat diverifikasi atau melebihi batas pesanan." : parsed.message,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "recheck_failed" }, { status: 503, headers });
  }
}
