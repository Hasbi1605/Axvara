// /api/admin/product-groups — grup produk lintas supplier (16 November 2026).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { readJsonBody } from "@/lib/http-body";
import { createProductGroup, listProductGroups, ProductGroupError } from "@/lib/product-groups";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  product_ids: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(2).max(10),
  mode: z.enum(["winner", "merge_variants"]).optional(),
}).strict();

function failure(error: unknown) {
  if (error instanceof ProductGroupError) {
    return NextResponse.json({ error: error.code, message: error.message, ...(error.groupId ? { group_id: error.groupId } : {}) }, { status: error.status, headers: NO_STORE });
  }
  console.error("[product-groups] create failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ groups: [] }, { headers: NO_STORE });
  try {
    return NextResponse.json({ groups: await listProductGroups() }, { headers: NO_STORE });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  const body = await readJsonBody(req, 2048);
  if (!body.ok) return body.response;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400, headers: NO_STORE });
  const ids = parsed.data.product_ids;
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "Produk duplikat dalam grup" }, { status: 400, headers: NO_STORE });
  try {
    const group = await createProductGroup({ name: parsed.data.name, productIds: ids, mode: parsed.data.mode });
    return NextResponse.json({ group }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
