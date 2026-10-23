import { readUniqueUnitProgress } from "@/lib/orders/unit-progress";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { checkRateLimit } from "@/lib/rateLimit";
import { constantTimeEqual } from "@/lib/security";
import { emailMatches, normalizeWa, parseBuyerContact } from "@/lib/order-contact";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// `contact` = No. WA atau email checkout; `wa` tetap diterima (tautan lama ?wa=).
const schema = z.object({
  code: z.string().trim().min(1).max(32),
  contact: z.string().trim().max(254).optional(),
  wa: z.string().trim().max(254).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "orders:lookup")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  const contactRaw = parsed.success ? (parsed.data.contact ?? parsed.data.wa ?? "").trim() : "";
  if (!parsed.success || !contactRaw) {
    return NextResponse.json({ error: "Kode pesanan dan No. WA atau email wajib diisi." }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();
  // Kode Pedia (AXP-…) — pola sama, tabel item berbeda (PD-13).
  if (/^AXP-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    const { lookupPediaOrder } = await import("@/lib/pedia/lookup");
    return lookupPediaOrder(code, contactRaw);
  }
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "Format kode tidak valid. Contoh: AXV-20260917-AB12CD34." }, { status: 400 });
  }
  const contact = parseBuyerContact(contactRaw);
  if (!contact) {
    return NextResponse.json({
      error: contactRaw.includes("@")
        ? "Format email tidak valid. Contoh: nama@gmail.com."
        : "Nomor WA tidak valid. Gunakan format 08... atau +62..., atau isi email checkout.",
    }, { status: 400 });
  }

  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status, pt.provider AS payment_provider
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;

  // Respons generik untuk tidak-ditemukan maupun WA-tidak-cocok agar kode
  // order tidak bisa di-oracle satu per satu (enumerasi).
  const notFound = () =>
    NextResponse.json({ error: "Pesanan tidak ditemukan atau No. WA/email tidak cocok. Periksa kembali kode serta No. WA atau email yang dipakai saat checkout." }, { status: 404 });

  if (!row) return notFound();
  if (contact.kind === "email") {
    if (!emailMatches(contact.value, row.customer_email)) return notFound();
  } else {
    const storedWa = normalizeWa(row.customer_wa);
    if (!storedWa || !constantTimeEqual(contact.value, storedWa)) return notFound();
  }

  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? `${waFull.slice(0, 5)}****${waFull.slice(-4)}` : waFull ? `${waFull.slice(0, 3)}****` : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  let items: { name: string; price: number; qty: number }[] = [];
  try {
    items = JSON.parse(String(row.items || "[]"));
  } catch {
    items = [];
  }
  // Flag kredensial siap (Fase B): lookup SUDAH memverifikasi WA penuh
  // (constantTimeEqual di atas), jadi panel di hasil lacak sama amannya
  // dengan halaman pesanan — tanpa input WA ulang.
  let credentialsReady = false;
  let supplierOwned = false;
  let supplierRunning = false;
  let fulfillmentStatus = row.fulfillment_status ?? null;
  if (String(row.status) === "lunas") {
    // Detail WR ATAU isi produk non-WR terkirim (migrasi 0043) + kepemilikan
    // supplier (pagar kalimat sesat) + link masih berjalan (pemicu segar).
    const cred = await queryFirst(
      `SELECT
        (EXISTS(SELECT 1 FROM wr_order_links
           WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
         OR EXISTS(SELECT 1 FROM fulfillment_items
           WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=?)
         OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=?)) AS supplier_owned,
        (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!='')
         OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS supplier_running`,
      code, code, code, code, code, code,
    ).catch(() => null);
    credentialsReady = Number(cred?.creds ?? 0) === 1;
    supplierOwned = Number((cred as Record<string, unknown> | null)?.supplier_owned ?? 0) === 1;
    supplierRunning = Number((cred as Record<string, unknown> | null)?.supplier_running ?? 0) === 1;
    // Sama seperti halaman pesanan: pembeli yang menunggu memicu tarikan
    // status vendor sekarang (gerbang 20 dtk/order). Best-effort diam.
    if (supplierRunning && !credentialsReady) {
      try {
        const { createDatabaseAccess } = await import("@/lib/db-access");
        const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
        const refreshDb = createDatabaseAccess();
        const { refreshed } = await maybeRefreshSupplierOrder(code, refreshDb);
        if (refreshed) {
          const after = await refreshDb.queryFirst(
            `SELECT o.fulfillment_status,
                    (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL)
                     OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL)) AS creds,
                    (EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!='')
                     OR EXISTS(SELECT 1 FROM sk_order_links WHERE order_code=? AND (status IN ('processing','submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL)))) AS running
             FROM orders o WHERE o.code=?`,
            code, code, code, code, code,
          ).catch(() => null);
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
      items,
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      proof_url: undefined,
      status: row.status,
      payment_status: row.payment_status ?? null,
      fulfillment_status: fulfillmentStatus,
      created_at: row.created_at,
      expires_at: row.payment_provider === "klikqris" && row.payment_expires_at ? row.payment_expires_at : row.expires_at,
      unique_units_progress: await readUniqueUnitProgress(row),
      credentials_ready: credentialsReady,
      supplier_owned: supplierOwned,
      supplier_running: supplierRunning,
      qris_reissue_allowed: row.payment_provider !== "klikqris" && row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
      qris: row.dynamic_qris_url
        ? {
            payable_amount: row.payable_amount,
            unique_code: row.unique_code,
            image_url: row.dynamic_qris_url,
            expires_at: row.payment_expires_at,
            status: row.transaction_status,
          }
        : null,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
