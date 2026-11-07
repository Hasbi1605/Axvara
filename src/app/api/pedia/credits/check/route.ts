// Retired endpoint: old clients must not redeem or probe historical credits.
import { NextRequest, NextResponse } from "next/server";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const locale = pediaApiLocale(request);
  return NextResponse.json({ error: "credits_retired", message: pick(locale, "Kode kredit tidak lagi digunakan. Hubungi admin untuk kode lama.", "Credit codes are no longer used. Contact admin for old codes.") }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
