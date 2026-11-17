// /api/admin/payments/test/orders — RETIRED (18 November 2026).
// Rail non-QRIS (NOWPayments & Sekalipay gateway) sudah aktif di publik.
import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const gone = () => NextResponse.json(
  { error: "Tes pembayaran admin sudah dipensiunkan." },
  { status: 410, headers: { "Cache-Control": "no-store" } },
);

export function GET() { return gone(); }
export function POST() { return gone(); }
export function PUT() { return gone(); }
export function PATCH() { return gone(); }
export function DELETE() { return gone(); }
