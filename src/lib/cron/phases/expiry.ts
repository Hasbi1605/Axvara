// src/lib/cron/phases/expiry.ts — operations expiry phase (3C expiry,
// class E: pure move, no behavior change).
//
// BEFORE: `runExpiry` + `expiryCost` lived inline in
// src/app/api/cron/operations/route.ts. AFTER: `run(ctx)` owns the
// verbatim body; the route dispatch returns this promise directly.
// Multiline SQL, gates, caps, mutation points and deferred accounting
// are unchanged; notify still reads results.expired_payments.

import { FAST_EXPIRY_RAILS_SQL, STALE_INITIALIZING_SQL } from "@/lib/payments/stale-initializing";
import { transitionPendingOrder as rawTransitionPendingOrder, transitionPendingPaymentOrder as rawTransitionPendingPaymentOrder } from "@/lib/db";
import { isExpiredIso } from "@/lib/expiry";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import type { OperationsContext } from "@/lib/cron/operations-context";

const EXPIRY_PER_RUN = 30;
const TIME_SINGLE_MESSAGE = 3_000;

// Expiry restores each distinct product/variant inside one atomic batch.
// Charge its real size, rather than assuming every order contains one item.
function expiryCost(raw: unknown): number {
  try {
    const items = JSON.parse(String(raw ?? "[]")) as { product_id: number; variant_id?: number }[];
    return 6 + new Set(items.map((i) => i.variant_id ? `v:${i.variant_id}` : `p:${i.product_id}`)).size;
  } catch { return 6; }
}

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut, activePhases, hasTime } = ctx;
  const { pendingExpiry, pendingExpiryAny, pendingExpiryManualWa } = ctx.counts;
  const { queryAll, execRun } = database;

      let marketRestocked = false;
      const onMarketChanged = () => { marketRestocked = true; };
      const expiryOpts = { onMarketChanged };
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
           WHERE ${STALE_INITIALIZING_SQL} AND o.status='pending'
           LIMIT ?`,
          EXPIRY_PER_RUN,
        );
        expiredCandidates = await queryAll(
          `SELECT pt.order_code, pt.provider, pt.provider_order_id, pt.merchant_id,
                  COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at) AS expires_at,
                  pt.status, o.items, o.telegram_chat_id
           FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status='pending'
             AND julianday(COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at))<=julianday('now')
           ORDER BY julianday(COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at)) ASC
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

            const changed = await rawTransitionPendingPaymentOrder({
              orderCode: String(tx.order_code),
              expectedTransactionStatus: "initializing",
              staleInitializingOnly: true,
              transactionStatus: "failed",
              orderStatus: "dibatalkan",
              paymentStatus: "failed",
              items,
              lastError: "stale_initializing",
            }, database.d1, expiryOpts);
            if (changed) staleTransitions++;
          } catch { /* ok */ }
        }
      }
      results.stale_initializing = staleTransitions;

      // 2. A dead QR may be renewed while its order still owns the stock.
      // Close DANA ledger + order only at the ORDER deadline (legacy fallback:
      // invoice deadline when the order has none). Keep the JS check as well.
      const expiredPayments = expiredCandidates
        .filter((tx) => isExpiredIso(tx.expires_at))
        .slice(0, EXPIRY_PER_RUN);
      let expiredTransitions = 0;
      for (const tx of expiredPayments) {
        if (!budget.fits(expiryCost(tx.items))) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
        // Deadline: transisi DB murah, tetapi cabang non-DANA mengirim pesan
        // Telegram (10 s timeout) — jangan mulai bila waktu tidak cukup.
        if (!hasTime(TIME_SINGLE_MESSAGE)) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
        const order = { items: tx.items, telegram_chat_id: tx.telegram_chat_id };
        if (order) {
          try {
            const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

            const changed = await rawTransitionPendingPaymentOrder({
              orderCode: String(tx.order_code),
              expectedTransactionStatus: "pending",
              transactionStatus: "expired",
              expiredOnly: true,
              orderStatus: "kadaluarsa",
              paymentStatus: "expired",
              items,
            }, database.d1, expiryOpts);
            if (!changed) continue;
            expiredTransitions++;
            if (tx.provider !== "dana" && order.telegram_chat_id) {
              await sendMessage({ chat_id: String(order.telegram_chat_id),
                text: orderExpiredMessage(String(tx.order_code)), parse_mode: "HTML" }).catch(() => {});
            }
          } catch { /* ok */ }
        }

      }
      results.expired_payments = expiredTransitions;

      // 2a. Safe repair stranded ledger (no-op untuk pending/paid sejati).
      // Dieksekusi hanya bila budget cukup; baris stranded aman menunggu run
      // berikutnya (deferred jujur di bawah).
      const expirySpent = staleTransitions + expiredTransitions;
      if (expiryListed && expirySpent < EXPIRY_PER_RUN && budget.fits(1)) {
        strandedCandidates = await queryAll(
          `SELECT pt.order_code, pt.status AS tx_status
           FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status IN ('pending','initializing')
             AND o.status IN ('kadaluarsa','dibatalkan')
             AND ${FAST_EXPIRY_RAILS_SQL}
           LIMIT ?`,
          EXPIRY_PER_RUN,
        );

      } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
        deferredOut.push("expiry");
      }
      // Deklarasi dipulihkan (terpotong saat edit RR4-06): loop stranded di bawah.
      let repairedLegacy = 0;
      for (const row of strandedCandidates) {
        if (!budget.fits(1)) break;
        try {
          // Never touch stock for a terminal order. Recheck the rail and order
          // under the write; known charges stay available for late review.
          const closed = await execRun(
            `UPDATE payment_transactions AS pt
               SET status=?, last_error='legacy_expiry_repair', updated_at=datetime('now')
               WHERE order_code=? AND status=? AND ${FAST_EXPIRY_RAILS_SQL}
                 AND EXISTS(SELECT 1 FROM orders o WHERE o.code=pt.order_code AND o.status IN ('kadaluarsa','dibatalkan'))`,
            String(row.tx_status) === "initializing" ? "failed" : "expired",
            String(row.order_code),
            String(row.tx_status),
          );
          if (closed.changes) repairedLegacy++;
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

          await rawTransitionPendingOrder(String(order.code), "kadaluarsa", null, items, database.d1, expiryOpts);
          expiredStaticCount++;
        } catch { /* another worker may have transitioned it */ }
      }
      results.expired_manual_whatsapp_orders = expiredStaticCount;

      if (marketRestocked && budget.fits(1)) {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("market", database, { metered: true });
      }

      // Sinyal deferred expiry jujur: masih ada sisa antrean setelah batas
      // (semua jenis: pending + init-basi + manual-WA — RR4-06).
      if (pendingExpiryAny > staleTransitions + expiredTransitions + repairedLegacy + expiredStaticCount) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
      }
}
