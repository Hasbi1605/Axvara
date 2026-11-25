// POST /api/pedia/orders/[code]/refill — Ajukan refill (PD-25).
// Capability: kode + kontak (WA/email) cocok (pola lookup). Rate-limit refill.
// Syarat: eligibility sama dengan GET + refill terakhir ≥ 24 jam (atomik).
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http-body";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { executePediaRefill } from "@/lib/pedia/refill-action";
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
  if (!checkRateLimit(request, "pedia:refill")) {
    return NextResponse.json({ error: pick(locale, "Terlalu sering, coba lagi 1 menit.", "Too many requests, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: pick(locale, "Kontak wajib diisi.", "Contact is required.") }, { status: 400 });
  const contact = parsed.data.access_code ?? parsed.data.contact ?? "";
  if (!contact) return NextResponse.json({ error: pick(locale, "Kode akses wajib diisi.", "Access code is required.") }, { status: 400 });
  const db = createDatabaseAccess();
  const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, clean).catch(() => null);
  if (!order) return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan.", "Order not found.") }, { status: 404 });
  const failure = await newOrderAccessFailure(request, order, contact);
  if (failure) return failure;
  // Verifikasi kontak (pola lookup — generik agar tak bisa di-oracle).
  if (!requiresOrderAccessCode(order) && !(await buyerOrderAccessMatches(contact, order))) {
    return NextResponse.json({ error: pick(locale, "Pesanan tidak ditemukan atau kontak tidak cocok.", "Order not found or the contact does not match.") }, { status: 404 });
  }
  const outcome = await executePediaRefill(db, clean, locale);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.reason ? { reason: outcome.reason } : {}) },
      { status: outcome.status },
    );
  }
  return NextResponse.json({ ok: true, mode: outcome.mode, message: outcome.message });
}
