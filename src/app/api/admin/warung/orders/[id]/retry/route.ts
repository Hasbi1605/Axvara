// POST /api/admin/warung/orders/[id]/retry — Manual retry satu WR order link.
// Hanya untuk status retry/failed/pending; attempt_count dihormati.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun } from "@/lib/db";
import { isWrEnabled } from "@/lib/warung-rebahan/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isWrEnabled()) return NextResponse.json({ error: "warung_rebahan_disabled" }, { status: 503 });
  const { id } = await params;
  const linkId = Number(id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!["pending", "retry", "failed"].includes(String(link.status))) {
    return NextResponse.json({ error: "not_retryable", status: String(link.status) }, { status: 409 });
  }
  if (Number(link.attempt_count || 0) >= Number(link.max_attempts || 3)) {
    return NextResponse.json({ error: "max_attempts_reached" }, { status: 409 });
  }
  await execRun(
    `UPDATE wr_order_links SET status='retry', next_attempt_at=datetime('now'),
      last_error=NULL, updated_at=datetime('now') WHERE id=?`,
    linkId,
  );
  try {
    const { processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
    await processWrPendingOrders();
  } catch { /* cron memproses berikutnya */ }
  const updated = await queryFirst(`SELECT id, order_code, status, attempt_count, last_error FROM wr_order_links WHERE id=?`, linkId);
  return NextResponse.json({ ok: true, link: updated });
}
