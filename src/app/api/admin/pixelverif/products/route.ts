import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isPixelverifConfigured, isPixelverifEnabled, isPixelverifSyncEnabled } from "@/lib/pixelverif/client";
import { parseStoredSyncError } from "@/lib/sync-status";
import { loadProductGroupLosers, computeVariantLiveStatus } from "@/lib/product-live-status";
import { PIXELVERIF_FAMILY } from "@/lib/pixelverif/families";
import { parsePixelverifObservedPlans, PIXELVERIF_OBSERVED_PLANS_KEY, pixelverifObservedKey } from "@/lib/pixelverif/observed-plans";
import { observedMarkupFields, PIXELVERIF_PLAN_ADMIN_PREFIX } from "@/lib/pixelverif/observed-markup";
import { loadPixelverifFxIdrPerUsd } from "@/lib/pixelverif/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ error: "unauthorized" }, 401);
  try {
    const db = createDatabaseAccess();
    if (!db.d1) return json({ error: "database_unavailable" }, 503);
    const rows = await db.queryAll(
      `SELECT
          s.service_key, s.flow_type, s.validity, s.credit_cost, s.available, s.pricing_version, s.synced_at,
          CASE WHEN s.available=1 THEN -1 ELSE 0 END AS stock,
          CASE WHEN s.available=0 THEN 1 ELSE 0 END AS disappeared,
          COALESCE(v.pixelverif_markup_percent, 35) AS markup_percent,
          v.pixelverif_admin_price_idr AS admin_price_idr,
          v.pixelverif_fx_idr_per_usd AS fx_idr_per_usd,
          v.id AS variant_id, v.sku, v.label, v.price AS variant_price, v.is_active AS variant_active,
          v.stock AS pv_stock, v.min_qty AS pv_min_qty, v.fulfillment_mode AS pv_fulfillment_mode,
          CASE WHEN v.fulfillment_mode='unique' THEN (
            SELECT COUNT(*) FROM fulfillment_inventory fi WHERE fi.product_id=v.product_id AND fi.variant_id=v.id AND fi.status='available'
          ) ELSE NULL END AS inventory_available,
          p.id AS axvara_product_id, p.name AS product_name, p.slug AS product_slug, p.is_active AS product_active, p.archived_at AS product_archived_at
        FROM pixelverif_services s
        LEFT JOIN product_variants v ON v.pixelverif_flow_type = s.flow_type AND v.pixelverif_validity = s.validity
          AND v.sku = CASE WHEN s.flow_type='normal' THEN 'PV-NORMAL-3' ELSE 'PV-FULL-3' END
        LEFT JOIN products p ON p.id = v.product_id
        ORDER BY s.flow_type ASC`,
    );
    const settings = await db.queryAll(
      `SELECT key, value FROM store_settings WHERE key IN ('pixelverif_catalog_success_at','pixelverif_catalog_last_error',?) OR key GLOB ?`,
      PIXELVERIF_OBSERVED_PLANS_KEY,
      `${PIXELVERIF_PLAN_ADMIN_PREFIX}*`,
    );
    const loserToWinner = await loadProductGroupLosers(db.queryAll);
    const items = rows.map((row) => {
      const { product_archived_at, ...rest } = row;
      const productArchived = product_archived_at != null ? 1 : 0;
      const live = computeVariantLiveStatus(
        {
          axvara_product_id: row.axvara_product_id,
          variant_id: row.variant_id,
          variant_active: row.variant_active,
          product_active: row.product_active,
          product_archived: productArchived,
          stock: row.pv_stock ?? row.stock,
          min_qty: row.pv_min_qty ?? 1,
          fulfillment_mode: row.pv_fulfillment_mode ?? "manual",
          inventory_available: row.inventory_available,
        },
        loserToWinner,
      );
      return {
        ...rest,
        family: { key: PIXELVERIF_FAMILY.key, name: PIXELVERIF_FAMILY.name, slug: PIXELVERIF_FAMILY.slug },
        product_archived: productArchived,
        variant_status: live.status,
        variant_reason: live.reason,
      };
    });
    const mirrored = new Set(rows.map(row => row.service_key));
    const settingsByKey = new Map(settings.map(row => [row.key, row.value]));
    const plans = parsePixelverifObservedPlans(settingsByKey.get(PIXELVERIF_OBSERVED_PLANS_KEY))
      .filter(plan => !mirrored.has(pixelverifObservedKey(plan.flow, plan.months)));
    const fx = plans.some(plan => plan.cost != null) ? await loadPixelverifFxIdrPerUsd(db.d1) : null;
    const observed = plans.map(plan => {
      const key = pixelverifObservedKey(plan.flow, plan.months);
      return {
        service_key: key,
        label: `${plan.flow === "full" ? "Aktivasi Langsung" : "Link Redeem"} ${plan.months} Bulan`,
        credit_cost: plan.cost,
        ...observedMarkupFields(settingsByKey.get(`${PIXELVERIF_PLAN_ADMIN_PREFIX}${key}`), plan.cost, fx),
        fx_idr_per_usd: fx,
        variant_active: 0,
        variant_id: null,
        variant_status: "hidden_nocatalog",
        variant_reason: "Belum terhubung ke katalog AXVARA",
        pixel_observed_state: plan.state,
        family: { key: `pixel-observed-${plan.months}`, name: `Google AI Pro ${plan.months} Bulan` },
      };
    });
    return json({
      ok: true,
      configured: isPixelverifConfigured(),
      dispatch_enabled: isPixelverifEnabled(),
      sync_enabled: isPixelverifSyncEnabled(),
      items: [...items, ...observed],
      last_sync_at: settings.find((r) => r.key === "pixelverif_catalog_success_at")?.value ?? null,
      last_error: parseStoredSyncError(settings.find((r) => r.key === "pixelverif_catalog_last_error")?.value),
    });
  } catch {
    return json({ error: "load_failed" }, 503);
  }
}
