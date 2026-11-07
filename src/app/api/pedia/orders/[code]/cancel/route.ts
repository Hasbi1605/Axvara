// POST /api/pedia/orders/[code]/cancel — Batal mandiri pembeli Pedia.
// Pola `POST /api/orders/[code]/cancel` Market: kode + kontak checkout (pola
// refill/lookup), hanya order pending yang belum dibayar, CAS atomik lewat
// `transitionPendingOrder` (kalah balapan vs pembayaran = 409). Item Pedia
// ditutup oleh `expirePediaCheckouts` yang sudah menangani status `dibatalkan`.
// Invoice QRIS di provider tidak dibatalkan; pembayaran terlambat tetap masuk
// Rekonsiliasi. Slot checkout anti-abuse tidak dikembalikan.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/http-body";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { transitionPendingOrder, OrderTransitionError } from "@/lib/db";
import { buyerOrderAccessMatches, requiresOrderAccessCode, newOrderAccessFailure } from "@/lib/order-access";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  contact: z.string().trim().max(254).optional(),
  access_code: z.string().trim().max(100).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const locale = pediaApiLocale(request);
  if (!checkRateLimit(request, "pedia:cancel")) {
    return NextResponse.json({ error: pick(locale, "Terlalu sering, coba lagi 1 menit.", "Too many requests, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!/^AXP-\d{8}-[A-Z0-9]{8}$/.test(clean)) return NextResponse.json({ error: pick(locale, "Kode pesanan tidak valid", "Invalid order code") }, { status: 400 });
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  const contact = parsed.success ? (parsed.data.access_code ?? parsed.data.contact ?? "").trim() : "";
  if (!contact) return NextResponse.json({ error: pick(locale, "No. WA atau email checkout wajib diisi.", "WhatsApp number or checkout email is required.") }, { status: 400 });
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=? AND COALESCE(order_kind,'apps')='pedia'`, clean).catch(() => null);
  const notFound = () => NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan atau kontak tidak cocok.", "Order not found or the contact does not match.") }, { status: 404 });
  if (!order) return notFound();
  const failure = await newOrderAccessFailure(request, order, contact);
  if (failure) return failure;
  if (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contact, order))) return notFound();
  if (String(order.status) !== "pending") {
    return NextResponse.json({ error: pick(locale, `Pesanan sudah ${String(order.status)}, tidak bisa dibatalkan.`, `The order is already ${String(order.status)} and cannot be canceled.`) }, { status: 409 });
  }
  let items: { product_id: number; variant_id?: number; qty: number }[];
  try { items = JSON.parse(String(order.items || "[]")); } catch {
    return NextResponse.json({ error: pick(locale, "Snapshot item pesanan rusak; status tidak diubah.", "The order item snapshot is corrupted; status was not changed.") }, { status: 500 });
  }
  try {
    await transitionPendingOrder(clean, "dibatalkan", "buyer_cancel", items);
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json({ error: pick(locale, "Pesanan tidak dapat dibatalkan — statusnya sudah berubah (mungkin baru saja dibayar).", "The order cannot be canceled — its status already changed (it may have just been paid).") }, { status: 409 });
    }
    console.error("POST /api/pedia/orders/[code]/cancel transition failed:", error);
    return NextResponse.json({ error: pick(locale, "Pembatalan gagal. Coba lagi.", "Cancellation failed. Try again.") }, { status: 500 });
  }
  return NextResponse.json({ ok: true, code: clean, status: "dibatalkan" }, { headers: { "Cache-Control": "private, no-store" } });
}
