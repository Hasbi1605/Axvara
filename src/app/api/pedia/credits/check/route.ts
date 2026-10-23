// Retired endpoint: old clients must not redeem or probe historical credits.
import { NextResponse } from "next/server";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function POST() {
  return NextResponse.json({ error: "credits_retired", message: "Kode kredit tidak lagi digunakan. Hubungi admin untuk kode lama." }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
