import { describe, expect, it, vi } from "vitest";
import { run } from "@/lib/cron/phases/notify";
import type { OperationsContext } from "@/lib/cron/operations-context";

const sendQris = vi.hoisted(() => vi.fn(async () => ({ sent: 1 })));
vi.mock("@/lib/payments/qris-expiry-notifications", async (original) => {
  const actual = await original<typeof import("@/lib/payments/qris-expiry-notifications")>();
  return { ...actual, sendQrisExpiryNotifications: sendQris };
});

// 3C notify regression: QRIS admission requires budget.fits(5). With
// pending notice, active notify, and time available but headroom < 5,
// the sender must not run and `notify` is deferred exactly once.
describe("notify QRIS admission gate", () => {
  it("defers without sending when budget headroom is below fits(5)", async () => {
    sendQris.mockClear();
    // Route results skeleton carries expired_payments before phases run.
    const results: Record<string, unknown> = { expired_payments: 0 };
    const deferredOut: string[] = [];
    const ctx = {
      budget: { fits: (n: number) => n < 5 },
      database: {},
      results,
      deferredOut,
      activePhases: new Set(["notify"]),
      hasTime: () => true,
      counts: {
        pendingQrisNotice: 1, pendingNotify: 0, pendingCreated: 0, pendingPaid: 0,
        pendingPaidAdmin: 0, pendingPaidAdminWeb: 0, pendingPinEmail: 0,
        pendingWa: 0, pendingStaleWa: 0, waWorkPending: 0,
      },
    } as unknown as OperationsContext;
    await run(ctx);
    expect(sendQris).not.toHaveBeenCalled();
    expect(deferredOut).toEqual(["notify"]);
    expect(results.qris_expiry_notifications).toBeUndefined();
  });
});
