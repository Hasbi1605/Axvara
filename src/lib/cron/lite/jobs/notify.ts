// src/lib/cron/lite/jobs/notify.ts — notify a/b/combined job bodies (3A-3,
// class E: pure move, no behavior change).
//
// BEFORE: `runNotifyA(db, deadline, failedCore)`, `runNotifyB(...)` and the
// combined `runNotify(...)` lived inline in src/app/api/cron/lite/route.ts.
// AFTER: this module exports `run(ctx, which)` with the verbatim bodies. The
// route dispatches via dynamic `await import("@/lib/cron/lite/jobs/notify")`
// inside each branch, so the dispatcher keeps its `if/else` + `await import()`
// shape (§3.6) and adds no static heavy imports: this module's own static
// imports are only db-access (budget throw) and the `LiteContext` type —
// every payload (invoice-retry, order-notifications, access-email,
// whatsapp promo/promo-bot/outbox, qris-expiry, restock-alerts) stays behind
// the original `await import()`s, in the same order. `ctx` carries db,
// deadline, result, failedCore. Ordering inside notify_b is verbatim
// (notably `checkout_pin_emails` BEFORE `whatsapp_outbox`), as are the
// `guard(key, fn, core)` failure semantics (failedCore push, sanitized error),
// deadline math, marker path (generic tail in route), and result keys/order:
// notify = runNotifyB then runNotifyA via Object.assign — B wins ties the
// same way, A keys appended after.

import { QueryBudgetExceeded } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";

export type NotifyWhich = "notify_a" | "notify_b" | "notify";

export async function run(ctx: LiteContext, which: NotifyWhich): Promise<Record<string, unknown>> {
  const { db, deadline } = ctx;
  if (which === "notify_a") return runNotifyA(ctx);
  if (which === "notify_b") return runNotifyB(ctx);
  const out = await runNotifyBInternal(db, deadline, ctx.failedCore);
  return Object.assign(out, await runNotifyAInternal(db, deadline, ctx.failedCore));
}

type Db = LiteContext["db"];

const makeGuard = (out: Record<string, unknown>, failedCore: string[]) =>
  async (key: string, fn: () => Promise<unknown>, core = false) => {
    try { out[key] = await fn(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out[`${key}_error`] = error instanceof Error ? error.message.slice(0, 80) : "failed";
      if (core) failedCore.push(key);
    }
  };

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
async function runNotifyA(ctx: LiteContext): Promise<Record<string, unknown>> {
  return runNotifyAInternal(ctx.db, ctx.deadline, ctx.failedCore);
}

async function runNotifyAInternal(db: Db, deadline: number, failedCore: string[]) {
  const out: Record<string, unknown> = {};
  const guard = makeGuard(out, failedCore);
  await guard("invoice_retry", async () => {
    const { retryInvoicePendingTelegramInvoices } = await import("@/lib/telegram/invoice-retry");
    // At most one slow photo plus ambiguity notice, or one slow text retry,
    // before yielding. Stop if this is the combined job and time is short.
    const invoiceDeadline = Math.min(deadline, Date.now() + 37_000);
    return retryInvoicePendingTelegramInvoices(25, db, ms => Date.now() + ms <= invoiceDeadline);
  });
  await guard("telegram_retry", async () => {
    const { retryPendingTelegramNotifications } = await import("@/lib/telegram/order-notifications");
    return retryPendingTelegramNotifications(50, undefined, db, ms => Date.now() + ms <= deadline);
  }, true);
  return out;
}

async function runNotifyB(ctx: LiteContext): Promise<Record<string, unknown>> {
  return runNotifyBInternal(ctx.db, ctx.deadline, ctx.failedCore);
}

async function runNotifyBInternal(db: Db, deadline: number, failedCore: string[]) {
  const out: Record<string, unknown> = {};
  const guard = makeGuard(out, failedCore);
  const hasTime = (ms: number) => Date.now() + ms <= deadline;
  // cleanup has no Worker alarm; feed its durable failure into the monitored
  // notify step without delaying either buyer lane or sending another alert.
  await guard("maintenance_cleanup", async () => {
    if (await db.queryFirst(`SELECT 1 FROM store_settings WHERE key='cleanup_recovery_last_error'`)) {
      throw new Error("maintenance_cleanup_failed");
    }
    return "ok";
  }, true);
  // Protect both buyer lanes from Telegram. PIN gets up to 18s; WA runs next
  // and only claims when the send and its existing anti-ban delay fit.
  const pinDeadline = Math.min(deadline, Date.now() + 18_000);
  await guard("checkout_pin_emails", async () => {
    if (!db.canSpend(10)) return { skipped: "query_budget" };
    const { processCredentialAccessEmails } = await import("@/lib/orders/access-email");
    return processCredentialAccessEmails(db, 15, undefined, { hasTime: ms => Date.now() + ms <= pinDeadline });
  });
  // Promo only enqueues in D1; keep it ahead of the outbox drain for the same tick.
  await guard("whatsapp_promo", async () => {
    const { enqueueWhatsAppPromo } = await import("@/lib/whatsapp/promo-digest");
    return enqueueWhatsAppPromo(db);
  });
  await guard("whatsapp_promo_bot", async () => {
    const { enqueueWhatsAppPromoBot } = await import("@/lib/whatsapp/promo-bot");
    return enqueueWhatsAppPromoBot(db);
  });
  await guard("whatsapp_outbox", async () => {
    const { processDueWhatsAppOutbox } = await import("@/lib/whatsapp/outbox");
    return processDueWhatsAppOutbox(4, db, hasTime);
  }, true);
  await guard("qris_expiry_notices", async () => {
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    return sendQrisExpiryNotifications(15, db, { hasTime: () => hasTime(11_000) });
  });
  await guard("pending_reminders", async () => {
    const { sendPendingOrderReminders } = await import("@/lib/telegram/order-notifications");
    return sendPendingOrderReminders(50, db, hasTime);
  });
  await guard("restock_alerts", async () => {
    const { processDueRestockAlerts } = await import("@/lib/telegram/restock-alerts");
    return processDueRestockAlerts(db, 50, hasTime);
  });
  return out;
}
