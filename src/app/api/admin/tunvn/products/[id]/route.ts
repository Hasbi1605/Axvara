import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { isTunvnExcludedProduct } from "@/lib/tunvn/families";
import { isValidTunvnMarkup } from "@/lib/tunvn/pricing";
import {
  applyTunvnProductMarkupUpdate,
  TUNVN_MIRROR_SELECT,
  TUNVN_VARIANT_OWNERSHIP_SQL,
} from "@/lib/tunvn/markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  markup_percent: z.number().min(0).max(1000).optional(),
  admin_price_idr: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  admin_name: z.string().trim().max(160).nullable().optional(),
  admin_description: z.string().trim().max(4000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "Tidak ada perubahan.");

const selectMirror = `${TUNVN_MIRROR_SELECT} WHERE supplier_product_id=?`;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supplierId = Number((await params).id);
  if (!Number.isSafeInteger(supplierId) || supplierId < 1) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  if (isTunvnExcludedProduct(supplierId)) return NextResponse.json({ error: "excluded_product" }, { status: 409 });
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = patchSchema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;
  if (body.markup_percent !== undefined && !isValidTunvnMarkup(body.markup_percent)) {
    return NextResponse.json({ error: "invalid_markup", message: "Markup harus 0–1000%." }, { status: 400 });
  }
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  try {
    const mirror = await db.queryFirst(selectMirror, supplierId);
    if (!mirror) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const variant = await db.queryFirst(
      `SELECT v.* FROM product_variants v
       WHERE (v.tunvn_source_product_id=? OR v.sku=?)
         AND ${TUNVN_VARIANT_OWNERSHIP_SQL}
       ORDER BY v.tunvn_source_product_id IS NULL LIMIT 1`,
      supplierId, `TUNVN-${supplierId}`,
    );
    const product = variant
      ? await db.queryFirst("SELECT id, name, archived_at FROM products WHERE id=?", variant.product_id)
      : mirror.axvara_product_id
        ? await db.queryFirst("SELECT id, name, archived_at FROM products WHERE id=?", mirror.axvara_product_id)
        : null;

    const outcome = await applyTunvnProductMarkupUpdate(db, mirror, variant, product, body);
    if (!outcome.ok) {
      return NextResponse.json(
        outcome.message ? { error: outcome.error, message: outcome.message } : { error: outcome.error },
        { status: outcome.status },
      );
    }
    if (outcome.changed) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("market", db);
    }
    return NextResponse.json({ ok: true, item: await db.queryFirst(selectMirror, supplierId), fx_missing: outcome.fx_missing });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
