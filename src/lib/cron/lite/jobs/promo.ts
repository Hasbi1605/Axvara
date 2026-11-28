// src/lib/cron/lite/jobs/promo.ts — `promo` job body (3A-2 diff 1, class E:
// pure move, no behavior change).
//
// BEFORE: `runPromo(db)` lived inline in src/app/api/cron/lite/route.ts.
// AFTER: this module exports `run(ctx)` with the verbatim body. The route
// dispatches via dynamic `await import("@/lib/cron/lite/jobs/promo")` inside
// the branch, so the dispatcher keeps its `if/else` + `await import()` shape
// (§3.6) and adds no static heavy imports: this module's own static imports
// are exactly db-access (budget/query), db (types), and the lite context
// type — every job payload (promo-broadcast, daily-admin-summary, broadcasts
// queue/worker) stays behind the original `await import()`s. `ctx` carries
// db + result + failedCore + deadline so the nested broadcast budget built
// from `unwrapD1(db.getD1())` keeps working verbatim.

import { createBudgetedDatabase, QueryBudgetExceeded, unwrapD1 } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";

export async function run(ctx: LiteContext): Promise<Record<string, unknown>> {
  const { db } = ctx;
  const started = Date.now();
  const { enqueueDueTelegramPromo } = await import("@/lib/telegram/promo-broadcast");
  const promo = await enqueueDueTelegramPromo(db);
  let daily_summary: Record<string, unknown> = {};
  if (db.canSpend(1)) {
    try {
      const { sendDueDailyAdminSummary } = await import("@/lib/telegram/daily-admin-summary");
      const summary = await sendDueDailyAdminSummary(db);
      daily_summary = {
        due: summary.due,
        sent: summary.sent,
        ...(summary.skipped ? { skipped: summary.skipped } : {}),
        ...(summary.date ? { date: summary.date } : {}),
      };
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      daily_summary = { due: false, sent: false, error: "summary_failed" };
    }
  }
  // Pemantau kesehatan userbot channel: no-op tanpa mode userbot; selain itu
  // gerbang memo isolate + interval 30 menit (1 baca + 1 tulis per cek).
  let userbot_watch: Record<string, unknown> | undefined;
  if (process.env.TELEGRAM_CHANNEL_USERBOT_ENABLED === "true" && db.canSpend(2)) {
    try {
      const { watchUserbotHealth } = await import("@/lib/telegram/channel-sender-status");
      const watch = await watchUserbotHealth(db);
      if (watch.checked) userbot_watch = { state: watch.state, ...(watch.alerted ? { alerted: watch.alerted } : {}) };
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      userbot_watch = { error: "watch_failed" };
    }
  }
  // Paid: broadcast backstop gets its own generous 400-statement budget and ~40s
  // wall-time envelope separate from the 300-statement promo/summary DB.
  const broadcastDb = createBudgetedDatabase(400, 4, unwrapD1(db.getD1())).access;
  const { BROADCAST_BACKSTOP_GRACE_MS, isBroadcastQueueActive } = await import("@/lib/broadcasts/queue");
  const queueActive = await isBroadcastQueueActive(broadcastDb);
  const remainingMs = Math.max(0, 40_000 - (Date.now() - started));
  const { processBroadcasts } = await import("@/lib/broadcasts/worker");
  const broadcasts =
    remainingMs > 0
      ? await processBroadcasts(broadcastDb, 150, remainingMs, {
          queueGraceMs: queueActive ? BROADCAST_BACKSTOP_GRACE_MS : 0,
        })
      : null;
  return {
    broadcasts,
    promo_due: promo.due,
    promo_enqueued: promo.enqueued,
    promo_skipped: promo.skipped ?? null,
    ...(promo.queuedMessages ? { promo_queued_messages: promo.queuedMessages } : {}),
    daily_summary,
    ...(userbot_watch ? { userbot_watch } : {}),
  };
}
