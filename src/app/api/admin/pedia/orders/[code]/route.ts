// POST /api/admin/pedia/orders/[code] — Aksi antrean needs_check (PD-42):
// {action:"mark_submitted", supplier_order_id} — tandai sudah dibuat.
// {action:"resubmit"} — kirim ulang (konfirmasi ganda di UI; server batasi
//   percobaan: submit_attempts < 6, status needs_check → queued).
// {action:"cancel_credit"} — batalkan + terbitkan kredit penuh.
// {action:"check_balance"} — cek saldo supplier live (read-only).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["mark_submitted", "resubmit", "cancel_credit", "check_balance"]),
  supplier_order_id: z.string().trim().max(60).optional(),
  confirm: z.literal(true).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { code } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const db = createDatabaseAccess();
  const item = await db.queryFirst(`SELECT * FROM pedia_order_items WHERE order_code=?`, code).catch(() => null);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { action } = parsed.data;

  if (action === "check_balance") {
    const { callPsmmProxy } = await import("@/lib/pedia/proxy");
    const res = await callPsmmProxy("balance", {}, 15_000);
    if (!res.ok) return NextResponse.json({ error: "proxy_failed" }, { status: 502 });
    return NextResponse.json({ ok: true, balance: res.data });
  }

  if (String(item.status) !== "needs_check") {
    return NextResponse.json({ error: "not_needs_check" }, { status: 409 });
  }

  if (action === "mark_submitted") {
    const sid = parsed.data.supplier_order_id?.trim();
    if (!sid) return NextResponse.json({ error: "supplier_order_id_required" }, { status: 400 });
    await db.execRun(
      `UPDATE pedia_order_items SET status='submitted', supplier_order_id=?,
         lease_until=NULL, last_error=NULL, updated_at=datetime('now')
       WHERE order_code=? AND status='needs_check'`,
      sid, code,
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "resubmit") {
    // Konfirmasi ganda: UI meminta 2×; server mewajibkan flag confirm.
    if (parsed.data.confirm !== true) {
      return NextResponse.json({ error: "confirm_required" }, { status: 400 });
    }
    if (Number(item.submit_attempts) >= 6) {
      return NextResponse.json({ error: "max_attempts" }, { status: 409 });
    }
    await db.execRun(
      `UPDATE pedia_order_items SET status='queued', lease_until=NULL, last_error=NULL,
         updated_at=datetime('now') WHERE order_code=? AND status='needs_check'`,
      code,
    );
    return NextResponse.json({ ok: true });
  }

  // cancel_credit: batalkan + kredit penuh (idempoten per item via UNIQUE).
  const { issuePediaCredit } = await import("@/lib/pedia/credits");
  const order = await db.queryFirst(`SELECT customer_email FROM orders WHERE code=?`, code).catch(() => null);
  const credit = await issuePediaCredit(db, {
    email: String(order?.customer_email ?? ""),
    amount: Number(item.total),
    sourceOrderCode: code,
    sourceKind: "canceled",
  });
  await db.execRun(
    `UPDATE pedia_order_items SET status='canceled', refund_credit_code=?,
       updated_at=datetime('now') WHERE order_code=?`,
    credit.code, code,
  );
  return NextResponse.json({ ok: true, credit_code: credit.code });
}
