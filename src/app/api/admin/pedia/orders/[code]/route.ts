// POST /api/admin/pedia/orders/[code] — Aksi antrean needs_check (PD-42):
// {action:"mark_submitted", supplier_order_id} — tandai sudah dibuat.
// {action:"resubmit"} — kirim ulang (konfirmasi ganda di UI; server batasi
//   percobaan: submit_attempts < 6, status needs_check → queued).
// {action:"cancel_manual"} — batalkan sebelum submit + tindak lanjut manual.
// {action:"mark_handled",note,confirm:true} — catat penyelesaian di luar website.
// {action:"check_balance"} — cek saldo supplier live (read-only).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { callPediaProxy, isPediaProvider } from "@/lib/pedia/proxy";
import { canResubmit } from "../../_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["mark_submitted", "resubmit", "cancel_manual", "cancel_credit", "mark_handled", "check_balance"]),
  note: z.string().trim().min(10).max(1000).optional(),
  supplier_order_id: z.string().trim().max(60).optional(),
  confirm: z.literal(true).optional(),
  checked_supplier: z.literal(true).optional(),
  accept_charge: z.literal(true).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { code } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  if (parsed.data.action === "cancel_credit") return NextResponse.json({ error: "credits_retired", message: "Penerbitan kredit dihentikan. Gunakan tindak lanjut manual." }, { status: 410 });
  const db = createDatabaseAccess();
  try {
  const item = await db.queryFirst(`SELECT * FROM pedia_order_items WHERE order_code=?`, code);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isPediaProvider(item.supplier)) return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  const { action } = parsed.data;

  if (action === "check_balance") {
    const res = await callPediaProxy<{ balance?: unknown; currency?: unknown }>(item.supplier, "balance", {}, 15_000);
    if (!res.ok) return NextResponse.json({ error: "proxy_failed" }, { status: 502 });
    if ((item.supplier === "indosmm" && res.data.currency !== "IDR") || (res.data.currency != null && res.data.currency !== "IDR") || res.data.balance == null || !Number.isFinite(Number(res.data.balance)) || Number(res.data.balance) < 0) return NextResponse.json({ error: "unsupported_currency" }, { status: 502 });
    return NextResponse.json({ ok: true, supplier: item.supplier, balance: res.data });
  }

  if (action === "mark_handled") {
    if (!parsed.data.note || parsed.data.confirm !== true) return NextResponse.json({ error: "note_and_confirm_required" }, { status: 400 });
    const changed = await db.execRun(`UPDATE pedia_followups SET state='handled',note=?,handled_by=?,handled_at=datetime('now')
      WHERE order_code=? AND state='open'`, parsed.data.note, admin.email, code);
    return NextResponse.json({ ok: changed.changes === 1 }, { status: changed.changes === 1 ? 200 : 409 });
  }

  if (String(item.status) !== "needs_check") {
    return NextResponse.json({ error: "not_needs_check" }, { status: 409 });
  }

  if (action === "mark_submitted") {
    if (parsed.data.confirm !== true) return NextResponse.json({ error: "confirm_required" }, { status: 400 });
    const sid = parsed.data.supplier_order_id?.trim();
    if (!sid) return NextResponse.json({ error: "supplier_order_id_required" }, { status: 400 });
    if (!/^[1-9][0-9]*$/.test(sid)) return NextResponse.json({ error: "invalid_supplier_order_id" }, { status: 400 });
    if (item.supplier_order_id && String(item.supplier_order_id) !== sid) return NextResponse.json({ error: "supplier_order_conflict" }, { status: 409 });
    const existing = await db.queryFirst(`SELECT order_code FROM pedia_order_items WHERE supplier=? AND supplier_order_id=? AND order_code<>?`, item.supplier, sid, code);
    if (existing) return NextResponse.json({ error: "supplier_order_conflict" }, { status: 409 });
    const status = await callPediaProxy<{ status?: unknown }>(item.supplier, "status", { order: sid }, 15_000);
    if (!status.ok || typeof status.data.status !== "string" || !status.data.status) return NextResponse.json({ error: "proxy_failed" }, { status: 502 });
    const changed = await db.execRun(
      `UPDATE pedia_order_items SET status='submitted', supplier_order_id=?,
          snapshot_json=json_set(CASE WHEN json_valid(snapshot_json) THEN snapshot_json ELSE '{}' END,
            '$.supplier',supplier,'$.supplier_service_id',supplier_service_id,'$.supplier_order_id',?),
          lease_until=NULL, last_error=NULL, updated_at=datetime('now')
       WHERE order_code=? AND status='needs_check' AND supplier=?
         AND NOT EXISTS (SELECT 1 FROM pedia_order_items other WHERE other.supplier=? AND other.supplier_order_id=? AND other.order_code<>?)`,
      sid, sid, code, item.supplier, item.supplier, sid, code,
    );
    if (!changed.changes) return NextResponse.json({ error: "not_needs_check" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "resubmit") {
    // Konfirmasi ganda: UI meminta 2×; server mewajibkan flag confirm.
    if (parsed.data.confirm !== true || parsed.data.checked_supplier !== true || parsed.data.accept_charge !== true) {
      return NextResponse.json({ error: "confirm_required" }, { status: 400 });
    }
    if (!canResubmit(item)) return NextResponse.json({ error: "reconcile_required" }, { status: 409 });
    const order = await db.queryFirst(`SELECT status FROM orders WHERE code=?`, code);
    if (order?.status !== "lunas") return NextResponse.json({ error: "payment_required" }, { status: 409 });
    if (Number(item.submit_attempts) >= 6) {
      return NextResponse.json({ error: "max_attempts" }, { status: 409 });
    }
    const changed = await db.execRun(
      `UPDATE pedia_order_items SET status='queued', lease_until=NULL, last_error=NULL,
          updated_at=datetime('now') WHERE order_code=? AND status='needs_check'
          AND submit_attempts=0 AND supplier_order_id IS NULL`,
      code,
    );
    if (!changed.changes) return NextResponse.json({ error: "not_needs_check" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  // Only a conclusively never-submitted order may be canceled locally.
  if (parsed.data.confirm !== true) return NextResponse.json({ error: "confirm_required" }, { status: 400 });
  if (!canResubmit(item)) return NextResponse.json({ error: "reconcile_required" }, { status: 409 });
  const order = await db.queryFirst(`SELECT status,payment_status FROM orders WHERE code=?`, code);
  if (order?.status !== "lunas" || order.payment_status !== "paid") return NextResponse.json({ error: "payment_required" }, { status: 409 });
  const { finishWithFollowup } = await import("@/lib/pedia/followup");
  const changed = await finishWithFollowup(db, code, "canceled", "admin_canceled_before_submit", true);
  return NextResponse.json({ ok: changed }, { status: changed ? 200 : 409 });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
