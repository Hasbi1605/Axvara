// src/app/api/admin/proofs/[id]/route.ts — Review payment proof (Approve/Reject with CAS)

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun, getD1, D1Statement } from "@/lib/db";
import { z } from "zod";
import { authoritativePaymentMethodForProof } from "@/lib/payment-proofs";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";

export const runtime = "edge";

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(300).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "reject" && !value.reason) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Alasan penolakan wajib diisi" });
  }
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const proofId = Number(id);
  if (!Number.isInteger(proofId) || proofId <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { action, reason } = parsed.data;
  const reviewer = admin.email;

  // 1. Fetch current proof
  const proof = await queryFirst(`SELECT * FROM payment_proofs WHERE id=?`, proofId);
  if (!proof) return NextResponse.json({ error: "proof_not_found" }, { status: 404 });

  // Compare-and-set: can only review if status is 'submitted'
  if (String(proof.status) !== "submitted") {
    return NextResponse.json(
      { error: "already_reviewed", current_status: proof.status },
      { status: 409 },
    );
  }

  const orderCode = String(proof.order_code);
  const d1 = getD1();

  if (action === "approve") {
    const dynamicQrisTransaction = String(proof.claimed_method) === "QRIS"
      ? await queryFirst(
          `SELECT id, status FROM payment_transactions WHERE order_code=? AND provider='klikqris'`,
          orderCode,
        )
      : null;
    const authoritativeMethod = authoritativePaymentMethodForProof(
      String(proof.claimed_method),
      Boolean(dynamicQrisTransaction),
    );

    // A dynamic QRIS proof is supporting evidence only. KlikQRIS callback/status
    // remains authoritative. Static QRIS has no provider callback and therefore
    // follows the same admin-confirmed mutation path as bank/e-wallet.
    if (!authoritativeMethod) {
      const result = await execRun(
        `UPDATE payment_proofs
         SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=NULL
         WHERE id=? AND status='submitted'`,
        reviewer,
        proofId,
      );
      if (!result.changes) {
        return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });
      }
      try {
        await ensureFulfillmentForPaidOrder(orderCode);
      } catch { /* Paid-state reconciliation will retry if applicable. */ }
      return NextResponse.json({ ok: true, action: "approved", order_code: orderCode, payment_updated: false });
    }

    if (d1) {
      const guardId = `proof-review:${proofId}:manual-payment`;
      const statements: D1Statement[] = [
        d1.prepare(
          `INSERT INTO operation_guards (operation_id, valid)
           SELECT ?, CASE WHEN
             EXISTS(SELECT 1 FROM payment_proofs WHERE id=? AND status='submitted')
             AND EXISTS(
               SELECT 1 FROM orders
               WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')
             )
             AND NOT EXISTS(
               SELECT 1 FROM payment_transactions WHERE order_code=? AND status='paid'
             )
           THEN 1 ELSE 0 END`,
        ).bind(guardId, proofId, orderCode, orderCode),
        d1.prepare(
          `UPDATE payment_proofs
           SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=NULL
           WHERE id=? AND status='submitted'`,
        ).bind(reviewer, proofId),
        d1.prepare(
          `UPDATE payment_transactions
           SET status='failed', last_error='superseded_by_manual_payment', updated_at=datetime('now')
           WHERE order_code=? AND status IN ('initializing','pending')`,
        ).bind(orderCode),
        d1.prepare(
          `UPDATE orders
           SET status='lunas', payment_status='paid', payment_method=?,
               updated_at=datetime('now')
           WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
        ).bind(authoritativeMethod, orderCode),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ];

      try {
        await d1.batch(statements);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/operation_guards|CHECK constraint|UNIQUE/i.test(message)) {
          return NextResponse.json({ error: "payment_conflict_or_already_reviewed" }, { status: 409 });
        }
        throw error;
      }

      let fulfillmentStarted = false;
      try {
        fulfillmentStarted = await ensureFulfillmentForPaidOrder(orderCode);
      } catch { /* Payment is durable; fulfillment remains retryable. */ }
      return NextResponse.json({
        ok: true,
        action: "approved",
        order_code: orderCode,
        payment_updated: true,
        fulfillment_started: fulfillmentStarted,
      });
    }

    // Dev fallback
    const res = await execRun(
      `UPDATE payment_proofs SET status='approved', reviewed_by=?, reviewed_at=datetime('now') WHERE id=? AND status='submitted'`,
      reviewer,
      proofId,
    );
    if (!res.changes) return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });

    await execRun(
      `UPDATE orders SET status='lunas', payment_status='paid', payment_method=?, updated_at=datetime('now') WHERE code=? AND status='pending'`,
      authoritativeMethod,
      orderCode,
    );
    await execRun(
      `UPDATE payment_transactions
       SET status='failed', last_error='superseded_by_manual_payment', updated_at=datetime('now')
       WHERE order_code=? AND status IN ('initializing','pending')`,
      orderCode,
    );
    try {
      await ensureFulfillmentForPaidOrder(orderCode);
    } catch { /* best effort in dev */ }
    return NextResponse.json({ ok: true, action: "approved", order_code: orderCode });
  }

  // Action: reject
  if (d1) {
    const res = await execRun(
      `UPDATE payment_proofs
       SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=?
       WHERE id=? AND status='submitted'`,
      reviewer,
      reason || "Bukti ditolak oleh admin",
      proofId,
    );
    if (!res.changes) {
      return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action: "rejected", order_code: orderCode });
  }

  // Dev fallback reject
  await execRun(
    `UPDATE payment_proofs SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=? WHERE id=? AND status='submitted'`,
    reviewer,
    reason || "Bukti ditolak oleh admin",
    proofId,
  );
  return NextResponse.json({ ok: true, action: "rejected", order_code: orderCode });
}
