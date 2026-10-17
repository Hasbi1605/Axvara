import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isD1Mode, queryAll, queryFirst } from "@/lib/db";
import {
  currentWibMonthString,
  isSameWibDay,
  isSameWibMonth,
  isSameWibWeek,
  revenueDateWibSql,
  revenueMonthWibSql,
  revenuePaidAtWibSql,
  revenueWeekWibSql,
  todayWibDateString,
  weekWibStartDateString,
  resolveReportRange,
  type ReportSelection,
} from "@/lib/revenue";
import { emptySelectedReport, readOverviewFinancialReport, readSelectedFinancialReport, selectedReportFromFinancial } from "@/lib/dashboard-report";
import { OVERVIEW_ATTENTION_SQL, OVERVIEW_JOB_QUEUE_SQL } from "@/lib/admin-overview-queries";
import { readAdminOverviewSnapshot } from "@/lib/admin-overview-cache";
import { parseExpiry } from "@/lib/expiry";
import { topProfitByItems } from "@/lib/dashboard-profit";
import {
  evaluateQris,
  evaluateQueue,
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
  revenue_week: 0,
  revenue_month: 0,
  revenue_from: null as null | string,
  revenue_to: null as null | string,
  revenue_timezone: "Asia/Jakarta",
  orders_today: 0,
  orders_week: 0,
  orders_month: 0,
  cost_today: 0,
  cost_week: 0,
  cost_month: 0,
  cost_total: 0,
  profit_today: 0,
  profit_week: 0,
  profit_month: 0,
  profit_total: 0,
  profit_estimated_orders: 0,
  pending_proofs: 0,
  payment_attention: 0,
  fulfillment_attention: 0,
  low_stock: 0,
  top_product: null as null | { name: string; sold_count: number },
  profit_by_supplier: {
    wr: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    sk: { orders: 0, revenue: 0, cost: 0, profit: 0 },
    manual: { orders: 0, revenue: 0, cost: 0, profit: 0 },
  },
  top_profit_products: [] as { name: string; qty: number; revenue: number; cost: number; profit: number }[],
  profit_by_channel: {
    web: { orders: 0, revenue: 0, profit: 0 },
    telegram: { orders: 0, revenue: 0, profit: 0 },
    whatsapp: { orders: 0, revenue: 0, profit: 0 },
  },
  daily_series: [] as { date: string; orders: number; revenue: number; cost: number; profit: number }[],
};

