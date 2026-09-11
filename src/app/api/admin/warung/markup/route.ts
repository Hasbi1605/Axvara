// /api/admin/warung/markup — Kelola markup per varian WR.
// GET: daftar varian + markup + harga. PUT: {wr_variant_id, markup_percent, markup_fixed}.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { calculateSellPrice } from "@/lib/warung-rebahan/sync";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  wr_variant_id: z.string().trim().min(1).max(120),
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
    `SELECT wv.wr_variant_id, wv.wr_variant_name, wv.wr_price, wv.wr_stock,
            wv.markup_percent, wv.markup_fixed, wv.axvara_sell_price,
            wv.axvara_variant_id, wp.wr_product_name,
            pv.price AS current_price
     FROM wr_variants wv
     LEFT JOIN wr_products wp ON wp.wr_product_id=wv.wr_product_id
     LEFT JOIN product_variants pv ON pv.id=wv.axvara_variant_id
     ${q ? "WHERE lower(wv.wr_variant_name) LIKE ? OR lower(wp.wr_product_name) LIKE ?" : ""}
     ORDER BY wp.wr_product_name ASC, wv.wr_variant_name ASC LIMIT ?`,
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
  const { wr_variant_id, markup_percent, markup_fixed } = parsed.data;
  const row = await queryFirst(`SELECT wr_price, axvara_variant_id FROM wr_variants WHERE wr_variant_id=?`, wr_variant_id);
  if (!row) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
  const sellPrice = calculateSellPrice(Number(row.wr_price), markup_percent, markup_fixed);
  const now = new Date().toISOString();
  await execRun(
    `UPDATE wr_variants SET markup_percent=?, markup_fixed=?, axvara_sell_price=?,
      last_synced_at=?, updated_at=? WHERE wr_variant_id=?`,
    markup_percent,
    markup_fixed,
    sellPrice,
    now,
    now,
    wr_variant_id,
  );
  if (row.axvara_variant_id != null) {
    await execRun(
      `UPDATE product_variants SET price=?, updated_at=datetime('now') WHERE id=?`,
      sellPrice,
      Number(row.axvara_variant_id),
    ).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, wr_variant_id, sell_price: sellPrice });
}
