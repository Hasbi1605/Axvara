import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Endpoint publik: identitas pembeli hanya kode order, jadi isi respons WAJIB
// tetap sepadan dengan `GET /api/orders?code=` — keduanya melayani halaman
// /pesanan/[code] yang sama. `proof_url` TIDAK pernah ikut: ia adalah kunci
// objek R2 privat yang hanya boleh dibaca admin lewat /api/admin/bukti/*,
// dan membocorkannya di sini memberi penebak kode order sebuah nama file
// bukti pembayaran milik orang lain.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(req, "orders:lookup")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status,pt.provider AS payment_provider
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  let credentialsReady = false;
  let supplierOwned = false;
  let supplierRunning = false;
  let fulfillmentStatus = row.fulfillment_status ?? null;
  if (String(row.status) === "lunas") {
    const flags = (await queryFirst(
      `SELECT
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
         OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=?)
         OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=?)) AS supplier_owned,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!='')
         OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS supplier_running`,
      code, code, code, code, code, code,
    ).catch(() => null)) as Record<string, unknown> | null;
    credentialsReady = Number(flags?.creds ?? 0) === 1;
    supplierOwned = Number(flags?.supplier_owned ?? 0) === 1;
    supplierRunning = Number(flags?.supplier_running ?? 0) === 1;
    if (supplierRunning && !credentialsReady) {
      try {
        const { createDatabaseAccess } = await import("@/lib/db-access");
        const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
        const refreshDb = createDatabaseAccess();
        const { refreshed } = await maybeRefreshSupplierOrder(code, refreshDb);
        if (refreshed) {
          const after = (await refreshDb.queryFirst(
            `SELECT o.fulfillment_status,
                    (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
                     OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
                    (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!='')
                     OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS running
             FROM orders o WHERE o.code=?`,
            code, code, code, code, code,
          ).catch(() => null)) as Record<string, unknown> | null;
          if (after) {
            credentialsReady = Number(after.creds ?? 0) === 1;
            supplierRunning = Number(after.running ?? 0) === 1;
            if (after.fulfillment_status != null) fulfillmentStatus = after.fulfillment_status;
          }
        }
      } catch { /* penjamin cron tetap berlaku */ }
    }
  }
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: waMasked,
      customer_email: emailMasked,
      items: JSON.parse(String(row.items || "[]")),
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      credentials_ready: credentialsReady,
      supplier_owned: supplierOwned,
      supplier_running: supplierRunning,
      fulfillment_status: fulfillmentStatus,
      qris_reissue_allowed: row.payment_provider !== "klikqris" && row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
      qris: row.dynamic_qris_url ? {
        payable_amount: row.payable_amount,
        unique_code: row.unique_code,
        image_url: row.dynamic_qris_url,
        expires_at: row.payment_expires_at,
        status: row.transaction_status,
      } : null,
    },
  });
}
