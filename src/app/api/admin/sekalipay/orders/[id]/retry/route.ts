// POST /api/admin/sekalipay/orders/[id]/retry — Manual retry satu SK link.
// CAS berpagar (cermin WR): UPDATE bersyarat atas (status, attempt_count).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun } from "@/lib/db";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { SK_LINK_STATUSES } from "@/lib/sekalipay/order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const RETRYABLE = ["pending", "retry", "failed", "blocked_balance"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  const { id } = await params;
  const linkId = Number(id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const link = await queryFirst(
    `SELECT id, status, attempt_count, max_attempts FROM sk_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!(SK_LINK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "unknown_status", status }, { status: 500 });
  }
  if (!RETRYABLE.includes(status)) {
    return NextResponse.json({ error: "not_retryable", status }, { status: 409 });
  }
  if (Number(link.attempt_count || 0) >= Number(link.max_attempts || 3)) {
    return NextResponse.json({ error: "max_attempts_reached" }, { status: 409 });
  }
  const claimed = await execRun(
    `UPDATE sk_order_links SET status='retry', next_attempt_at=datetime('now'),
       last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
       request_sent_at=NULL, updated_at=datetime('now')
     WHERE id=? AND status=? AND attempt_count=?`,
    linkId,
    status,
    Number(link.attempt_count || 0),
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (Number(claimed.changes ?? 0) === 0) {
    const current = await queryFirst(`SELECT status, attempt_count FROM sk_order_links WHERE id=?`, linkId);
    return NextResponse.json(
      { error: "retry_race_lost", status: String(current?.status ?? "unknown") },
      { status: 409 },
    );
  }
  try {
    const { processSkPendingOrders } = await import("@/lib/sekalipay/order");
    await processSkPendingOrders();
  } catch { /* cron memproses berikutnya */ }
  const updated = await queryFirst(`SELECT id, order_code, status, attempt_count, last_error FROM sk_order_links WHERE id=?`, linkId);
  return NextResponse.json({ ok: true, link: updated });
}
