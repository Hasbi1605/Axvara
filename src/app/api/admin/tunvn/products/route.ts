// GET /api/admin/tunvn/products — mirror katalog TUNVN + pemetaan varian/family.
// Admin saja; tanpa TUNVN terkonfigurasi mengembalikan daftar mirror apa
// adanya dengan flag configured=false (tanpa fetch upstream).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readSyncTimestampSetting } from "@/lib/sync-status";
import { isTunvnConfigured } from "@/lib/tunvn/client";
import { isTunvnExcludedProduct, tunvnFamilyForSupplierId } from "@/lib/tunvn/families";

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
              t.admin_name, t.admin_description, t.publish_requested, t.description AS supplier_description,
              p.name AS axvara_name, p.description AS axvara_description, p.is_active AS axvara_is_active,
              p.slug AS axvara_slug, p.tunvn_family AS family, p.archived_at AS axvara_archived_at,
              v.id AS variant_id, v.sku AS variant_sku, v.label AS variant_label,
              v.price AS variant_price, v.is_active AS variant_is_active, v.tunvn_admin_price_idr
         FROM tunvn_products t
         LEFT JOIN product_variants v ON v.tunvn_source_product_id = t.supplier_product_id
         LEFT JOIN products p ON p.id = COALESCE(v.product_id, t.axvara_product_id)
        ORDER BY t.supplier_product_id ASC LIMIT 200`,
    );
    const counts = await db.queryFirst(
      `SELECT COUNT(*) AS total, COALESCE(SUM(visible),0) AS published, COALESCE(SUM(publish_requested),0) AS requested, COALESCE(SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END),0) AS in_stock FROM tunvn_products`,
    );
    const mapped = items.filter(item => item.variant_id != null);
    const lastValue = await readSyncTimestampSetting(db, "tunvn_catalog", "tunvn_catalog_sync_at");
    const lastMs = lastValue ? Number(lastValue) : NaN;
    return NextResponse.json({
      ok: true,
      configured: isTunvnConfigured(),
      items: items.map(item => ({
        ...item,
        // Key family dari peta statis (fallback 1:1 juga dikenali) agar panel
        // bisa mengelompokkan kartu walau produk belum terbit.
        family_key: tunvnFamilyForSupplierId(Number(item.supplier_product_id))?.family.key ?? `p${item.supplier_product_id}`,
        // Flag baca-saja untuk panel: produk pengecualian (#60) dan produk
        // induk yang sudah diarsipkan tidak boleh ditawarkan untuk diterbitkan.
        excluded: isTunvnExcludedProduct(Number(item.supplier_product_id)) ? 1 : 0,
        product_archived: item.axvara_archived_at != null ? 1 : 0,
      })),
      counts: {
        total: Number(counts?.total ?? 0),
        published: Number(counts?.published ?? 0),
        requested: Number(counts?.requested ?? 0),
        in_stock: Number(counts?.in_stock ?? 0),
        mapped: mapped.length,
        active_variants: mapped.filter(item => Number(item.variant_is_active ?? 0) === 1).length,
      },
      last_sync_at: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
