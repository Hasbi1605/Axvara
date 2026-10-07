// GET /api/pedia/ticker — 10 order lunas terbaru tersamarkan (PD-15, §9.7).
// Publik, cache 60 dtk. Tanpa data palsu — kosong bila < 5 order/24 jam
// (UI menyembunyikan).
import { NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { maskTargetForTicker } from "@/lib/pedia/link";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = createDatabaseAccess();
  const rows = await db.queryAll(
    `SELECT i.quantity, i.target_normalized, p.name AS product_name
       FROM pedia_order_items i
       JOIN orders o ON o.code=i.order_code
       JOIN pedia_products p ON p.id=i.product_id
      WHERE o.paid_at IS NOT NULL
        AND datetime(o.paid_at) > datetime('now', '-24 hours')
      ORDER BY o.paid_at DESC LIMIT 10`,
  ).catch(() => []);
  if (rows.length < 5) return NextResponse.json({ ok: true, items: [] });
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      text: `${Number(r.quantity).toLocaleString("id-ID")} ${String(r.product_name)} · ${maskTargetForTicker(String(r.target_normalized))}`,
    })),
  }, {
    headers: { "CDN-Cache-Control": "max-age=60", "Cache-Control": "public, max-age=60" },
  });
}
