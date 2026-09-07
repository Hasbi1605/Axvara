import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode, queryAll, queryFirst } from "@/lib/db";
import {
  currentWibMonthString,
  isSameWibDay,
  isSameWibMonth,
  revenueDateWibSql,
  revenueMonthWibSql,
  revenuePaidAtWibSql,
  todayWibDateString,
} from "@/lib/revenue";
import {
  evaluateQris,
  evaluateTelegram,
  evaluateWhatsApp,
  summarizeQueue,
  type ServiceStatus,
} from "@/lib/service-health";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const zero = {
  total_orders: 0,
  pending_orders: 0,
  paid_orders: 0,
  revenue_total: 0,
  revenue_today: 0,
  revenue_month: 0,
  revenue_from: null as null | string,
  revenue_to: null as null | string,
  revenue_timezone: "Asia/Jakarta",
  pending_proofs: 0,
  payment_attention: 0,
  fulfillment_attention: 0,
  low_stock: 0,
  top_product: null as null | { name: string; sold_count: number },
};

/** Waktu pembayaran order untuk laporan: paid_at tetap, fallback updated_at. */
function orderPaidTime(order: Record<string, unknown>): number | null {
  const raw = order.paid_at ?? order.updated_at ?? order.created_at;
  if (raw == null) return null;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isD1Mode()) {
    const [orders, products] = await Promise.all([
      queryAll("SELECT * FROM orders ORDER BY created_at DESC"),
      queryAll("SELECT * FROM products ORDER BY sort_order ASC"),
    ]);
    const paid = orders.filter((order) => String(order.status) === "lunas");
    const now = Date.now();
    const amountOf = (order: Record<string, unknown>) => Number(order.subtotal || 0);
    const revenueTotal = paid.reduce((sum, order) => sum + amountOf(order), 0);
    const revenueToday = paid
      .filter((order) => { const ts = orderPaidTime(order); return ts != null && isSameWibDay(ts, now); })
      .reduce((sum, order) => sum + amountOf(order), 0);
    const revenueMonth = paid
      .filter((order) => { const ts = orderPaidTime(order); return ts != null && isSameWibMonth(ts, now); })
      .reduce((sum, order) => sum + amountOf(order), 0);
    const top = [...products].sort((a, b) => Number(b.sold_count || 0) - Number(a.sold_count || 0))[0];
    return NextResponse.json({
      ...zero,
      total_orders: orders.length,
      pending_orders: orders.filter((order) => String(order.status) === "pending").length,
      paid_orders: paid.length,
      revenue_total: revenueTotal,
      revenue_today: revenueToday,
      revenue_month: revenueMonth,
      top_product: top ? { name: String(top.name), sold_count: Number(top.sold_count || 0) } : null,
      channels: { web: 0, telegram: 0, whatsapp: 0 },
      systems: legacySystems(),
      system_details: {
        telegram: { level: "unknown", detail: "Mode tanpa D1: belum ada pengukuran" },
        whatsapp: { level: "unknown", detail: "Mode tanpa D1: belum ada pengukuran" },
        qris: { level: "unknown", detail: "Mode tanpa D1: belum ada pengukuran" },
        fulfillment: { level: "unknown", detail: "Mode tanpa D1: belum ada pengukuran" },
      },
    });
  }

  const safeFirst = async (sql: string) => {
    try { return await queryFirst(sql); } catch { return undefined; }
  };
  const safeAll = async (sql: string) => {
    try { return await queryAll(sql); } catch { return []; }
  };
  // Pendapatan memakai waktu pembayaran tetap (paid_at, WIB) — bukan
  // updated_at (issue #12): pengiriman, catatan admin, dan retry notifikasi
  // tidak boleh memindahkan pendapatan ke hari/bulan lain. Hierarki sumber:
  // ledger paid_at → reviewed_at bukti → paid_at order → updated_at fallback.
  const paidAtWib = revenuePaidAtWibSql("o");
  const paidDateWib = revenueDateWibSql("o");
  const paidMonthWib = revenueMonthWibSql("o");
  const todayWib = todayWibDateString();
  const monthWib = currentWibMonthString();
  const paidJoin = `FROM orders o
      LEFT JOIN payment_transactions pt ON pt.order_code=o.code
      LEFT JOIN (SELECT order_code, MAX(reviewed_at) AS reviewed_at
                 FROM payment_proofs WHERE status='approved' GROUP BY order_code) pp
        ON pp.order_code=o.code`;
  const [orders, proofs, qris, fulfillment, stock, topProduct, channelRows, tgQueue, waQueue, tgSends, waSends, qrisEvents] = await Promise.all([
    safeFirst(`SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending_orders,
      SUM(CASE WHEN o.status='lunas' THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN o.status='lunas' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_total,
      SUM(CASE WHEN o.status='lunas' AND ${paidDateWib}='${todayWib}' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_today,
      SUM(CASE WHEN o.status='lunas' AND ${paidMonthWib}='${monthWib}' THEN COALESCE(pt.payable_amount,o.subtotal) ELSE 0 END) AS revenue_month,
      MIN(CASE WHEN o.status='lunas' THEN ${paidAtWib} ELSE NULL END) AS revenue_from,
      MAX(CASE WHEN o.status='lunas' THEN ${paidAtWib} ELSE NULL END) AS revenue_to
      ${paidJoin}`),
    safeFirst(`SELECT COUNT(*) AS count FROM payment_proofs pp
      JOIN orders o ON o.code=pp.order_code
      WHERE pp.status='submitted' AND UPPER(COALESCE(pp.claimed_method,''))!='QRIS' AND o.status='pending'`),
    safeFirst(`SELECT COUNT(*) AS count FROM dana_webhook_events
      WHERE status IN ('received','ignored','failed') AND datetime(created_at)>=datetime('now','-7 days')`),
    safeFirst(`SELECT COUNT(*) AS count FROM fulfillment_jobs WHERE status IN ('manual_required','retry','failed')`),
    safeFirst(`SELECT COUNT(*) AS count FROM product_variants WHERE is_active=1 AND stock BETWEEN 0 AND 5`),
    safeFirst(`SELECT name,sold_count FROM products WHERE is_active=1 ORDER BY sold_count DESC, sort_order ASC LIMIT 1`),
    safeAll(`SELECT sales_channel,COUNT(*) AS count FROM orders WHERE status='pending' GROUP BY sales_channel`),
    // Sinyal kesehatan berbasis pengukuran (issue #13), bukan sekadar env:
    // antrean fulfillment + usia kirim Telegram terakhir.
    safeAll(`SELECT status, COUNT(*) AS count FROM fulfillment_jobs GROUP BY status`),
    safeAll(`SELECT status, COUNT(*) AS count FROM whatsapp_outbox GROUP BY status`),
    safeFirst(`SELECT MAX(CASE WHEN telegram_paid_notified_at IS NOT NULL THEN telegram_paid_notified_at ELSE NULL END) AS last_ok,
      MAX(updated_at) AS last_touch FROM orders WHERE sales_channel='telegram'`),
    safeFirst(`SELECT MAX(updated_at) AS last_touch, MAX(CASE WHEN status='sent' THEN updated_at ELSE NULL END) AS last_ok,
      MAX(CASE WHEN status IN ('failed','dead') THEN updated_at ELSE NULL END) AS last_fail FROM whatsapp_outbox`),
    safeFirst(`SELECT COUNT(*) AS unmatched, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      MAX(CASE WHEN status='matched' THEN processed_at ELSE NULL END) AS last_match FROM dana_webhook_events
      WHERE status IN ('received','ignored','failed') AND datetime(created_at)>=datetime('now','-7 days')`),
  ]);
  const channels = { web: 0, telegram: 0, whatsapp: 0 };
  for (const row of channelRows) {
    const channel = String(row.sales_channel || "web") as keyof typeof channels;
    if (channel in channels) channels[channel] = Number(row.count || 0);
  }
  const systems = buildSystems({
    tgQueue: tgQueue ?? [],
    waQueue: waQueue ?? [],
    tgSends: tgSends ?? {},
    waSends: waSends ?? {},
    qrisEvents: qrisEvents ?? {},
  });

  return NextResponse.json({
    ...zero,
    total_orders: Number(orders?.total_orders || 0),
    pending_orders: Number(orders?.pending_orders || 0),
    paid_orders: Number(orders?.paid_orders || 0),
    revenue_total: Number(orders?.revenue_total || 0),
    revenue_today: Number(orders?.revenue_today || 0),
    revenue_month: Number(orders?.revenue_month || 0),
    revenue_from: orders?.revenue_from ? String(orders.revenue_from) : null,
    revenue_to: orders?.revenue_to ? String(orders.revenue_to) : null,
    revenue_timezone: "Asia/Jakarta",
    pending_proofs: Number(proofs?.count || 0),
    payment_attention: Number(qris?.count || 0),
    fulfillment_attention: Number(fulfillment?.count || 0),
    low_stock: Number(stock?.count || 0),
    top_product: topProduct ? { name: String(topProduct.name), sold_count: Number(topProduct.sold_count || 0) } : null,
    channels,
    systems,
    system_details: systemsDetails,
  });
}

