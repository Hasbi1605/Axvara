// POST /api/admin/warung/rescue-plaintext — DARURAT 2026-10-04, HAPUS SETELAH DIPAKAI.
//
// Kasus F111FD64: reconcile fresh (deploy a9e2de2) menyimpan ciphertext dari
// formatter LAMA yang menghasilkan "[object Object]" untuk payload
// {product, details: [{...}×4]}. Endpoint ini menulis ulang ciphertext link
// + item dari PLAINTEXT BENAR (server-side encrypt, tanpa key keluar).
// Body: { order_code, plaintext (≤2000), link_id }.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { refreshOrderAggregate } from "@/lib/warung-rebahan/deliver";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const orderCode = String(body?.order_code || "").trim();
  const plaintext = String(body?.plaintext || "").trim().slice(0, 2000);
  const linkId = Number(body?.link_id || 0);
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(orderCode) || !plaintext || !Number.isInteger(linkId) || linkId <= 0) {
    return NextResponse.json({ error: "order_code + plaintext + link_id diperlukan" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const link = await db.queryFirst(`SELECT id FROM wr_order_links WHERE id=? AND order_code=?`, linkId, orderCode).catch(() => null);
  if (!link) return NextResponse.json({ error: "link_not_found" }, { status: 404 });
  const { ciphertext, iv } = await encryptSecret(plaintext);
  const now = new Date().toISOString();
  await db.execRun(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=?, completed_at=COALESCE(completed_at,?), last_error=NULL, updated_at=datetime('now') WHERE id=?`,
    ciphertext, iv, now, linkId,
  );
  await db.execRun(
    `UPDATE wr_order_links SET fulfillment_item_id=COALESCE(fulfillment_item_id, (SELECT fi.id FROM fulfillment_items fi JOIN product_variants pv ON pv.id=fi.variant_id WHERE fi.order_code=? AND pv.wr_variant_id=(SELECT wr_variant_id FROM wr_order_links WHERE id=?) ORDER BY fi.item_index ASC LIMIT 1)) WHERE id=?`,
    orderCode, linkId, linkId,
  ).catch(() => undefined);
  const bound = await db.queryFirst(`SELECT fulfillment_item_id FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  const itemId = Number(bound?.fulfillment_item_id || 0);
  if (itemId > 0) {
    await db.execRun(
      `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, delivered_ciphertext=?, delivered_iv=?, wr_link_id=?, locked_until=NULL, updated_at=datetime('now') WHERE id=? AND order_code=?`,
      `wr:${itemId}`, ciphertext, iv, linkId, itemId, orderCode,
    );
  }
  await refreshOrderAggregate(orderCode, db);
  return NextResponse.json({ ok: true, order_code: orderCode, link_id: linkId, item_id: itemId });
}
