// GET/POST /api/admin/warung/credentials — Retrieval & resend kredensial (admin-only fallback, P0-6).
// GET ?order_code=: baca detail akun terdekripsi milik order (admin).
// POST {order_code}: antrekan ulang delivery kredensial (retry manual).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { getDecryptedAccountDetails, queueCredentialDelivery } from "@/lib/warung-rebahan/deliver";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orderCode = request.nextUrl.searchParams.get("order_code")?.trim() || "";
  if (!orderCode) return NextResponse.json({ error: "order_code_required" }, { status: 400 });
  const db = createDatabaseAccess();
  const details = await getDecryptedAccountDetails(orderCode, db, { admin: true });
  const links = await db
    .queryAll(
      `SELECT id, wr_order_id, status, delivery_status, delivery_attempt_count,
              delivery_last_error, completed_at
       FROM wr_order_links WHERE order_code=? ORDER BY id ASC`,
      orderCode,
    )
    .catch(() => []);
  return NextResponse.json({ ok: true, order_code: orderCode, credentials: details, links });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const orderCode = String(body?.order_code || "").trim();
  if (!orderCode) return NextResponse.json({ error: "order_code_required" }, { status: 400 });
  const db = createDatabaseAccess();
  const links = await db
    .queryAll(`SELECT id FROM wr_order_links WHERE order_code=? AND status='completed'`, orderCode)
    .catch(() => []);
  if (!links.length) return NextResponse.json({ error: "no_completed_link" }, { status: 404 });
  let queued = 0;
  for (const link of links) {
    try {
      if (await queueCredentialDelivery(Number(link.id), db)) queued++;
    } catch {
      /* lanjut link berikutnya */
    }
  }
  try {
    const { processDueCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
    await processDueCredentialDeliveries(db);
  } catch {
    /* cron memproses berikutnya */
  }
  return NextResponse.json({ ok: true, order_code: orderCode, queued });
}
