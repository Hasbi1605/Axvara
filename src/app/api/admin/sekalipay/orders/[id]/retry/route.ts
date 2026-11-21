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
    `SELECT l.id, l.status, l.attempt_count, l.max_attempts, l.sk_invoice,
       l.request_sent_at, l.last_error, o.status AS order_status, o.payment_status, o.supplier_purchase_disabled
     FROM sk_order_links l JOIN orders o ON o.code=l.order_code WHERE l.id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!(SK_LINK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "unknown_status", status }, { status: 500 });
  }
  if (String(link.last_error || "").startsWith("cancelled_by_admin")
    || link.order_status !== "lunas" || link.payment_status !== "paid" || Number(link.supplier_purchase_disabled) !== 0) {
    return NextResponse.json({ error: "not_retryable", message: "Pesanan dibatalkan atau belum lunas; retry supplier ditolak." }, { status: 409 });
  }
  if (link.sk_invoice || link.request_sent_at) {
    return NextResponse.json({ error: "reconciliation_required", message: "Permintaan sudah dikirim ke Sekalipay. Gunakan rekonsiliasi, bukan retry pembelian." }, { status: 409 });
  }
  if (!RETRYABLE.includes(status)) {
    return NextResponse.json({ error: "not_retryable", status }, { status: 409 });
  }
  const preSendFailure = status === "failed";
  if (!preSendFailure && Number(link.attempt_count || 0) >= Number(link.max_attempts || 3)) {
    return NextResponse.json({ error: "max_attempts_reached" }, { status: 409 });
  }
  const claimed = await execRun(
    `UPDATE sk_order_links SET status='retry', next_attempt_at=datetime('now'),
       last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
       attempt_count=?, updated_at=datetime('now')
     WHERE id=? AND status=? AND attempt_count=?
       AND request_sent_at IS NULL AND COALESCE(sk_invoice,'')=''
       AND COALESCE(last_error,'') NOT LIKE 'cancelled_by_admin%'
       AND EXISTS(SELECT 1 FROM orders o WHERE o.code=sk_order_links.order_code
         AND o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0)`,
    preSendFailure ? 0 : Number(link.attempt_count || 0),
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
    await processSkPendingOrders(undefined, { skipOrphanProbe: true });
  } catch { /* cron memproses berikutnya */ }
  const updated = await queryFirst(`SELECT id, order_code, status, attempt_count, last_error FROM sk_order_links WHERE id=?`, linkId);
  return NextResponse.json({ ok: true, link: updated });
}
