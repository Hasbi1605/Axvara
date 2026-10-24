import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";

export const SALES_CONFIG_KEY = "whatsapp_sales_notifications";
export const SALES_BOT_NUMBER = "6283181632507";
export const SALES_GROUP_NAME = "AXVARA'S";
export type SalesConfig = { enabled: boolean; enabledAt: string; groupId: string };
export async function readSalesConfig(db: DatabaseAccess): Promise<SalesConfig | null> {
  const row = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", SALES_CONFIG_KEY);
  try {
    const value = JSON.parse(String(row?.value ?? "null"));
    return value && typeof value.enabled === "boolean" && /^\d+(-\d+)?@g\.us$/.test(value.groupId)
      && Number.isFinite(Date.parse(value.enabledAt)) ? value : null;
  } catch { return null; }
}

type Row = Record<string, unknown>;
function safeCatalogText(value: unknown): string {
  return String(value ?? "").replace(/https?:\/\/\S+|[^\s@]+@[^\s@]+|\+?\d[\d\s()-]{8,}\d/g, "[disamarkan]")
    .replace(/[\r\n*`_~]/g, " ").trim().slice(0, 100);
}

export function salesNotificationMessage(order: Row, completedAt: string, publicRef: string): string {
  let items: Row[] = [];
  try { const value = JSON.parse(String(order.items ?? "[]")); if (Array.isArray(value)) items = value; } catch { /* invalid orders are rejected by scanner */ }
  const channel = ({ web: "WEB", telegram: "TELEGRAM", whatsapp: "WHATSAPP" } as Record<string, string>)[String(order.sales_channel)] || "WEB";
  const first = String(order.customer_name ?? "").trim().slice(0, 1);
  const buyer = /^[\p{L}]$/u.test(first) ? first.toUpperCase() + "***" : "P***";
  // Never include order code, contacts, account contents, target, supplier or a buyer access link.
  return [
    `🎉 *PESANAN BERHASIL DIPROSES - ${channel}*`, "━━━━━━━━━━━━━━━━━━━━", "",
    ...items.flatMap(item => [`📦 ${safeCatalogText(item.name) || "Produk digital"}`,
      ...(item.variant_label ? [`↳ Varian: ${safeCatalogText(item.variant_label)}`] : []),
      `↳ Jumlah: ${Math.max(1, Math.floor(Number(item.qty) || 1))} item`,
      `↳ Harga: ${formatRupiah(Number(item.price) || 0)}`]),
    "", "*Rincian Transaksi*", `🧾 Referensi: ${publicRef}`,
    `👤 Pembeli: ${buyer}`, `💰 Harga produk: ${formatRupiah(Number(order.subtotal) || 0)}`,
    `💳 Total bayar: ${formatRupiah(Number(order.payable_amount ?? order.subtotal) || 0)}`,
    `💠 Pembayaran: ${safeCatalogText(order.payment_method || "qris").toUpperCase()}`,
    "", "✅ *Status: SELESAI*",
    `🗓 ${formatWibDateTime(completedAt, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} WIB`,
    "", "Terima kasih telah berbelanja di AXVARA 🤍", "🌐 axvara.tech",
  ].join("\n");
}

/** Bounded sweep on the existing notify tick; no customer traffic or supplier purchase. */
export async function enqueueCompletedSales(limit = 4, db = createDatabaseAccess()): Promise<number> {
  if (!db.getD1() || !db.canSpend(2)) return 0;
  const config = await readSalesConfig(db);
  if (!config?.enabled) return 0;
  const rows = await db.queryAll(
    `SELECT o.*, (SELECT payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code AND pt.status='paid' ORDER BY id DESC LIMIT 1) AS payable_amount
     FROM orders o WHERE o.status='lunas' AND o.payment_status='paid' AND julianday(o.paid_at)>=julianday(?)
       AND NOT EXISTS(SELECT 1 FROM whatsapp_outbox w WHERE w.idempotency_key='wa:sale-completed:'||o.code)
       AND ((o.order_kind='pedia' AND EXISTS(SELECT 1 FROM pedia_order_items p WHERE p.order_code=o.code)
             AND NOT EXISTS(SELECT 1 FROM pedia_order_items p WHERE p.order_code=o.code AND p.status!='completed'))
         OR (COALESCE(o.order_kind,'apps')!='pedia' AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.order_code=o.code)
             AND (SELECT count(*) FROM fulfillment_items f WHERE f.order_code=o.code) = json_array_length(o.items)
               + COALESCE((SELECT sum(CASE WHEN json_extract(j.value,'$.unique_units')=1 AND json_extract(j.value,'$.fulfillment_mode')='unique'
                    THEN MAX(0,CAST(json_extract(j.value,'$.qty') AS INTEGER)-1) ELSE 0 END) FROM json_each(o.items) j),0)
             AND NOT EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.order_code=o.code AND f.status!='delivered')))
     ORDER BY o.paid_at,o.code LIMIT ?`, config.enabledAt, Math.max(1, Math.min(limit, 4)));
  let queued = 0;
  for (const order of rows) {
    if (!db.canSpend(2)) break;
    const pedia = order.order_kind === "pedia";
    const items = await db.queryAll(pedia
      ? "SELECT status, completed_at AS finished_at FROM pedia_order_items WHERE order_code=?"
      : "SELECT item_index,status,updated_at AS finished_at FROM fulfillment_items WHERE order_code=?", order.code);
    if (!items.length || items.some(item => item.status !== (pedia ? "completed" : "delivered"))) continue;
    if (!pedia) {
      const expected = expandDeliveryLines(order.items);
      if (!expected.length || expected.length !== items.length || expected.some((_, i) => !items.some(item => Number(item.item_index) === i))) continue;
    }
    const finished = items.map(item => String(item.finished_at || "")).sort().at(-1);
    if (!finished) continue;
    const ref = "TRX-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    const result = await db.execRun(
      `INSERT OR IGNORE INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status,attempt_count,next_attempt_at,created_at,updated_at)
       VALUES (?,'whatsapp',?,'sale_completed',?,'pending',0,datetime('now'),datetime('now'),datetime('now'))`,
      `wa:sale-completed:${order.code}`, config.groupId, salesNotificationMessage(order, finished, ref));
    queued += Number(result.changes ?? 0);
  }
  return queued;
}
