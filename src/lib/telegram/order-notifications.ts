import { execRun, queryAll, queryFirst } from "@/lib/db";
import { sendMessage } from "@/lib/telegram/api";
import {
  adminTelegramOrderCreatedMessage,
  orderPaidMessage,
} from "@/lib/telegram/messages";
import {
  orderPaidKeyboard,
  telegramOrderAdminKeyboard,
} from "@/lib/telegram/keyboards";

type OrderItem = {
  name?: string;
  qty?: number;
};

function parseItems(raw: unknown): OrderItem[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function productNames(raw: unknown): string {
  const names = parseItems(raw).map((item) => {
    const name = String(item.name || "Produk");
    const qty = Math.max(1, Number(item.qty || 1));
    return `${name} ×${qty}`;
  });
  return names.join(", ") || "Produk";
}

function fulfillmentMode(raw: unknown): string {
  try {
    const snapshot = JSON.parse(String(raw || "{}")) as { fulfillment_mode?: unknown };
    return String(snapshot.fulfillment_mode || "manual");
  } catch {
    return "manual";
  }
}

function telegramNotificationsConfigured(): boolean {
  return process.env.TELEGRAM_BOT_ENABLED === "true" && Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Notify Axvara_Notif as soon as a Telegram order and its QRIS ledger exist. */
export async function notifyTelegramOrderCreated(orderCode: string): Promise<boolean> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.telegram_user_id, o.payment_method,
            o.telegram_order_notified_at, pt.payable_amount, o.subtotal, tu.username
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     LEFT JOIN telegram_users tu ON tu.user_id=o.telegram_user_id
     WHERE o.code=? AND o.sales_channel='telegram'
       AND o.telegram_order_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return true;

  const username = String(order.username || "").replace(/^@/, "");
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const sent = await sendMessage({
    chat_id: adminChatId,
    text: adminTelegramOrderCreatedMessage({
      orderCode: String(order.code),
      productNames: productNames(order.items),
      amount: Number(order.payable_amount ?? order.subtotal ?? 0),
      customerName: String(order.customer_name || "Pengguna Telegram"),
      telegramUser: username || String(order.telegram_user_id || ""),
      paymentMethod: String(order.payment_method || "qris"),
    }),
    parse_mode: "HTML",
    reply_markup: telegramOrderAdminKeyboard({
      username: username || undefined,
      orderCode: String(order.code),
      siteUrl,
    }),
  });
  if (!sent.ok) return false;

  await execRun(
    `UPDATE orders SET telegram_order_notified_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_order_notified_at IS NULL`,
    orderCode,
  );
  return true;
}

/**
 * Push payment success without requiring the buyer to press "Cek Status".
 * For manual fulfillment, this is also the first point where WA is requested.
 */
export async function notifyTelegramBuyerPaid(orderCode: string): Promise<boolean> {
  if (!telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT code, items, customer_wa, telegram_chat_id, telegram_user_id,
            variant_snapshot, telegram_paid_notified_at
     FROM orders
     WHERE code=? AND sales_channel='telegram' AND status='lunas'
       AND payment_status='paid' AND telegram_paid_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return true;

  const chatId = String(order.telegram_chat_id || "");
  if (!chatId) return false;
  const needsWhatsApp = fulfillmentMode(order.variant_snapshot) === "manual"
    && !String(order.customer_wa || "").trim();
  const sent = await sendMessage({
    chat_id: chatId,
    text: orderPaidMessage(String(order.code), productNames(order.items), needsWhatsApp),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(String(order.code), needsWhatsApp),
  });
  if (!sent.ok) return false;

  if (needsWhatsApp && order.telegram_user_id) {
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
      `wa_after_paid:${orderCode}`,
      String(order.telegram_user_id),
    );
  }
  await execRun(
    `UPDATE orders SET telegram_paid_notified_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_paid_notified_at IS NULL`,
    orderCode,
  );
  return true;
}

/** Retry best-effort Telegram notifications from the five-minute operations cron. */
export async function retryPendingTelegramNotifications(limit = 25): Promise<{
  created: number;
  paid: number;
}> {
  const pendingCreated = await queryAll(
    `SELECT code FROM orders
     WHERE sales_channel='telegram' AND telegram_order_notified_at IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    limit,
  );
  let created = 0;
  for (const order of pendingCreated) {
    try {
      if (await notifyTelegramOrderCreated(String(order.code))) created++;
    } catch { /* Retry the same durable marker on the next cron run. */ }
  }

  const pendingPaid = await queryAll(
    `SELECT code FROM orders
     WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid'
       AND telegram_paid_notified_at IS NULL
     ORDER BY updated_at ASC LIMIT ?`,
    limit,
  );
  let paid = 0;
  for (const order of pendingPaid) {
    try {
      if (await notifyTelegramBuyerPaid(String(order.code))) paid++;
    } catch { /* Retry the same durable marker on the next cron run. */ }
  }
  return { created, paid };
}
