import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { isValidTunvnMarkup } from "@/lib/tunvn/pricing";
import { applyTunvnBuffMarkupUpdate, TUNVN_VARIANT_OWNERSHIP_SQL } from "@/lib/tunvn/markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  markup_percent: z.number().optional(),
  admin_price_idr: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  is_active: z.boolean().optional(),
  label: z.string().trim().min(1).max(120).optional(),
}).strict().refine(
  (v) => ["markup_percent", "admin_price_idr", "is_active", "label"].some((k) => v[k as keyof typeof v] !== undefined),
  { message: "Tidak ada perubahan." },
);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sku = (await params).sku;
  if (sku !== "TUNVN-BUFF-1B") return NextResponse.json({ error: "invalid_sku" }, { status: 400 });
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = patchSchema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", message: parsed.error.issues[0]?.message }, { status: 400 });
  const body = parsed.data;
  if (body.markup_percent !== undefined && !isValidTunvnMarkup(body.markup_percent)) {
    return NextResponse.json({ error: "invalid_markup", message: "Markup harus 0–1000%." }, { status: 400 });
  }
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  try {
    const variant = await db.queryFirst(
      `SELECT v.*, p.archived_at AS p_archived_at
       FROM product_variants v
       JOIN products p ON p.id=v.product_id
       WHERE v.sku=? AND ${TUNVN_VARIANT_OWNERSHIP_SQL}`,
      sku,
    );
    if (!variant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const outcome = await applyTunvnBuffMarkupUpdate(db, variant, variant.p_archived_at ?? null, body);
    if (!outcome.ok) {
      return NextResponse.json(
        outcome.message ? { error: outcome.error, message: outcome.message } : { error: outcome.error },
        { status: outcome.status },
      );
    }
    const updated = await db.queryFirst("SELECT * FROM product_variants WHERE sku=?", sku);
    if (outcome.changed) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("market", db);
    }
    return NextResponse.json({ ok: true, variant: updated });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
