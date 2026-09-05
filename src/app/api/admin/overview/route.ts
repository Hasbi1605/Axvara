import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode, queryAll, queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const zero = {
  total_orders: 0,
  pending_orders: 0,
  paid_orders: 0,
  revenue_total: 0,
  revenue_today: 0,
  revenue_month: 0,
  pending_proofs: 0,
  payment_attention: 0,
  fulfillment_attention: 0,
  low_stock: 0,
  top_product: null as null | { name: string; sold_count: number },
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isD1Mode()) {
    const [orders, products] = await Promise.all([
      queryAll("SELECT * FROM orders ORDER BY created_at DESC"),
      queryAll("SELECT * FROM products ORDER BY sort_order ASC"),
    ]);
    const paid = orders.filter((order) => String(order.status) === "lunas");
    const top = [...products].sort((a, b) => Number(b.sold_count || 0) - Number(a.sold_count || 0))[0];
    return NextResponse.json({
      ...zero,
      total_orders: orders.length,
      pending_orders: orders.filter((order) => String(order.status) === "pending").length,
      paid_orders: paid.length,
      revenue_total: paid.reduce((sum, order) => sum + Number(order.subtotal || 0), 0),
      low_stock: products.filter((product) => Number(product.stock) >= 0 && Number(product.stock) <= 5).length,
      top_product: top ? { name: String(top.name), sold_count: Number(top.sold_count || 0) } : null,
      channels: { web: 0, telegram: 0, whatsapp: 0 },
      systems: systemHealth(),
    });
  }

  const safeFirst = async (sql: string) => {
    try { return await queryFirst(sql); } catch { return undefined; }
  };
  const safeAll = async (sql: string) => {
    try { return await queryAll(sql); } catch { return []; }
  };
  const [orders, proofs, qris, fulfillment, stock, topProduct, channelRows] = await Promise.all([
    safeFirst(`SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending_orders,
      SUM(CASE WHEN o.status='lunas' THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN o.status='lunas' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_total,
      SUM(CASE WHEN o.status='lunas' AND date(o.updated_at)=date('now') THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_today,
      SUM(CASE WHEN o.status='lunas' AND strftime('%Y-%m',o.updated_at)=strftime('%Y-%m','now') THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_month
      FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code`),
    safeFirst(`SELECT COUNT(*) AS count FROM payment_proofs pp
      JOIN orders o ON o.code=pp.order_code
      WHERE pp.status='submitted' AND UPPER(COALESCE(pp.claimed_method,''))!='QRIS' AND o.status='pending'`),
    safeFirst(`SELECT COUNT(*) AS count FROM dana_webhook_events
      WHERE status IN ('received','ignored','failed') AND datetime(created_at)>=datetime('now','-7 days')`),
    safeFirst(`SELECT COUNT(*) AS count FROM fulfillment_jobs WHERE status IN ('manual_required','retry','failed')`),
    safeFirst(`SELECT COUNT(*) AS count FROM product_variants WHERE is_active=1 AND stock BETWEEN 0 AND 5`),
    safeFirst(`SELECT name,sold_count FROM products WHERE is_active=1 ORDER BY sold_count DESC, sort_order ASC LIMIT 1`),
    safeAll(`SELECT sales_channel,COUNT(*) AS count FROM orders WHERE status='pending' GROUP BY sales_channel`),
  ]);
  const channels = { web: 0, telegram: 0, whatsapp: 0 };
  for (const row of channelRows) {
    const channel = String(row.sales_channel || "web") as keyof typeof channels;
    if (channel in channels) channels[channel] = Number(row.count || 0);
  }

  return NextResponse.json({
    ...zero,
    total_orders: Number(orders?.total_orders || 0),
    pending_orders: Number(orders?.pending_orders || 0),
    paid_orders: Number(orders?.paid_orders || 0),
    revenue_total: Number(orders?.revenue_total || 0),
    revenue_today: Number(orders?.revenue_today || 0),
    revenue_month: Number(orders?.revenue_month || 0),
    pending_proofs: Number(proofs?.count || 0),
    payment_attention: Number(qris?.count || 0),
    fulfillment_attention: Number(fulfillment?.count || 0),
    low_stock: Number(stock?.count || 0),
    top_product: topProduct ? { name: String(topProduct.name), sold_count: Number(topProduct.sold_count || 0) } : null,
    channels,
    systems: systemHealth(),
  });
}

function systemHealth() {
  return {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) && process.env.TELEGRAM_BOT_ENABLED === "true",
    whatsapp: Boolean(process.env.WHATSAPP_GATEWAY_URL) && process.env.WHATSAPP_ENABLED === "true",
    qris: process.env.DANA_QRIS_ENABLED === "true" && Boolean(process.env.DANA_STATIC_QRIS) && Boolean(process.env.DANA_WEBHOOK_SECRET),
    fulfillment: process.env.AUTO_FULFILLMENT_ENABLED === "true" && Boolean(process.env.FULFILLMENT_ENCRYPTION_KEY),
  };
}
