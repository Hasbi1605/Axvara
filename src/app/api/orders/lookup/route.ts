import { readAutomaticProgress } from "@/lib/warung-rebahan/progress";
import { queryAll } from "@/lib/db";
import { readUniqueUnitProgress } from "@/lib/orders/unit-progress";
import { EMPTY_STATUS_FLAGS, maybeRefreshStatusFlags, readLookupFlags, type StatusFlags } from "@/lib/orders/status-flags";
import { NextRequest, NextResponse } from "next/server";
import { withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { readJsonBody } from "@/lib/http-body";
import { z } from "zod";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/qris";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseBuyerContact } from "@/lib/order-contact";
import { requireAdmin } from "@/lib/auth";
import { buyerOrderAccessMatches, createBuyerAccessSession, requiresOrderAccessCode, newOrderAccessFailure, orderAccessDenied } from "@/lib/order-access";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// `contact` = No. WA atau email checkout; `wa` tetap diterima (tautan lama ?wa=).
const schema = z.object({
  code: z.string().trim().min(1).max(32),
  contact: z.string().trim().max(254).optional(),
  wa: z.string().trim().max(254).optional(),
  access_code: z.string().trim().max(100).optional(),
  adminView: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const response = await lookup(req);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function lookup(req: NextRequest) {
  if (!checkRateLimit(req, "orders:lookup")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  const adminView = parsed.success && parsed.data.adminView === true;
  if (adminView && !(await requireAdmin(req))) {
    return NextResponse.json({ error: "Sesi admin berakhir. Masuk ke panel admin lalu buka kembali tautan ini." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const contactRaw = parsed.success ? (parsed.data.contact ?? parsed.data.wa ?? parsed.data.access_code ?? "").trim() : "";
  if (!parsed.success || (!adminView && !contactRaw)) {
    return NextResponse.json({ error: "Kode pesanan dan No. WA atau email wajib diisi." }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();
  // Kode Pedia (AXP-…) — pola sama, tabel item berbeda (PD-13).
  if (/^AXP-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    const { lookupPediaOrder } = await import("@/lib/pedia/lookup");
    return lookupPediaOrder(code, contactRaw, adminView, req);
  }
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "Format kode tidak valid. Contoh: AXV-20260917-AB12CD34." }, { status: 400 });
  }
  const contact = parseBuyerContact(contactRaw);
  if (!adminView && !contact && !normalizeOrderAccessCode(contactRaw)) {
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
  const notFound = orderAccessDenied;

  if (!row) return notFound();
  if (!adminView) {
    const pin = parsed.data.access_code;
    const failure = await newOrderAccessFailure(req, row, pin ?? contactRaw, {
      allowAdmin: false, ...(pin ? { purpose: "credentials" as const, contact: contactRaw } : {}),
    });
    if (failure) return failure;
  }
  if (!adminView && !requiresOrderAccessCode(row) && !(await buyerOrderAccessMatches(contactRaw, row))) return notFound();

  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? `${waFull.slice(0, 5)}****${waFull.slice(-4)}` : waFull ? `${waFull.slice(0, 3)}****` : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  let items: { name: string; price: number; qty: number }[] = [];
  try {
    items = withoutPrivateBuyerData(JSON.parse(String(row.items || "[]"))) as typeof items;
  } catch {
    items = [];
  }
  // Flag kredensial siap (Fase B): lookup SUDAH memverifikasi WA penuh
  // (constantTimeEqual di atas), jadi panel di hasil lacak sama amannya
  // dengan halaman pesanan — tanpa input WA ulang.
  // Readiness SQL + refresh kini di src/lib/orders/status-flags.ts (3B-1).
  let flags: StatusFlags = { ...EMPTY_STATUS_FLAGS };
  let fulfillmentStatus = row.fulfillment_status ?? null;
  if (String(row.status) === "lunas") {
    // Detail WR ATAU isi produk non-WR terkirim (migrasi 0043) + kepemilikan
    // supplier (pagar kalimat sesat) + link masih berjalan (pemicu segar).
    // Compact query: creds/owned/running + automatic progress, tanpa
    // queued/instant (panel lacak tidak memakainya).
    const lookupFlags = await readLookupFlags(code, row as Record<string, unknown>, { queryFirst });
    flags = { ...flags, ...lookupFlags };
    // Sama seperti halaman pesanan: pembeli yang menunggu memicu tarikan
    // status vendor sekarang (gerbang 20 dtk/order). Best-effort diam.
    // One ready item must not stop refresh for the remaining supplier items.
    if (flags.supplierRunning) {
      const refreshFlags = {
        credentialsReady: flags.credentialsReady,
        supplierRunning: flags.supplierRunning,
        fulfillmentStatus,
      };
      try {
        const { createDatabaseAccess } = await import("@/lib/db-access");
        const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
        await maybeRefreshStatusFlags(
          code,
          row as Record<string, unknown>,
          refreshFlags,
          {
            createAccess: () => createDatabaseAccess(),
            maybeRefresh: (orderCode, refreshDb) => maybeRefreshSupplierOrder(orderCode, refreshDb),
          },
        );
      } catch {
        /* penjamin cron tetap berlaku (termasuk gagal impor bundle) */
      }
      flags.credentialsReady = refreshFlags.credentialsReady;
      flags.supplierRunning = refreshFlags.supplierRunning;
      if (refreshFlags.fulfillmentStatus != null) fulfillmentStatus = refreshFlags.fulfillmentStatus;
    }
  }
  // Non-QRIS view (W3): same proof guard as status route above; buyer-safe only.
  const payment = row.payment_provider === "nowpayments"
    ? await import("@/lib/payments/payment-view").then((m) => m.buildNowpaymentsPaymentView(code)).catch(() => null)
    : row.payment_provider === "sekalipay_gateway" ? await import("@/lib/payments/payment-view").then((m) => m.buildSekalipayGatewayPaymentView(code)).catch(() => null)
    : null;
  return NextResponse.json({
    buyer_access_session: adminView ? undefined : await createBuyerAccessSession(row),
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
      locale: (row.locale as string) ?? "id",
      unique_units_progress: await readUniqueUnitProgress(row),
      credentials_ready: flags.credentialsReady,
      buyer_pin_required: requiresOrderAccessCode(row),
      supplier_owned: flags.supplierOwned,
      supplier_running: flags.supplierRunning,
      automatic_progress: flags.hasAutomaticProgress ? await readAutomaticProgress(code, { queryAll }).catch(() => []) : [],
      qris_reissue_allowed: row.payment_provider === "gopay" && row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
      qris: row.dynamic_qris_url
        ? {
            payable_amount: row.payable_amount,
            unique_code: row.unique_code,
            image_url: row.dynamic_qris_url,
            expires_at: row.payment_expires_at,
            status: row.transaction_status,
          }
        : null,
      ...(payment ? { payment } : {}),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
