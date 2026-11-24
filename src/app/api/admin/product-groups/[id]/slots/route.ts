// /api/admin/product-groups/[id]/slots — PUT atomic replace of variant slots inside a group.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { ProductGroupError, replaceGroupSlots } from "@/lib/product-groups";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const putSchema = z.object({
  slots: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    variant_ids: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(2).max(20),
  }).strict()).max(20),
}).strict();

function groupId(raw: string): number | null {
  const id = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(id) ? id : null;
}

function failure(error: unknown) {
  if (error instanceof ProductGroupError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers: NO_STORE });
  }
  console.error("[product-groups/slots] update failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  const id = groupId((await params).id);
  if (!id) return NextResponse.json({ error: "id tidak valid" }, { status: 400 });
  const body = await readJsonBody(req, 8192);
  if (!body.ok) return body.response;
  const parsed = putSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400, headers: NO_STORE });
  }
  try {
    const group = await replaceGroupSlots(id, parsed.data.slots);
    return NextResponse.json({ group }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
