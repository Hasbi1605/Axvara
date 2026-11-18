import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { isMiraiConfigured, isMiraiEnabled, isMiraiSyncEnabled } from "@/lib/mirai/client";
import { miraiFamily } from "@/lib/mirai/families";
import { parseStoredSyncError } from "@/lib/sync-status";

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
         m.package_code, m.group_key, m.name, m.quota_tokens, m.duration_seconds,
         m.cost_usdt, m.min_quantity, m.max_quantity, m.unlimited, m.remaining_today,
         m.is_active AS mirror_active, m.last_seen_at,
         CASE WHEN m.is_active=1 THEN (CASE WHEN m.unlimited=1 THEN -1 ELSE MAX(0, m.remaining_today) END) ELSE 0 END AS stock,
         CASE WHEN m.is_active=0 THEN 1 ELSE 0 END AS disappeared,
         COALESCE(v.mirai_markup_percent, m.markup_percent, 35) AS markup_percent,
         v.mirai_admin_price_idr AS admin_price_idr,
         COALESCE(v.mirai_fx_idr_per_usdt, m.fx_idr_per_usdt) AS fx_idr_per_usdt,
         v.id AS variant_id, v.sku, v.label, v.price AS variant_price, v.is_active AS variant_active,
         p.id AS axvara_product_id, p.name AS product_name, p.is_active AS product_active, p.archived_at AS product_archived_at
       FROM mirai_packages m
       LEFT JOIN product_variants v ON v.mirai_package_code = m.package_code AND v.sku = 'MR-' || m.package_code
       LEFT JOIN products p ON p.id = v.product_id
       ORDER BY m.quota_tokens ASC, m.duration_seconds ASC, m.package_code ASC`,
    );
    const settings = await db.queryAll(
      `SELECT key, value FROM store_settings WHERE key IN ('mirai_catalog_success_at','mirai_catalog_last_error')`,
    );
    const items = rows.map((row) => {
      const { mirror_active: _m, product_archived_at, ...rest } = row;
      return {
        ...rest,
        family: miraiFamily({
          package_code: String(row.package_code),
          group: String(row.group_key),
          name: String(row.name),
          quota_tokens: Number(row.quota_tokens),
          duration_seconds: Number(row.duration_seconds),
        }),
        product_archived: product_archived_at != null ? 1 : 0,
      };
    });
    return json({
      ok: true,
      configured: isMiraiConfigured(),
      dispatch_enabled: isMiraiEnabled(),
      sync_enabled: isMiraiSyncEnabled(),
      items,
      last_sync_at: settings.find((r) => r.key === "mirai_catalog_success_at")?.value ?? null,
      last_error: parseStoredSyncError(settings.find((r) => r.key === "mirai_catalog_last_error")?.value),
    });
  } catch {
    return json({ error: "load_failed" }, 503);
  }
}
