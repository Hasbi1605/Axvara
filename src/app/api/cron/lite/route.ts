// POST /api/cron/lite?job=expiry|fulfillment|wr_orders|sk_orders — langkah
// cron INTI yang dipisah dari route raksasa `/api/cron/operations` (2026-10-05).
//
// Latar: Workers Free ~10 ms CPU per request. Malam 4→5 Okt 10–20% request
// `/api/cron/operations` per jam dibunuh `exceededResources` — termasuk fase
// ringan (expiry) — karena biaya MENYALAKAN route itu (impor statis Telegram,
// WhatsApp, QRIS, fulfillment, …) sudah ±7–10 ms. `/api/supplier-sync` yang
// ramping tidak pernah kena. Route ini meniru polanya: impor minimal, satu
// pekerjaan per request, modul dimuat dinamis HANYA untuk job yang diminta.
//
// Cakupan sengaja inti (yang menyentuh pembeli); sisanya tetap di route besar
// yang masih dipanggil Worker sebagai pelengkap (idempoten — klaim atomik/
// lease/transisi bersyarat mencegah kerja ganda):
//   expiry      — initializing basi + invoice DANA/GoPay lewat deadline order
//   fulfillment — lepas lock basi + proses job kirim yang jatuh tempo
//   wr_orders   — pulihkan klaim/saldo, retry, teruskan order lunas, reconcile
//                 macet, kirim kredensial
//   sk_orders   — pola yang sama untuk Sekalipay
//   promo       — Daily Promo Digest 09.00/17.00 WIB (guard murah; ledger
//                 `telegram_promo_digests` mencegah kirim ganda dengan notify)
// Kontrak: header `authorization: Bearer <CRON_SECRET>`; 200 {ok,job,...};
// 400 job tak dikenal; 401 secret salah. Worker: `mcp-worker/src/cron.ts`.

import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security";
import { createBudgetedDatabase, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";

const LITE_JOBS = ["expiry", "fulfillment", "wr_orders", "sk_orders", "promo"] as const;
type LiteJob = (typeof LITE_JOBS)[number];
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;

type Items = { product_id: number; variant_id?: number; qty: number }[];
const parseItems = (raw: unknown): Items => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const job = request.nextUrl.searchParams.get("job") as LiteJob | null;
  if (!job || !LITE_JOBS.includes(job)) return NextResponse.json({ error: "invalid_job" }, { status: 400 });

  // Budget statement D1 per invocation sama dengan route besar (40).
  const db = createBudgetedDatabase(40).access;
  const result: Record<string, unknown> = { ok: true, job };
  try {
    if (job === "expiry") Object.assign(result, await runExpiry(db));
    else if (job === "fulfillment") Object.assign(result, await runFulfillment(db));
    else if (job === "wr_orders") Object.assign(result, await runWrOrders(db));
    else if (job === "sk_orders") Object.assign(result, await runSkOrders(db));
    else Object.assign(result, await runPromo(db));
  } catch (error) {
    // Budget habis = sisa kerja dilanjutkan tick berikut, bukan kegagalan.
    if (!(error instanceof QueryBudgetExceeded)) {
      return NextResponse.json({ ok: false, job, error: error instanceof Error ? error.message.slice(0, 160) : "failed" }, { status: 500 });
    }
    result.budget_exhausted = true;
  }
  try {
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      `cron_lite_${job}_ok_at`,
    );
  } catch { /* penanda best-effort */ }
  return NextResponse.json(result);
}

type Db = DatabaseAccess;

