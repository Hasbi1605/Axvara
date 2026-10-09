// POST /api/cron/lite?job=expiry|fulfillment|wr_orders|sk_orders|pedia_orders|promo|notify_a|notify_b|notify|cleanup — langkah
// cron INTI yang dipisah dari route raksasa `/api/cron/operations` (2026-10-05).
//
// Latar: Workers Free ~10 ms CPU per request. Malam 4→5 Okt 10–20% request
// `/api/cron/operations` per jam dibunuh `exceededResources` — termasuk fase
// ringan (expiry) — karena biaya MENYALAKAN route itu (impor statis Telegram,
// WhatsApp, QRIS, fulfillment, …) sudah ±7–10 ms. `/api/supplier-sync` yang
// ramping tidak pernah kena. Route ini meniru polanya: impor minimal, satu
// pekerjaan per request, modul dimuat dinamis HANYA untuk job yang diminta.
//
// 2026-10-09: `notify` dipecah jadi `notify_a` (retry kabar order Telegram +
// invoice tertunda) dan `notify_b` (kabar QRIS kedaluwarsa + pengingat order
// pending + outbox WhatsApp). Latar: 09:50 WIB 4 langkah lite 503 bareng;
// `notify` satu-satunya job yang mengipas 5 sub-kerjaan (5 dynamic import)
// dalam 1 request (~1,9 dtk antrean kosong). `job=notify` LAMA tetap hidup
// sebagai alias gabungan A→B (kompat pemanggil lama + heavy tick) — Worker
// memanggil a/b terpisah agar tiap request lebih ringan.
//
// Cakupan sengaja inti (yang menyentuh pembeli); sisanya tetap di route besar
// yang masih dipanggil Worker sebagai pelengkap (idempoten — klaim atomik/
// lease/transisi bersyarat mencegah kerja ganda):
//   expiry      — initializing basi + invoice DANA/GoPay lewat deadline order
//   fulfillment — lepas lock basi + proses job kirim yang jatuh tempo
//   wr_orders   — pulihkan klaim/saldo, retry, teruskan order lunas, reconcile
//                 macet, kirim kredensial
//   sk_orders   — pola yang sama untuk Sekalipay
//   pedia_orders — dispatch + poll order Pedia ke ProviderSMM (PD-30–33);
//                 saldo dicek maks 1×/30 mnt (hemat statement)
//   promo       — Daily Promo Digest 09.00/17.00 WIB (guard murah; ledger
//                 `telegram_promo_digests` mencegah kirim ganda dengan notify)
//   notify_a    — retry kabar order Telegram + invoice tertunda (separuh notify)
//   notify_b    — kabar QRIS kedaluwarsa + pengingat pending + outbox WA
//   notify      — alias gabungan notify_a lalu notify_b (kompat lama)
// Kontrak: header `authorization: Bearer <CRON_SECRET>`; 200 {ok,job,...};
// 400 job tak dikenal; 401 secret salah. Worker: `mcp-worker/src/cron.ts`.

