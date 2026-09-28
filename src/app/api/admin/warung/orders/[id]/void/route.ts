// POST /api/admin/warung/orders/[id]/void — Batalkan (void) satu WR order link.
// CAS berpagar (mirror route retry): UPDATE bersyarat atas (status,
// attempt_count) yang dibaca — worker/admin lain yang sudah mengubah baris
// membuat UPDATE ini 0 changes → 409, bukan void ganda.
//
// Void = terminal `failed` + `last_error='cancelled_by_admin'` (reuse status
// `failed` yang sudah terminal di WR_TERMINAL_STATUSES; TANPA status baru
// agar CHECK wr_order_links tidak perlu ALTER). Link yang sudah `completed`
// atau sudah `failed` ditolak 409/404. Cron tidak menyentuh status terminal,
// jadi void menghentikan zombie auto-revive blocked_balance secara permanen.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun } from "@/lib/db";
import { isWrEnabled } from "@/lib/warung-rebahan/client";
import { WR_LINK_STATUSES } from "@/lib/warung-rebahan/order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Semua status non-terminal boleh di-void; terminal (completed/failed)
// tidak bisa dibatalkan lagi.
const VOIDABLE = ["pending", "retry", "blocked_balance", "claimed", "submitted", "ordering", "processing"];

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
    `SELECT id, status, attempt_count FROM wr_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = String(link.status || "");
  if (!(WR_LINK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "unknown_status", status }, { status: 500 });
  }
  if (!VOIDABLE.includes(status)) {
    return NextResponse.json({ error: "not_voidable", status }, { status: 409 });
  }
  // CAS: menangkan void hanya bila status + attempt_count masih sama seperti
  // saat dibaca. Kalah race (worker cron/admin lain) → 409.
  const voided = await execRun(
    `UPDATE wr_order_links SET status='failed', last_error='cancelled_by_admin',
       lease_owner=NULL, lease_expires_at=NULL, request_sent_at=NULL,
       next_attempt_at=NULL, updated_at=datetime('now')
     WHERE id=? AND status=? AND attempt_count=?`,
    linkId,
    status,
    Number(link.attempt_count || 0),
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (Number(voided.changes ?? 0) === 0) {
    const current = await queryFirst(`SELECT status FROM wr_order_links WHERE id=?`, linkId);
    return NextResponse.json(
      { error: "void_race_lost", status: String(current?.status ?? "unknown") },
      { status: 409 },
    );
  }
  const updated = await queryFirst(`SELECT id, order_code, status, attempt_count, last_error FROM wr_order_links WHERE id=?`, linkId);
  return NextResponse.json({ ok: true, link: updated });
}
