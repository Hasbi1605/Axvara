// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import { transitionPendingOrder as rawTransitionPendingOrder, transitionPendingPaymentOrder as rawTransitionPendingPaymentOrder } from "@/lib/db";
import { createBudgetedDatabase, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { isExpiredIso } from "@/lib/expiry";
import {
  COST_PER_JOB_FRAME, COST_PER_DELIVERY_ITEM, COST_PER_ORPHAN_LIGHT,
  getDueJobs, ensureFulfillmentItems, processJobItems, reconcileOrphanLight, reconcileSettledJobs, releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import { retryPendingTelegramNotifications, sendPendingOrderReminders } from "@/lib/telegram/order-notifications";
import { retryInvoicePendingTelegramInvoices } from "@/lib/telegram/invoice-retry";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";

export const runtime = "edge";

// A request-scoped D1 wrapper counts all nested queries, including batch members.
// Budget 40 leaves ten queries of platform margin; two are reserved for phase state.
const QUERY_BUDGET = 40;
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;
const COST_PER_NOTIFICATION = 4;
const COST_PER_WA_ROW = 5;
const COST_PER_WA_RECOVERY = 2;
const COST_PER_STALE_RELEASE = 2;
const COST_PER_CLEANUP = 4;
const RESERVE_TAIL = 2;
type CronPhase = "expiry" | "fulfillment" | "notify" | "cleanup";

// Expiry restores each distinct product/variant inside one atomic batch.
// Charge its real size, rather than assuming every order contains one item.
function expiryCost(raw: unknown): number {
  try {
    const items = JSON.parse(String(raw ?? "[]")) as { product_id: number; variant_id?: number }[];
    return 6 + new Set(items.map((i) => i.variant_id ? `v:${i.variant_id}` : `p:${i.product_id}`)).size;
  } catch { return 6; }
}

async function readCronPhase(database: DatabaseAccess): Promise<{ phase: CronPhase; deferred: CronPhase[] }> {
  const { queryFirst } = database;
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

async function writeCronPhase(next: CronPhase, deferred: CronPhase[], database: DatabaseAccess): Promise<void> {
  const { execRun } = database;
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
    telegram_invoice_retried: 0,
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
    const budget = createBudgetedDatabase(QUERY_BUDGET, RESERVE_TAIL);
    const database = budget.access;
    const { queryAll, queryFirst, execRun } = database;
    const transitionPendingPaymentOrder = (input: Parameters<typeof rawTransitionPendingPaymentOrder>[0]) => rawTransitionPendingPaymentOrder(input, database.d1);
    const transitionPendingOrder = (code: string, status: "kadaluarsa", note: null, items: { product_id: number; variant_id?: number; qty: number }[]) => rawTransitionPendingOrder(code, status, note, items, database.d1);
    const deferredOut: CronPhase[] = [];
    const { phase: storedPhase, deferred: storedDeferred } = await readCronPhase(database);

    // Hitung antrean dalam SATU query gabungan (1 query, bukan 8 — RR3-01/
    // RR3-03): tiap COUNT adalah subselect murah atas indeks status. Tanpa
    // ini, 10 query baca di depan + heater + 3 scan = 14 query sebelum satu
    // pun item terkirim, sehingga order 4 item (23 query kirim) tak muat.
    // RR3-06: kandidat sending basi dihitung SENDIRI (bukan dari pending/
    // failed) agar recovery tidak bergantung pada hadirnya pesan baru.
    // RR3-09: antrean notifikasi dihitung per JENIS (created / paid buyer /
    // paid admin), bukan hanya marker order-created.
    const queueRow = await queryFirst(
      `SELECT
        (SELECT COUNT(*) FROM payment_transactions WHERE status='pending') AS expiry,
        (SELECT COUNT(*) FROM payment_transactions WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')) AS expiry_init,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='whatsapp' AND status='pending' AND expires_at IS NOT NULL
          AND datetime(expires_at) <= datetime('now')
          AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code)) AS expiry_manual_wa,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS wa,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))) AS wa_stale,
        (SELECT COUNT(*) FROM fulfillment_jobs WHERE status IN ('queued','retry')) AS jobs,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND telegram_order_notified_at IS NULL) AS created,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_notified_at IS NULL) AS paid,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_admin_notified_at IS NULL) AS paid_admin,
        (SELECT COUNT(*) FROM fulfillment_jobs WHERE status='sending') AS stale`,
    ).catch(() => null);
    const pendingExpiry = Number(queueRow?.expiry ?? 0);
    // RR4-06: sinyal expiry per JENIS — initializing basi dan manual-WA
    // kedaluwarsa dihitung SENDIRI, bukan dari ada/tidaknya pending lain.
    const pendingExpiryInit = Number((queueRow as Record<string, unknown> | null)?.expiry_init ?? 0);
    const pendingExpiryManualWa = Number((queueRow as Record<string, unknown> | null)?.expiry_manual_wa ?? 0);
    const pendingExpiryAny = pendingExpiry + pendingExpiryInit + pendingExpiryManualWa;
    const pendingWa = Number(queueRow?.wa ?? 0);
    const pendingStaleWa = Number(queueRow?.wa_stale ?? 0);
    const pendingJobs = Number(queueRow?.jobs ?? 0);
    const pendingCreated = Number(queueRow?.created ?? 0);
    const pendingPaid = Number(queueRow?.paid ?? 0);
    const pendingPaidAdmin = Number(queueRow?.paid_admin ?? 0);
    const pendingStale = Number(queueRow?.stale ?? 0);
    // pendingNotify = seluruh jenis pekerjaan notifikasi (RR3-09).
    const pendingNotify = pendingCreated + pendingPaid + pendingPaidAdmin;

    // Urutan eksekusi: deferred tersimpan dulu (anti-starvation — expiry
    // yang terus berdatangan tidak membuat kanal lain kelaparan), lalu fase
    // giliran, lalu sisanya. Setiap cabang dieksekusi HANYA bila fits().
    // RR3-01: fulfillment SELALU aktif tiap run selama ada job due
    // (pendingJobs > 0) — fase bergiliran tidak boleh membuat antrean
    // pengiriman tertunda selamanya sementara fase lain kosong/ringan.
    const ordered: CronPhase[] = [];
    for (const d of storedDeferred) if (!ordered.includes(d)) ordered.push(d);
    if (!ordered.includes(storedPhase)) ordered.push(storedPhase);
    for (const p of ["expiry", "fulfillment", "notify", "cleanup"] as CronPhase[]) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    const activePhases = new Set(ordered.slice(0, 3)); // maks 3 fase/run
    for (const p of ordered.slice(3)) deferredOut.push(p);
    if (pendingJobs > 0 && !activePhases.has("fulfillment")) {
      // Jamin satu slot fulfillment: geser fase non-fulfillment terakhir
      // (prioritas terendah) keluar menjadi deferred jujur.
      const actives = ordered.filter((p) => activePhases.has(p));
      const victim = [...actives].reverse().find((p) => p !== "fulfillment");
      if (victim) {
        activePhases.delete(victim);
        activePhases.add("fulfillment");
        const idx = deferredOut.indexOf("fulfillment");
        if (idx >= 0) deferredOut.splice(idx, 1);
        if (!deferredOut.includes(victim)) deferredOut.push(victim);
      }
    }

    const waWorkPending = pendingWa + pendingStaleWa;
    const runExpiry = async () => {
      // === FASE EXPIRY: stale-init + expired + stranded + manual-WA ===
      // Daftar expiry HANYA dibaca bila fase expiry aktif — pembacaan murah
      // pun (4 query) berarti satu job 2-item (16+ query) tak muat pada run
      // yang sama (RR3-01: 8 daftar × 30 query baca = antrean macet).
      // Keputusan deferred memakai COUNT antrean di atas (gratis, sudah
      // dibayar), bukan daftar yang belum dibaca.
      let staleInit: Record<string, unknown>[] = [];
      let expiredCandidates: Record<string, unknown>[] = [];
      let strandedCandidates: Record<string, unknown>[] = [];
      let manualCandidates: Record<string, unknown>[] = [];
      let expiryListed = false;
      // RR3-01: daftar dibaca HANYA bila fase expiry aktif DAN (ada sinyal
      // antrean ATAU belum pernah listing pada run ini dan budget longgar).
      // Tanpa guard ini, 4 daftar kosong tiap run mengusir satu job kirim.
      // RR4-06: sinyalnya per jenis (pending/init-basi/manual-WA) — initializing
      // basi dipulihkan walau tidak ada pending lain.
      const expiryDue = pendingExpiryAny > 0;
      if (activePhases.has("expiry") && expiryDue && budget.fits(4)) {
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

        expiryListed = true;
      } else if (pendingExpiryAny > 0) {
        deferredOut.push("expiry");
      }
      let staleTransitions = 0;
      for (const tx of staleInit) {
        if (!budget.fits(expiryCost(tx.items))) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
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

      // 2. Expired payments (evaluasi JS atas ISO kanonis — lihat komentar lama).
      const expiredPayments = expiredCandidates
        .filter((tx) => isExpiredIso(tx.expires_at))
        .slice(0, EXPIRY_PER_RUN);
      let expiredTransitions = 0;
      for (const tx of expiredPayments) {
        if (!budget.fits(expiryCost(tx.items))) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
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

      } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
        deferredOut.push("expiry");
      }
      // Deklarasi dipulihkan (terpotong saat edit RR4-06): loop stranded di bawah.
      let repairedLegacy = 0;
      for (const row of strandedCandidates) {
        if (!budget.fits(expiryCost(row.items))) break;
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
      // 2b. Manual WhatsApp rails (tanpa ledger): expire dari TTL order.
      // RR4-06: gerbangnya sinyal manual-WA SENDIRI (pendingExpiryManualWa),
      // bukan ada/tidaknya ledger pending lain.
      if (activePhases.has("expiry") && expiryListed && pendingExpiryManualWa > 0 && budget.fits(1)) {
        manualCandidates = await queryAll(
          `SELECT o.code, o.items, o.expires_at
           FROM orders o
           WHERE o.sales_channel='whatsapp' AND o.status='pending'
             AND o.expires_at IS NOT NULL
             AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
           LIMIT ?`,
          EXPIRY_PER_RUN * 2,
        );

      }
      const expiredManualWhatsApp = manualCandidates
        .filter((order) => isExpiredIso(order.expires_at))
        .slice(0, EXPIRY_PER_RUN);
      let expiredStaticCount = 0;
      for (const order of expiredManualWhatsApp) {
        if (!budget.fits(expiryCost(order.items))) break;
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

          await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
          expiredStaticCount++;
        } catch { /* another worker may have transitioned it */ }
      }
      results.expired_manual_whatsapp_orders = expiredStaticCount;

      // Sinyal deferred expiry jujur: masih ada sisa antrean setelah batas
      // (semua jenis: pending + init-basi + manual-WA — RR4-06).
      if (pendingExpiryAny > staleTransitions + expiredTransitions + repairedLegacy + expiredStaticCount) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
      }

    };
    const runNotify = async () => {
      // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
      // RR3-09: retry notifikasi mencakup created + paid buyer + paid admin
      // (hitung pendingNotify di atas = ketiganya). Daftar dibaca HANYA bila
      // fase notify aktif DAN antrean jenis itu > 0 (RR3-01: tanpa guard ini,
      // 3 list kosong × tiap run = 12 query baca yang mengusir job kirim).
      // Biaya konservatif: 1 list + per order 4 (baca+validasi+kirim+tandai).
      if (activePhases.has("notify") && pendingNotify > 0) {
        const units = Math.min(FULFILLMENT_PER_RUN, pendingNotify);
        if (budget.fits(1 + COST_PER_NOTIFICATION * units)) {
          const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN, {
            created: pendingCreated > 0, paid: pendingPaid > 0, paidAdmin: pendingPaidAdmin > 0,
          }, database);

          results.telegram_order_notifications_retried = telegramNotifications.created;
          results.telegram_paid_notifications_retried = telegramNotifications.paid;
          results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;
        } else {
          deferredOut.push("notify");
        }
      } else if (pendingNotify > 0 && !activePhases.has("notify")) {
        deferredOut.push("notify");
      }

      // RR3-05: sapu invoice Telegram yang fotonya belum sampai (marker
      // telegram_invoice_sent_at IS NULL + ledger pending). Satu foto ulang
      // per order, tanpa order/invoice/reservasi/stok kedua. Tunduk pada
      // budget yang sama (1 list + 4/order konservatif).
      if (activePhases.has("notify")) {
        if (budget.fits(1 + COST_PER_NOTIFICATION * 2)) {
          try {
            const invoiceSent = await retryInvoicePendingTelegramInvoices(2, database);

            results.telegram_invoice_retried = invoiceSent;
          } catch { /* cron berikutnya retry */ }
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      }

      if (activePhases.has("notify")) {
        if (budget.fits(1 + COST_PER_NOTIFICATION * FULFILLMENT_PER_RUN)) {
          const reminders = await sendPendingOrderReminders(FULFILLMENT_PER_RUN, database);

          results.telegram_pending_reminders_sent = reminders;
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      }

      // 3c. Antrean WhatsApp idempoten: recovery lease + kirim. Fase notify;
      // budget dihitung per baris aktual + biaya recovery mandiri (RR3-06).
      // RR3-06: recovery sending basi dijadwalkan MANDIRI — gerbangnya adalah
      // pendingWa > 0 ATAU pendingStaleWa > 0, bukan hanya pendingWa, sehingga
      // antrean yang seluruhnya sending basi tetap dipulihkan via entrypoint
      // cron (bukan hanya bila ada pesan pending/failed baru).
      if (activePhases.has("notify") && waWorkPending > 0) {
        const waUnits = Math.min(FULFILLMENT_PER_RUN, Math.max(pendingWa, pendingStaleWa > 0 ? 1 : 0));
        if (budget.fits(COST_PER_WA_RECOVERY + waUnits * COST_PER_WA_ROW)) {
          try {
            const waOutbox = await processDueWhatsAppOutbox(FULFILLMENT_PER_RUN, database);

            results.whatsapp_outbox_sent = waOutbox.sent;
            results.whatsapp_outbox_dead = waOutbox.dead;
            results.whatsapp_outbox_recovered = waOutbox.recovered ?? 0;
            results.whatsapp_outbox_claim_errors = waOutbox.claimErrors ?? 0;
          } catch { /* antrean bertahan; cron berikutnya retry */ }
          const waLeft = pendingWa - (Number(results.whatsapp_outbox_sent) + Number(results.whatsapp_outbox_dead));
          if ((waLeft > 0 || pendingStaleWa > Number(results.whatsapp_outbox_recovered)) && !deferredOut.includes("notify")) deferredOut.push("notify");
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      } else if (waWorkPending > 0 && !deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }

    };
    const runFulfillment = async () => {
      // Materialization and delivery are resumable units in the same request budget.
      if (activePhases.has("fulfillment")) {
        if (pendingStale > 0 && budget.fits(COST_PER_STALE_RELEASE)) {
          results.stale_locks_released = await releaseStaleJobs(database);
        }
        if (budget.fits(1 + COST_PER_ORPHAN_LIGHT)) {
          const orphans = await queryAll(
            `SELECT o.code FROM orders o LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
             WHERE o.status='lunas' AND o.payment_status='paid' AND fj.order_code IS NULL
             ORDER BY o.created_at ASC LIMIT ?`, FULFILLMENT_PER_RUN,
          );
          for (const orphan of orphans) {
            if (!budget.fits(COST_PER_ORPHAN_LIGHT)) { deferredOut.push("fulfillment"); break; }
            try { if (await reconcileOrphanLight(String(orphan.code), database)) results.fulfillment_orphans_healed = Number(results.fulfillment_orphans_healed) + 1; }
            catch { deferredOut.push("fulfillment"); }
          }
        }
        if (budget.fits(5)) results.fulfillment_aggregates_repaired = await reconcileSettledJobs(2, database);
        if (budget.fits(1)) {
          const jobs = process.env.AUTO_FULFILLMENT_ENABLED === "true"
            ? await getDueJobs(FULFILLMENT_PER_RUN, database)
            : await queryAll(
              `SELECT fj.* FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code
               WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid'
                 AND (fj.locked_until IS NULL OR datetime(fj.locked_until)<datetime('now'))
                 AND (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code)
                   < json_array_length(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END)
               ORDER BY fj.created_at ASC, fj.id ASC LIMIT ?`, FULFILLMENT_PER_RUN,
            );
          for (const job of jobs) {
            if (!budget.fits(2 + COST_PER_JOB_FRAME + COST_PER_DELIVERY_ITEM)) { deferredOut.push("fulfillment"); break; }
            const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
            if (!order) continue;
            // processJobItems resolves each item's product; no eager products scan.
            try {
              if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") {
                // Populate the admin queue in bounded steps, without dispatching.
                await ensureFulfillmentItems(order, database, 2);
                continue;
              }
              const unit = await processJobItems(Number(job.id), order, {}, 2, undefined, database);
              if (unit.done || unit.attempted > 0) results.due_jobs_processed = Number(results.due_jobs_processed) + 1;
              if (!unit.finished && !["not_owned", "not_paid", "no_work"].includes("reason" in unit ? unit.reason : "")) deferredOut.push("fulfillment");
            } catch { deferredOut.push("fulfillment"); }
          }
          if (jobs.length >= FULFILLMENT_PER_RUN) deferredOut.push("fulfillment");
        }
      } else if (pendingJobs > 0 || pendingStale > 0) deferredOut.push("fulfillment");

    };
    const runCleanup = async () => {
      // === FASE CLEANUP: ringan, jalan tiap run bila budget sisa ===
      // RR3-01: JANGAN paksakan cleanup tiap run — 4 query kosong tiap run =
      // setengah item kirim. Cleanup jalan bila (a) tidak ada pekerjaan
      // fulfillment/notify yang menunggu, ATAU (b) budget tersisa longgar
      // (sisa ≥ 10 setelah cadangan ekor). Deferred cleanup adalah normal,
      // bukan kegagalan.
      const fulfilOrNotifyWaiting = pendingJobs > 0 || pendingNotify > 0 || waWorkPending > 0 || pendingExpiryAny > 0;
      if (!fulfilOrNotifyWaiting && budget.fits(COST_PER_CLEANUP)) {
        const expiredSessions = await execRun(
          `DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`,
        );
        const oldInboxEvents = await execRun(
          `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
        );
        await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);

        // Cleanup revokasi sesi kedaluwarsa (R8): anggaran cron yang sama.
        await execRun(`DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')`)
          .catch(() => ({ changes: 0 as number | undefined }));

        results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
          + Number(oldInboxEvents.changes || 0);
      } else if (!deferredOut.includes("cleanup")) {
        deferredOut.push("cleanup");
      }

    };
    const phases = { expiry: runExpiry, notify: runNotify, fulfillment: runFulfillment, cleanup: runCleanup };
    // Execute in the persisted priority order, so busy expiry cannot always
    // consume the budget before a deferred delivery or notification gets a turn.
    for (const phase of ordered) {
      try { await phases[phase](); }
      catch (error) {
        if (!(error instanceof QueryBudgetExceeded)) throw error;
        deferredOut.push(phase);
      }
    }

    // Tail cannot be consumed by helpers: two final statements are reserved.
    budget.beginTail();
    const deferred = [...new Set(deferredOut)];
    await writeCronPhase(nextPhase(storedPhase), deferred, database);
    results.query_budget_used = budget.used;
    results.query_budget_limit = QUERY_BUDGET;
    results.query_budget_note = "submitted_statements_including_batch_members";
    if (deferred.length > 0) results.deferred = deferred;

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