import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security";
import { createBudgetedDatabase, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";

const LITE_JOBS = ["expiry", "fulfillment", "wr_orders", "sk_orders", "pedia_orders", "promo", "notify", "notify_a", "notify_b", "cleanup"] as const;
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
    else if (job === "pedia_orders") Object.assign(result, await runPediaOrders(db));
    else if (job === "notify_a") Object.assign(result, await runNotifyA(db));
    else if (job === "notify_b") Object.assign(result, await runNotifyB(db));
    else if (job === "notify") Object.assign(result, await runNotify(db));
    else if (job === "cleanup") Object.assign(result, await runCleanup(db));
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

// pedia_orders (PEDIA M4, PD-30–33): dispatch + poll + alert saldo.
// Budget: klaim atomik + ≤20 item + poll ≤20 + saldo 1×/30mnt + penanda.
// Saldo dicek via proxy /psmm/balance; bila < ambang → ping admin dengan
// throttle 1:1 WR/SK (6 jam ATAU turun Rp5.000 — `notifyPediaLowBalance`,
// kunci store_settings pedia_balance_alert_at format `amount|ms`).
async function runPediaOrders(db: Db) {
  const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
  const out: Record<string, unknown> = {};
  try {
    // Teruskan budgeted access: statement dispatch+poll ikut budget 40
    // (dulu koneksi sendiri → tak terhitung, rawan jebol diam-diam).
    const r = await processPediaPaidOrders(undefined, db);
    Object.assign(out, r);
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    out.dispatch_error = error instanceof Error ? error.message.slice(0, 80) : "failed";
  }
  // Alert saldo: maks 1×/30 mnt (baca penanda dulu — 1 query murah).
  // Penanda datetime SQLite = UTC (parseExpiry kanonis, bukan Date.parse
  // mentah yang mengira waktu lokal → selisih 7 jam → cek tiap tick).
  try {
    const last = await db.queryFirst(
      `SELECT value FROM store_settings WHERE key='pedia_balance_checked_at'`,
    ).catch(() => null);
    const { parseExpiry: parseChecked } = await import("@/lib/expiry");
    const lastMs = last ? (parseChecked(String(last.value)) ?? NaN) : NaN;
    if (!Number.isFinite(lastMs) || Date.now() - lastMs > 30 * 60 * 1000) {
      await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES ('pedia_balance_checked_at', datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      ).catch(() => null);
      const { callPsmmProxy } = await import("@/lib/pedia/proxy");
      const res = await callPsmmProxy<{ balance?: string | number }>("balance", {}, 15_000);
      if (res.ok) {
        const v = Number((res.data as { balance?: unknown })?.balance);
        if (Number.isFinite(v)) {
          out.balance = v;
          await db.execRun(
            `INSERT INTO pedia_supplier_balance_log (supplier, balance) VALUES ('providersmm', ?)`,
            v,
          ).catch(() => null);
          const alertRp = Number(process.env.PEDIA_BALANCE_ALERT_RP || 100000) || 100000;
          if (v < alertRp) {
            // Throttle 6 jam + turun Rp5.000 ada DI DALAM notify (cermin
            // WR/SK) — di sini cukup panggil; tanpa gate ganda 1 jam yang
            // dulu bikin spam tiap jam saat saldo stagnan Rp 0.
            const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
            const alerted = await notifyPediaLowBalance(v, db).catch(() => false);
            if (alerted) out.balance_alerted = true;
          }
        }
      }
    }
  } catch {
    if ((out as { budget_exhausted?: boolean }).budget_exhausted) throw new QueryBudgetExceeded();
  }
  return out;
}

async function runPromo(db: Db) {
  const { sendDueAdminPromoDigest } = await import("@/lib/telegram/promo-digest");
  const promo = await sendDueAdminPromoDigest(db);
  return { promo_due: promo.due, promo_full_sent: promo.fullSent, promo_short_sent: promo.shortSent, promo_skipped: promo.skipped ?? null };
}

// notify (2026-10-05 malam, dipecah 2026-10-09): retry kabar order Telegram,
// invoice tertunda, kabar QRIS kedaluwarsa, pengingat order pending, outbox
// WhatsApp. Tiap pekerjaan berdiri sendiri (satu gagal tidak menghentikan
// yang lain) dan masing-masing memilih kandidatnya sendiri dengan klaim
// idempoten.
//
// Pecahan (2026-10-09): `notify_a` = telegram_retry + invoice_retry (2 import);
// `notify_b` = qris_expiry + reminders + whatsapp_outbox (3 import). `notify`
// = alias gabungan A lalu B. Hasil digabung dengan kunci yang sama sehingga
// pemantau lama (alarm Worker, dashboard) tidak berubah bentuk respons.
async function runNotifyA(db: Db) {
  const out: Record<string, unknown> = {};
  const guard = async (key: string, fn: () => Promise<unknown>) => {
    try { out[key] = await fn(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out[`${key}_error`] = error instanceof Error ? error.message.slice(0, 80) : "failed";
    }
  };
  await guard("telegram_retry", async () => {
    const { retryPendingTelegramNotifications } = await import("@/lib/telegram/order-notifications");
    return retryPendingTelegramNotifications(4, undefined, db);
  });
  await guard("invoice_retry", async () => {
    const { retryInvoicePendingTelegramInvoices } = await import("@/lib/telegram/invoice-retry");
    return retryInvoicePendingTelegramInvoices(2, db);
  });
  return out;
}

async function runNotifyB(db: Db) {
  const out: Record<string, unknown> = {};
  const guard = async (key: string, fn: () => Promise<unknown>) => {
    try { out[key] = await fn(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out[`${key}_error`] = error instanceof Error ? error.message.slice(0, 80) : "failed";
    }
  };
  await guard("qris_expiry_notices", async () => {
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    return sendQrisExpiryNotifications(2, db);
  });
  await guard("pending_reminders", async () => {
    const { sendPendingOrderReminders } = await import("@/lib/telegram/order-notifications");
    return sendPendingOrderReminders(4, db);
  });
  await guard("whatsapp_outbox", async () => {
    const { processDueWhatsAppOutbox } = await import("@/lib/whatsapp/outbox");
    return processDueWhatsAppOutbox(4, db);
  });
  return out;
}

async function runNotify(db: Db) {
  const out: Record<string, unknown> = {};
  try {
    Object.assign(out, await runNotifyA(db));
  } catch (error) {
    // Budget habis di paruh A = sisa kerja dilanjutkan tick berikut.
    if (error instanceof QueryBudgetExceeded) throw error;
  }
  try {
    Object.assign(out, await runNotifyB(db));
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
  }
  return out;
}

// cleanup: baris kedaluwarsa (sesi WA, inbox WA 7 hari, event DANA 30 hari,
// revokasi sesi admin). Murah dan idempoten.
async function runCleanup(db: Db) {
  const del = async (sql: string) => Number((await db.execRun(sql).catch(() => ({ changes: 0 }))).changes || 0);
  return {
    rows_cleaned:
      await del(`DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`)
      + await del(`DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`)
      + await del(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`)
      + await del(`DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')`),
  };
}
