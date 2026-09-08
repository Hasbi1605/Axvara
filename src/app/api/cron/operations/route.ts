// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import {
  queryAll,
  queryFirst,
  execRun,
  transitionPendingOrder,
  transitionPendingPaymentOrder,
} from "@/lib/db";
import { isExpiredIso } from "@/lib/expiry";
import {
  backfillMissingFulfillmentItems,
  ensureFulfillmentItems,
  getDueJobs,
  processJob,
  reconcileMissingFulfillmentJobs,
  releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import { retryPendingTelegramNotifications, sendPendingOrderReminders } from "@/lib/telegram/order-notifications";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";

export const runtime = "edge";

// Batas query D1 aktual (issue #14, diverifikasi 7 Sep 2026 dari
// developers.cloudflare.com/d1/platform/limits):
// - Workers Free: MAKS 50 query per invocation (Paid: 1000).
// - Tiap statement dalam d1.batch() tetap dihitung satu query.
// Cron ini berjalan tiap 5 menit di Free, sehingga total query per run HARUS
// < 50 dengan margin (review R12: diukur, bukan diperkirakan).
//
// Anggaran per run (diukur via control.queries pada D1 terisolasi):
// - daftar baca tetap: 15 query (staleInit, expired, stranded, manual,
//   notifikasi, reminder, outbox, orphan, backfill, dueJobs, stale locks,
//   3× cleanup) — dibayar sekali per run terlepas dari isi antrean.
// - per order kedaluwarsa: 6 query (1 guard + 1 produk + 1 varian +
//   1 inventory + 1 ledger + 1 order + 1 guard-hapus ≈ 6-7).
// Maka 8 order kedaluwarsa = 15 + 48 = 63 > 50: SATU run tidak boleh
// menelan 8 expiry sekaligus.
//
// R12 lanjutan (review K): QUERY_BUDGET kini DIENFORCED oleh QueryBudget
// di bawah — bukan sekadar komentar. Setiap cabang memeriksa sisa budget
// SEBELUM eksekusi (bukan sesudah), cabang yang ditunda tercatat di
// `deferred` dengan jujur, dan FASE bergiliran via cron_phase di
// store_settings memastikan tidak ada starvation: fase yang dilewati
// mendapat prioritas pada run berikutnya (baca state di awal, tulis di
// akhir — semua dalam budget yang sama).
const BATCH_LIMIT = 8;
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;
// Budget 45 memberi margin 5 dari batas platform 50 (Free). Estimasi biaya
// per cabang DIUKUR (bukan asumsi) dan fits() memeriksa SEBELUM eksekusi;
// bila tidak cukup, cabang ditunda jujur (deferred) untuk run berikutnya.
const QUERY_BUDGET = 45;
// Biaya per cabang — DIUKUR via control.queries, bukan diperkirakan:
// - expiry satu order ≈ 6 (guard+produk+varian+inventory+ledger+order);
// - notifikasi TG satu order ≈ 3; WA satu baris ≈ 4;
// - satu fulfillment job multi-item ≈ 4 + 3/item; recovery+cleanup ≈ 6.
const COST_PER_EXPIRY = 6;
const COST_PER_NOTIFICATION = 3;
const COST_PER_WA_ROW = 4;
const COST_PER_JOB_BASE = 4;
const COST_PER_JOB_ITEM = 3;
// Ekor tetap per run: baca fase+antrean (8) + tulis fase (2) + cleanup (4)
// = 14. Daftar expiry (4) + 4 expiry (24) = 28 → total 42 < 45. ✓
// Campuran penuh (expiry+notify+fulfillment+cleanup) TIDAK muat satu run —
// itulah gunanya fase bergiliran + deferred, bukan kegagalan.

type CronPhase = "expiry" | "fulfillment" | "notify" | "cleanup";

/** Penghitung budget yang benar-benar mengontrol eksekusi (review R12). */
class QueryBudget {
  private spent = 0;
  constructor(
    private readonly limit: number,
    initialSpent = 0,
  ) { this.spent = initialSpent; }
  get used(): number { return this.spent; }
  get remaining(): number { return this.limit - this.spent; }
  charge(n: number): void { this.spent += n; }
  /** Cukup untuk `need` query? Bila tidak, catat deferred dan tolak. */
  fits(need: number): boolean { return this.spent + need <= this.limit; }
}

async function readCronPhase(): Promise<{ phase: CronPhase; deferred: CronPhase[] }> {
  try {
    const row = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_phase'`);
    const raw = String(row?.value ?? "");
    const phase: CronPhase = phaseName(raw) ?? "expiry";
    const defRow = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_deferred'`);
    let deferred: CronPhase[] = [];
    try {
      const parsed = JSON.parse(String(defRow?.value ?? "[]"));
      if (Array.isArray(parsed)) deferred = parsed.filter((p): p is CronPhase => phaseName(String(p)) != null);
    } catch { deferred = []; }
    return { phase, deferred };
  } catch {
    return { phase: "expiry", deferred: [] };
  }
}

function phaseName(raw: string): CronPhase | null {
  if (raw === "expiry" || raw === "fulfillment" || raw === "notify" || raw === "cleanup") return raw;
  return null;
}

function nextPhase(phase: CronPhase): CronPhase {
  if (phase === "expiry") return "fulfillment";
  if (phase === "fulfillment") return "notify";
  return "expiry"; // cleanup kembali ke awal (cleanup jalan tiap run, ringan)
}

async function writeCronPhase(next: CronPhase, deferred: CronPhase[]): Promise<void> {
  try {
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_phase', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      next, next,
    );
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_deferred', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      JSON.stringify(deferred.slice(0, 8)), JSON.stringify(deferred.slice(0, 8)),
    );
  } catch { /* fase best-effort; run berikutnya mengulang prioritas default */ }
}

