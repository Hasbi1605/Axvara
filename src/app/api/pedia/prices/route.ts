// Harga per jumlah untuk membandingkan layanan. Read-only, tanpa quote/order,
// identitas supplier, tarif modal, atau parameter markup di respons publik.
import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkRateLimit } from "@/lib/rateLimit";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { pediaBounds } from "@/lib/pedia/bounds";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!checkRateLimit(request, "pedia:prices")) return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." }, { status: 429, headers: { "Retry-After": "60" } });
  if (process.env.PEDIA_ENABLED !== "true") return NextResponse.json({ error: "Pedia belum tersedia." }, { status: 503 });
  const slug = request.nextUrl.searchParams.get("product_slug") ?? "";
  const quantity = Number(request.nextUrl.searchParams.get("quantity"));
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000_000) return NextResponse.json({ error: "Produk atau jumlah tidak valid." }, { status: 400 });
  const db = createDatabaseAccess();
  const product = await db.queryFirst("SELECT id, step FROM pedia_products WHERE slug=? AND is_active=1", slug);
  if (!product) return NextResponse.json({ error: "Produk tidak tersedia." }, { status: 404 });
  if (quantity % (Number(product.step) || 1) !== 0) return NextResponse.json({ error: `Jumlah harus kelipatan ${Number(product.step) || 1}.` }, { status: 422 });
  const rows = await db.queryAll(
    `SELECT t.id, t.markup_pct, t.min_profit_rp, t.min_qty_override, t.max_qty_override, t.quantity_step, s.rate_idr_per_1k, s.min_qty, s.max_qty
       FROM pedia_tiers t JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
      WHERE t.product_id=? AND t.is_active=1 AND t.supplier IN ('providersmm','indosmm')
        AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0
      ORDER BY t.id LIMIT 100`, product.id,
  );
  const prices = rows.filter((r) => { const b = pediaBounds(r, r, Number(product.step)); return b && quantity >= b.min && quantity <= b.max && quantity % b.step === 0; })
    .map((r) => ({ tier_id: Number(r.id), total: computePediaPrice({ supplierRatePer1k: Number(r.rate_idr_per_1k), quantity, markupPct: Number(r.markup_pct), minProfitRp: Number(r.min_profit_rp), minOrderRp: Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000 }) }));
  return NextResponse.json({ ok: true, product_slug: slug, quantity, prices }, { headers: { "Cache-Control": "no-store" } });
}
