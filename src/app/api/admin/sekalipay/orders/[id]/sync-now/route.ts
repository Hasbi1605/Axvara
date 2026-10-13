// POST /api/admin/sekalipay/orders/[id]/sync-now — Tarik status satu SK
// link langsung dari vendor sekarang (GET /v1/trx), cermin endpoint WR
// (2026-10-13, paritas supplier). Read-only terhadap upstream, idempoten +
// monotonik, TIDAK pernah beli ulang. Tanpa route ini tombol "Cek status"
// admin hanya ada untuk WR, jadi SK tidak punya jalan pintas manual.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst } from "@/lib/db";
import { isSkEnabled } from "@/lib/sekalipay/client";
import { reconcileSkInvoiceNow } from "@/lib/sekalipay/order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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
    `SELECT id, order_code, sk_invoice, status FROM sk_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!["processing", "submitted", "ordering"].includes(status)) {
    return NextResponse.json({ error: "not_syncable", status }, { status: 409 });
  }
  const invoice = String(link.sk_invoice || "");
  if (!invoice) return NextResponse.json({ error: "not_syncable", status }, { status: 409 });
  let advanced = false;
  try {
    advanced = await reconcileSkInvoiceNow(invoice);
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }
  const updated = await queryFirst(
    `SELECT id, order_code, sk_invoice, status, completed_at,
            sk_account_details IS NOT NULL AS has_cred, fulfillment_item_id
     FROM sk_order_links WHERE id=?`,
    linkId,
  );
  return NextResponse.json({ ok: true, reconciled: advanced ? 1 : 0, link: updated });
}
