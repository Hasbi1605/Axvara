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
      `SELECT supplier_product_id, name, price_vnd, price_usdt, stock, visible,
              axvara_product_id, markup_percent, sell_price_idr, fx_idr_per_usdt, synced_at
         FROM tunvn_products ORDER BY supplier_product_id ASC LIMIT 200`,
    );
    const counts = await db.queryFirst(
      `SELECT COUNT(*) AS total, COALESCE(SUM(visible),0) AS published, COALESCE(SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END),0) AS in_stock FROM tunvn_products`,
    );
    const last = await db.queryFirst("SELECT value FROM store_settings WHERE key='tunvn_catalog_sync_at'");
    return NextResponse.json({
      ok: true,
      configured: isTunvnConfigured(),
      items,
      counts: {
        total: Number(counts?.total ?? 0),
        published: Number(counts?.published ?? 0),
        in_stock: Number(counts?.in_stock ?? 0),
      },
      last_sync_at: last?.value ? new Date(Number(last.value)).toISOString() : null,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
