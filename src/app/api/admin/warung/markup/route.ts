// /api/admin/warung/markup — Kelola markup + kelas pengiriman per varian WR.
// GET: daftar varian + markup + harga + kelas. PUT: {wr_variant_id,
// markup_percent, markup_fixed} dan/atau {delivery_class} untuk kunci manual.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { calculateSellPrice } from "@/lib/warung-rebahan/sync";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  wr_variant_id: z.string().trim().min(1).max(120),
  markup_percent: z.coerce.number().int().min(0).max(500).optional(),
  markup_fixed: z.coerce.number().int().min(0).max(999_999_999).default(0),
  // Kunci kelas pengiriman manual (migrasi 0032): restock = auto,
  // made_by_order = manual slow. Sumber dicatat 'admin', sync tak menimpa.
  delivery_class: z.enum(["restock", "made_by_order"]).optional(),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 60) || "";
  // Limit 200: registry WR ~92 baris muat 1 request (tab markup fetch 1x,
  // filter + pagination murni klien cermin halaman Produk).
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 200)));
  const like = `%${q.toLowerCase()}%`;
  const rows = await queryAll(
    `SELECT wv.wr_variant_id, wv.wr_variant_name, wv.wr_price, wv.wr_stock,
            wv.markup_percent, wv.markup_fixed, wv.axvara_sell_price,
            wv.axvara_variant_id, wv.wr_delivery_class, wv.wr_delivery_source,
            wv.is_active AS wr_is_active,
            wp.wr_product_name, wp.axvara_product_id AS wp_axvara_product_id,
            pv.price AS current_price, pv.stock AS pv_stock, pv.min_qty AS pv_min_qty,
            pv.is_active AS pv_is_active, pv.product_id AS pv_product_id,
            p.is_active AS p_is_active,
            CASE WHEN pair.winner IS NOT NULL
                   AND pair.wr_product_id = wp.axvara_product_id
                   AND pair.winner != 'WR'
                 THEN 1 ELSE 0 END AS parent_is_loser
     FROM wr_variants wv
     LEFT JOIN wr_products wp ON wp.wr_product_id=wv.wr_product_id
     LEFT JOIN product_variants pv ON pv.id=wv.axvara_variant_id
     LEFT JOIN products p ON p.id=pv.product_id
     LEFT JOIN supplier_pairs pair ON pair.wr_product_id=wp.axvara_product_id
       AND pair.winner IS NOT NULL
      ${q ? "WHERE lower(wv.wr_variant_name) LIKE ? OR lower(wp.wr_product_name) LIKE ?" : ""}
      ORDER BY wp.wr_product_name ASC, wv.wr_variant_name ASC LIMIT ?`,
    ...(q ? [like, like, limit] : [limit]),
  ).catch(() => []);
  // Total hasil filter (tanpa LIMIT) untuk pagination jujur.
  const totalRow = await queryFirst(
    `SELECT COUNT(*) AS total
     FROM wr_variants wv
     LEFT JOIN wr_products wp ON wp.wr_product_id=wv.wr_product_id
      ${q ? "WHERE lower(wv.wr_variant_name) LIKE ? OR lower(wp.wr_product_name) LIKE ?" : ""}`,
    ...(q ? [like, like] : []),
  ).catch(() => null);
  // Status toko per varian (cermin liveStatus produk, hierarki:
  // off > kalah > tanpa-katalog > habis > live).
  const withStatus = (rows as Record<string, unknown>[]).map((r) => {
    const pvActive = r.pv_is_active == null ? 1 : Number(r.pv_is_active);
    const pActive = r.p_is_active == null ? 1 : Number(r.p_is_active);
    const wrActive = Number(r.wr_is_active ?? 1);
    let status: "live" | "hidden_loser" | "hidden_nocatalog" | "hidden_soldout" | "off" = "live";
    let reason = "Tampil di storefront";
    if (wrActive !== 1 || pvActive !== 1 || pActive !== 1) {
      status = "off";
      reason = "Nonaktif manual";
    } else if (Number(r.parent_is_loser ?? 0) === 1) {
      status = "hidden_loser";
      reason = "Produk kalah pasangan WR vs SK";
    } else if (r.axvara_variant_id == null) {
      status = "hidden_nocatalog";
      reason = "Tanpa pasangan katalog — tidak tampil";
    } else {
      const stock = Number(r.pv_stock ?? r.wr_stock ?? 0);
      const minQty = Math.max(1, Number(r.pv_min_qty ?? 1) || 1);
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
  const { wr_variant_id, markup_percent, markup_fixed, delivery_class } = parsed.data;
  const row = await queryFirst(`SELECT wr_price, axvara_variant_id FROM wr_variants WHERE wr_variant_id=?`, wr_variant_id);
  if (!row) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  // Kunci kelas manual: sumber 'admin', sync tidak menimpa (WHERE di sync
  // hanya mengisi yang NULL; UPDATE admin langsung menimpa apa pun).
  if (delivery_class) {
    await execRun(
      `UPDATE wr_variants SET wr_delivery_class=?, wr_delivery_source='admin',
        updated_at=? WHERE wr_variant_id=?`,
      delivery_class,
      now,
      wr_variant_id,
    );
  }
  if (markup_percent == null && !delivery_class) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  if (markup_percent == null) {
    return NextResponse.json({ ok: true, wr_variant_id, delivery_class });
  }
  const sellPrice = calculateSellPrice(Number(row.wr_price), markup_percent, markup_fixed);
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
