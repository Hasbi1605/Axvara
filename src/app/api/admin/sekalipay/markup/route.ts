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
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 50)));
  const like = `%${q.toLowerCase()}%`;
  const rows = await queryAll(
    `SELECT sp.sk_variant_id, sp.sk_variant_name, sp.sk_price, sp.sk_stock,
            sp.sk_order_process, sp.sk_min_order, sp.sk_status,
            sp.markup_percent, sp.markup_fixed, sp.axvara_sell_price,
            sp.axvara_variant_id, sp.sk_product_name,
            pv.price AS current_price
     FROM sk_products sp
     LEFT JOIN product_variants pv ON pv.id=sp.axvara_variant_id
     ${q ? "WHERE lower(sp.sk_variant_name) LIKE ? OR lower(sp.sk_product_name) LIKE ?" : ""}
     ORDER BY sp.sk_product_name ASC, sp.sk_variant_name ASC LIMIT ?`,
    ...(q ? [like, like, limit] : [limit]),
  ).catch(() => []);
  return NextResponse.json({ variants: rows });
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
