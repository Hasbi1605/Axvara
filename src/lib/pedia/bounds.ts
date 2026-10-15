/** Supplier API limits intersect the curated service's documented constraints.
 * Product chips never define the allowed quantities. */
export function pediaBounds(live: Record<string, unknown>, tier: Record<string, unknown>, productStep = 1) {
  if (![Number(live.min_qty), Number(live.max_qty)].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  const min = Math.max(Number(live.min_qty), Number(tier.min_qty_override) || 1);
  const max = Math.min(Number(live.max_qty), Number(tier.max_qty_override) || Number(live.max_qty));
  const a = Number(productStep) || 1;
  const b = Number(tier.quantity_step) || 1;
  const gcd = (x: number, y: number): number => y ? gcd(y, x % y) : x;
  if (![min, max, a, b].every((n) => Number.isSafeInteger(n) && n > 0) || max < min || a > 100000 || b > 100000) return null;
  const step = a / gcd(a, b) * b;
  if (!Number.isSafeInteger(step) || Math.ceil(min / step) * step > max) return null;
  return { min, max, step };
}
