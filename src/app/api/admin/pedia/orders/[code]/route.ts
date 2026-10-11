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
import { callPediaProxy, isPediaProvider } from "@/lib/pedia/proxy";
import { canResubmit } from "../../_shared";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["mark_submitted", "resubmit", "cancel_credit", "check_balance"]),
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

  // cancel_credit: batalkan + kredit penuh (idempoten per item via UNIQUE).
  const { sha256Hex, PEDIA_CREDIT_TTL_DAYS } = await import("@/lib/pedia/credits");
  if (parsed.data.confirm !== true) return NextResponse.json({ error: "confirm_required" }, { status: 400 });
  if (!canResubmit(item)) return NextResponse.json({ error: "reconcile_required" }, { status: 409 });
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  const order = await db.queryFirst(`SELECT customer_email,status FROM orders WHERE code=?`, code);
  if (order?.status !== "lunas" || !order.customer_email) return NextResponse.json({ error: "payment_required" }, { status: 409 });
  const raw = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const creditCode = `PDK-${raw.slice(0, 4)}-${raw.slice(4)}`;
  const hash = await sha256Hex(creditCode);
  const results = await db.d1.batch([
    db.d1.prepare(`INSERT INTO pedia_credits (code_hash,code_hint,email,amount,remaining,source_order_code,source_kind,expires_at)
      SELECT ?,?,?,total,total,order_code,'canceled',datetime('now','+${PEDIA_CREDIT_TTL_DAYS} days')
      FROM pedia_order_items WHERE order_code=? AND status='needs_check' AND submit_attempts=0 AND supplier_order_id IS NULL
      ON CONFLICT(source_order_code,source_kind) DO NOTHING`).bind(hash, raw.slice(4), String(order.customer_email), code),
    db.d1.prepare(`INSERT INTO pedia_credit_ledger (credit_id,order_code,delta)
      SELECT id,source_order_code,amount FROM pedia_credits WHERE code_hash=?`).bind(hash),
    db.d1.prepare(`UPDATE pedia_order_items SET status='canceled',refund_credit_code=?,lease_until=NULL,updated_at=datetime('now')
      WHERE order_code=? AND status='needs_check' AND submit_attempts=0 AND supplier_order_id IS NULL
      AND EXISTS (SELECT 1 FROM pedia_credits WHERE code_hash=?)`).bind(creditCode, code, hash),
  ]);
  if (!results[2].meta.changes) return NextResponse.json({ error: "not_needs_check" }, { status: 409 });
  return NextResponse.json({ ok: true, credit_code: creditCode });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
