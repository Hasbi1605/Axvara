// GET /api/admin/tunvn/products — mirror katalog TUNVN + pemetaan varian/family.
// Admin saja; tanpa TUNVN terkonfigurasi mengembalikan daftar mirror apa
// adanya dengan flag configured=false (tanpa fetch upstream).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readSyncStatusSettings } from "@/lib/sync-status";
import { isTunvnConfigured, isTunvnEnabled, isTunvnSyncEnabled } from "@/lib/tunvn/client";
import { isTunvnExcludedProduct, tunvnFallbackFamily, tunvnFamilyForSupplierId } from "@/lib/tunvn/families";
import { computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";

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
              t.admin_name, t.admin_description, t.description AS supplier_description,
              COALESCE(v.product_id, t.axvara_product_id) AS resolved_axvara_product_id,
              p.name AS axvara_name, p.description AS axvara_description, p.is_active AS axvara_is_active,
              p.slug AS axvara_slug, p.tunvn_family, p.archived_at AS axvara_archived_at,
              v.id AS variant_id, v.sku AS variant_sku, v.label AS variant_label,
              v.price AS variant_price, v.is_active AS variant_is_active, v.tunvn_admin_price_idr,
              v.stock AS pv_stock, v.min_qty AS pv_min_qty, v.fulfillment_mode AS pv_fulfillment_mode,
              CASE WHEN v.fulfillment_mode='unique' THEN (
                SELECT COUNT(*) FROM fulfillment_inventory fi WHERE fi.product_id=v.product_id AND fi.variant_id=v.id AND fi.status='available'
              ) ELSE NULL END AS inventory_available
         FROM tunvn_products t
         LEFT JOIN product_variants v ON v.tunvn_source_product_id = t.supplier_product_id
         LEFT JOIN products p ON p.id = COALESCE(v.product_id, t.axvara_product_id)
        ORDER BY t.supplier_product_id ASC LIMIT 200`,
    );
    const counts = await db.queryFirst(
      `SELECT COUNT(*) AS total, COALESCE(SUM(visible),0) AS published, COALESCE(SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END),0) AS in_stock FROM tunvn_products`,
    );
    const mapped = items.filter(item => item.variant_id != null);
    const activeVariants = mapped.filter(item => Number(item.variant_is_active ?? 0) === 1).length;
    const { lastSyncAt, lastError } = await readSyncStatusSettings(db, "tunvn_catalog", "tunvn_catalog_sync_at");
    const loserToWinner = await loadProductGroupLosers(db.queryAll);
    const lastMs = lastSyncAt ? Number(lastSyncAt) : NaN;
    return NextResponse.json({
      ok: true,
      configured: isTunvnConfigured(),
      dispatch_enabled: isTunvnEnabled(),
      sync_enabled: isTunvnSyncEnabled(),
      items: items.map(item => {
        const id = Number(item.supplier_product_id);
        const mappedFamily = tunvnFamilyForSupplierId(id);
        const { key, name, slug, members } = mappedFamily?.family ?? tunvnFallbackFamily(id, String(item.name));
        const excluded = isTunvnExcludedProduct(id) ? 1 : 0;
        const productArchived = item.axvara_archived_at != null ? 1 : 0;
        const live = computeVariantLiveStatus(
          {
            supplier_active: excluded ? 0 : 1,
            axvara_product_id: item.resolved_axvara_product_id,
            variant_id: item.variant_id,
            variant_active: item.variant_is_active,
            product_active: item.axvara_is_active,
            product_archived: productArchived,
            stock: item.pv_stock ?? item.stock,
            min_qty: item.pv_min_qty ?? 1,
            fulfillment_mode: item.pv_fulfillment_mode ?? "manual",
            inventory_available: item.inventory_available,
          },
          loserToWinner,
        );
        return {
          ...item,
          id,
          variant_active: item.variant_is_active,
          product_active: item.axvara_is_active,
          product_name: item.axvara_name,
          product_slug: item.axvara_slug,
          label: item.variant_label,
          cost_usdt: item.price_usdt,
          admin_price_idr: item.tunvn_admin_price_idr ?? null,
          family_key: key,
          family: { key, name, slug, label: mappedFamily?.member.label ?? members[0].label },
          excluded,
          product_archived: productArchived,
          variant_status: live.status,
          variant_reason: live.reason,
        };
      }),
      counts: {
        total: Number(counts?.total ?? 0),
        published: Number(counts?.published ?? 0),
        requested: activeVariants, // Legacy alias; no separate publication switch.
        in_stock: Number(counts?.in_stock ?? 0),
        mapped: mapped.length,
        active_variants: activeVariants,
      },
      last_sync_at: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null,
      last_error: lastError,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
