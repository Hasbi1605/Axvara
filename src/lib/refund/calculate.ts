export const DAY = 86400;
const WIB = 7 * 3600;
export const MARKET_INVOICE = /^AXV-\d{8}-[A-Z0-9]{8}$/;

/** Calendar months/years end on the same WIB clock time, clamped at month-end. */
export function termEnd(start: number, value: number, unit: string): number | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(value) || value < 1) return null;
  if (unit === "day" && value <= 36600) return start + value * DAY;
  const months = unit === "year" ? value * 12 : value;
  if (!["month", "year"].includes(unit) || months > 1200) return null;
  const date = new Date((start + WIB) * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  const end = date.getTime() / 1000 - WIB;
  return Number.isSafeInteger(end) && end > start ? end : null;
}

export function wibInputSeconds(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const local = Date.parse(`${value}Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, value.length) !== value) return null;
  return local / 1000 - WIB;
}

export function prorata(price: number, remaining: number, total: number, rate = 10000): number {
  const denominator = BigInt(total) * BigInt(10000);
  const numerator = BigInt(price) * BigInt(Math.max(0, Math.min(remaining, total))) * BigInt(rate);
  return Number((numerator + denominator / BigInt(2)) / denominator);
}

export type EstimateLine = {
  id: number; name: string; unit: number | null; unitTotal: number | null; qty: number; price: number;
  start: number | null; end: number | null; warrantyEnd: number | null; duration: number | null;
  remaining: number | null; rate: number; claim: number | null; amount: number | null;
  status: "ready" | "waiting" | "review" | "no_warranty" | "warranty_ended" | "ended";
};

export type Estimate = { state: "ready" | "unpaid" | "refunded" | "review"; asOf: number; lines: EstimateLine[] };
export type SharedEstimate = Estimate & { expires: number; locale: "id" | "en" };

export function estimateLine(row: Record<string, unknown>, now: number): EstimateLine {
  const start = row.started_at == null ? null : Number(row.started_at);
  const claim = row.claimed_at == null ? null : Number(row.claimed_at);
  const asOf = claim ?? now;
  const qty = Number(row.qty);
  const price = Number(row.price) * qty;
  const rate = Number(row.rate_bps);
  const end = start == null ? null : termEnd(start, Number(row.duration_value), String(row.duration_unit));
  const duration = start != null && end != null ? end - start : null;
  const remaining = end != null && duration != null ? Math.max(0, Math.min(end - asOf, duration)) : null;
  const noWarranty = row.warranty_type === "none";
  const lifetime = row.warranty_unit === "lifetime";
  const warrantyEnd = start == null || noWarranty || lifetime ? null : termEnd(start, Number(row.warranty_value), String(row.warranty_unit));
  const status = start == null ? "waiting" : noWarranty ? "no_warranty"
    : duration == null || (!lifetime && warrantyEnd == null) || !Number.isSafeInteger(price) || !Number.isSafeInteger(rate) || rate < 0 || rate > 10000 || asOf < start ? "review"
    : remaining === 0 ? "ended" : warrantyEnd != null && asOf >= warrantyEnd ? "warranty_ended" : "ready";
  return {
    id: Number(row.item_index), name: String(row.name), unit: row.unit_number == null ? null : Number(row.unit_number),
    unitTotal: row.unit_total == null ? null : Number(row.unit_total), qty, price, start, end, warrantyEnd, duration, remaining, rate, claim,
    status, amount: status === "ready" && remaining != null && duration != null ? prorata(price, remaining, duration, rate) : null,
  };
}
