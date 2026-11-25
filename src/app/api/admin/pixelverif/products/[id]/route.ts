import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { applyPixelverifMarkupUpdate, PIXELVERIF_MARKUP_SELECT_FROM } from "@/lib/pixelverif/markup";
import { resolvePixelverifMarkupId, saveObservedPixelverifMarkup } from "@/lib/pixelverif/observed-markup";

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
  const parsedFlow = resolvePixelverifMarkupId((await params).id);
  if (!parsedFlow) return json({ error: "invalid_id" }, 400);
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
    const row = parsedFlow.validity === 3 ? await db.queryFirst(
      `${PIXELVERIF_MARKUP_SELECT_FROM} AND v.pixelverif_flow_type = ? AND v.pixelverif_validity = ?`,
      parsedFlow.flow,
      parsedFlow.validity,
    ) : null;
    if (!row) {
      const written = await saveObservedPixelverifMarkup(db, [parsedFlow.key], parsed.data);
      return written.has(parsedFlow.key) ? json({ ok: true }) : json({ error: "not_mapped" }, 404);
    }
    const outcome = await applyPixelverifMarkupUpdate(db, row, parsed.data);
    if (!outcome.ok) return json({ error: outcome.error }, outcome.status);
    if (outcome.changed) await bumpCatalogRevision("market", db);
    return json({ ok: true });
  } catch {
    return json({ error: "save_failed_or_stale" }, 409);
  }
}
