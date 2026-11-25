import type { DatabaseAccess } from "@/lib/db-access";
import type { PixelverifMarkupUpdateInput } from "./markup";
import { parsePixelverifObservedPlans, PIXELVERIF_OBSERVED_PLANS_KEY, pixelverifObservedKey } from "./observed-plans";
import { isValidPixelverifMarkup, PIXELVERIF_DEFAULT_MARKUP_PERCENT, pixelverifSellPriceIdr } from "./pricing";

export const PIXELVERIF_PLAN_ADMIN_PREFIX = "pixelverif_plan_admin:";

export function resolvePixelverifMarkupId(id: string) {
  const canonical = id === "PV-NORMAL-3" ? "normal_3" : id === "PV-FULL-3" ? "full_3" : id;
  const match = /^(normal|full)_([1-9][0-9]{0,2})$/.exec(canonical);
  if (!match || Number(match[2]) > 120) return null;
  return { key: canonical, flow: match[1], validity: Number(match[2]) };
}

export function observedMarkupFields(value: unknown, cost: number | null, fx: number | null) {
  let prefs: PixelverifMarkupUpdateInput = {};
  if (typeof value === "string") {
    try { prefs = JSON.parse(value) ?? {}; } catch { /* default for unreadable settings */ }
  }
  const markup = isValidPixelverifMarkup(prefs.markup_percent) ? prefs.markup_percent : PIXELVERIF_DEFAULT_MARKUP_PERCENT;
  const manual = typeof prefs.admin_price_idr === "number" && Number.isInteger(prefs.admin_price_idr) &&
    prefs.admin_price_idr > 0 && prefs.admin_price_idr <= 1e9 ? prefs.admin_price_idr : null;
  let price = manual;
  if (price == null && cost != null && fx != null) {
    try { price = pixelverifSellPriceIdr(cost, fx, markup); } catch { /* unavailable formula price */ }
  }
  return { markup_percent: markup, admin_price_idr: manual, pixel_admin_active: prefs.is_active === true, variant_price: price };
}

/** Update only previously observed IDs that have no mirror, regardless of stock/FX. */
export async function saveObservedPixelverifMarkup(
  db: DatabaseAccess,
  ids: string[],
  { markup_percent, admin_price_idr, is_active }: PixelverifMarkupUpdateInput,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const snapshot = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", PIXELVERIF_OBSERVED_PLANS_KEY);
  const known = new Set(parsePixelverifObservedPlans(snapshot?.value).map(plan => pixelverifObservedKey(plan.flow, plan.months)));
  const eligible = [...new Set(ids.filter(id => known.has(id)))];
  if (!eligible.length) return new Set();

  // One atomic partial merge (including bulk). An omitted field keeps its value;
  // explicit null removes the manual override. Never update storefront tables.
  const patch = JSON.stringify({ markup_percent, admin_price_idr, is_active });
  const written = await db.queryAll(
    `INSERT INTO store_settings(key,value,updated_at)
     SELECT ? || target.value, json_patch('{}', ?), datetime('now')
     FROM json_each(?) target
     WHERE NOT EXISTS (SELECT 1 FROM pixelverif_services s WHERE s.service_key=target.value)
     ON CONFLICT(key) DO UPDATE SET
       value=json_patch(CASE WHEN json_valid(store_settings.value) THEN store_settings.value ELSE '{}' END, ?),
       updated_at=excluded.updated_at
     RETURNING key`,
    PIXELVERIF_PLAN_ADMIN_PREFIX, patch, JSON.stringify(eligible), patch,
  );
  return new Set(written.map(row => String(row.key).slice(PIXELVERIF_PLAN_ADMIN_PREFIX.length)));
}
