import {
  ADMIN_PAID_ORDER_WINDOW, ADMIN_PAID_PREFIX, ADMIN_PAID_RECOVERY_DUE, ADMIN_PAID_RECOVERY_KEY, ADMIN_PAID_RETRY_DUE,
  CHAT_PAID_ADMIN_PENDING_WHERE, LEGACY_ADMIN_PAID_TIMEOUT_PREFIX, WEB_PAID_ADMIN_PENDING_WHERE,
} from "@/lib/cron-queues";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

type Row = Record<string, unknown>;
import { parseExpiry } from "@/lib/expiry";
import { formatRupiah } from "@/lib/telegram/messages/format";
import { getMe, sendMessage } from "@/lib/telegram/api";
import { classifyTelegramSend } from "@/lib/telegram/send-outcome";
import type { SendMessageParams } from "@/lib/telegram/types";
import {
  adminTelegramOrderCreatedMessage,
  adminTelegramOrderPaidMessage,
  adminWebOrderPaidMessage,
  adminWhatsAppOrderPaidMessage,
  orderPaidMessage,
  orderReminderMessage,
  providerOrderReminderMessage,
  type TelegramPaidDelivery,
} from "@/lib/telegram/messages";
import { buyerDeliveryKind } from "@/lib/catalog";
import { hasAutomaticSupplierDelivery } from "@/lib/buyer-fields";
import {
  orderPaidKeyboard,
  telegramOrderAdminKeyboard,
  webOrderAdminKeyboard,
  webPaidAdminKeyboard,
} from "@/lib/telegram/keyboards";
import { siteOrigin } from "@/lib/site-url";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { GAMES_ORDER_LABEL_SQL } from "@/lib/games/order-display";
import { parseItems } from "@/lib/orders/items-json";

type OrderItem = {
  name?: string;
  qty?: number;
};