/** Waktu pembayaran order untuk laporan: paid_at tetap, fallback updated_at. */
function orderPaidTime(order: Record<string, unknown>): number | null {
  const raw = order.paid_at ?? order.updated_at ?? order.created_at;
  if (raw == null) return null;
  const parsed = parseExpiry(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const params = request.nextUrl.searchParams;
  let selection: ReportSelection;
  try {
    for (const key of ["date_from", "date_to", "period"]) if (params.getAll(key).length > 1) throw new Error("Filter laporan tidak boleh berulang.");
    const hasRange = params.has("date_from") || params.has("date_to");
    if (hasRange && params.has("period")) throw new Error("Pilih periode atau rentang tanggal, bukan keduanya.");
    selection = hasRange ? { date_from: params.get("date_from") ?? "", date_to: params.get("date_to") ?? "" }
      : (params.get("period") ?? "week") as ReportSelection;
    resolveReportRange(selection, now);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rentang laporan tidak valid." }, { status: 400 });
  }

  if (!isD1Mode()) {
    const [orders, products] = await Promise.all([
      queryAll("SELECT * FROM orders ORDER BY created_at DESC"),
      queryAll("SELECT * FROM products ORDER BY sort_order ASC"),
    ]);
    const paid = orders.filter((order) => String(order.status) === "lunas");
    const nowMs = now.getTime();
    const amountOf = (order: Record<string, unknown>) => Number(order.subtotal || 0);
    const revenueTotal = paid.reduce((sum, order) => sum + amountOf(order), 0);
    const inDay = (order: Record<string, unknown>) => { const ts = orderPaidTime(order); return ts != null && isSameWibDay(ts, nowMs); };
    const inWeek = (order: Record<string, unknown>) => { const ts = orderPaidTime(order); return ts != null && isSameWibWeek(ts, nowMs); };
    const inMonth = (order: Record<string, unknown>) => { const ts = orderPaidTime(order); return ts != null && isSameWibMonth(ts, nowMs); };
    const revenueToday = paid.filter(inDay).reduce((sum, order) => sum + amountOf(order), 0);
    const revenueWeek = paid.filter(inWeek).reduce((sum, order) => sum + amountOf(order), 0);
    const revenueMonth = paid.filter(inMonth).reduce((sum, order) => sum + amountOf(order), 0);
    const top = [...products].sort((a, b) => Number(b.sold_count || 0) - Number(a.sold_count || 0))[0];
    const selected = emptySelectedReport(selection, now);
    const selectedOrders: Record<string, unknown>[] = [];
    for (const order of paid) {
      const ts = orderPaidTime(order);
      if (ts == null) continue;
      const date = todayWibDateString(new Date(ts));
      if (date < selected.from || date > selected.to) continue;
      const amount = amountOf(order);
      selectedOrders.push({ ...order, revenue: amount, supplier_cost: 0 });
      selected.orders++; selected.revenue += amount; selected.profit += amount; selected.estimated_orders++;
      selected.merchant_paid = (selected.merchant_paid ?? 0) + amount;
      const channel = order.sales_channel === "telegram" || order.sales_channel === "whatsapp" ? order.sales_channel : "web";
      for (const value of [selected.suppliers.manual, selected.channels[channel]]) {
        value.orders++; value.revenue += amount; value.profit += amount;
      }
      const label = selection === "today" ? `${new Date(ts + 7 * 3600000).toISOString().slice(11, 13)}:00` : date;
      const point = selected.series.find(p => p.date === label);
      if (point) { point.orders++; point.revenue += amount; point.profit += amount; }
    }
    selected.top_products = topProfitByItems(selectedOrders);
    return NextResponse.json({
      ...zero,
      selected_report: selected,
      total_orders: orders.length,
      pending_orders: orders.filter((order) => String(order.status) === "pending").length,
      paid_orders: paid.length,
      revenue_total: revenueTotal,
      revenue_today: revenueToday,
      revenue_week: revenueWeek,
      revenue_month: revenueMonth,
      orders_today: paid.filter(inDay).length,
      orders_week: paid.filter(inWeek).length,
      orders_month: paid.filter(inMonth).length,
      // Mode tanpa D1: tanpa tabel link supplier, modal tak bisa dihitung —
      // untung = omzet (estimasi) agar kartu tetap terisi jujur di dev.
      cost_today: 0,
      cost_week: 0,
      cost_month: 0,
      cost_total: 0,
      profit_today: revenueToday,
      profit_week: revenueWeek,
      profit_month: revenueMonth,
      profit_total: revenueTotal,
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

  const range = resolveReportRange(selection, now);
  const key = JSON.stringify([admin.email, selection, range.from, range.to, now.toISOString().slice(0, 13)]);
  const value = await readAdminOverviewSnapshot(key, () => readD1Overview(selection, now));
  return NextResponse.json(value);
}

async function readD1Overview(selection: ReportSelection, now: Date) {
  let cacheable = true;
  const safeFirst = async (sql: string) => {
    try { return await queryFirst(sql); } catch { cacheable = false; return undefined; }
  };
  const safeAll = async (sql: string): Promise<{ status?: unknown; count?: unknown; sales_channel?: unknown; value?: unknown; oldest_due?: unknown }[]> => {
    try { return await queryAll(sql); } catch { cacheable = false; return []; }
  };
  // Pendapatan memakai waktu pembayaran tetap (paid_at, WIB) — bukan
  // updated_at (issue #12): pengiriman, catatan admin, dan retry notifikasi
  // tidak boleh memindahkan pendapatan ke hari/bulan lain. Hierarki sumber:
  // ledger paid_at → reviewed_at bukti → paid_at order → updated_at fallback.
  // Untung memakai bucket & omzet yang SAMA (minggu = Senin-start, 0058).
  const paidAtWib = revenuePaidAtWibSql("o");
  const paidDateWib = revenueDateWibSql("o");
  const paidWeekWib = revenueWeekWibSql("o");
  const paidMonthWib = revenueMonthWibSql("o");
  const todayWib = todayWibDateString();
  const weekWib = weekWibStartDateString();
  const monthWib = currentWibMonthString();
  const paidJoin = `FROM orders o
      LEFT JOIN payment_transactions pt ON pt.order_code=o.code
      LEFT JOIN (SELECT order_code, MAX(reviewed_at) AS reviewed_at
                 FROM payment_proofs WHERE status='approved' GROUP BY order_code) pp
        ON pp.order_code=o.code`;
  const paidOnly = `o.status='lunas'`;
  const inToday = `${paidDateWib}='${todayWib}'`;
  const inWeek = `${paidWeekWib}='${weekWib}'`;
  const inMonth = `${paidMonthWib}='${monthWib}'`;
  const financialPromise = readOverviewFinancialReport(now);
  const [orders, proofs, qris, fulfillmentJobsRaw, fulfillmentOrdersNeedingAction, itemAttention, stock, topProduct, channelRows, financial, selected, tgQueue, waQueue, oldestJobDue, oldestItemDue, oldestWaDue, tgSends, waSends, qrisEvents] = await Promise.all([
    safeFirst(`SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending_orders,
      SUM(CASE WHEN ${paidOnly} THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN ${paidOnly} AND ${inToday} THEN 1 ELSE 0 END) AS orders_today,
      SUM(CASE WHEN ${paidOnly} AND ${inWeek} THEN 1 ELSE 0 END) AS orders_week,
      SUM(CASE WHEN ${paidOnly} AND ${inMonth} THEN 1 ELSE 0 END) AS orders_month,
      MIN(CASE WHEN ${paidOnly} THEN ${paidAtWib} ELSE NULL END) AS revenue_from,
      MAX(CASE WHEN ${paidOnly} THEN ${paidAtWib} ELSE NULL END) AS revenue_to
      ${paidJoin}`),
    safeFirst(`SELECT COUNT(*) AS count FROM payment_proofs pp
      JOIN orders o ON o.code=pp.order_code
      WHERE pp.status='submitted' AND UPPER(COALESCE(pp.claimed_method,''))!='QRIS' AND o.status='pending'`),
    safeFirst(`SELECT COUNT(*) AS count FROM dana_webhook_events
      WHERE status IN ('received','ignored','failed') AND datetime(created_at)>=datetime('now','-7 days')`),
    safeFirst(`SELECT COUNT(*) AS count FROM fulfillment_jobs WHERE status IN ('manual_required','retry','failed')`),
    // Unit hitung (review R11): fulfillment_attention = JUMLAH ORDER yang
    // butuh tindakan (bukan jumlah job + jumlah item yang dihitung ganda).
    // Satu order dihitung SEKALI walau punya 1 job + N item bermasalah.
    // Item delivered/sending/queued tepat waktu TIDAK dihitung.
    safeFirst(OVERVIEW_ATTENTION_SQL),
    safeAll(`SELECT fi.status AS status, COUNT(*) AS count FROM fulfillment_items fi
      JOIN orders o ON o.code=fi.order_code
      WHERE fi.status IN ('manual_required','retry','failed','queued','sending')
        AND o.status='lunas' AND o.payment_status='paid' GROUP BY fi.status`),
    safeFirst(`SELECT COUNT(*) AS count FROM product_variants WHERE is_active=1 AND stock BETWEEN 0 AND 5`),
    safeFirst(`SELECT name,sold_count FROM products WHERE is_active=1 ORDER BY sold_count DESC, sort_order ASC LIMIT 1`),
    safeAll(`SELECT sales_channel,COUNT(*) AS count FROM orders WHERE status='pending' GROUP BY sales_channel`),
    financialPromise,
    typeof selection === "string"
      ? financialPromise.then(report => selectedReportFromFinancial(selection, report, now))
      : readSelectedFinancialReport(selection, now),
    // Sinyal kesehatan berbasis pengukuran (issue #13), bukan sekadar env:
    // antrean fulfillment + usia kirim Telegram terakhir.
    // 2026-09-16: tgQueue/fulfillment HANYA dari order yang masih butuh
    // kirim (lunas+paid). Job/item milik order final (dibatalkan/kadaluarsa)
    // tidak dihitung — sebelumnya 7 failed order final menyeret Telegram ke
    // degraded padahal bot sehat (false alarm).
    safeAll(OVERVIEW_JOB_QUEUE_SQL),
    safeAll(`SELECT status, COUNT(*) AS count FROM whatsapp_outbox GROUP BY status`),
    // Usia antrean tertua (review R11): tanpa ini, satu kirim sukses yang
    // baru menutupi antrean macet berjam-jam. Filter order sama: hanya order
    // lunas+paid yang menua yang dihitung; bangkai order final diabaikan.
    safeFirst(`SELECT MIN(fj.next_attempt_at) AS oldest_due FROM fulfillment_jobs fj
      JOIN orders o ON o.code=fj.order_code
      WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid'`),
    safeFirst(`SELECT MIN(fi.next_attempt_at) AS oldest_due FROM fulfillment_items fi
      JOIN orders o ON o.code=fi.order_code
      WHERE fi.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid'`),
    safeFirst(`SELECT MIN(next_attempt_at) AS oldest_due FROM whatsapp_outbox WHERE status IN ('pending','failed')`),
    safeFirst(`SELECT MAX(CASE WHEN telegram_paid_notified_at IS NOT NULL THEN telegram_paid_notified_at ELSE NULL END) AS last_ok,
      MAX(updated_at) AS last_touch FROM orders WHERE sales_channel='telegram'`),
    safeFirst(`SELECT MAX(updated_at) AS last_touch, MAX(CASE WHEN status='sent' THEN updated_at ELSE NULL END) AS last_ok,
      MAX(CASE WHEN status IN ('failed','dead') THEN updated_at ELSE NULL END) AS last_fail FROM whatsapp_outbox`),
    safeFirst(`SELECT SUM(CASE WHEN status IN ('received','ignored') THEN 1 ELSE 0 END) AS unmatched,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      MAX(CASE WHEN status='matched' THEN processed_at ELSE NULL END) AS last_match FROM dana_webhook_events
      WHERE datetime(created_at)>=datetime('now','-7 days')`),
  ]);
  const channels = { web: 0, telegram: 0, whatsapp: 0 };
  for (const row of (Array.isArray(channelRows) ? channelRows : [])) {
    const channel = String(row.sales_channel || "web") as keyof typeof channels;
    if (channel in channels) channels[channel] = Number(row.count || 0);
  }
  const total = financial.reports.total;
  const today = financial.reports.today, week = financial.reports.week, month = financial.reports.month;
  const profitByChannel = total.channels, profitBySupplier = total.suppliers;
  const topProfitProducts = total.top_products, dailySeries = financial.daily;
  const systems = buildSystems({
    tgQueue: (Array.isArray(tgQueue) ? tgQueue : []) as Record<string, unknown>[],
    itemQueue: (Array.isArray(itemAttention) ? itemAttention : []) as Record<string, unknown>[],
    waQueue: (Array.isArray(waQueue) ? waQueue : []) as Record<string, unknown>[],
    tgSends: tgSends ?? {},
    waSends: waSends ?? {},
    qrisEvents: qrisEvents ?? {},
    oldestJobDue: oldestJobDue?.oldest_due ? String(oldestJobDue.oldest_due) : null,
    oldestItemDue: oldestItemDue?.oldest_due ? String(oldestItemDue.oldest_due) : null,
    oldestWaDue: oldestWaDue?.oldest_due ? String(oldestWaDue.oldest_due) : null,
  });

  return { cacheable, expiresAt: Date.parse(financial.generatedAt) + 60_000, value: {
    ...zero,
    selected_report: selected,
    total_orders: Number(orders?.total_orders || 0),
    pending_orders: Number(orders?.pending_orders || 0),
    paid_orders: Number(orders?.paid_orders || 0),
    orders_today: Number(orders?.orders_today || 0),
    orders_week: Number(orders?.orders_week || 0),
    orders_month: Number(orders?.orders_month || 0),
    revenue_total: total.revenue,
    revenue_today: today.revenue,
    revenue_week: week.revenue,
    revenue_month: month.revenue,
    revenue_from: orders?.revenue_from ? String(orders.revenue_from) : null,
    revenue_to: orders?.revenue_to ? String(orders.revenue_to) : null,
    revenue_timezone: "Asia/Jakarta",
    cost_total: total.cost,
    cost_today: today.cost,
    cost_week: week.cost,
    cost_month: month.cost,
    profit_total: total.profit,
    profit_today: today.profit,
    profit_week: week.profit,
    profit_month: month.profit,
    profit_estimated_orders: total.estimated_orders,
    profit_by_supplier: profitBySupplier,
    top_profit_products: topProfitProducts,
    profit_by_channel: profitByChannel,
    daily_series: dailySeries,
    period_reports: { today, week, month },
    pending_proofs: Number(proofs?.count || 0),
    payment_attention: Number(qris?.count || 0),
    // fulfillment_attention = order-butuh-tindakan (tanpa hitung ganda;
    // delivered tidak pernah dihitung — query di atas hanya memilih status
    // aksi). Rincian per status tersedia di fulfillment_attention_by_status.
    // fulfillment_jobs_raw dipertahankan untuk diagnosis (bukan angka utama).
    fulfillment_attention: Number(fulfillmentOrdersNeedingAction?.count || 0),
    fulfillment_jobs_attention: Number(fulfillmentJobsRaw?.count || 0),
    fulfillment_attention_by_status: Object.fromEntries(
      (Array.isArray(itemAttention) ? itemAttention : []).map((row) => [
        String((row as Record<string, unknown>).status ?? ""),
        Number((row as Record<string, unknown>).count || 0),
      ]),
    ),
    low_stock: Number(stock?.count || 0),
    top_product: topProduct ? { name: String(topProduct.name), sold_count: Number(topProduct.sold_count || 0) } : null,
    channels,
    systems,
    system_details: systemsDetails,
  } };
}

type SystemsInput = {
  tgQueue: Record<string, unknown>[];
  itemQueue: Record<string, unknown>[];
  waQueue: Record<string, unknown>[];
  tgSends: Record<string, unknown>;
  waSends: Record<string, unknown>;
  qrisEvents: Record<string, unknown>;
  oldestJobDue: string | null;
  oldestItemDue: string | null;
  oldestWaDue: string | null;
};

let systemsDetails: Record<string, ServiceStatus> = {};

/** Kompatibilitas boolean lama untuk UI yang belum membaca system_details. */
function legacySystems() {
  const danaOk = process.env.DANA_QRIS_ENABLED === "true" && Boolean(process.env.DANA_STATIC_QRIS) && Boolean(process.env.DANA_WEBHOOK_SECRET);
  const gopayOk = process.env.GOPAY_QRIS_ENABLED === "true" && Boolean(process.env.GOPAY_STATIC_QRIS) && Boolean(process.env.GOPAY_POLLER_SECRET);
  return {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) && process.env.TELEGRAM_BOT_ENABLED === "true",
    whatsapp: Boolean(process.env.WHATSAPP_GATEWAY_URL) && process.env.WHATSAPP_ENABLED === "true",
    qris: danaOk || gopayOk,
    fulfillment: process.env.AUTO_FULFILLMENT_ENABLED === "true" && Boolean(process.env.FULFILLMENT_ENCRYPTION_KEY),
  };
}

/** Status jujur empat tingkat (issue #13): unknown/configured/healthy/degraded. */
function buildSystems(input: SystemsInput): Record<string, boolean> {
  const tgQueueRows = input.tgQueue.map((row) => ({ status: String(row.status || ""), count: Number(row.count || 0) }));
  const waQueueRows = input.waQueue.map((row) => ({ status: String(row.status || ""), count: Number(row.count || 0) }));
  // Review R11: usia antrean Telegram HARUS nyata (tertua dari job+item),
  // bukan null yang membuat antrean macet terlihat sehat. Dan verdict
  // antrean dinilai DULU sebelum keberhasilan terakhir — kirim sukses yang
  // baru tidak boleh menutupi antrean yang menua.
  const tgOldest = input.oldestItemDue ?? input.oldestJobDue ?? null;
  const telegramQueueFirst = summarizeQueue(tgQueueRows, tgOldest);
  const telegramQueueVerdict = evaluateQueue(telegramQueueFirst, { maxPending: 25, maxAgeMinutes: 30 }, "Fulfillment Telegram");
  const telegram = telegramQueueVerdict.level === "degraded"
    ? telegramQueueVerdict
    : evaluateTelegram({
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
        webhookError: null,
        webhookPending: null,
        lastSendOkAt: input.tgSends.last_ok ? String(input.tgSends.last_ok) : null,
        lastSendFailAt: null,
        queue: telegramQueueFirst,
      });
  const whatsapp = evaluateWhatsApp({
    configured: Boolean(process.env.WHATSAPP_GATEWAY_URL),
    enabled: process.env.WHATSAPP_ENABLED === "true",
    gatewayReachable: null, // sesi Baileys milik gateway eksternal; diukur via /health gateway
    lastSendOkAt: input.waSends.last_ok ? String(input.waSends.last_ok) : null,
    lastSendFailAt: input.waSends.last_fail ? String(input.waSends.last_fail) : null,
    queue: summarizeQueue(waQueueRows, input.oldestWaDue),
  });
  const qris = evaluateQris({
    configured: (Boolean(process.env.DANA_STATIC_QRIS) && Boolean(process.env.DANA_WEBHOOK_SECRET))
      || (Boolean(process.env.GOPAY_STATIC_QRIS) && Boolean(process.env.GOPAY_POLLER_SECRET)),
    enabled: process.env.DANA_QRIS_ENABLED === "true" || process.env.GOPAY_QRIS_ENABLED === "true",
    unmatched7d: Number(input.qrisEvents.unmatched || 0),
    failed7d: Number(input.qrisEvents.failed || 0),
    lastMatchAt: input.qrisEvents.last_match ? String(input.qrisEvents.last_match) : null,
  });
  const itemQueueRows = (Array.isArray(input.itemQueue) ? input.itemQueue : []).map((row) => ({ status: String(row.status || ""), count: Number(row.count || 0) }));
  const fulfillmentQueue = summarizeQueue([...tgQueueRows, ...itemQueueRows], input.oldestItemDue ?? input.oldestJobDue ?? null);
  // Review R11: antrean macet/menumpuk adalah degraded — satu kirim sukses
  // yang baru tidak boleh menutupinya. evaluateQueue menilai gagal, jumlah,
  // DAN usia antrean tertua dalam satu tempat.
  const fulfillment: ServiceStatus = !process.env.FULFILLMENT_ENCRYPTION_KEY
    ? { level: "unknown", detail: "Fulfillment belum dikonfigurasi" }
    : evaluateQueue(fulfillmentQueue, { maxPending: 25, maxAgeMinutes: 30 }, "Fulfillment");
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
