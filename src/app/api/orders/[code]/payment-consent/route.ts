import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/http-body";
import { queryFirst } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { isValidBuyerOrderCode } from "@/lib/security";
import { buyerOrderAccessMatches, requiresOrderAccessCode, newOrderAccessFailure, orderAccessDenied } from "@/lib/order-access";
import { confirmGatewayFee } from "@/lib/payments/sekalipay-gateway";
import { buildSekalipayGatewayPaymentView } from "@/lib/payments/payment-view";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema = z.object({ contact: z.string().trim().max(254).optional(), wa: z.string().trim().max(254).optional(), access_code: z.string().trim().max(100).optional(), expected_final_total: z.number().int().safe().positive() }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const response = await consent(req, (await params).code);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
async function consent(req: NextRequest, code: string) {
  if (!checkRateLimit(req, "orders:lookup")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429 });
  code = String(code || "").toUpperCase();
  // AXV (Market) + AXP (Pedia) memakai rute persetujuan yang sama.
  if (!isValidBuyerOrderCode(code)) return NextResponse.json({ error: "Kode pesanan tidak valid" }, { status: 400 });
  const body = await readJsonBody(req, 8000); if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  const contact = (parsed.data.access_code ?? parsed.data.contact ?? parsed.data.wa ?? "").trim();
  if (!contact) return NextResponse.json({ error: "Kontak wajib diisi" }, { status: 400 });
  const row = await queryFirst("SELECT code,status,payment_status,customer_wa,customer_email,buyer_access_version,buyer_access_format FROM orders WHERE code=?", code);
  if (!row) return orderAccessDenied();
  const failure = await newOrderAccessFailure(req, row, contact); if (failure) return failure;
  if (!requiresOrderAccessCode(row) && !await buyerOrderAccessMatches(contact, row)) return orderAccessDenied();
  if (!await confirmGatewayFee(code, parsed.data.expected_final_total)) return NextResponse.json({ error: "Persetujuan tidak tersedia" }, { status: 409 });
  const payment = await buildSekalipayGatewayPaymentView(code);
  if (!payment || payment.state !== "pending" || payment.total !== parsed.data.expected_final_total) return NextResponse.json({ error: "Persetujuan tidak tersedia" }, { status: 409 });
  return NextResponse.json({ ok: true, payment });
}
