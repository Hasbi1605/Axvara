// POST /api/pedia/credits/check — Cek kode kredit (PD-11, §9.7).
// Publik + rate-limit. Hanya sisa (tanpa email).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkPediaCredit } from "@/lib/pedia/credits";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "pedia:credit_check")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const parsed = z.object({ code: z.string().trim().min(1).max(20) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kode wajib diisi." }, { status: 400 });
  const db = createDatabaseAccess();
  const check = await checkPediaCredit(db, parsed.data.code);
  if (!check) return NextResponse.json({ error: "Kode tidak valid atau kedaluwarsa." }, { status: 404 });
  return NextResponse.json({ ok: true, remaining: check.remaining });
}
