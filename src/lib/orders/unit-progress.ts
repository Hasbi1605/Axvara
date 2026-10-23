import { queryFirst } from "@/lib/db";
import { expandDeliveryLines } from "@/lib/fulfillment/units";

export async function readUniqueUnitProgress(order: { code?: unknown; status?: unknown; items?: unknown }) {
  if (order.status !== "lunas") return undefined;
  const units = expandDeliveryLines(order.items).filter(line => line.unique_units === true);
  if (units.length <= 1) return undefined;
  const row = await queryFirst("SELECT COUNT(*) AS n FROM fulfillment_items WHERE order_code=? AND fulfillment_mode='unique' AND status='delivered' AND delivered_ciphertext IS NOT NULL", order.code);
  return { ready: Math.min(units.length, Number(row?.n || 0)), total: units.length };
}
