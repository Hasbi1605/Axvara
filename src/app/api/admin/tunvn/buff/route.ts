// GET /api/admin/tunvn/buff — varian Buff Muse terbit + probe harga live.
// Probe /api/buff/check tidak mendebit saldo; kegagalan probe ditandai stale.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkTunvnBuff, isTunvnConfigured } from "@/lib/tunvn/client";
import { TUNVN_MUSE_SLUG } from "@/lib/tunvn/catalog";
import { computeVariantLiveStatus, loadProductGroupLosers } from "@/lib/product-live-status";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
    const rawVariants = await db.queryAll(
      `SELECT pv.id, pv.product_id, pv.sku, pv.label, pv.price, pv.stock, pv.min_qty, pv.fulfillment_mode, pv.is_active,
              pv.tunvn_buff_quantity_b, pv.tunvn_cost_usdt, pv.tunvn_markup_percent, pv.tunvn_fx_idr_per_usdt, pv.tunvn_admin_price_idr,
              p.is_active AS product_active, p.archived_at AS product_archived_at,
              CASE WHEN pv.fulfillment_mode='unique' THEN (
                SELECT COUNT(*) FROM fulfillment_inventory fi WHERE fi.product_id=pv.product_id AND fi.variant_id=pv.id AND fi.status='available'
              ) ELSE NULL END AS inventory_available
         FROM product_variants pv
         LEFT JOIN products p ON p.id=pv.product_id
         WHERE pv.sku='TUNVN-BUFF-1B' ORDER BY pv.tunvn_buff_quantity_b ASC`,
    );
    const muse = await db.queryFirst("SELECT id, is_active, archived_at FROM products WHERE slug=?", TUNVN_MUSE_SLUG);
    const loserToWinner = await loadProductGroupLosers(db.queryAll);
    const variants = rawVariants.map((row) => {
      const { product_active, product_archived_at, inventory_available, ...rest } = row;
      const live = computeVariantLiveStatus(
        {
          axvara_product_id: row.product_id ?? muse?.id,
          variant_id: row.id,
          variant_active: row.is_active,
          product_active: product_active ?? muse?.is_active,
          product_archived: product_archived_at ?? muse?.archived_at,
          stock: row.stock,
          min_qty: row.min_qty ?? 1,
          fulfillment_mode: row.fulfillment_mode ?? "manual",
          inventory_available,
        },
        loserToWinner,
      );
      return {
        ...rest,
        variant_status: live.status,
        variant_reason: live.reason,
      };
    });
    let probe: unknown = null;
    let probe_error: string | null = null;
    if (isTunvnConfigured()) {
      const checked = await checkTunvnBuff(1);
      if (checked.kind === "ok") {
        probe = {
          quantity_b: 1,
          sell_price_usdt: checked.sell_price_usdt,
          cost_per_b_usdt: checked.sell_price_usdt,
          fundable: checked.fundable,
        };
      } else {
        probe_error = `buff_${checked.kind}`;
      }
    } else {
      probe_error = "not_configured";
    }
    return NextResponse.json({
      ok: true, variants, probe, probe_error,
      muse_product: muse ? { id: Number(muse.id), is_active: Number(muse.is_active ?? 0), archived: muse.archived_at != null ? 1 : 0 } : null,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
