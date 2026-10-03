// POST /api/admin/warung/orders/[id]/sync-now — Tarik status satu WR link
// langsung dari /transactions upstream (2026-10-03).
//
// Kasus order F111FD64: dashboard WR sudah COMPLETED + kredensial terbit
// hitungan menit setelah lunas, tetapi webhook order.completed TIDAK PERNAH
// sampai (wr_webhook_events terakhir 28 Sep) dan reconcile cron baru menyentuh
// link >1 jam. Endpoint ini memaksa reconcile SATU link sekarang — read-only
// terhadap upstream, idempoten + monotonik, TIDAK pernah beli ulang.
// SK tidak tersentuh (modul + tabel + endpoint terpisah).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst } from "@/lib/db";
import { isWrEnabled } from "@/lib/warung-rebahan/client";
import { reconcileFreshWrLinks } from "@/lib/warung-rebahan/order";

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
  const link = await queryFirst(
    `SELECT id, order_code, wr_order_id, status FROM wr_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!["processing", "submitted", "ordering"].includes(status)) {
    return NextResponse.json({ error: "not_syncable", status }, { status: 409 });
  }
  let reconciled = 0;
  try {
    reconciled = await reconcileFreshWrLinks([{
      id: linkId,
      wr_order_id: String(link.wr_order_id || ""),
      order_code: String(link.order_code || ""),
    }]);
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 502 });
  }
  const updated = await queryFirst(
    `SELECT id, order_code, wr_order_id, status, completed_at,
            wr_account_details IS NOT NULL AS has_cred, fulfillment_item_id
     FROM wr_order_links WHERE id=?`,
    linkId,
  );
  return NextResponse.json({ ok: true, reconciled, link: updated });
}
