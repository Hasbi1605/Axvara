/**
 * Pre-send failures that keep the sealed buyer input so admin retry can work.
 * Single source for PIXELVERIF_RETRYABLE_SQL (orders.ts), settle() purge and
 * the purge sweep. Separate module so purge.ts does not import orders.ts (cycle).
 *
 * `price_increased` is deliberately NOT retryable here: dispatch compares
 * live price against the immutable order snapshot (`credit_cost`), so generic
 * retry without an approved cap repeats the failure. It goes to manual/refund.
 */
export const PIXELVERIF_RETRYABLE_ERRORS: ReadonlySet<string> = new Set([
  "service_unavailable", "insufficient_credits", "credits_unavailable", "preflight_unavailable",
]);

/** Hard upper bound for keeping sealed paid-order buyer inputs before purge. */
export const PIXELVERIF_INPUT_MAX_AGE_HOURS = 24;
