// src/lib/cron/lite/jobs/tg-webhook.ts — tg_webhook job body
// (3A-8e, class E: pure move, no behavior change).
//
// BEFORE: the tg_webhook branch lived inline in
// src/app/api/cron/lite/route.ts. AFTER: `run(ctx)` owns the verbatim
// body and returns a discriminated outcome; the route keeps the 503
// serialization (`{ ...result, ok: false, error }`) before the generic
// marker. Import order (webhook-guard, then service-health), the single
// guard call, health admission, and error selection are preserved.

import { saveServiceHealth, type LiteContext } from "@/lib/cron/lite/context";

export type TgWebhookOutcome =
  | { kind: "done" }
  | { kind: "failed"; error: string | undefined };

export async function run(ctx: LiteContext): Promise<TgWebhookOutcome> {
  const { db, result } = ctx;
  const { guardTelegramWebhook } = await import("@/lib/telegram/webhook-guard");
  const { TG_WEBHOOK_HEALTH_KEY } = await import("@/lib/service-health");
  const guard = await guardTelegramWebhook(db);
  Object.assign(result, guard);
  // A successful reinstall is not proof of recovery. Let the next
  // getWebhookInfo confirm the URL/backlog before resetting the soft alarm.
  const failed = guard.status !== "skipped" && guard.status !== "healthy" && guard.status !== "recovered";
  if (guard.status !== "skipped" && db.canSpend(1)) {
    await saveServiceHealth(db, TG_WEBHOOK_HEALTH_KEY, JSON.stringify({
      error: failed ? guard.status : null,
      pending: guard.pending_update_count ?? null,
    }));
  }
  if (failed) return { kind: "failed", error: guard.error || guard.status };
  return { kind: "done" };
}
