// /api/admin/sekalipay/markup — Kelola markup per varian SK (cermin WR).
// GET: daftar varian + markup + harga + capability. PUT: {sk_variant_id,
// markup_percent, markup_fixed} — harga jual Axvara dihitung ulang.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { queryAll, queryFirst } from "@/lib/db";
import { createDatabaseAccess } from "@/lib/db-access";
import { computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";
import { calculateSkSellPrice } from "@/lib/sekalipay/sync";
import { saveSupplierMarkup } from "@/lib/supplier/admin-markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  sk_variant_id: z.string().trim().min(1).max(120),
  markup_percent: z.coerce.number().int().min(0).max(500),
  markup_fixed: z.coerce.number().int().min(0).max(999_999_999).default(0),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 60) || "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 200;
  const rawOffset = Number(request.nextUrl.searchParams.get("offset") || 0);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
  const needle = q.toLowerCase();
  const rows = await queryAll(
    `SELECT sp.sk_variant_id, sp.sk_product_id, sp.sk_product_id AS supplier_product_id,
            sp.sk_variant_name, sp.sk_price, sp.sk_stock,
            sp.sk_order_process, sp.sk_min_order, sp.sk_status,
            sp.markup_percent, sp.markup_fixed, sp.axvara_sell_price,
            sp.axvara_variant_id, sp.sk_product_name, sp.is_active AS sk_is_active,
            sp.axvara_product_id AS sp_axvara_product_id,
            COALESCE(pv.product_id, sp.axvara_product_id) AS axvara_product_id,
            pv.price AS current_price, pv.stock AS pv_stock, pv.min_qty AS pv_min_qty,
            pv.is_active AS pv_is_active, pv.product_id AS pv_product_id,
            pv.label AS variant_label, pv.fulfillment_mode AS pv_fulfillment_mode,
            CASE WHEN pv.fulfillment_mode='unique' THEN (
              SELECT COUNT(*) FROM fulfillment_inventory fi
              WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available'
            ) ELSE NULL END AS inventory_available,
            p.name AS product_name, p.slug AS product_slug,
            p.is_active AS p_is_active,
            CASE WHEN p.archived_at IS NOT NULL THEN 1 ELSE 0 END AS product_archived,
            CASE WHEN EXISTS(SELECT 1 FROM product_group_members gm JOIN product_groups gp ON gp.id=gm.group_id
                   WHERE gm.product_id=COALESCE(pv.product_id, sp.axvara_product_id) AND gp.winner_product_id IS NOT NULL
                     AND gp.winner_product_id<>gm.product_id)
                 THEN 1 ELSE 0 END AS parent_is_loser
     FROM sk_products sp
     LEFT JOIN product_variants pv ON pv.id=sp.axvara_variant_id
     LEFT JOIN products p ON p.id=COALESCE(pv.product_id, sp.axvara_product_id)
     WHERE sp.sk_category='Aplikasi Premium'
      ${q ? "AND (INSTR(LOWER(COALESCE(sp.sk_variant_name,'')), ?) > 0 OR INSTR(LOWER(COALESCE(sp.sk_product_name,'')), ?) > 0)" : ""}
     ORDER BY sp.sk_product_name ASC, sp.sk_variant_name ASC, sp.sk_product_id ASC, sp.sk_variant_id ASC LIMIT ? OFFSET ?`,
    ...(q ? [needle, needle, limit, offset] : [limit, offset]),
  ).catch(() => []);
  const totalRow = await queryFirst(
    `SELECT COUNT(*) AS total FROM sk_products sp
     WHERE sp.sk_category='Aplikasi Premium'
      ${q ? "AND (INSTR(LOWER(COALESCE(sp.sk_variant_name,'')), ?) > 0 OR INSTR(LOWER(COALESCE(sp.sk_product_name,'')), ?) > 0)" : ""}`,
    ...(q ? [needle, needle] : []),
  ).catch(() => null);
  const loserToWinner = await loadProductGroupLosers(queryAll);
  const withStatus = (rows as Record<string, unknown>[]).map((r) => {
    const live = computeVariantLiveStatus(
      {
        supplier_active: r.sk_is_active,
        axvara_product_id: r.axvara_product_id,
        variant_id: r.axvara_variant_id,
        variant_active: r.pv_is_active,
        product_active: r.p_is_active,
        product_archived: r.product_archived,
        stock: r.pv_stock ?? r.sk_stock,
        supplier_stock: r.pv_stock != null ? r.sk_stock : undefined,
        min_qty: r.pv_min_qty ?? r.sk_min_order ?? 1,
        fulfillment_mode: r.pv_fulfillment_mode ?? "manual",
        inventory_available: r.inventory_available,
        parent_is_loser: r.parent_is_loser,
      },
      loserToWinner,
    );
    return { ...r, variant_status: live.status, variant_reason: live.reason };
  });
  return NextResponse.json({ variants: withStatus, total: Number((totalRow as Record<string, unknown> | null)?.total ?? withStatus.length) });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 2_000);
  if (!body.ok) return body.response;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  const { sk_variant_id, markup_percent, markup_fixed } = parsed.data;
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "update_failed" }, { status: 503 });
  try {
    const row = await db.queryFirst(`SELECT sk_price FROM sk_products WHERE sk_variant_id=?`, sk_variant_id);
    if (!row) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
    const sellPrice = calculateSkSellPrice(Number(row.sk_price), markup_percent, markup_fixed);
    await saveSupplierMarkup(db.d1, "sekalipay", sk_variant_id, markup_percent, markup_fixed, sellPrice, new Date().toISOString());
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
    return NextResponse.json({ ok: true, sk_variant_id, sell_price: sellPrice });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
