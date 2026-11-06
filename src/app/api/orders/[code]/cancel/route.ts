// POST /api/orders/[code]/cancel — Pembatalan mandiri oleh pembeli.
//
// Latar (keputusan owner 2026-10-11): tombol Batalkan selama ini hanya ada di
// panel ADMIN dan bot Telegram (`cancel:`). Pembeli WEB yang berubah pikiran
// / salah varian tidak punya jalan keluar selain menunggu expiry — sementara
// stoknya mengunci varian untuk semua orang. Endpoint ini memberi jalan
// keluar instan dengan verifikasi kepemilikan yang sama dengan lacak pesanan
// (kode + kontak WA/email checkout), tanpa login.
//
// Keamanan:
// - Verifikasi kontak WAJIB (pola `POST /api/orders/lookup`): kode order saja
//   tidak cukup — penebak kode orang lain tidak bisa membatalkan.
//   Respons gagal generik (404 sama) agar tidak bisa di-oracle.
// - Hanya order `pending` + `payment_status IN ('unpaid','pending')` yang bisa
//   dibatalkan. Order lunas/kadaluarsa/dibatalkan → 409 jujur.
// - Race vs webhook pembayaran dimenangkan secara deterministik oleh
//   `transitionPendingPaymentOrder`-style CAS di `transitionPendingOrder`
//   (guard `status='pending'`): kalah balapan = 409, stok tidak digelembungkan,
//   ledger `paid` tidak tersentuh.
// - Rate-limit `orders:lookup` (20/mnt/IP) — sama dengan lookup/credentials.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http-body";
import { z } from "zod";
import { queryFirst, transitionPendingOrder, OrderTransitionError } from "@/lib/db";
import { isValidOrderCode } from "@/lib/security";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseBuyerContact } from "@/lib/order-contact";
import { buyerOrderAccessMatches, requiresOrderAccessCode, newOrderAccessFailure } from "@/lib/order-access";
import { normalizeOrderAccessCode } from "@/lib/order-access-format";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  contact: z.string().trim().max(254).optional(),
  wa: z.string().trim().max(254).optional(),
  access_code: z.string().trim().max(100).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(req, "orders:lookup")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  const orderCode = String(code || "").toUpperCase();
  if (!isValidOrderCode(orderCode)) {
    return NextResponse.json({ error: "Kode pesanan tidak valid" }, { status: 400 });
  }
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  const contactRaw = parsed.success ? (parsed.data.access_code ?? parsed.data.contact ?? parsed.data.wa ?? "").trim() : "";
  if (!parsed.success || !contactRaw) {
    return NextResponse.json({ error: "No. WA atau email checkout wajib diisi." }, { status: 400 });
  }
  const contact = parseBuyerContact(contactRaw);
  if (!contact && !normalizeOrderAccessCode(contactRaw)) {
    return NextResponse.json({ error: "Format kontak tidak valid." }, { status: 400 });
  }

  const row = (await queryFirst(
    `SELECT o.code, o.status, o.payment_status, o.customer_wa, o.customer_email, o.items, o.buyer_access_version, o.buyer_access_format,
            pt.provider AS payment_provider, pt.status AS transaction_status, pt.last_error AS payment_last_error,
            pt.provider_status_text AS provider_status_text, pt.actually_paid_text AS actually_paid_text,
            pt.pay_amount_text AS pay_amount_text,pt.paid_at AS transaction_paid_at
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=?`,
    orderCode,
  )) as Record<string, unknown> | undefined;

  // Generik seperti lookup: tidak membocorkan apakah kode salah atau kontak salah.
  const notFound = () =>
    NextResponse.json({ error: "Pesanan tidak ditemukan atau kontak tidak cocok." }, { status: 404 });
  if (!row) return notFound();
  const failure = await newOrderAccessFailure(req, row, contactRaw);
  if (failure) return failure;
  if (!requiresOrderAccessCode(row) && !(await buyerOrderAccessMatches(contactRaw, row))) return notFound();

  // W3 crypto fail-closed (server-side, bukan sekadar sembunyi tombol UI):
  // guard BERSAMA baca kolom durable yang sama dengan buyer view
  // (provider_status_text dari GET terverifikasi + actually_paid sufficient +
  // last_error manual review). Ledger 'pending' TIDAK dipercaya: provider
  // confirming = 409 walau ledger pending. Stock tidak ditahan selamanya
  // (cron expiry + manual review path existing). Ownership: route ini.
  if (String(row.payment_provider ?? "") === "nowpayments") {
    const { cancelGuardForNowpaymentsRow } = await import("@/lib/payments/payment-view");
    const guard = cancelGuardForNowpaymentsRow({
      provider: row.payment_provider,
      provider_status_text: row.provider_status_text,
      actually_paid_text: row.actually_paid_text,
      pay_amount_text: row.pay_amount_text,
      last_error: row.payment_last_error,
    });
    if (guard.cancelBlocked) {
      return NextResponse.json({ error: guard.reason }, { status: 409 });
    }
  }
  if (row.payment_provider === "sekalipay_gateway" && (row.payment_last_error || row.transaction_paid_at || ["paid", "completed"].includes(String(row.provider_status_text ?? "")))) {
    return NextResponse.json({ error: "Pembayaran sedang diperiksa; pembatalan tidak tersedia." }, { status: 409 });
  }

  if (String(row.status) !== "pending") {
    return NextResponse.json(
      { error: `Pesanan sudah ${String(row.status)}, tidak bisa dibatalkan.` },
      { status: 409 },
    );
  }

  let items: { product_id: number; variant_id?: number; qty: number }[];
  try {
    items = JSON.parse(String(row.items || "[]"));
  } catch {
    return NextResponse.json({ error: "Snapshot item pesanan rusak; status tidak diubah." }, { status: 500 });
  }
  try {
    await transitionPendingOrder(orderCode, "dibatalkan", "buyer_cancel", items);
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json(
        { error: "Pesanan tidak dapat dibatalkan — statusnya sudah berubah (mungkin baru saja dibayar)." },
        { status: 409 },
      );
    }
    console.error("POST /api/orders/[code]/cancel transition failed:", error);
    return NextResponse.json({ error: "Pembatalan gagal. Coba lagi." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, code: orderCode, status: "dibatalkan" });
}