async function runExpiry(db: Db) {
  const { transitionPendingPaymentOrder } = await import("@/lib/db");
  const { isExpiredIso } = await import("@/lib/expiry");
  let staleInitializing = 0;
  let expired = 0;
  const stale = await db.queryAll(
    `SELECT pt.order_code, o.items FROM payment_transactions pt
       JOIN orders o ON o.code=pt.order_code
      WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
      LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of stale) {
    const changed = await transitionPendingPaymentOrder({
      orderCode: String(tx.order_code), expectedTransactionStatus: "initializing",
      transactionStatus: "failed", orderStatus: "dibatalkan", paymentStatus: "failed",
      items: parseItems(tx.items), lastError: "stale_initializing",
    }, db.d1).catch(() => false);
    if (changed) staleInitializing++;
  }
  // Hanya QRIS dinamis (DANA/GoPay): cabang provider lain mengirim pesan
  // Telegram dan tetap ditangani route besar.
  const candidates = await db.queryAll(
    `SELECT pt.order_code, COALESCE(o.expires_at, pt.expires_at) AS expires_at, o.items
       FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
      WHERE pt.status='pending' AND pt.provider IN ('dana','gopay')
        AND julianday(COALESCE(o.expires_at, pt.expires_at)) <= julianday('now')
      ORDER BY julianday(COALESCE(o.expires_at, pt.expires_at)) ASC
      LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of candidates) {
    if (!isExpiredIso(tx.expires_at)) continue;
    const changed = await transitionPendingPaymentOrder({
      orderCode: String(tx.order_code), expectedTransactionStatus: "pending",
      transactionStatus: "expired", expiredOnly: true, orderStatus: "kadaluarsa",
      paymentStatus: "expired", items: parseItems(tx.items),
    }, db.d1).catch(() => false);
    if (changed) expired++;
  }
  return { stale_initializing: staleInitializing, expired_payments: expired };
}

async function runFulfillment(db: Db) {
  if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") return { skipped: "auto_fulfillment_disabled" };
  const { getDueJobs, processJobItems, releaseStaleJobs } = await import("@/lib/fulfillment/deliver");
  const released = await releaseStaleJobs(db).catch(() => 0);
  const jobs = await getDueJobs(FULFILLMENT_PER_RUN, db);
  let processed = 0;
  for (const job of jobs) {
    const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
    if (!order) continue;
    try {
      const unit = await processJobItems(Number(job.id), order, {}, 2, undefined, db);
      if (unit.done || unit.attempted > 0) processed++;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return { stale_locks_released: released, due_jobs_processed: processed };
}

async function runWrOrders(db: Db) {
  const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
  if (!isWrEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/warung-rebahan/order");
  const out: Record<string, unknown> = {};
  await order.recoverStaleClaims(db).catch(() => 0);
  await order.reconcileBlockedBalance(db).catch(() => 0);
  if (process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true") {
    const due = await db.queryFirst(
      `SELECT COUNT(*) AS n FROM wr_order_links
        WHERE status IN ('pending','retry') AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ).catch(() => null);
    if (Number(due?.n ?? 0) > 0) {
      out.retried = await order.retryFailedWrOrders(db);
      const processed = await order.processWrPendingOrders(db);
      out.processed = processed.processed;
      out.succeeded = processed.succeeded;
    }
    out.reconciled = await order.reconcileStuckWrOrders(db).catch(() => 0);
  }
  const { processDueCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
  const delivery = await processDueCredentialDeliveries(db);
  out.credentials_delivered = delivery.delivered;
  return out;
}

async function runSkOrders(db: Db) {
  const { isSkEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/sekalipay/order");
  const out: Record<string, unknown> = {};
  await order.recoverStaleSkClaims(db).catch(() => 0);
  await order.reconcileBlockedSkBalance(db).catch(() => 0);
  if (process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true") {
    const due = await db.queryFirst(
      `SELECT COUNT(*) AS n FROM sk_order_links
        WHERE status IN ('pending','retry') AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ).catch(() => null);
    if (Number(due?.n ?? 0) > 0) {
      out.retried = await order.retryFailedSkOrders(db);
      const processed = await order.processSkPendingOrders(db);
      out.processed = processed.processed;
      out.succeeded = processed.succeeded;
    }
    out.reconciled = await order.reconcileStuckSkOrders(db).catch(() => 0);
  }
  return out;
}

async function runPromo(db: Db) {
  const { sendDueAdminPromoDigest } = await import("@/lib/telegram/promo-digest");
  const promo = await sendDueAdminPromoDigest(db);
  return { promo_due: promo.due, promo_full_sent: promo.fullSent, promo_short_sent: promo.shortSent, promo_skipped: promo.skipped ?? null };
}
