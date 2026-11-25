import type { PixelverifPricing } from "./client";

export const PIXELVERIF_OBSERVED_PLANS_KEY = "pixelverif_observed_plans";

type Flow = "normal" | "full";
type Plan = {
  flow: Flow;
  months: number;
  cost: number | null;
  state: "available" | "disabled" | "unlisted";
};

const validFlow = (v: unknown): v is Flow => v === "normal" || v === "full";
// Bound the history in store_settings; the feed describes subscriptions in months.
const validMonths = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120;
const positiveCost = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function pixelverifObservedKey(flow: Flow, months: number) {
  return `${flow}_${months}`;
}

export function parsePixelverifObservedPlans(value: unknown): Plan[] {
  if (typeof value !== "string" || value.length > 40_000) return [];
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows)) return [];
    const plans = new Map<string, Plan>();
    for (const row of rows) {
      if (!row || !validFlow(row.flow) || !validMonths(row.months) ||
        (row.state !== "available" && row.state !== "disabled" && row.state !== "unlisted")) continue;
      const cost = positiveCost(row.cost) ? row.cost : null;
      if (row.state === "available" && cost === null) continue;
      plans.set(pixelverifObservedKey(row.flow, row.months), { flow: row.flow, months: row.months, cost, state: row.state });
    }
    return [...plans.values()];
  } catch {
    return [];
  }
}

export function observePixelverifPlans(pricing: PixelverifPricing, previous: unknown): Plan[] {
  const plans = new Map<string, Plan>();
  for (const plan of parsePixelverifObservedPlans(previous)) {
    plans.set(pixelverifObservedKey(plan.flow, plan.months), { ...plan, state: "unlisted" });
  }
  const allowed = new Set(pricing.allowed_validities);
  const disabled = new Set(pricing.disabled_plans);
  for (const flow of ["normal", "full"] as const) {
    const costs = pricing.pricing[flow] ?? {};
    for (const [rawMonths, cost] of Object.entries(costs)) {
      const months = Number(rawMonths);
      if (!validMonths(months) || String(months) !== rawMonths) continue;
      const key = pixelverifObservedKey(flow, months);
      const available = positiveCost(cost) && allowed.has(months) && !disabled.has(`${flow}:${months}`);
      plans.set(key, { flow, months, cost: positiveCost(cost) ? cost : plans.get(key)?.cost ?? null, state: available ? "available" : "disabled" });
    }
  }
  for (const value of disabled) {
    const match = /^(normal|full):([1-9][0-9]{0,2})$/.exec(value);
    const flow = match?.[1], months = Number(match?.[2]);
    if (!validFlow(flow) || !validMonths(months)) continue;
    const key = pixelverifObservedKey(flow, months);
    plans.set(key, { flow, months, cost: plans.get(key)?.cost ?? null, state: "disabled" });
  }
  return [...plans.values()].sort((a, b) => a.months - b.months || a.flow.localeCompare(b.flow));
}