type SystemsInput = {
  tgQueue: Record<string, unknown>[];
  waQueue: Record<string, unknown>[];
  tgSends: Record<string, unknown>;
  waSends: Record<string, unknown>;
  qrisEvents: Record<string, unknown>;
};

let systemsDetails: Record<string, ServiceStatus> = {};

/** Kompatibilitas boolean lama untuk UI yang belum membaca system_details. */
function legacySystems() {
  return {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) && process.env.TELEGRAM_BOT_ENABLED === "true",
    whatsapp: Boolean(process.env.WHATSAPP_GATEWAY_URL) && process.env.WHATSAPP_ENABLED === "true",
    qris: process.env.DANA_QRIS_ENABLED === "true" && Boolean(process.env.DANA_STATIC_QRIS) && Boolean(process.env.DANA_WEBHOOK_SECRET),
    fulfillment: process.env.AUTO_FULFILLMENT_ENABLED === "true" && Boolean(process.env.FULFILLMENT_ENCRYPTION_KEY),
  };
}

/** Status jujur empat tingkat (issue #13): unknown/configured/healthy/degraded. */
function buildSystems(input: SystemsInput): Record<string, boolean> {
  const tgQueueRows = input.tgQueue.map((row) => ({ status: String(row.status || ""), count: Number(row.count || 0) }));
  const waQueueRows = input.waQueue.map((row) => ({ status: String(row.status || ""), count: Number(row.count || 0) }));
  const telegram = evaluateTelegram({
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
    webhookError: null,
    webhookPending: null,
    lastSendOkAt: input.tgSends.last_ok ? String(input.tgSends.last_ok) : null,
    lastSendFailAt: null,
    queue: summarizeQueue(tgQueueRows, null),
  });
  const whatsapp = evaluateWhatsApp({
    configured: Boolean(process.env.WHATSAPP_GATEWAY_URL),
    enabled: process.env.WHATSAPP_ENABLED === "true",
    gatewayReachable: null, // sesi Baileys milik gateway eksternal; diukur via /health gateway
    lastSendOkAt: input.waSends.last_ok ? String(input.waSends.last_ok) : null,
    lastSendFailAt: input.waSends.last_fail ? String(input.waSends.last_fail) : null,
    queue: summarizeQueue(waQueueRows, null),
  });
  const qris = evaluateQris({
    configured: Boolean(process.env.DANA_STATIC_QRIS) && Boolean(process.env.DANA_WEBHOOK_SECRET),
    enabled: process.env.DANA_QRIS_ENABLED === "true",
    unmatched7d: Number(input.qrisEvents.unmatched || 0),
    failed7d: Number(input.qrisEvents.failed || 0),
    lastMatchAt: input.qrisEvents.last_match ? String(input.qrisEvents.last_match) : null,
  });
  const fulfillmentQueue = summarizeQueue(tgQueueRows, null);
  const fulfillment: ServiceStatus =
    fulfillmentQueue.failed > 0
      ? { level: "degraded", detail: `Fulfillment: ${fulfillmentQueue.failed} gagal` }
      : !process.env.FULFILLMENT_ENCRYPTION_KEY
        ? { level: "unknown", detail: "Fulfillment belum dikonfigurasi" }
        : fulfillmentQueue.pending > 0
          ? { level: "configured", detail: `Fulfillment: ${fulfillmentQueue.pending} antre` }
          : { level: "healthy", detail: "Fulfillment: antrean kosong" };
  systemsDetails = { telegram, whatsapp, qris, fulfillment };
  // Boolean lama dipertahankan untuk kompatibilitas UI: true bila layanan
  // terukur sehat/antre wajar (healthy/configured), false bila butuh
  // perhatian (degraded) atau belum bisa dinilai (unknown).
  const asBool = (status: ServiceStatus) => status.level === "healthy" || status.level === "configured";
  return {
    telegram: asBool(telegram),
    whatsapp: asBool(whatsapp),
    qris: asBool(qris),
    fulfillment: asBool(fulfillment),
  };
}
