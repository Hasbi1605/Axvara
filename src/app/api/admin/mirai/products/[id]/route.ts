import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { validMiraiPackageCode } from "@/lib/mirai/client";
import { applyMiraiMarkupUpdate, MIRAI_MARKUP_SELECT_FROM } from "@/lib/mirai/markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

const schema = z
  .object({
    markup_percent: z.number().min(0).max(1000).optional(),
    admin_price_idr: z.number().int().positive().max(1e9).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  const packageCode = (await params).id;
  if (!validMiraiPackageCode(packageCode)) return json({ error: "invalid_id" }, 400);
  const raw = await readJsonBody(request, 4096);
  if (!raw.ok) {
    raw.response.headers.set("Cache-Control", "private, no-store");
    return raw.response;
  }
  const parsed = schema.safeParse(raw.data);
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const db = createDatabaseAccess();
  if (!db.d1) return json({ error: "database_unavailable" }, 503);
  try {
    const row = await db.queryFirst(
      `${MIRAI_MARKUP_SELECT_FROM} AND v.mirai_package_code = ?`,
      packageCode,
    );
    if (!row) return json({ error: "not_mapped" }, 404);
    const outcome = await applyMiraiMarkupUpdate(db, row, parsed.data);
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);
    if (outcome.changed) await bumpCatalogRevision("market", db);
    return json({ ok: true });
  } catch {
    return json({ error: "save_failed_or_stale" }, 409);
  }
}
