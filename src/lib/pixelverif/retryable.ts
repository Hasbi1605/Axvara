/**
 * Pre-send failures that keep the sealed buyer input so admin retry can work.
 * Single source for PIXELVERIF_RETRYABLE_SQL (orders.ts), settle() purge and
 * the purge sweep. Separate module so purge.ts does not import orders.ts (cycle).
 */
export const PIXELVERIF_RETRYABLE_ERRORS: ReadonlySet<string> = new Set([
  "service_unavailable", "insufficient_credits", "credits_unavailable", "price_increased", "preflight_unavailable",
]);