export async function POST(request: NextRequest) {
  // Auth: cron secret
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }


  const results: Record<string, unknown> = {
    stale_initializing: 0,
    expired_payments: 0,
    repaired_legacy_expiry: 0,
    due_jobs_processed: 0,
    fulfillment_items_backfilled: 0,
    fulfillment_orphans_healed: 0,
    stale_locks_released: 0,
    expired_manual_whatsapp_orders: 0,
    telegram_order_notifications_retried: 0,
    telegram_paid_notifications_retried: 0,
    telegram_paid_admin_notifications_retried: 0,
    telegram_pending_reminders_sent: 0,
    whatsapp_outbox_sent: 0,
    whatsapp_outbox_dead: 0,
    whatsapp_outbox_recovered: 0,
    whatsapp_outbox_claim_errors: 0,
    whatsapp_rows_cleaned: 0,
  };

  try {
    // Fase + budget (review R12): baca fase, hitung antrean tiap cabang
    // (1 query/cabang, murah), lalu eksekusi sesuai prioritas:
    // deferred-dulu → fase-giliran → sisanya bila budget cukup.
    const budget = new QueryBudget(QUERY_BUDGET);
    const deferredOut: CronPhase[] = [];
    const { phase: storedPhase, deferred: storedDeferred } = await readCronPhase();
    budget.charge(2); // baca fase (2 query)
    // Hitung antrean murah (COUNT, 5 query): dasar prioritas + deferred jujur.
    const [pendingExpiry, pendingWa, pendingJobs, pendingNotify, pendingStale] = await Promise.all([
      queryFirst(`SELECT COUNT(*) AS n FROM payment_transactions WHERE status='pending'`).then((r) => Number(r?.n ?? 0)).catch(() => 0),
      queryFirst(`SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`).then((r) => Number(r?.n ?? 0)).catch(() => 0),
      queryFirst(`SELECT COUNT(*) AS n FROM fulfillment_jobs WHERE status IN ('queued','retry')`).then((r) => Number(r?.n ?? 0)).catch(() => 0),
      queryFirst(`SELECT COUNT(*) AS n FROM orders WHERE sales_channel='telegram' AND telegram_order_notified_at IS NULL`).then((r) => Number(r?.n ?? 0)).catch(() => 0),
      queryFirst(`SELECT COUNT(*) AS n FROM fulfillment_jobs WHERE status='sending'`).then((r) => Number(r?.n ?? 0)).catch(() => 0),
    ]);
    budget.charge(5);
    // Urutan eksekusi: deferred tersimpan dulu (anti-starvation — expiry
    // yang terus berdatangan tidak membuat kanal lain kelaparan), lalu fase
    // giliran, lalu sisanya. Setiap cabang dieksekusi HANYA bila fits().
    const ordered: CronPhase[] = [];
    for (const d of storedDeferred) if (!ordered.includes(d)) ordered.push(d);
    if (!ordered.includes(storedPhase)) ordered.push(storedPhase);
    for (const p of ["expiry", "fulfillment", "notify", "cleanup"] as CronPhase[]) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    const activePhases = new Set(ordered.slice(0, 3)); // maks 3 fase/run
    for (const p of ordered.slice(3)) deferredOut.push(p);

    // Heater: jumlah item per order memengaruhi biaya fulfillment (3/item).
    // Dibaca SEKALI di awal (1 query) agar estimasi fits() akurat untuk
    // order multi-item, bukan asumsi 1 item/order.
    let avgItemsPerJob = 1;
    try {
      const avgRow = await queryFirst(
        `SELECT AVG(c) AS a FROM (SELECT COUNT(*) AS c FROM fulfillment_items WHERE status IN ('queued','retry') GROUP BY order_code)`,
      );
      avgItemsPerJob = Math.max(1, Math.min(8, Math.round(Number(avgRow?.a ?? 1))));
      budget.charge(1);
    } catch { /* default 1 */ }
    const costPerJob = COST_PER_JOB_BASE + COST_PER_JOB_ITEM * avgItemsPerJob;

    // === FASE EXPIRY: stale-init + expired + stranded + manual-WA ===
    // Daftar expiry selalu dibaca (4 query) — murah dan menjadi dasar
    // keputusan deferred yang jujur. Eksekusi per order memeriksa fits()
    // satu per satu agar tidak pernah melewati budget di tengah loop.
    let staleInit: Record<string, unknown>[] = [];
    let expiredCandidates: Record<string, unknown>[] = [];
    let strandedCandidates: Record<string, unknown>[] = [];
    let manualCandidates: Record<string, unknown>[] = [];
    let expiryListed = false;
    if (activePhases.has("expiry") && budget.fits(4)) {
      staleInit = await queryAll(
        `SELECT pt.order_code, o.items FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
         LIMIT ?`,
        EXPIRY_PER_RUN,
      );
      expiredCandidates = await queryAll(
        `SELECT pt.order_code, pt.provider_order_id, pt.merchant_id, pt.expires_at, pt.status, o.items, o.telegram_chat_id
         FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status='pending'
         LIMIT ?`,
        EXPIRY_PER_RUN * 2,
      );
      budget.charge(4);
      expiryListed = true;
    } else if (pendingExpiry > 0) {
      deferredOut.push("expiry");
    }
    let staleTransitions = 0;
    for (const tx of staleInit) {
      if (!budget.fits(COST_PER_EXPIRY)) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
        break;
      }
      const order = { items: tx.items };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          budget.charge(COST_PER_EXPIRY);
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "initializing",
            transactionStatus: "failed",
            orderStatus: "dibatalkan",
            paymentStatus: "failed",
            items,
            lastError: "stale_initializing",
          });
          if (changed) staleTransitions++;
        } catch { /* ok */ }
      }
    }
    results.stale_initializing = staleTransitions;

    // 2. Expired payments (evaluasi JS atas ISO kanonis — lihat komentar lama).
    const expiredPayments = expiredCandidates
      .filter((tx) => isExpiredIso(tx.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredTransitions = 0;
    for (const tx of expiredPayments) {
      if (!budget.fits(COST_PER_EXPIRY)) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
        break;
      }
      const order = { items: tx.items, telegram_chat_id: tx.telegram_chat_id };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          budget.charge(COST_PER_EXPIRY);
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "pending",
            transactionStatus: "expired",
            orderStatus: "kadaluarsa",
            paymentStatus: "expired",
            items,
          });
          if (!changed) continue;
          expiredTransitions++;
        } catch { /* ok */ }
      }
      // Notify buyer
      if (order?.telegram_chat_id) {
        try {
          await sendMessage({
            chat_id: String(order.telegram_chat_id),
            text: orderExpiredMessage(String(tx.order_code)),
            parse_mode: "HTML",
          });
        } catch { /* best-effort */ }
      }
    }
    results.expired_payments = expiredTransitions;

    // 2a. Safe repair stranded ledger (no-op untuk pending/paid sejati).
    // Dieksekusi hanya bila budget cukup; baris stranded aman menunggu run
    // berikutnya (deferred jujur di bawah).
    const expirySpent = staleTransitions + expiredTransitions;
    if (expiryListed && expirySpent < EXPIRY_PER_RUN && budget.fits(1)) {
      strandedCandidates = await queryAll(
        `SELECT pt.order_code, pt.status AS tx_status, o.items
         FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status IN ('pending','initializing')
           AND o.status IN ('kadaluarsa','dibatalkan')
         LIMIT ?`,
        EXPIRY_PER_RUN,
      );
      budget.charge(1);
    } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
      deferredOut.push("expiry");
    }
    let repairedLegacy = 0;
    for (const row of strandedCandidates) {
      if (!budget.fits(COST_PER_EXPIRY)) break;
      try {
        const items = JSON.parse(String(row.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        budget.charge(COST_PER_EXPIRY);
        const changed = await transitionPendingPaymentOrder({
          orderCode: String(row.order_code),
          expectedTransactionStatus: String(row.tx_status) === "initializing" ? "initializing" : "pending",
          transactionStatus: String(row.tx_status) === "initializing" ? "failed" : "expired",
          orderStatus: "kadaluarsa",
          paymentStatus: "expired",
          items,
          lastError: "legacy_expiry_repair",
        });
        // transitionPendingPaymentOrder guards on a pending order, so for
        // already-terminal orders close just the stranded ledger row: its
        // status is still non-terminal, therefore still pinning the amount.
        if (!changed) {
          const closed = await execRun(
            `UPDATE payment_transactions
             SET status=?, last_error='legacy_expiry_repair', updated_at=datetime('now')
             WHERE order_code=? AND status=?`,
            String(row.tx_status) === "initializing" ? "failed" : "expired",
            String(row.order_code),
            String(row.tx_status),
          );
          if (closed.changes) repairedLegacy++;
        } else {
          repairedLegacy++;
        }
      } catch { /* keep the repair best-effort; next run retries */ }
    }
    results.repaired_legacy_expiry = repairedLegacy;

    // 2b. Manual WhatsApp rails have no transaction ledger but still reserve
    // variant stock. Expire them from the order TTL as well. Publish-scheduled
    // covers every pending web/manual order; this leg only handles the
    // WhatsApp subset and shares the same guarded transition, so whichever
    // cron reaches an order first wins and the other becomes a no-op.
    // 2b. Manual WhatsApp rails (tanpa ledger): expire dari TTL order.
    // Hanya bila fase expiry aktif DAN budget cukup untuk daftar.
    if (activePhases.has("expiry") && expiryListed && budget.fits(1)) {
      manualCandidates = await queryAll(
        `SELECT o.code, o.items, o.expires_at
         FROM orders o
         WHERE o.sales_channel='whatsapp' AND o.status='pending'
           AND o.expires_at IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
         LIMIT ?`,
        EXPIRY_PER_RUN * 2,
      );
      budget.charge(1);
    }
    const expiredManualWhatsApp = manualCandidates
      .filter((order) => isExpiredIso(order.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredStaticCount = 0;
    for (const order of expiredManualWhatsApp) {
      if (!budget.fits(COST_PER_EXPIRY)) break;
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        budget.charge(COST_PER_EXPIRY);
        await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
        expiredStaticCount++;
      } catch { /* another worker may have transitioned it */ }
    }
    results.expired_manual_whatsapp_orders = expiredStaticCount;

    // Sinyal deferred expiry jujur: masih ada sisa antrean setelah batas.
    if (pendingExpiry > staleTransitions + expiredTransitions + repairedLegacy + expiredStaticCount) {
      if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
    }

    // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
    if (activePhases.has("notify") && pendingNotify > 0) {
      if (budget.fits(COST_PER_NOTIFICATION * Math.min(FULFILLMENT_PER_RUN, pendingNotify) + 2)) {
        const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN);
        budget.charge(2 + COST_PER_NOTIFICATION * (telegramNotifications.created + telegramNotifications.paid + telegramNotifications.paidAdmin));
        results.telegram_order_notifications_retried = telegramNotifications.created;
        results.telegram_paid_notifications_retried = telegramNotifications.paid;
        results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;
      } else {
        deferredOut.push("notify");
      }
    } else if (pendingNotify > 0 && !activePhases.has("notify")) {
      deferredOut.push("notify");
    }

    if (activePhases.has("notify")) {
      if (budget.fits(2 + COST_PER_NOTIFICATION * FULFILLMENT_PER_RUN)) {
        const reminders = await sendPendingOrderReminders(FULFILLMENT_PER_RUN);
        budget.charge(2 + COST_PER_NOTIFICATION * reminders);
        results.telegram_pending_reminders_sent = reminders;
      } else if (!deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }
    }

    // 3c. Antrean WhatsApp idempoten: recovery lease + kirim. Fase notify;
    // budget dihitung per baris aktual (COST_PER_WA_ROW).
    if (activePhases.has("notify") && pendingWa > 0) {
      const waUnits = Math.min(FULFILLMENT_PER_RUN, pendingWa);
      if (budget.fits(2 + waUnits * COST_PER_WA_ROW)) {
        try {
          const waOutbox = await processDueWhatsAppOutbox(FULFILLMENT_PER_RUN);
          budget.charge(2 + (waOutbox.sent + waOutbox.dead + (waOutbox.recovered ?? 0)) * COST_PER_WA_ROW);
          results.whatsapp_outbox_sent = waOutbox.sent;
          results.whatsapp_outbox_dead = waOutbox.dead;
          results.whatsapp_outbox_recovered = waOutbox.recovered ?? 0;
          results.whatsapp_outbox_claim_errors = waOutbox.claimErrors ?? 0;
        } catch { /* antrean bertahan; cron berikutnya retry */ }
        const waLeft = pendingWa - (Number(results.whatsapp_outbox_sent) + Number(results.whatsapp_outbox_dead));
        if (waLeft > 0 && !deferredOut.includes("notify")) deferredOut.push("notify");
      } else if (!deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }
    } else if (pendingWa > 0 && !deferredOut.includes("notify")) {
      deferredOut.push("notify");
    }

    // === FASE FULFILLMENT: orphan + backfill + due jobs + stale locks ===
    if (activePhases.has("fulfillment")) {
      const jobUnits = Math.min(FULFILLMENT_PER_RUN, Math.max(pendingJobs, 1));
      if (budget.fits(3 + jobUnits * costPerJob)) {
        results.fulfillment_orphans_healed = await reconcileMissingFulfillmentJobs(FULFILLMENT_PER_RUN);
        budget.charge(1);
        results.fulfillment_items_backfilled = await backfillMissingFulfillmentItems(FULFILLMENT_PER_RUN);
        budget.charge(1);
        if (process.env.AUTO_FULFILLMENT_ENABLED === "true") {
          const dueJobs = await getDueJobs(FULFILLMENT_PER_RUN);
          budget.charge(1);
          let processed = 0;
          for (const job of dueJobs) {
            if (!budget.fits(costPerJob)) {
              if (!deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
              break;
            }
            const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
            if (!order) continue;
            const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number }[];
            if (!items.length) continue;
            const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
            if (!product) continue;
            try {
              await ensureFulfillmentItems(order).catch(() => {});
              await processJob(Number(job.id), order, product);
            } catch { /* individual job failure doesn't stop batch */ }
            budget.charge(costPerJob);
            processed++;
          }
          results.due_jobs_processed = processed;
          if (pendingJobs > processed && !deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
        }
      } else if (pendingJobs > 0 && !deferredOut.includes("fulfillment")) {
        deferredOut.push("fulfillment");
      }
    } else if (pendingJobs > 0 && !deferredOut.includes("fulfillment")) {
      deferredOut.push("fulfillment");
    }

    // 5. Release stale job locks (fase fulfillment; murah, 2 query).
    if (activePhases.has("fulfillment") && budget.fits(2)) {
      results.stale_locks_released = await releaseStaleJobs();
      budget.charge(2);
    } else if (pendingStale > 0 && !deferredOut.includes("fulfillment")) {
      deferredOut.push("fulfillment");
    }

    // === FASE CLEANUP: ringan, jalan tiap run bila budget sisa ===
    if (budget.fits(4)) {
      const expiredSessions = await execRun(
        `DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`,
      );
      const oldInboxEvents = await execRun(
        `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
      );
      await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);
      budget.charge(3);
      // Cleanup revokasi sesi kedaluwarsa (R8): anggaran cron yang sama.
      await execRun(`DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')`)
        .catch(() => ({ changes: 0 as number | undefined }));
      budget.charge(1);
      results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
        + Number(oldInboxEvents.changes || 0);
    } else if (!deferredOut.includes("cleanup")) {
      deferredOut.push("cleanup");
    }

    // Tulis fase berikutnya + deferred untuk run selanjutnya (dalam budget:
    // 2 query; bila tidak cukup, fase tetap maju di memori run ini saja).
    if (budget.fits(2)) {
      const rotated = nextPhase(storedPhase);
      await writeCronPhase(activePhases.has(rotated) ? nextPhase(rotated) : rotated, deferredOut);
      budget.charge(2);
    }
    results.query_budget_used = budget.used;
    results.query_budget_limit = QUERY_BUDGET;
    if (deferredOut.length > 0) results.deferred = deferredOut;

  } catch (error) {
    console.error("Cron operations error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...results, error: "partial_failure" }, { status: 500 });
  }

  const deferredList = results.deferred as string[] | undefined;
  if (deferredList && deferredList.length > 0) {
    return NextResponse.json({ ok: true, ...results, note: "partial_run_more_pending" });
  }
  return NextResponse.json({ ok: true, ...results });
}
