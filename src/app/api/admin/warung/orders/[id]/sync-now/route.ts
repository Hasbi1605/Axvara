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
import { fetchTransactions, isWrEnabled } from "@/lib/warung-rebahan/client";
import { reconcileFreshWrLinks } from "@/lib/warung-rebahan/order";
import { createDatabaseAccess } from "@/lib/db-access";
import { readTextBody } from "@/lib/http-body";

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
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(linkId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const bounded = await readTextBody(request, 1_000);
  if (!bounded.ok) return bounded.response;
  let selectedId: string | undefined;
  if (bounded.data.trim()) {
    let body: unknown;
    try { body = JSON.parse(bounded.data); } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("wr_order_id" in body)
      || typeof body.wr_order_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(body.wr_order_id)) {
      return NextResponse.json({ error: "invalid_invoice" }, { status: 400 });
    }
    selectedId = body.wr_order_id;
  }
  const link = await queryFirst(
    `SELECT * FROM wr_order_links WHERE id=?`,
    linkId,
  );
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (selectedId && link.wr_order_id && link.wr_order_id !== selectedId) {
    return NextResponse.json({ error: "invoice_conflict" }, { status: 409 });
  }
  const status = String(link.status || "");
  const replay = selectedId && link.wr_order_id === selectedId;
  if (!["processing", "submitted", "ordering"].includes(status) && !(status === "claimed" && link.request_sent_at)
    && !(replay && ["completed", "failed"].includes(status))) {
    return NextResponse.json({ error: "not_syncable", status }, { status: 409 });
  }
  if (!link.wr_order_id && !selectedId) return NextResponse.json({ error: "invoice_required" }, { status: 409 });
  let reconciled = 0;
  try {
    const db = createDatabaseAccess();
    const transactions = await fetchTransactions();
    if (selectedId && !link.wr_order_id) {
      if (!["submitted", "ordering", "claimed"].includes(status) || !link.request_sent_at) {
        return NextResponse.json({ error: "not_bindable" }, { status: 409 });
      }
      const matches = transactions.filter((tx) => tx?.order_id === selectedId);
      if (matches.length !== 1) return NextResponse.json({ error: "invoice_not_unique_or_missing" }, { status: 409 });
      const tx = matches[0];
      const product = Array.isArray(tx.products) && tx.products.length === 1 ? tx.products[0] as Record<string, unknown> | null : null;
      if (tx.payment_status !== "paid" || !["processing", "completed", "success", "done", "failed", "cancelled", "canceled", "refunded"].includes(tx.status)
        || typeof tx.total_amount !== "number" || !Number.isSafeInteger(tx.total_amount) || tx.total_amount <= 0 || tx.total_amount !== link.wr_cost
        || !product || typeof product !== "object" || !Number.isSafeInteger(product.quantity) || product.quantity !== link.quantity
        || Number(product.quantity) <= 0 || typeof product.price !== "number" || !Number.isSafeInteger(product.price) || product.price <= 0
        || product.price * Number(product.quantity) !== tx.total_amount) {
        return NextResponse.json({ error: "invoice_mismatch" }, { status: 409 });
      }
      const byVariant = "variant_id" in product;
      if (byVariant && (typeof product.variant_id !== "string" || product.variant_id !== link.wr_variant_id)) {
        return NextResponse.json({ error: "invoice_mismatch" }, { status: 409 });
      }
      if (!byVariant && !["product_name", "variant_name", "type", "duration", "warranty"].every((key) => typeof product[key] === "string" && String(product[key]).trim())) {
        return NextResponse.json({ error: "invoice_mismatch" }, { status: 409 });
      }
      // The admin establishes correlation. The single guarded statement verifies
      // identity, snapshot, payment and exclusive invoice ownership at assignment.
      const assigned = await db.execRun(
        `UPDATE wr_order_links SET wr_order_id=?,status='processing',last_error=NULL,
           lease_owner=NULL,lease_expires_at=NULL,updated_at=datetime('now')
         WHERE id=? AND COALESCE(wr_order_id,'')='' AND status=?
           AND request_sent_at=? AND wr_variant_id=? AND quantity=? AND wr_cost=? AND order_code=?
           AND EXISTS (SELECT 1 FROM orders o WHERE o.code=wr_order_links.order_code AND o.status='lunas' AND o.payment_status='paid')
           AND NOT EXISTS (SELECT 1 FROM wr_order_links used WHERE used.wr_order_id=?)
           AND EXISTS (SELECT 1 FROM wr_variants v JOIN wr_products p ON p.wr_product_id=v.wr_product_id
             WHERE v.wr_variant_id=wr_order_links.wr_variant_id AND v.wr_price=?
             ${byVariant ? "" : `AND p.wr_product_name=? AND v.wr_variant_name=? AND v.wr_type=? AND v.wr_duration=? AND v.wr_warranty=?
               AND (SELECT COUNT(*) FROM wr_variants other JOIN wr_products parent ON parent.wr_product_id=other.wr_product_id
                 WHERE parent.wr_product_name=p.wr_product_name AND other.wr_variant_name=v.wr_variant_name)=1`})`,
        selectedId, linkId, status, link.request_sent_at, link.wr_variant_id, link.quantity, link.wr_cost, link.order_code, selectedId, product.price,
        ...(!byVariant ? [product.product_name, product.variant_name, product.type, product.duration, product.warranty] : []),
      );
      if (!Number(assigned.changes ?? 0)) return NextResponse.json({ error: "binding_conflict" }, { status: 409 });
    }
    reconciled = await reconcileFreshWrLinks([{
      id: linkId,
      wr_order_id: String(link.wr_order_id || ""),
      order_code: String(link.order_code || ""),
    }], db, async () => transactions);
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
