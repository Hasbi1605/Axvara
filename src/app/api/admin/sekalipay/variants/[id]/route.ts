// GET /api/admin/sekalipay/variants/[id] — Detail satu varian SK registry
// + capability live (detail API bila tersedia). Menampilkan min_order,
// status, description, seller_note, required_fields, validation.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst } from "@/lib/db";
import { isSkEnabled } from "@/lib/sekalipay/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const skVariantId = String(id || "").trim().slice(0, 120);
  if (!skVariantId) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const row = await queryFirst(`SELECT * FROM sk_products WHERE sk_variant_id=?`, skVariantId).catch(
    () => null,
  );
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const safe = { ...row };
  // required_fields + validation disimpan JSON string — parse untuk UI.
  for (const key of ["sk_required_fields", "sk_validation"] as const) {
    const raw = safe[key];
    if (typeof raw === "string" && raw) {
      try {
        safe[key] = JSON.parse(raw);
      } catch {
        /* tampilkan mentah bila bukan JSON */
      }
    }
  }
  // Capability live (best-effort): status/required bisa berubah upstream.
  let live: Record<string, unknown> | null = null;
  if (isSkEnabled()) {
    try {
      const { fetchSkItemDetail } = await import("@/lib/sekalipay/client");
      live = (await fetchSkItemDetail(Number(skVariantId))) as unknown as Record<string, unknown>;
    } catch {
      /* registry tetap jadi sumber utama */
    }
  }
  return NextResponse.json({ ok: true, variant: safe, live });
}
