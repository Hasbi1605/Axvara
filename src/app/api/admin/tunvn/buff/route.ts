// GET /api/admin/tunvn/buff — varian Buff Muse terbit + probe harga live.
// Probe /api/buff/check tidak mendebit saldo; kegagalan probe ditandai stale.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkTunvnBuff, isTunvnConfigured } from "@/lib/tunvn/client";
import { TUNVN_MUSE_SLUG } from "@/lib/tunvn/catalog";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
    const variants = await db.queryAll(
      `SELECT id, sku, label, price, is_active, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt, tunvn_admin_price_idr
         FROM product_variants WHERE sku='TUNVN-BUFF-1B' ORDER BY tunvn_buff_quantity_b ASC`,
    );
    const muse = await db.queryFirst("SELECT id, is_active FROM products WHERE slug=?", TUNVN_MUSE_SLUG);
    let probe: unknown = null;
    let probe_error: string | null = null;
    if (isTunvnConfigured()) {
      const checked = await checkTunvnBuff(20);
      if (checked.kind === "ok") {
        probe = {
          quantity_b: 20,
          sell_price_usdt: checked.sell_price_usdt,
          cost_per_b_usdt: checked.sell_price_usdt / 20,
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
      muse_product: muse ? { id: Number(muse.id), is_active: Number(muse.is_active ?? 0) } : null,
    });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}
