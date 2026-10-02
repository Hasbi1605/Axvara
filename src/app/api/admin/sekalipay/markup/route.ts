// /api/admin/sekalipay/markup — Kelola markup per varian SK (cermin WR).
// GET: daftar varian + markup + harga + capability. PUT: {sk_variant_id,
// markup_percent, markup_fixed} — harga jual Axvara dihitung ulang.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { calculateSkSellPrice } from "@/lib/sekalipay/sync";

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
  // Limit 200: registry SK premium ~153 baris muat 1 request (cermin WR).
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 200)));
  const like = `%${q.toLowerCase()}%`;
  const rows = await queryAll(
    `SELECT sp.sk_variant_id, sp.sk_variant_name, sp.sk_price, sp.sk_stock,
            sp.sk_order_process, sp.sk_min_order, sp.sk_status,
            sp.markup_percent, sp.markup_fixed, sp.axvara_sell_price,
            sp.axvara_variant_id, sp.sk_product_name, sp.is_active AS sk_is_active,
            sp.axvara_product_id AS sp_axvara_product_id,
            pv.price AS current_price, pv.stock AS pv_stock, pv.min_qty AS pv_min_qty,
            pv.is_active AS pv_is_active, pv.product_id AS pv_product_id,
            p.is_active AS p_is_active,
            CASE WHEN pair.sk_product_id = sp.axvara_product_id
                   AND (pair.winner IS NULL OR pair.winner != 'SK')
                 THEN 1 ELSE 0 END AS parent_is_loser
     FROM sk_products sp
     LEFT JOIN product_variants pv ON pv.id=sp.axvara_variant_id
     LEFT JOIN products p ON p.id=pv.product_id
     LEFT JOIN supplier_pairs pair ON pair.sk_product_id=sp.axvara_product_id
       AND pair.winner IS NOT NULL
     WHERE sp.sk_category='Aplikasi Premium'
      ${q ? "AND (lower(sp.sk_variant_name) LIKE ? OR lower(sp.sk_product_name) LIKE ?)" : ""}
     ORDER BY sp.sk_product_name ASC, sp.sk_variant_name ASC LIMIT ?`,
    ...(q ? [like, like, limit] : [limit]),
  ).catch(() => []);
  const totalRow = await queryFirst(
    `SELECT COUNT(*) AS total FROM sk_products sp
     WHERE sp.sk_category='Aplikasi Premium'
      ${q ? "AND (lower(sp.sk_variant_name) LIKE ? OR lower(sp.sk_product_name) LIKE ?)" : ""}`,
    ...(q ? [like, like] : []),
  ).catch(() => null);
  const withStatus = (rows as Record<string, unknown>[]).map((r) => {
    const pvActive = r.pv_is_active == null ? 1 : Number(r.pv_is_active);
    const pActive = r.p_is_active == null ? 1 : Number(r.p_is_active);
    const skActive = Number(r.sk_is_active ?? 1);
    let status: "live" | "hidden_loser" | "hidden_nocatalog" | "hidden_soldout" | "off" = "live";
    let reason = "Tampil di storefront";
    if (skActive !== 1 || pvActive !== 1 || pActive !== 1) {
      status = "off";
      reason = "Nonaktif manual";
    } else if (Number(r.parent_is_loser ?? 0) === 1) {
      status = "hidden_loser";
      reason = "Produk kalah pasangan WR vs SK";
    } else if (r.axvara_variant_id == null) {
      status = "hidden_nocatalog";
      reason = "Tanpa pasangan katalog — tidak tampil";
    } else {
      const stock = Number(r.pv_stock ?? r.sk_stock ?? 0);
      const minQty = Math.max(1, Number(r.pv_min_qty ?? r.sk_min_order ?? 1) || 1);
      if (!(stock === -1 || stock >= minQty)) {
        status = "hidden_soldout";
        reason = "Stok habis · restok otomatis tampil";
      }
    }
    return { ...r, variant_status: status, variant_reason: reason };
  });
  return NextResponse.json({ variants: withStatus, total: Number((totalRow as Record<string, unknown> | null)?.total ?? withStatus.length) });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  const { sk_variant_id, markup_percent, markup_fixed } = parsed.data;
  const row = await queryFirst(
    `SELECT sk_price, axvara_variant_id FROM sk_products WHERE sk_variant_id=?`,
    sk_variant_id,
  );
  if (!row) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
  const sellPrice = calculateSkSellPrice(Number(row.sk_price), markup_percent, markup_fixed);
  const now = new Date().toISOString();
  await execRun(
    `UPDATE sk_products SET markup_percent=?, markup_fixed=?, axvara_sell_price=?,
      last_synced_at=?, updated_at=? WHERE sk_variant_id=?`,
    markup_percent,
    markup_fixed,
    sellPrice,
    now,
    now,
    sk_variant_id,
  );
  // Harga katalog ikut markup baru (milik SK — admin pegang sisanya).
  const axvaraVariantId = row.axvara_variant_id != null ? Number(row.axvara_variant_id) : 0;
  if (axvaraVariantId > 0) {
    await execRun(
      `UPDATE product_variants SET price=?, updated_at=datetime('now') WHERE id=?`,
      sellPrice,
      axvaraVariantId,
    ).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, sk_variant_id, sell_price: sellPrice });
}
