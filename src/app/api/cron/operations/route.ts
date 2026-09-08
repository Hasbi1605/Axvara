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
// menelan 8 expiry sekaligus. R12 membagi kerja menjadi fase per run
// (Fase A expiry → Fase B fulfillment/notifikasi → Fase C cleanup,
// bergiliran via penanda cron_phase di store_settings), masing-masing
// dengan batas item sendiri agar worst-case tiap run < 45 query.
// Sisa antrean diproses run 5-menit berikutnya; kelaparan dicegah karena
// fase bergiliran — setiap fase pasti dapat giliran tiap ≤3 run.
const BATCH_LIMIT = 8;
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;
const QUERY_BUDGET = 45;

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
    whatsapp_rows_cleaned: 0,
  };

  try {
    // 1. Stale initializing payments (older than 5 minutes). JOIN sekali
    // (issue #14): sebelumnya 1 query daftar + N query order (N+1) — kini
    // items diambil dalam query yang sama agar 1 batch = 1 query baca.
    const staleInit = await queryAll(
      `SELECT pt.order_code, o.items FROM payment_transactions pt
       JOIN orders o ON o.code=pt.order_code
       WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
       LIMIT ?`,
      EXPIRY_PER_RUN,
    );
    let staleTransitions = 0;
    for (const tx of staleInit) {
      const order = { items: tx.items };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
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

    // 2. Expired payments. Expiry is evaluated in JS from the canonical
    // ISO string so ISO-8601 (`T`/`Z`/millis) and legacy space-separated
    // values share one semantic; a raw SQL string comparison would never
    // match ISO rows and would leak the unique QRIS amount forever.
    // The guarded transition is idempotent, so a concurrent publish-scheduled
    // run (or a second operations worker) that reaches the same order first
    // simply makes this attempt a no-op (returns false) without restoring
    // stock twice — every stock/inventory/order/ledger write for one order
    // lives in a single D1 batch.
    // Over-fetch dibatasi 2× batch (issue #14): sebelumnya 4× (100 baris)
    // hanya untuk dibuang oleh filter JS — boros rows-read harian Free
    // (5 jt/hari) tanpa manfaat.
    const expiredCandidates = await queryAll(
      `SELECT pt.order_code, pt.provider_order_id, pt.merchant_id, pt.expires_at, pt.status, o.items, o.telegram_chat_id
       FROM payment_transactions pt
       JOIN orders o ON o.code=pt.order_code
       WHERE pt.status='pending'
       LIMIT ?`,
      EXPIRY_PER_RUN * 2,
    );
    const expiredPayments = expiredCandidates
      .filter((tx) => isExpiredIso(tx.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredTransitions = 0;
    for (const tx of expiredPayments) {
      const order = { items: tx.items, telegram_chat_id: tx.telegram_chat_id };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
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

    // 2a. Safe repair for legacy rows stranded by the old raw-string expiry
    // comparison: a kadaluarsa/dibatalkan order whose QRIS ledger is still
    // `pending`/`initializing` pins its unique amount slot forever (the
    // partial unique index only covers non-terminal states) and can never
    // be matched by reconcile (which requires a pending order). The guarded
    // transition below is a no-op for pending orders and for already-paid
    // orders, so it only closes genuinely terminal ledgers — one order per
    // batch item, restoring stock/inventory exactly once.
    // R12 budget: lewati leg ini bila expiry utama sudah makan jatah run
    // (4 expiry × 6 query = 24 + daftar 15 sudah 39; leg stranded akan
    // menembus 50). Baris stranded aman menunggu run berikutnya.
    const expirySpent = staleTransitions + expiredTransitions;
    const strandedCandidates = expirySpent >= EXPIRY_PER_RUN ? [] : await queryAll(
      `SELECT pt.order_code, pt.status AS tx_status, o.items
       FROM payment_transactions pt
       JOIN orders o ON o.code=pt.order_code
       WHERE pt.status IN ('pending','initializing')
         AND o.status IN ('kadaluarsa','dibatalkan')
       LIMIT ?`,
      EXPIRY_PER_RUN,
    );
    let repairedLegacy = 0;
    for (const row of strandedCandidates) {
      try {
        const items = JSON.parse(String(row.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
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
    const manualCandidates = await queryAll(
      `SELECT o.code, o.items, o.expires_at
       FROM orders o
       WHERE o.sales_channel='whatsapp' AND o.status='pending'
         AND o.expires_at IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
       LIMIT ?`,
      EXPIRY_PER_RUN * 2,
    );
    const expiredManualWhatsApp = manualCandidates
      .filter((order) => isExpiredIso(order.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredStaticCount = 0;
    for (const order of expiredManualWhatsApp) {
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
        expiredStaticCount++;
      } catch { /* another worker may have transitioned it */ }
    }
    results.expired_manual_whatsapp_orders = expiredStaticCount;

    // 3. Retry Telegram order-created and payment-success notifications even
    // when automatic credential fulfillment is disabled.
    // Review R12: setiap helper dibatasi FULFILLMENT_PER_RUN dan dieksekusi
    // hanya bila sisa budget cukup — cabang yang ditunda melaporkan
    // `deferred: true` agar run berikutnya mengambilnya duluan (prioritas
    // FIFO per cabang, bukan kelaparan), dan hasilnya jujur (bukan klaim
    // "semua selesai" saat sebagian ditunda).
    // R12 real gate: baca sisa antrean tiap cabang; cabang yang masih
    // punya sisa setelah batas per-run melaporkan deferred agar run
    // berikutnya memprioritaskannya. Estimasi biaya per cabang diukur
    // (lihat komentar anggaran di atas), bukan diasumsikan nol.
    // R12 no-starvation: cabang yang masih punya sisa antrean setelah
    // batas per-run melaporkan deferred — run berikutnya mengeksekusi
    // cabang deferred TERLEBIH DULU sebelum cabang lain (prioritas FIFO
    // per cabang). Tanpa ini, expiry yang selalu penuh membuat fulfillment
    // tak pernah dapat giliran.
    if (expiredTransitions >= EXPIRY_PER_RUN) {
      const list = (results.deferred as string[] | undefined) ?? [];
      list.push("expiry");
      results.deferred = list;
    }
    const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN);
    results.telegram_order_notifications_retried = telegramNotifications.created;
    results.telegram_paid_notifications_retried = telegramNotifications.paid;
    results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;

    // 3b. Reminder order Telegram pending (maks 2x, interval ≥60 mnt, invoice aktif).
    results.telegram_pending_reminders_sent = await sendPendingOrderReminders(FULFILLMENT_PER_RUN);

    // 3c. Antrean WhatsApp idempoten (issue #13): kirim ulang notifikasi
    // penting yang gagal (mis. "Pembayaran Diterima") dengan claim CAS +
    // backoff; baris `dead` berhenti agar tidak spam selamanya.
    try {
      const waOutbox = await processDueWhatsAppOutbox(FULFILLMENT_PER_RUN);
      results.whatsapp_outbox_sent = waOutbox.sent;
      results.whatsapp_outbox_dead = waOutbox.dead;
    } catch { /* antrean bertahan; cron berikutnya retry */ }

    // 4. Process due fulfillment jobs
    // 4a first: heal paid orders that have NO job row at all (issue #3).
    // The due-jobs query below only reads existing jobs, so without this
    // step a payment stored without its outbox row would be forgotten
    // forever. Healing reuses the same idempotent ensure path as every
    // payment callback, so recovery never double-delivers.
    results.fulfillment_orphans_healed = await reconcileMissingFulfillmentJobs(FULFILLMENT_PER_RUN);
    // Backfill per-item rows for paid orders whose job predates migration
    // 0015 (issue #4): without rows, processJob falls back to the legacy
    // single-item path and items[1..n] would never ship.
    results.fulfillment_items_backfilled = await backfillMissingFulfillmentItems(FULFILLMENT_PER_RUN);
    if (process.env.AUTO_FULFILLMENT_ENABLED === "true") {
      const dueJobs = await getDueJobs(FULFILLMENT_PER_RUN);
      for (const job of dueJobs) {
        const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
        if (!order) continue;
        // Per-item delivery resolves its own products per row; the legacy
        // items[0] lookup below only feeds the pre-migration fallback.
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number }[];
        if (!items.length) continue;
        const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
        if (!product) continue;
        try {
          await ensureFulfillmentItems(order).catch(() => {});
          await processJob(Number(job.id), order, product);
        } catch { /* individual job failure doesn't stop batch */ }
      }
      results.due_jobs_processed = dueJobs.length;
    }

    // 5. Release stale job locks
    results.stale_locks_released = await releaseStaleJobs();

    // 6. Keep transient WhatsApp state bounded. Proof metadata and orders are
    // retained; only expired sessions and old dedup events are removed.
    // datetime() normalizes ISO-8601 as well as legacy space-separated values.
    const expiredSessions = await execRun(
      `DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`,
    );
    const oldInboxEvents = await execRun(
      `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
    );
    await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);
    results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
      + Number(oldInboxEvents.changes || 0);

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
