import { describe, expect, it } from "vitest";
import { initialSchedule, isStalePromotion, promoteStalePhase, OPERATIONS_STALE_PROMOTION_MS } from "@/lib/cron/scheduling";
import type { CronPhase } from "@/lib/cron/phase-state";

// 3C scheduling parity: both stale promotions on one rotation, applied in
// route order (WR first, then SK against the updated sets), fulfillment
// protected throughout. Mirrors the old inline semantics exactly.
describe("scheduling promotion parity", () => {
  it("applies WR then SK promotion with exact ordered/active/deferred outcome", () => {
    const deferredOut: CronPhase[] = [];
    const { ordered, activePhases } = initialSchedule(
      { forcedPhase: null, storedPhase: "expiry", storedDeferred: [], pendingJobs: 1, pendingSkAny: 1, skEnabled: true },
      deferredOut,
    );
    expect(ordered.slice(0, 3)).toEqual(["expiry", "fulfillment", "warung_rebahan"]);
    promoteStalePhase(ordered, activePhases, deferredOut, "warung_rebahan", true);
    // WR was already active: only the front move applies.
    expect(ordered[0]).toBe("warung_rebahan");
    promoteStalePhase(ordered, activePhases, deferredOut, "sekalipay", false);
    // SK victim = last non-fulfillment, non-SK active (expiry, after WR
    // front move); fulfillment is never the victim.
    expect([...activePhases].sort()).toEqual(["fulfillment", "sekalipay", "warung_rebahan"]);
    expect(activePhases.has("fulfillment")).toBe(true);
    expect(deferredOut).toContain("expiry");
    expect(deferredOut).not.toContain("sekalipay");
  });

  it("keeps the null-timestamp promotion without consulting staleness math", () => {
    const now = Date.now();
    expect(isStalePromotion(now - OPERATIONS_STALE_PROMOTION_MS - 1, now)).toBe(true);
    expect(isStalePromotion(now, now)).toBe(false);
    const lastTs: number | null = null;
    expect(lastTs == null || isStalePromotion(lastTs, now)).toBe(true);
  });
});
