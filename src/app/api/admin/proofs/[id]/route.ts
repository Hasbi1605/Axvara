// src/app/api/admin/proofs/[id]/route.ts — Review payment proof (Approve/Reject with CAS)

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun, getD1, D1Statement } from "@/lib/db";
import { z } from "zod";

export const runtime = "edge";

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(300).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const proofId = Number(id);
  if (!proofId) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

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
    if (d1) {
      const statements: D1Statement[] = [
        // 1. CAS on proof
        d1.prepare(
          `UPDATE payment_proofs
           SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), rejection_reason=NULL
           WHERE id=? AND status='submitted'`,
        ).bind(reviewer, proofId),

        // 2. Update order to lunas & paid
        d1.prepare(
          `UPDATE orders
           SET status='lunas', payment_status='paid',
               payment_method=CASE WHEN payment_method='pending' THEN ? ELSE payment_method END,
               updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(String(proof.claimed_method || "manual").toLowerCase(), orderCode),
      ];

      const results = await d1.batch(statements);
      const proofChanges = results[0]?.meta?.changes ?? 0;
      if (proofChanges === 0) {
        return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });
      }

      return NextResponse.json({ ok: true, action: "approved", order_code: orderCode });
    }

    // Dev fallback
    const res = await execRun(
      `UPDATE payment_proofs SET status='approved', reviewed_by=?, reviewed_at=datetime('now') WHERE id=? AND status='submitted'`,
      reviewer,
      proofId,
    );
    if (!res.changes) return NextResponse.json({ error: "concurrent_modification" }, { status: 409 });

    await execRun(
      `UPDATE orders SET status='lunas', payment_status='paid', updated_at=datetime('now') WHERE code=?`,
      orderCode,
    );
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
