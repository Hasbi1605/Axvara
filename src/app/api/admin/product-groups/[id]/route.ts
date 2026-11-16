// /api/admin/product-groups/[id] — PATCH (nama/prefer/margin) & DELETE grup.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { deleteProductGroup, ProductGroupError, updateProductGroup } from "@/lib/product-groups";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  prefer_product_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  prefer_margin: z.number().int().min(0).max(1_000_000).optional(),
}).strict();

function failure(error: unknown) {
  if (error instanceof ProductGroupError) {
    return NextResponse.json({ error: error.code, message: error.message, ...(error.groupId ? { group_id: error.groupId } : {}) }, { status: error.status, headers: NO_STORE });
  }
  console.error("[product-groups] update failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
}

function groupId(raw: string): number | null {
  const id = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(id) ? id : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  const id = groupId((await params).id);
  if (!id) return NextResponse.json({ error: "id tidak valid" }, { status: 400 });
  const body = await readJsonBody(req, 2048);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json({ group: await updateProductGroup(id, parsed.data) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  const id = groupId((await params).id);
  if (!id) return NextResponse.json({ error: "id tidak valid" }, { status: 400 });
  try {
    await deleteProductGroup(id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
