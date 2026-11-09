// GET /api/admin/tunvn/products — mirror katalog TUNVN + status publikasi.
// Admin saja; tanpa TUNVN terkonfigurasi mengembalikan daftar mirror apa
// adanya dengan flag configured=false (tanpa fetch upstream).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isTunvnConfigured } from "@/lib/tunvn/client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
    const items = await db.queryAll(
      `SELECT t.supplier_product_id, t.name, t.price_vnd, t.price_usdt, t.stock, t.visible,
              t.axvara_product_id, t.markup_percent, t.sell_price_idr, t.fx_idr_per_usdt, t.synced_at,
              t.admin_name, t.admin_description, t.publish_requested,
              p.name AS axvara_name, p.description AS axvara_description, p.is_active AS axvara_is_active,
              v.price AS variant_price, v.is_active AS variant_is_active
         FROM tunvn_products t
         LEFT JOIN products p ON p.id = t.axvara_product_id
         LEFT JOIN product_variants v ON v.sku = 'TUNVN-' || t.supplier_product_id
        ORDER BY t.supplier_product_id ASC LIMIT 200`,
    );
    const counts = await db.queryFirst(
      `SELECT COUNT(*) AS total, COALESCE(SUM(visible),0) AS published, COALESCE(SUM(publish_requested),0) AS requested, COALESCE(SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END),0) AS in_stock FROM tunvn_products`,
    );
    const last = await db.queryFirst("SELECT value FROM store_settings WHERE key='tunvn_catalog_sync_at'");
    return NextResponse.json({
      ok: true,
      configured: isTunvnConfigured(),
      items,
      counts: {
        total: Number(counts?.total ?? 0),
        published: Number(counts?.published ?? 0),
        requested: Number(counts?.requested ?? 0),
        in_stock: Number(counts?.in_stock ?? 0),
      },
      last_sync_at: last?.value ? new Date(Number(last.value)).toISOString() : null,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
