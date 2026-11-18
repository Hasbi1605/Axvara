import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { bumpCatalogRevision } from "@/lib/catalog-cache";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { MIRAI_PARENT_REFRESH } from "@/lib/mirai/catalog";
import { validMiraiPackageCode } from "@/lib/mirai/client";
import { MIRAI_DEFAULT_MARKUP_PERCENT, miraiSellPriceIdr } from "@/lib/mirai/pricing";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";

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
  const d1 = db.d1;
  if (!d1) return json({ error: "database_unavailable" }, 503);
  try {
    const row = await db.queryFirst(
      `SELECT v.*, p.archived_at, m.markup_percent AS mirror_markup_percent
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN mirai_packages m ON m.package_code = v.mirai_package_code
       WHERE v.mirai_package_code = ? AND v.sku = 'MR-' || v.mirai_package_code AND p.mirai_family IS NOT NULL`,
      packageCode,
    );
    if (!row) return json({ error: "not_mapped" }, 404);
    if (row.archived_at && parsed.data.is_active) return json({ error: ARCHIVED_MESSAGE }, 409);
    const body = parsed.data;
    const markup =
      body.markup_percent ??
      Number(row.mirai_markup_percent ?? row.mirror_markup_percent ?? MIRAI_DEFAULT_MARKUP_PERCENT);
    const manual = body.admin_price_idr === undefined ? row.mirai_admin_price_idr : body.admin_price_idr;
    const fx = Number(row.mirai_fx_idr_per_usdt);
    const cost = Number(row.mirai_cost_usdt);
    if (!(fx > 0 && cost > 0)) return json({ error: "fx_unavailable" }, 409);
    const price = manual == null ? miraiSellPriceIdr(cost, fx, markup) : Number(manual);
    const active = body.is_active === undefined ? row.is_active : Number(body.is_active);
    if (
      row.mirai_markup_percent === markup &&
      row.mirai_admin_price_idr === manual &&
      row.price === price &&
      row.is_active === active
    ) {
      return json({ ok: true });
    }
    const guard = crypto.randomUUID();
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO operation_guards(operation_id, valid)
           SELECT ?, EXISTS(
             SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
             WHERE v.id=? AND p.id=? AND p.mirai_family IS NOT NULL AND p.archived_at IS ?
               AND v.mirai_package_code=? AND v.sku=?
               AND v.price IS ? AND v.is_active IS ?
               AND v.mirai_admin_price_idr IS ? AND v.mirai_markup_percent IS ?
               AND v.mirai_fx_idr_per_usdt IS ? AND v.mirai_cost_usdt IS ?
           )`,
        )
        .bind(
          guard,
          row.id,
          row.product_id,
          row.archived_at,
          packageCode,
          row.sku,
          row.price,
          row.is_active,
          row.mirai_admin_price_idr,
          row.mirai_markup_percent,
          row.mirai_fx_idr_per_usdt,
          row.mirai_cost_usdt,
        ),
      d1
        .prepare(
          "UPDATE product_variants SET price=?, is_active=?, mirai_markup_percent=?, mirai_admin_price_idr=?, updated_at=datetime('now') WHERE id=?",
        )
        .bind(price, active, markup, manual, row.id),
      d1.prepare(`UPDATE products ${MIRAI_PARENT_REFRESH} WHERE id=? AND archived_at IS NULL`).bind(row.product_id),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    await bumpCatalogRevision("market", db);
    return json({ ok: true });
  } catch {
    return json({ error: "save_failed_or_stale" }, 409);
  }
}
