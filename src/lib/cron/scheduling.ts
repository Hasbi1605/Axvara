// src/lib/cron/scheduling.ts — operations phase scheduling policy
// (3C scheduling, class E: pure move of the pure policy; probes stay in
// the route).
//
// Owns: initial ordered selection (stored deferred dedup -> stored turn
// -> rotation), the 3-slot active set, spill into deferredOut, the
// fulfillment protection swap, WR/SK stale-promotion victim/front-move
// bookkeeping. Async freshness probes remain in the route and pass plain
// facts in, so statement order/time parsing stays exactly as before.

import type { CronPhase } from "./phase-state";

export const OPERATIONS_STALE_PROMOTION_MS = 45 * 60 * 1000;

export type SchedulingInputs = {
  forcedPhase: CronPhase | null;
  storedPhase: CronPhase;
  storedDeferred: CronPhase[];
  pendingJobs: number;
  pendingSkAny: number;
  skEnabled: boolean;
};

export type SchedulingOutcome = {
  ordered: CronPhase[];
  activePhases: Set<CronPhase>;
};

export function initialSchedule(inputs: SchedulingInputs, deferredOut: CronPhase[]): SchedulingOutcome {
  const { forcedPhase, storedPhase, storedDeferred } = inputs;
  const ordered: CronPhase[] = [];
  for (const d of storedDeferred) if (!ordered.includes(d)) ordered.push(d);
  if (!ordered.includes(storedPhase)) ordered.push(storedPhase);
  const skPhaseRelevant =
    inputs.skEnabled || inputs.pendingSkAny > 0 || ordered.includes("sekalipay");
  const rotation: CronPhase[] = skPhaseRelevant
    ? ["expiry", "fulfillment", "warung_rebahan", "sekalipay", "notify", "cleanup"]
    : ["expiry", "fulfillment", "warung_rebahan", "notify", "cleanup"];
  if (!forcedPhase) for (const p of rotation) {
    if (!ordered.includes(p)) ordered.push(p);
  }
  const activePhases = new Set<CronPhase>(forcedPhase ? [forcedPhase] : ordered.slice(0, 3)); // maks 3 fase/run
  for (const p of ordered.slice(3)) deferredOut.push(p);
  if (!forcedPhase && inputs.pendingJobs > 0 && !activePhases.has("fulfillment")) {
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
  return { ordered, activePhases };
}

/** True when a probed last-sync timestamp counts as stale (>45m).
 * Callers keep the old `lastTs == null ||` short-circuit so the clock is
 * not read for a missing timestamp, exactly as the inline code did. */
export function isStalePromotion(lastTs: number, now: number): boolean {
  return lastTs < now - OPERATIONS_STALE_PROMOTION_MS;
}

export function promoteStalePhase(
  ordered: CronPhase[],
  activePhases: Set<CronPhase>,
  deferredOut: CronPhase[],
  phase: "warung_rebahan" | "sekalipay",
  moveToFront: boolean,
): void {
  if (!activePhases.has(phase)) {
    const actives = ordered.filter((p) => activePhases.has(p));
    const victim = [...actives].reverse().find((p) => p !== "fulfillment" && p !== phase);
    if (victim) {
      activePhases.delete(victim);
      activePhases.add(phase);
      const idx = deferredOut.indexOf(phase);
      if (idx >= 0) deferredOut.splice(idx, 1);
      if (!deferredOut.includes(victim)) deferredOut.push(victim);
    }
  }
  if (moveToFront && activePhases.has(phase)) {
    const at = ordered.indexOf(phase);
    if (at > 0) {
      ordered.splice(at, 1);
      ordered.unshift(phase);
    }
  }
}
