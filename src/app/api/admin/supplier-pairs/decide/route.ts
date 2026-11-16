// /api/admin/supplier-pairs/decide — DEPRECATED (16 November 2026).
// Gunakan POST /api/admin/product-groups/decide.
import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json({
    error: "gone",
    message: "Pasangan WR vs SK digantikan grup produk. Gunakan POST /api/admin/product-groups/decide.",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
