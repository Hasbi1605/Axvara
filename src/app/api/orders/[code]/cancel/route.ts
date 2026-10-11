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
import { z } from "zod";
import { queryFirst, transitionPendingOrder, OrderTransitionError } from "@/lib/db";
import { isValidOrderCode } from "@/lib/security";
import { checkRateLimit } from "@/lib/rateLimit";
import { emailMatches, normalizeWa, parseBuyerContact } from "@/lib/order-contact";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  contact: z.string().trim().max(254).optional(),
  wa: z.string().trim().max(254).optional(),
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
  let body: unknown;
  try {
    body = await req.json().catch(() => null);
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  const contactRaw = parsed.success ? (parsed.data.contact ?? parsed.data.wa ?? "").trim() : "";
  if (!parsed.success || !contactRaw) {
    return NextResponse.json({ error: "No. WA atau email checkout wajib diisi." }, { status: 400 });
  }
  const contact = parseBuyerContact(contactRaw);
  if (!contact) {
    return NextResponse.json({ error: "Format kontak tidak valid." }, { status: 400 });
  }

  const row = (await queryFirst(
    `SELECT code, status, payment_status, customer_wa, customer_email, items FROM orders WHERE code=?`,
    orderCode,
  )) as Record<string, unknown> | undefined;

  // Generik seperti lookup: tidak membocorkan apakah kode salah atau kontak salah.
  const notFound = () =>
    NextResponse.json({ error: "Pesanan tidak ditemukan atau kontak tidak cocok." }, { status: 404 });
  if (!row) return notFound();
  if (contact.kind === "email") {
    if (!emailMatches(contact.value, row.customer_email)) return notFound();
  } else {
    const storedWa = normalizeWa(row.customer_wa);
    if (!storedWa) return notFound();
    const { constantTimeEqual } = await import("@/lib/security");
    if (!constantTimeEqual(contact.value, storedWa)) return notFound();
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
