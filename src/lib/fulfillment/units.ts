// Public shopping lines keep their quantity. Only new, server-tagged unique
// lines expand into one durable fulfillment item per credential. Extra units
// are appended so original item indexes (including supplier links) stay stable.
export const MAX_UNIQUE_UNITS_PER_ORDER = 10;
export type DeliveryLine = Record<string, unknown>;

export function markUniqueUnitLines<T extends { variant_id?: unknown; qty?: unknown }>(items: T[], uniqueIds: ReadonlySet<number>): T[] {
  const total = items.reduce((n, item) => n + (uniqueIds.has(Number(item.variant_id)) ? Number(item.qty) : 0), 0);
  if (!Number.isSafeInteger(total) || total > MAX_UNIQUE_UNITS_PER_ORDER) throw new Error("unique_quantity_limit");
  return items.map(item => uniqueIds.has(Number(item.variant_id))
    ? { ...item, fulfillment_mode: "unique", unique_units: true }
    : item);
}

export function expandDeliveryLines(raw: unknown): DeliveryLine[] {
  let items: unknown;
  try { items = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]")); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const extra: DeliveryLine[] = [];
  const first = items.map((entry): DeliveryLine => {
    const line = entry && typeof entry === "object" ? entry as DeliveryLine : {};
    const qty = Number(line.qty ?? 1);
    if (line.unique_units !== true || line.fulfillment_mode !== "unique" || !Number.isSafeInteger(qty) || qty < 1 || qty > MAX_UNIQUE_UNITS_PER_ORDER) return line;
    for (let unit=2; unit<=qty; unit++) extra.push({ ...line, qty: 1, unit_number: unit, unit_total: qty });
    return { ...line, qty: 1, unit_number: 1, unit_total: qty };
  });
  return [...first, ...extra];
}
