// /api/admin/supplier-pairs — DEPRECATED (16 November 2026).
// Model pasangan WR vs SK digantikan grup produk lintas supplier.
// 410 Gone dipilih (bukan proxy) agar tidak ada jalur tulis ke tabel arsip.
import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const gone = () => NextResponse.json({
  error: "gone",
  message: "Pasangan WR vs SK digantikan grup produk. Gunakan /api/admin/product-groups.",
}, { status: 410, headers: { "Cache-Control": "no-store" } });

export function GET() { return gone(); }
export function POST() { return gone(); }
export function PUT() { return gone(); }
export function PATCH() { return gone(); }
export function DELETE() { return gone(); }