function productNames(raw: unknown): string {
  const names = parseItems<OrderItem>(raw).map((item) => {
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

/**
 * Profil pengiriman order Telegram dari varian tiap baris (bukan snapshot
 * `fulfillment_mode`: varian WR/SK selalu 'manual' lokal karena kontrak
 * CHECK, sehingga dulu SEMUA order WR/SK dijanjikan "dikirim admin" + diminta
 * nomor WA). Kelas mengikuti `buyerDeliveryKind` yang sama dengan PDP web.
 */
export async function telegramPaidDeliveryProfile(
  order: Row,
  database: DatabaseAccess,
): Promise<{ delivery: TelegramPaidDelivery; hasLocalManual: boolean }> {
  if (["pedia", "games"].includes(String(order.order_kind))) return { delivery: "queued", hasLocalManual: false };
  const ids = parseItems<OrderItem>(order.items)
    .map((item) => Number((item as { variant_id?: unknown }).variant_id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  const fallbackMode = fulfillmentMode(order.variant_snapshot);
  if (!ids.length) {
    const manual = fallbackMode === "manual";
    return { delivery: manual ? "manual" : "instant", hasLocalManual: manual };
  }
  const rows = await database.queryAll(
    `SELECT pv.id, pv.fulfillment_mode, pv.wr_variant_id, pv.sk_variant_id,
             pv.sku,pv.tunvn_buff_quantity_b,pv.tunvn_source_product_id,pv.buyer_field_key,pv.max_qty,pv.aivault_service_id,p.aivault_family,pv.storebat_product_id,p.storebat_family,pv.mirai_package_code,p.mirai_family,pv.pixelverif_flow_type,p.slug AS product_slug,
            wv.wr_delivery_class, sp.sk_order_process
      FROM product_variants pv
      JOIN products p ON p.id=pv.product_id
     LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
     LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
     WHERE pv.id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  ).catch(() => [] as Row[]);
  if (!rows.length) {
    const manual = fallbackMode === "manual";
    return { delivery: manual ? "manual" : "instant", hasLocalManual: manual };
  }
  let hasLocalManual = false;
  let hasQueued = false;
  for (const row of rows) {
    const supplier = Boolean(String(row.wr_variant_id ?? "").trim() || String(row.sk_variant_id ?? "").trim() || String(row.pixelverif_flow_type ?? "").trim());
    const kind = buyerDeliveryKind({ ...row, automatic_delivery: hasAutomaticSupplierDelivery(row) });
    if (kind === "queued") {
      if (supplier) hasQueued = true;
      else hasLocalManual = true;
    }
  }
  return { delivery: hasLocalManual ? "manual" : hasQueued ? "queued" : "instant", hasLocalManual };
}

/** Notify Axvara_Notif as soon as a Telegram order and its QRIS ledger exist. */
export async function notifyTelegramOrderCreated(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.customer_email, o.telegram_user_id, o.payment_method, o.created_at,
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
      createdAt: order.created_at,
      orderCode: String(order.code),
      productNames: productNames(order.items),
      amount: Number(order.payable_amount ?? order.subtotal ?? 0),
      customerName: String(order.customer_name || "Pengguna Telegram"),
      telegramUser: username || String(order.telegram_user_id || ""),
      customerEmail: String(order.customer_email || ""),
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

// Reuse the existing ledger lease/retry fields, isolated from email by this key.
const PAID_NOTICE_PREFIX = "telegram:paid:";
const PAID_NOTICE_DUE = `b.access_attempts < 5
  AND (b.access_retry_at IS NULL OR datetime(b.access_retry_at) <= datetime('now'))
  AND (b.status='failed' OR (b.status='sending'
    AND julianday(b.updated_at) <= julianday('now','-10 minutes')))`;

/** Push payment success with fenced ownership and at most five transport attempts. */
export async function notifyTelegramBuyerPaid(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
  if (!telegramNotificationsConfigured() || !database.canSpend(6)) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_wa, o.telegram_user_id, o.variant_snapshot, o.locale, o.order_kind,
            tu.pending_action, b.status AS notice_status
     FROM orders o
     LEFT JOIN telegram_users tu ON tu.user_id=o.telegram_user_id
     LEFT JOIN buyer_notice_log b ON b.idempotency_key='${PAID_NOTICE_PREFIX}' || o.code
     WHERE o.code=? AND o.sales_channel='telegram' AND o.status='lunas'
       AND o.payment_status='paid' AND o.telegram_paid_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return true;

  const key = `${PAID_NOTICE_PREFIX}${orderCode}`;
  if (order.notice_status === "sent") {
    await execRun(`UPDATE orders SET telegram_paid_notified_at=datetime('now'), updated_at=datetime('now')
      WHERE code=? AND telegram_paid_notified_at IS NULL`, orderCode);
    return true;
  }
  // Telegram private chat IDs equal user IDs. Never trust a stale saved chat
  // (even a positive one belonging to somebody else), or fall back to a group.
  const chatId = String(order.telegram_user_id || "").trim();
  if (!/^[1-9]\d*$/.test(chatId) || !Number.isSafeInteger(Number(chatId))) return false;

  const lease = crypto.randomUUID();
  try {
    const claimed = await execRun(
      `INSERT INTO buyer_notice_log AS b
         (idempotency_key, order_code, channel, status, access_attempts, access_lease, access_retry_at)
       SELECT ?, code, 'telegram', 'sending', 1, ?, datetime('now','+1 minute')
       FROM orders WHERE code=? AND sales_channel='telegram' AND status='lunas'
         AND payment_status='paid' AND telegram_paid_notified_at IS NULL
       ON CONFLICT(idempotency_key) DO UPDATE SET
         status='sending', access_attempts=b.access_attempts+1, access_lease=excluded.access_lease,
         access_retry_at=datetime('now', CASE b.access_attempts
           WHEN 0 THEN '+1 minute' WHEN 1 THEN '+5 minutes'
           WHEN 2 THEN '+15 minutes' ELSE '+60 minutes' END),
         error=NULL, updated_at=datetime('now')
       WHERE ${PAID_NOTICE_DUE}`,
      key, lease, orderCode,
    );
    if (!claimed.changes) return false;
  } catch {
    return false; // No durable ownership, no transport.
  }
  const profile = await telegramPaidDeliveryProfile(order, database);
  const locale = String((order as Row).locale ?? "") === "en" ? "en" as const : "id" as const;
  // Telegram delivery happens in this chat; never ask a paid buyer for their WA number.
  const sent = await sendMessage({
    chat_id: chatId,
    text: orderPaidMessage(String(order.code), productNames(order.items), profile.delivery, { locale }),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(String(order.code), { locale }),
  }).catch(() => ({ ok: false }));
  // A timeout may already have delivered. Retry only after backoff; Telegram
  // has no idempotency key, so this is bounded at-least-once, not exactly-once.
  const settled = await execRun(
    `UPDATE buyer_notice_log SET status=?, error=?, access_lease=NULL, updated_at=datetime('now')
     WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
    sent.ok ? "sent" : "failed", sent.ok ? null : "telegram_send_failed", key, lease,
  );
  if (!sent.ok || !settled.changes) return false;

  // If this marker write fails, the sent ledger repairs it on the next run.
  await execRun(
    `UPDATE orders SET telegram_paid_notified_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_paid_notified_at IS NULL`,
    orderCode,
  ).catch(() => undefined);

  // The order-created message in Axvara_Notif keeps saying "Menunggu
  // pembayaran otomatis" even after the DANA hook marks the order paid, so
  // always follow up with a paid update to the admin group (best-effort here,
  // retried by the operations cron via its own durable marker).
  try {
    if (database.canSpend(5)) await notifyTelegramPaidAdmin(orderCode, database);
  } catch { /* Cron retries via telegram_paid_admin_notified_at. */ }
  return true;
}

const ADMIN_PAID_RECOVERY_LABEL = "🔁 Kirim ulang otomatis — abaikan bila notif lunas order ini sudah ada";
const CHAT_ADMIN_SEND_MS = 11_000;
const WEB_ADMIN_SEND_MS = 21_000; // Includes a possible buttonless fallback on a proven 400.
const GET_ME_MS = 5_000;
type HasTime = (ms: number) => boolean;

async function sendPaidAdmin(
  database: DatabaseAccess, orderCode: string, message: SendMessageParams,
  channel: "web" | "telegram" | "whatsapp", recoveryKey?: string, hasTime?: HasTime,
): Promise<boolean> {
  const { execRun, queryFirst } = database;
  const key = `${ADMIN_PAID_PREFIX}${orderCode}`;
  const lease = crypto.randomUUID();
  const web = channel === "web";
  if (hasTime && !hasTime(web ? WEB_ADMIN_SEND_MS : CHAT_ADMIN_SEND_MS)) return false;
  try {
    // Consume the single replay atomically, rechecking the deadline after the health probe.
    // For legacy timeouts, move the marker to the canonical key in the same write.
    const claim = recoveryKey ? await queryFirst(
      `UPDATE buyer_notice_log AS b SET idempotency_key=?, status='sending', access_attempts=1,
         access_lease=?, access_retry_at=datetime('now','+2 minutes'), error=NULL, updated_at=datetime('now')
       WHERE b.idempotency_key=? AND b.order_code=? AND ${ADMIN_PAID_RECOVERY_DUE}
         AND (b.idempotency_key=? OR NOT EXISTS(SELECT 1 FROM buyer_notice_log WHERE idempotency_key=?))
         AND EXISTS(SELECT 1 FROM orders o WHERE o.code=b.order_code AND o.sales_channel=?
           ${web ? "" : "AND o.telegram_paid_admin_notified_at IS NULL"} AND ${ADMIN_PAID_ORDER_WINDOW})
       RETURNING access_attempts`,
      key, lease, recoveryKey, orderCode, key, key, channel,
    ) : await queryFirst(
      `INSERT INTO buyer_notice_log AS b (idempotency_key, order_code, channel, status, access_lease, access_retry_at, updated_at)
       SELECT ?, o.code, 'telegram', 'sending', ?, datetime('now','+2 minutes'), datetime('now')
       FROM orders o WHERE o.code=? AND o.sales_channel=? AND o.status='lunas' AND o.payment_status='paid'
         ${web ? "" : "AND o.telegram_paid_admin_notified_at IS NULL"}
         AND NOT EXISTS(SELECT 1 FROM buyer_notice_log WHERE idempotency_key=?)
       ON CONFLICT(idempotency_key) DO UPDATE SET status='sending', access_lease=excluded.access_lease,
         access_retry_at=excluded.access_retry_at, error=NULL, updated_at=datetime('now')
       WHERE ${ADMIN_PAID_RETRY_DUE}
       RETURNING access_attempts`,
      key, lease, orderCode, channel, `${LEGACY_ADMIN_PAID_TIMEOUT_PREFIX}${orderCode}`,
    );
    if (!claim) return false;
    // A definite-reject retry of a recovery notice still carries the label.
    if (Number(claim.access_attempts) > 0) message = { ...message, text: `${ADMIN_PAID_RECOVERY_LABEL}\n${message.text}` };
  } catch {
    console.warn(`[telegram-paid-admin] ${key} class=claim_unavailable`);
    return false;
  }

  const attempt = async (params: SendMessageParams) => {
    try { return classifyTelegramSend(await sendMessage(params)); }
    catch { return classifyTelegramSend(undefined); }
  };
  let outcome = await attempt(message);
  let sentWithoutKeyboard = false;
  if (web && message.reply_markup && outcome.kind === "rejected" && outcome.errorCode === 400) {
    outcome = await attempt({ ...message, reply_markup: undefined });
    sentWithoutKeyboard = outcome.kind === "sent";
  }

  const status = outcome.kind === "sent" ? "sent" : outcome.kind === "ambiguous" ? "unknown" : "failed";
  const error = outcome.kind === "sent" ? (sentWithoutKeyboard ? "terkirim tanpa tombol: Bad Request (400)" : null)
    : outcome.kind === "rejected" ? `rejected:${outcome.errorCode}` : outcome.kind;
  const retryDelay = outcome.kind === "rate_limited" ? Math.max(60, Math.ceil(outcome.retryAfter ?? 0)) : 0;
  console.info(`[telegram-paid-admin] ${key} class=${outcome.kind}`);
  try {
    const settled = await execRun(
      `UPDATE buyer_notice_log SET status=?, provider_id=?, error=?, access_lease=NULL,
         access_retry_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?), updated_at=datetime('now')
       WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
      status, outcome.kind === "sent" ? String(outcome.messageId) : null, error,
      status === "failed" ? `+${retryDelay} seconds` : null, key, lease,
    );
    if (!(Number(settled.changes) > 0)) return false;
    if (status !== "sent") return false;
    if (!web) {
      await execRun(
        `UPDATE orders SET telegram_paid_admin_notified_at=datetime('now'), updated_at=datetime('now')
         WHERE code=? AND telegram_paid_admin_notified_at IS NULL`,
        orderCode,
      );
    }
    return true;
  } catch {
    // An unacknowledged claim remains 'sending'; only the bounded cron recovery can reclaim it.
    console.warn(`[telegram-paid-admin] ${key} class=settle_unavailable`);
    return false;
  }
}

/** Announce a paid WhatsApp order to the admin group (separate from order-created). */
export async function notifyWhatsAppPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  return sendWhatsAppPaidAdmin(orderCode, database);
}

async function sendWhatsAppPaidAdmin(orderCode: string, database: DatabaseAccess, recoveryKey?: string, hasTime?: HasTime): Promise<boolean> {
  const { queryFirst } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.channel_member_id, o.customer_wa,
            o.payment_method, o.paid_at, o.variant_snapshot, o.order_kind, o.telegram_paid_admin_notified_at,
            pt.payable_amount, o.subtotal
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.sales_channel='whatsapp' AND o.status='lunas'
       AND o.payment_status='paid' AND o.telegram_paid_admin_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return !recoveryKey;

  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const member = String(order.channel_member_id || order.customer_wa || "");
  const paymentMethod = String(order.payment_method || "qris");
  const summary = await adminDeliverySummary(order, database);
  return sendPaidAdmin(database, orderCode, {
    chat_id: adminChatId,
    text: adminWhatsAppOrderPaidMessage({
      paidAt: order.paid_at, orderStatus: summary.orderStatus, deliveryLines: summary.lines,
      orderCode: String(order.code),
      productNames: summary.productName || productNames(order.items),
      amount: Number(order.payable_amount ?? order.subtotal ?? 0),
      customerName: String(order.customer_name || member || "Pembeli WhatsApp"),
      channelMember: member,
      paymentMethod,
    }),
    parse_mode: "HTML",
    reply_markup: webOrderAdminKeyboard({
      customerWa: member,
      customerName: String(order.customer_name || "Pembeli WhatsApp"),
      orderCode: String(order.code),
      siteUrl,
      paidMarket: order.order_kind === "apps",
    }),
  }, "whatsapp", recoveryKey, hasTime);
}

/** Announce a paid Telegram order to the admin group (separate from order-created). */
export async function notifyTelegramPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  return sendTelegramPaidAdmin(orderCode, database);
}

async function sendTelegramPaidAdmin(orderCode: string, database: DatabaseAccess, recoveryKey?: string, hasTime?: HasTime): Promise<boolean> {
  const { queryFirst } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.customer_email, o.customer_wa, o.telegram_user_id,
            o.paid_at, o.variant_snapshot, o.order_kind, o.telegram_paid_admin_notified_at, pt.payable_amount, o.subtotal, tu.username
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     LEFT JOIN telegram_users tu ON tu.user_id=o.telegram_user_id
     WHERE o.code=? AND o.sales_channel='telegram' AND o.status='lunas'
       AND o.payment_status='paid' AND o.telegram_paid_admin_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return !recoveryKey;

  const username = String(order.username || "").replace(/^@/, "");
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const summary = await adminDeliverySummary(order, database);
  return sendPaidAdmin(database, orderCode, {
    chat_id: adminChatId,
    text: adminTelegramOrderPaidMessage({
      paidAt: order.paid_at, orderStatus: summary.orderStatus, deliveryLines: summary.lines,
      orderCode: String(order.code),
      productNames: summary.productName || productNames(order.items),
      amount: Number(order.payable_amount ?? order.subtotal ?? 0),
      customerName: String(order.customer_name || "Pengguna Telegram"),
      telegramUser: username || String(order.telegram_user_id || ""),
      customerEmail: String(order.customer_email || ""),
      customerWa: String(order.customer_wa || ""),
      delivery: (await telegramPaidDeliveryProfile(order, database).catch(() => null))?.delivery ?? "manual",
    }),
    parse_mode: "HTML",
    reply_markup: telegramOrderAdminKeyboard({
      username: username || undefined,
      orderCode: String(order.code),
      siteUrl,
      paidMarket: order.order_kind === "apps",
    }),
  }, "telegram", recoveryKey, hasTime);
}

/** Pedia paid admin summary — reads the durable pedia item, never Market
 *  fulfillment_items. No manual handover words; statuses map to automatic
 *  processing except needs_check/partial/canceled (followup) and expired. */
export async function pediaAdminDeliverySummary(
  orderCode: string, database: DatabaseAccess,
): Promise<{ needsAdmin: boolean; lines: string[]; orderStatus: string }> {
  const item = await database.queryFirst(
    `SELECT i.status, i.quantity, i.supplier, i.supplier_order_id, i.remains, i.start_count,
            i.last_error, p.name AS product_name
       FROM pedia_order_items i JOIN pedia_products p ON p.id=i.product_id
      WHERE i.order_code=?`,
    orderCode,
  ).catch(() => null);
  if (!item) {
    // Missing Pedia item must not infer success or manual handover.
    return { needsAdmin: false, lines: ["⏳ Pesanan Pedia belum terdata — sedang dicek"], orderStatus: "SEDANG DICEK" };
  }
  const status = String(item.status ?? "");
  const qty = Number(item.quantity) || 0;
  const rawRemains = item.remains != null ? Number(item.remains) : NaN;
  const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= qty ? rawRemains : null;
  const done = status === "completed" ? qty : remains != null ? qty - remains : null;
  const progress = done != null ? ` · ${done.toLocaleString("id-ID")}/${qty.toLocaleString("id-ID")} masuk` : "";
  const supplierOrder = item.supplier_order_id ? ` · ID ${String(item.supplier_order_id).slice(0, 24)}` : "";
  const product = String(item.product_name ?? "Pesanan Pedia").slice(0, 80);
  const head = `📦 ${product} · ${qty.toLocaleString("id-ID")}${progress}${supplierOrder}`;
  if (status === "completed") {
    return { needsAdmin: false, lines: [head, "✅ Selesai"], orderStatus: "SELESAI" };
  }
  if (status === "in_progress") {
    return { needsAdmin: false, lines: [head, "🤖 Diproses otomatis (berjalan)"], orderStatus: "DIPROSES OTOMATIS (BERJALAN)" };
  }
  if (status === "queued" || status === "submitting" || status === "submitted") {
    return { needsAdmin: false, lines: [head, "🤖 Diproses otomatis"], orderStatus: "DIPROSES OTOMATIS" };
  }
  if (status === "partial" || status === "canceled") {
    return { needsAdmin: false, lines: [head, "🟡 Selesai sebagian/dibatalkan — tindak lanjut manual (bukan handover)"], orderStatus: "PERLU TINDAK LANJUT" };
  }
  if (status === "needs_check") {
    return { needsAdmin: true, lines: [head, `🟡 Perlu pemeriksaan admin: ${String(item.last_error ?? "perlu dicek").slice(0, 160)}`], orderStatus: "PERLU PEMERIKSAAN ADMIN" };
  }
  if (status === "expired") {
    return { needsAdmin: false, lines: [head, "⌛ Kedaluwarsa"], orderStatus: "KEDALUWARSA" };
  }
  // Unknown/awaiting states on a lunas order: sedang dicek, never optimistic.
  return { needsAdmin: false, lines: [head, "⏳ Pesanan Pedia sedang dicek"], orderStatus: "SEDANG DICEK" };
}

export async function gamesAdminDeliverySummary(orderCode: string, database: DatabaseAccess) {
  const item = await database.queryFirst(
    `SELECT gi.status, gi.customer_no, gi.customer_nickname, gi.supplier, gi.sn, gi.last_error,
            ${GAMES_ORDER_LABEL_SQL} AS product_name
       FROM games_order_items gi JOIN games_products gp ON gp.id=gi.product_id
       LEFT JOIN games_meta gm ON gm.slug=gp.game_slug WHERE gi.order_code=?`, orderCode,
  ).catch(() => null);
  if (!item) return { needsAdmin: false, productName: "Pesanan Games", lines: ["⏳ Pesanan Games belum terdata — sedang dicek"], orderStatus: "SEDANG DICEK" };
  const productName = String(item.product_name);
  const head = `🎮 ${productName} · ID ${String(item.customer_no)}${item.customer_nickname ? ` (${String(item.customer_nickname)})` : ""}`;
  const result = (orderStatus: string, line: string, needsAdmin = false) => ({ needsAdmin, productName, lines: [head, line], orderStatus });
  switch (item.status) {
    case "success": return result("SELESAI", `✅ Selesai${item.sn ? ` · SN ${String(item.sn)}` : ""}`);
    case "queued": case "submitting": case "pending":
      return result("DIPROSES OTOMATIS", `🤖 Diproses otomatis (${item.supplier === "sekalipay" ? "Sekalipay" : "Digiflazz"})`);
    case "needs_check": return result("PERLU PEMERIKSAAN ADMIN", `🟡 Perlu pemeriksaan admin: ${String(item.last_error || "perlu dicek").slice(0, 160)}`, true);
    case "expired": return result("KEDALUWARSA", "⌛ Kedaluwarsa");
    default: return result("SEDANG DICEK", "⏳ Pesanan Games sedang dicek");
  }
}

/** Ringkasan status kirim order web untuk notif admin (dibaca setelah upaya kirim pertama). */
export function summarizeWebDelivery(items: Row[]): { needsAdmin: boolean; lines: string[]; orderStatus: string } {
  let auto = 0, manualDone = 0, manual = 0, progress = 0, attention = 0;
  for (const item of items) {
    const status = String(item.status ?? "");
    const supplier = item.wr_link_id != null || item.sk_link_id != null || ["wr", "sk"].includes(String(item.supplier_source));
    if (status === "delivered") {
      if (supplier || String(item.delivered_message_id ?? "").startsWith("item:")) auto++;
      else manualDone++;
    } else if (supplier) {
      if (status === "failed" || ["failed", "needs_check", "canceled"].includes(String(item.supplier_status))) attention++;
      else progress++;
    } else if (status === "manual_required" || (status === "failed" && item.fulfillment_mode === "manual")) manual++;
    else if (status === "failed") attention++;
    else progress++;
  }
  const lines: string[] = [];
  if (manual) lines.push(`🛠 ${manual} item perlu dikirim: Panel → Pesanan → Kirim ke pembeli`);
  if (attention) lines.push(`⚠️ ${attention} item otomatis perlu pemeriksaan admin`);
  if (auto) lines.push(`🤖 ${auto} item terkirim otomatis`);
  if (manualDone) lines.push(`✅ ${manualDone} item sudah diserahkan admin`);
  if (progress) lines.push(`🤖 ${progress} item sedang diproses otomatis`);
  if (!lines.length) lines.push("⏳ Menunggu proses pengiriman");
  const orderStatus = attention ? "PERLU PEMERIKSAAN ADMIN" : manual ? "MENUNGGU PENGIRIMAN ADMIN"
    : progress ? "DIPROSES OTOMATIS" : auto + manualDone > 0 ? "SELESAI" : "DIPROSES";
  return { needsAdmin: manual > 0, lines, orderStatus };
}

async function adminDeliverySummary(order: Row, database: DatabaseAccess): Promise<{ needsAdmin: boolean; lines: string[]; orderStatus: string; productName?: string }> {
  if (order.order_kind === "games") return gamesAdminDeliverySummary(String(order.code), database);
  if (order.order_kind === "pedia") return pediaAdminDeliverySummary(String(order.code), database);
  const items = await database.queryAll(
    `SELECT f.*, COALESCE(c.source, CASE WHEN pv.wr_variant_id IS NOT NULL THEN 'wr'
             WHEN pv.sk_variant_id IS NOT NULL THEN 'sk' ELSE 'manual' END) AS supplier_source,
            COALESCE(w.status,s.status) AS supplier_status
     FROM fulfillment_items f
     LEFT JOIN order_item_costs c ON c.order_code=f.order_code AND c.item_index=f.item_index
     LEFT JOIN product_variants pv ON pv.id=f.variant_id
     LEFT JOIN wr_order_links w ON w.id=f.wr_link_id
     LEFT JOIN sk_order_links s ON s.id=f.sk_link_id
     WHERE f.order_code=?`, String(order.code));
  const inviteLines: string[] = [];
  const seenInviteEmails = new Set<string>();
  for (const it of parseItems<{
    buyer_fields?: { invite_email?: string; custom_values?: Record<string, string> };
    custom_buyer_fields_meta?: { key: string; label: string; type: string }[];
  }>(order.items)) {
    const em = String(it.buyer_fields?.invite_email ?? "").trim().toLowerCase();
    if (em && !seenInviteEmails.has(em)) {
      seenInviteEmails.add(em);
      inviteLines.push(`📩 Email invite: ${em}`);
    }
    if (it.buyer_fields?.custom_values) {
      const metaByKey = new Map((it.custom_buyer_fields_meta ?? []).map((m) => [m.key, m]));
      for (const [k, rawVal] of Object.entries(it.buyer_fields.custom_values)) {
        if (!rawVal) continue;
        const meta = metaByKey.get(k);
        const label = meta?.label || k.replace(/_/g, " ");
        if (meta?.type === "password") {
          inviteLines.push(`🔒 ${label}: (lihat di Panel Admin → Detail Pesanan)`);
        } else {
          const preview = String(rawVal).replace(/\s+/g, " ").trim().slice(0, 120);
          inviteLines.push(`📝 ${label}: ${preview}`);
        }
      }
    }
  }
  if (items.length) {
    for (const [index] of expandDeliveryLines(order.items).entries()) {
      if (!items.some(item => Number(item.item_index) === index)) items.push({ status: "queued" });
    }
    const summarized = summarizeWebDelivery(items);
    return inviteLines.length ? { ...summarized, lines: [...summarized.lines, ...inviteLines] } : summarized;
  }
  const profile = await telegramPaidDeliveryProfile(order, database);
  return { needsAdmin: profile.hasLocalManual,
    orderStatus: profile.hasLocalManual ? "MENUNGGU PENGIRIMAN ADMIN" : "DIPROSES OTOMATIS",
    lines: [profile.hasLocalManual ? "🛠 Pengiriman manual oleh admin" : "🤖 Pengiriman otomatis", ...inviteLines] };
}

/** Notif admin "Lunas — Web" setelah upaya fulfillment pertama. */
export async function notifyWebPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  return sendWebPaidAdmin(orderCode, database);
}

async function sendWebPaidAdmin(orderCode: string, database: DatabaseAccess, recoveryKey?: string, hasTime?: HasTime): Promise<boolean> {
  const { queryFirst } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;
  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.customer_email, o.customer_wa, o.subtotal, o.payment_method, o.paid_at, o.variant_snapshot, o.order_kind,
            (SELECT pt.payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code
              ORDER BY pt.id DESC LIMIT 1) AS payable_amount
     FROM orders o
     WHERE o.code=? AND o.sales_channel='web' AND o.status='lunas' AND o.payment_status='paid'`,
    orderCode,
  ).catch(() => null);
  if (!order) return !recoveryKey;
  const delivery = await adminDeliverySummary(order, database);
  const { deriveNameFromEmail } = await import("@/lib/utils");
  const storedName = String(order.customer_name || "").trim();
  const displayName = storedName || deriveNameFromEmail(String(order.customer_email || ""));
  const text = adminWebOrderPaidMessage({
    orderCode: String(order.code),
    productNames: delivery.productName || productNames(order.items),
    amount: Number(order.payable_amount ?? order.subtotal ?? 0),
    customerName: displayName,
    customerEmail: String(order.customer_email || ""),
    customerWa: String(order.customer_wa || ""),
    paymentMethod: String(order.payment_method || "qris"),
    paidAt: order.paid_at, orderStatus: delivery.orderStatus,
    needsAdmin: delivery.needsAdmin,
    deliveryLines: delivery.lines,
  });
  return sendPaidAdmin(database, orderCode, {
    chat_id: adminChatId,
    text,
    parse_mode: "HTML",
    reply_markup: webPaidAdminKeyboard({ customerWa: String(order.customer_wa || ""), orderCode: String(order.code), siteUrl: siteOrigin(), orderKind: String(order.order_kind || "apps") }),
  }, "web", recoveryKey, hasTime);
}

export { WEB_PAID_ADMIN_PENDING_WHERE };

/** Retry best-effort Telegram notifications from cron lite/operations.
 *
 * RR3-09: ketiga jenis pekerjaan (order-created, paid buyer, paid admin)
 * dihitung dan di-retry TERPISAH per marker — tidak lagi digantungkan pada
 * satu gerbang "created IS NULL". `only` memungkinkan cron memanggil tiap
 * jenis hanya bila antreannya > 0 (hemat query baca kosong, RR3-01).
 */
export async function retryPendingTelegramNotifications(limit = 50, only?: {
  created?: boolean; paid?: boolean; paidAdmin?: boolean; paidAdminWeb?: boolean;
}, database: DatabaseAccess = createDatabaseAccess(), hasTime: HasTime = () => true): Promise<{
  created: number;
  paid: number;
  paidAdmin: number;
  paidAdminWeb: number;
}> {
  const { queryAll } = database;
  // Workers Paid: cap per tick raised 20 -> 50 (still bounded as a runaway guard).
  const max = Math.min(50, Math.max(0, Math.floor(Number(limit) || 0)));
  if (!max) return { created: 0, paid: 0, paidAdmin: 0, paidAdminWeb: 0 };
  const want = {
    created: only?.created ?? true,
    paid: only?.paid ?? true,
    paidAdmin: only?.paidAdmin ?? true,
    // Pemanggil lama yang memberi `only` tanpa kunci ini tidak ikut membaca
    // antrean web (menjaga anggaran query cron, RR3-01).
    paidAdminWeb: only ? only.paidAdminWeb === true : true,
  };
  const created = 0;
  let paid = 0;
  let paidAdmin = 0;
  // 2026-10-10 (keputusan owner, paritas Web 2026-09-25): "Order Baru" ke grup
  // admin DIMATIKAN untuk KEDUA kanal — grup hanya menerima "Lunas" (Telegram:
  // notifyTelegramPaidAdmin; WhatsApp: notifyWhatsAppPaidAdmin). Blok created
  // dipertahankan sebagai no-op (return 0, tanpa query/kirim) agar pemanggil
  // lama (cron lite notify_a, route besar, test) tidak perlu diubah; marker
  // telegram_order_notified_at tetap ditulis migrasi 0012/0023 (kolom dibiarkan,
  // pemanggil langsung notify*OrderCreated tetap berfungsi bila dipanggil).
  void want.created;

  if (want.paid && database.canSpend(1)) {
    const pendingPaid = await queryAll(
      `SELECT o.code FROM orders o
       LEFT JOIN buyer_notice_log b ON b.idempotency_key='${PAID_NOTICE_PREFIX}' || o.code
       WHERE o.sales_channel='telegram' AND o.status='lunas' AND o.payment_status='paid'
         AND o.telegram_paid_notified_at IS NULL
         AND (b.status='sent' OR (
           o.telegram_user_id GLOB '[1-9]*' AND o.telegram_user_id NOT GLOB '*[^0-9]*'
           AND CAST(o.telegram_user_id AS INTEGER) BETWEEN 1 AND 9007199254740991
           AND (COALESCE(o.fulfillment_status,'') <> 'delivered'
             OR julianday(COALESCE(o.paid_at,o.created_at)) >= julianday('now','-6 hours'))
           AND (b.idempotency_key IS NULL OR (${PAID_NOTICE_DUE}))))
       ORDER BY COALESCE(b.access_attempts,0) ASC, COALESCE(o.paid_at,o.created_at) DESC, o.code
       LIMIT ?`,
      max,
    ).catch(() => [] as Row[]);
    for (const order of pendingPaid) {
      if (!database.canSpend(6) || !hasTime(11_000)) break;
      try {
        if (await notifyTelegramBuyerPaid(String(order.code), database)) paid++;
      } catch { /* Retry the same durable marker on the next cron run. */ }
    }
  }

  // At most one health probe across both admin queues, only when recovery is due.
  const canRecover = async () => {
    if (!telegramNotificationsConfigured() || !process.env.TELEGRAM_ADMIN_CHAT_ID) return false;
    try {
      const res = await getMe();
      return res?.ok === true && Number.isSafeInteger(res.result?.id);
    } catch { return false; }
  };
  let recoveryHealthy: boolean | undefined;
  const admitRecovery = async (sendMs: number) => {
    if (recoveryHealthy === undefined && hasTime(sendMs + GET_ME_MS)) recoveryHealthy = await canRecover();
    return recoveryHealthy === true && hasTime(sendMs);
  };

  if (want.paidAdmin && database.canSpend(1)) {
    const pendingPaidAdmin = await queryAll(
      `SELECT o.code, o.sales_channel, ${ADMIN_PAID_RECOVERY_KEY} AS recovery_key
       FROM orders o WHERE ${CHAT_PAID_ADMIN_PENDING_WHERE}
       ORDER BY recovery_key IS NOT NULL, o.updated_at ASC LIMIT ?`,
      max,
    ).catch(() => [] as Row[]);
    for (const order of pendingPaidAdmin) {
      if (!database.canSpend(7) || !hasTime(CHAT_ADMIN_SEND_MS)) break;
      try {
        const recoveryKey = typeof order.recovery_key === "string" ? order.recovery_key : undefined;
        if (recoveryKey && !(await admitRecovery(CHAT_ADMIN_SEND_MS))) continue;
        const ok = String(order.sales_channel || "telegram") === "whatsapp"
          ? await sendWhatsAppPaidAdmin(String(order.code), database, recoveryKey, hasTime)
          : await sendTelegramPaidAdmin(String(order.code), database, recoveryKey, hasTime);
        if (ok) paidAdmin++;
      } catch { /* Pre-claim preparation failed; other orders can still proceed. */ }
    }
  }
  let paidAdminWeb = 0;
  if (want.paidAdminWeb && database.canSpend(1)) {
    const pendingWeb = await queryAll(
      `SELECT o.code, ${ADMIN_PAID_RECOVERY_KEY} AS recovery_key FROM orders o WHERE ${WEB_PAID_ADMIN_PENDING_WHERE}
       ORDER BY recovery_key IS NOT NULL, COALESCE(o.paid_at, o.updated_at) ASC LIMIT ?`,
      max,
    ).catch(() => [] as Row[]);
    for (const order of pendingWeb) {
      if (!database.canSpend(7) || !hasTime(WEB_ADMIN_SEND_MS)) break;
      try {
        const recoveryKey = typeof order.recovery_key === "string" ? order.recovery_key : undefined;
        if (recoveryKey && !(await admitRecovery(WEB_ADMIN_SEND_MS))) continue;
        if (await sendWebPaidAdmin(String(order.code), database, recoveryKey, hasTime)) paidAdminWeb++;
      } catch { /* Pre-claim preparation failed; other orders can still proceed. */ }
    }
  }
  return { created, paid, paidAdmin, paidAdminWeb };
}

export const TELEGRAM_REMINDER_MAX = 2;

// Both cron paths share this gate, including the CAS. NULL last-reminder is
// not a bypass for invoice age. Use the TX, not the older order (QR renewal).
// julianday handles stored ISO/SQL UTC timestamps; round to ms to avoid drift at boundaries.
const reminderStart = "julianday(COALESCE(pt.invoice_issued_at, pt.created_at))";
const reminderEnd = "julianday(pt.expires_at)";
const msBetween = (later: string, earlier: string) => `ROUND((${later} - ${earlier}) * 86400000)`;
const reminderLifetime = msBetween(reminderEnd, reminderStart);
const reminderLeft = msBetween(reminderEnd, "clock.now_jd");
const reminderAge = msBetween("clock.now_jd", reminderStart);
// The SQL issue timestamp has second precision; the ISO deadline has milliseconds.
const shortQris = `(pt.provider IN ('gopay','klikqris') AND ${reminderLifetime} < 901000)`;
const reminderDue = `o.sales_channel='telegram' AND o.status='pending'
  AND o.payment_status IN ('unpaid','pending') AND COALESCE(o.telegram_chat_id,'')!=''
  AND pt.status='pending' AND pt.provider IS NOT NULL AND pt.provider!='dana' AND ${reminderLeft} > 60000
  AND ${reminderAge} >= MAX(480000, ${reminderLifetime} * 0.6)
  AND CASE WHEN ${shortQris} THEN o.telegram_reminder_count=0 AND ${reminderLeft} <= 300000
    ELSE o.telegram_reminder_count < ${TELEGRAM_REMINDER_MAX} END
  AND (o.telegram_reminder_sent_at IS NULL OR
    ${msBetween("clock.now_jd", "julianday(o.telegram_reminder_sent_at)")} >= MAX(600000, ${reminderLifetime} / 3.0))`;

export async function sendPendingOrderReminders(limit = 50, database: DatabaseAccess = createDatabaseAccess(), hasTime: HasTime = () => true): Promise<number> {
  const { queryAll, execRun } = database;
  if (!telegramNotificationsConfigured()) return 0;
  const pending = await queryAll(
    `SELECT o.code, o.telegram_chat_id, o.telegram_reminder_count,
            pt.id AS tx_id, pt.payable_amount, pt.expires_at, pt.price_amount_text, pt.price_currency,
            pt.provider, o.payment_method, o.locale, o.subtotal
     FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code
     CROSS JOIN (SELECT julianday(?) AS now_jd) clock
     WHERE ${reminderDue}
     ORDER BY ${reminderEnd}, o.code LIMIT ?`,
    new Date(Date.now()).toISOString(), limit,
  );
  let sent = 0;
  for (const order of pending) {
    if (!database.canSpend(1) || !hasTime(11_000)) break;
    const code = String(order.code);
    const chatId = String(order.telegram_chat_id || "");
    const expiresMs = parseExpiry(order.expires_at);
    if (!chatId || expiresMs === null) continue;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const claimed = await execRun(
      `UPDATE orders AS o SET telegram_reminder_count=telegram_reminder_count+1,
         telegram_reminder_sent_at=?, updated_at=datetime('now')
       WHERE o.code=? AND o.telegram_reminder_count=? AND EXISTS (
         SELECT 1 FROM payment_transactions pt CROSS JOIN (SELECT julianday(?) AS now_jd) clock
         WHERE pt.id=? AND pt.order_code=o.code AND pt.expires_at=? AND ${reminderDue})`,
      nowIso, code, Number(order.telegram_reminder_count || 0), nowIso, order.tx_id, order.expires_at,
    );
    if (!claimed.changes) continue; // dimenangkan worker lain / sudah berubah
    try {
      const method = String(order.payment_method ?? "");
      const crypto = order.provider === "nowpayments" || method.startsWith("nowpayments:");
      const newRail = crypto || order.provider === "sekalipay_gateway" || method.startsWith("sekalipay_gateway:");
      const quote = String(order.price_amount_text ?? "");
      const currency = String(order.price_currency ?? "").toUpperCase();
      const total = crypto
        ? (/^\d{1,24}(?:\.\d{1,18})?$/.test(quote) && ["USD", "IDR"].includes(currency) ? `${quote} ${currency}` : undefined)
        : order.payable_amount != null ? formatRupiah(Number(order.payable_amount)) : undefined;
      const locale = order.locale === "en" ? "en" : "id";
      const result = await sendMessage(newRail ? {
        chat_id: chatId,
        text: providerOrderReminderMessage({ orderCode: code, expiresMs, now, total }, { locale }),
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: locale === "en" ? "🔄 Open payment details" : "🔄 Buka detail pembayaran", callback_data: `refresh:${code}` }]] },
      } : {
        chat_id: chatId,
        text: orderReminderMessage({
          orderCode: code,
          payableAmount: Number(order.payable_amount ?? order.subtotal ?? 0),
          expiresMs, now,
        }, { locale }),
        parse_mode: "HTML",
      });
      if (result.ok) sent++;
    } catch { /* marker sudah dicatat; interval mencegah spam */ }
  }
  return sent;
}
