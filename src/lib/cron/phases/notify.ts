// src/lib/cron/phases/notify.ts — operations notify phase (3C notify,
// class E: pure move, no behavior change).
//
// BEFORE: `runNotify` lived inline in src/app/api/cron/operations/route.ts.
// AFTER: `run(ctx)` owns the verbatim body; the route dispatch returns
// this promise directly. Order (QRIS -> Telegram -> invoice retry ->
// reminders -> WA -> PIN), gates, caps, catches and result order are
// unchanged. Queue-probe WHERE constants stay in the route.

import { sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";
import { retryPendingTelegramNotifications, sendPendingOrderReminders } from "@/lib/telegram/order-notifications";
import { retryInvoicePendingTelegramInvoices } from "@/lib/telegram/invoice-retry";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";
import type { OperationsContext } from "@/lib/cron/operations-context";

// Ambang waktu minimum sebelum memulai satu unit kerja jaringan. Workers Paid:
// 12 dtk -> 4 dtk; per-item `hasTime` tetap dijaga supaya batch berhenti rapi
// sebelum deadline 45 dtk, bukan melewatkan seluruh fase.
const TIME_TELEGRAM_BATCH = 4_000;
// Satu kabar kedaluwarsa: Telegram timeout 10 dtk, email 8 dtk.
const TIME_EXPIRY_NOTICE = 10_000;
const TIME_WA_BATCH = 12_000;
const FULFILLMENT_PER_RUN = 20;
const WA_OUTBOX_PER_RUN = 4;
const COST_PER_WA_ROW = 5;
const COST_PER_WA_RECOVERY = 2;

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut, activePhases, hasTime } = ctx;
  const {
    pendingQrisNotice, pendingNotify, pendingCreated, pendingPaid, pendingPaidAdmin,
    pendingPaidAdminWeb, pendingPinEmail, pendingWa, pendingStaleWa, waWorkPending,
  } = ctx.counts;

      // Invoice-expired notice and terminal notice survive delivery failures.
      const noticeCount = pendingQrisNotice + Number(results.expired_payments);
      if (activePhases.has("notify") && noticeCount > 0 && budget.fits(5) && hasTime(TIME_TELEGRAM_BATCH)) {
        const notices = await sendQrisExpiryNotifications(15, database, { hasTime: () => hasTime(TIME_EXPIRY_NOTICE) });
        results.qris_expiry_notifications = notices.sent;
        if (noticeCount > Number(results.qris_expiry_notifications) && !deferredOut.includes("notify")) deferredOut.push("notify");
      } else if (noticeCount > 0 && !deferredOut.includes("notify")) deferredOut.push("notify");
      // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
      // RR3-09: retry notifikasi mencakup created + paid buyer + paid admin
      // (hitung pendingNotify di atas = ketiganya). Daftar dibaca HANYA bila
      // fase notify aktif DAN antrean jenis itu > 0 (RR3-01: tanpa guard ini,
      // 3 list kosong × tiap run = 12 query baca yang mengusir job kirim).
      // Biaya konservatif: 1 list + per order 4 (baca+validasi+kirim+tandai).
      if (activePhases.has("notify") && pendingNotify > 0) {
        // Workers Paid: the per-item budget check below is the real bound;
        // do not pre-reject the whole batch by an assumed unit count when the
        // queue size is unknown.
        if (hasTime(TIME_TELEGRAM_BATCH)) {
          const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN, {
            created: pendingCreated > 0, paid: pendingPaid > 0, paidAdmin: pendingPaidAdmin > 0, paidAdminWeb: pendingPaidAdminWeb > 0,
          }, database, hasTime);

          results.telegram_order_notifications_retried = telegramNotifications.created;
          results.telegram_paid_notifications_retried = telegramNotifications.paid;
          results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;
          results.telegram_paid_admin_web_notifications_retried = telegramNotifications.paidAdminWeb;
        } else {
          deferredOut.push("notify");
        }
      } else if (pendingNotify > 0 && !activePhases.has("notify")) {
        deferredOut.push("notify");
      }

      // RR3-05: sapu invoice Telegram yang fotonya belum sampai (marker
      // telegram_invoice_sent_at IS NULL + ledger pending). Satu foto ulang
      // per order, tanpa order/invoice/reservasi/stok kedua. Workers Paid:
      // cap 12 -> 25; the per-order canSpend guard inside bounds the run.
      if (activePhases.has("notify")) {
        if (hasTime(TIME_TELEGRAM_BATCH)) {
          try {
            const invoiceSent = await retryInvoicePendingTelegramInvoices(25, database);

            results.telegram_invoice_retried = invoiceSent;
          } catch { /* cron berikutnya retry */ }
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      }

      if (activePhases.has("notify")) {
        if (hasTime(TIME_TELEGRAM_BATCH)) {
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
        const waUnits = Math.min(WA_OUTBOX_PER_RUN, Math.max(pendingWa, pendingStaleWa > 0 ? 1 : 0));
        if (budget.fits(COST_PER_WA_RECOVERY + waUnits * COST_PER_WA_ROW) && hasTime(TIME_WA_BATCH)) {
          try {
            const waOutbox = await processDueWhatsAppOutbox(WA_OUTBOX_PER_RUN, database);

            results.whatsapp_outbox_sent = waOutbox.sent;
            results.whatsapp_outbox_dead = waOutbox.dead;
            results.whatsapp_outbox_recovered = waOutbox.recovered ?? 0;
            results.whatsapp_outbox_claim_errors = waOutbox.claimErrors ?? 0;
            results.whatsapp_outbox_paused = waOutbox.paused ?? 0;
          } catch { /* antrean bertahan; cron berikutnya retry */ }
          const waLeft = pendingWa - (Number(results.whatsapp_outbox_sent) + Number(results.whatsapp_outbox_dead));
          if ((waLeft > 0 || pendingStaleWa > Number(results.whatsapp_outbox_recovered)) && !deferredOut.includes("notify")) deferredOut.push("notify");
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      } else if (waWorkPending > 0 && !deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }

      // Sapu bounded antrean PIN checkout (maks 15, jeda 1 dtk antaremail) bila fase notify
      // aktif dan budget/waktu tersisa; tanpa job/trigger/budget baru.
      if (pendingPinEmail > 0 && activePhases.has("notify") && budget.fits(10) && hasTime(9_000)) {
        try {
          const { processCredentialAccessEmails } = await import("@/lib/orders/access-email");
          const pin = await processCredentialAccessEmails(database, 15, undefined, { hasTime });
          results.checkout_pin_emails_sent = pin.sent;
          results.checkout_pin_emails_failed = pin.failed;
        } catch { if (!deferredOut.includes("notify")) deferredOut.push("notify"); }
      }
}
