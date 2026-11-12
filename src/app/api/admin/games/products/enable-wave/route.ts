// POST /api/admin/games/products/enable-wave — RETIRED. Aktivasi massal
// gelombang 1/4 brand tidak dipakai lagi untuk katalog SK. Endpoint tetap
// ada agar pemanggil lama mendapat respons eksplisit (auth tetap wajib),
// tanpa pernah menulis atau mengaktifkan SKU diam-diam.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ dry_run: z.boolean({ error: "dry_run harus boolean." }).optional() }).strict();

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }
  return NextResponse.json({
    error: "bulk_activation_retired",
    message: "Aktivasi massal gelombang 1 sudah dipensiunkan; katalog Games dikelola per SKU.",
  }, { status: 410 });
}
