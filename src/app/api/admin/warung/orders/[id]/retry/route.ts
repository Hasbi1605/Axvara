// POST /api/admin/warung/orders/[id]/retry — Manual retry satu WR order link.
// CAS berpagar (P1-9): klaim retry memakai UPDATE bersyarat atas
// (status, attempt_count) yang dibaca — worker/admin lain yang sudah
// mengklaim/mengubah baris membuat UPDATE ini 0 changes → 409, bukan
// retry ganda.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun } from "@/lib/db";
import { isWrEnabled } from "@/lib/warung-rebahan/client";
import { WR_LINK_STATUSES } from "@/lib/warung-rebahan/order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const RETRYABLE = ["pending", "retry", "failed", "blocked_balance"];

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
    `SELECT id, status, attempt_count, max_attempts FROM wr_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!(WR_LINK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "unknown_status", status }, { status: 500 });
  }
  if (!RETRYABLE.includes(status)) {
    return NextResponse.json({ error: "not_retryable", status }, { status: 409 });
  }
  if (Number(link.attempt_count || 0) >= Number(link.max_attempts || 3)) {
    return NextResponse.json({ error: "max_attempts_reached" }, { status: 409 });
  }
  // CAS: menangkan klaim hanya bila status + attempt_count masih sama
  // seperti saat dibaca. Kalah race (worker cron/admin lain) → 409.
  //
  // Klaim ini SENGAJA tidak menaikkan `attempt_count` dan tidak memakai
  // debounce waktu (ditinjau 2026-09-23, klaim "spam-klik = amplifikasi"
  // DITOLAK): penaikan counter milik worker saat mengklaim (order.ts
  // `attempt_count=?`), dan `handleInsufficientBalance` justru
  // mengembalikannya agar saldo habis tidak memakan jatah transport —
  // menaikkan di sini akan menghitung GANDA. Amplifikasi sendiri sudah
  // tertutup: klik bersamaan disaring CAS ini (lihat
  // admin-retry-race.regression.test.ts), dan klik berurutan menemukan status
  // sudah `claimed` sepulang `processWrPendingOrders()` — `claimed` bukan
  // anggota RETRYABLE, jadi ditolak 409.
  const claimed = await execRun(
    `UPDATE wr_order_links SET status='retry', next_attempt_at=datetime('now'),
       last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
       request_sent_at=NULL, updated_at=datetime('now')
     WHERE id=? AND status=? AND attempt_count=?`,
    linkId,
    status,
    Number(link.attempt_count || 0),
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (Number(claimed.changes ?? 0) === 0) {
    const current = await queryFirst(`SELECT status, attempt_count FROM wr_order_links WHERE id=?`, linkId);
    return NextResponse.json(
      { error: "retry_race_lost", status: String(current?.status ?? "unknown") },
      { status: 409 },
    );
  }
  try {
    const { processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
    await processWrPendingOrders();
  } catch { /* cron memproses berikutnya */ }
  const updated = await queryFirst(`SELECT id, order_code, status, attempt_count, last_error FROM wr_order_links WHERE id=?`, linkId);
  return NextResponse.json({ ok: true, link: updated });
}
