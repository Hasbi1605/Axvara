import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

type Row = Record<string, unknown>;
import { isFutureIso } from "@/lib/expiry";
import { sendMessage } from "@/lib/telegram/api";
import {
  adminTelegramOrderCreatedMessage,
  adminTelegramOrderPaidMessage,
  adminWebOrderPaidMessage,
  adminWhatsAppOrderCreatedMessage,
  adminWhatsAppOrderPaidMessage,
  orderPaidMessage,
  orderReminderMessage,
  providerOrderReminderMessage,
  type TelegramPaidDelivery,
} from "@/lib/telegram/messages";
import { buyerDeliveryKind } from "@/lib/catalog";
import { aivaultEligibility, tunvnEligibility } from "@/lib/buyer-fields";
import {
  orderPaidKeyboard,
  telegramOrderAdminKeyboard,
  webOrderAdminKeyboard,
  webPaidAdminKeyboard,
} from "@/lib/telegram/keyboards";
import { siteOrigin } from "@/lib/site-url";
import { expandDeliveryLines } from "@/lib/fulfillment/units";
import { GAMES_ORDER_LABEL_SQL } from "@/lib/games/order-display";

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
  const ids = parseItems(order.items)
    .map((item) => Number((item as { variant_id?: unknown }).variant_id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);
  const fallbackMode = fulfillmentMode(order.variant_snapshot);
  if (!ids.length) {
    const manual = fallbackMode === "manual";
    return { delivery: manual ? "manual" : "instant", hasLocalManual: manual };
  }
  const rows = await database.queryAll(
    `SELECT pv.id, pv.fulfillment_mode, pv.wr_variant_id, pv.sk_variant_id,
             pv.sku,pv.tunvn_buff_quantity_b,pv.tunvn_source_product_id,pv.buyer_field_key,pv.max_qty,pv.aivault_service_id,p.aivault_family,p.slug AS product_slug,
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
    const supplier = Boolean(String(row.wr_variant_id ?? "").trim() || String(row.sk_variant_id ?? "").trim());
    const kind = buyerDeliveryKind({
      fulfillment_mode: String(row.fulfillment_mode || "manual"),
      automatic_delivery: Boolean((aivaultEligibility(row,1) || tunvnEligibility(row,1))),
      wr_variant_id: row.wr_variant_id ?? null,
      sk_variant_id: row.sk_variant_id ?? null,
      wr_delivery_class: row.wr_delivery_class != null ? String(row.wr_delivery_class) : null,
      sk_order_process: row.sk_order_process != null ? String(row.sk_order_process) : null,
    } as Parameters<typeof buyerDeliveryKind>[0]);
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
  const needsWhatsApp = profile.hasLocalManual
    && !String(order.customer_wa || "").trim()
    && !String(order.pending_action || "").trim();
  const sent = await sendMessage({
    chat_id: chatId,
    text: orderPaidMessage(String(order.code), productNames(order.items), needsWhatsApp, profile.delivery, { locale }),
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
  if (needsWhatsApp) {
    await execRun(
      `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now')
       WHERE user_id=? AND (pending_action IS NULL OR trim(pending_action)='')`,
      `wa_after_paid:${orderCode}`, chatId,
    ).catch(() => undefined);
  }

  // The order-created message in Axvara_Notif keeps saying "Menunggu
  // pembayaran otomatis" even after the DANA hook marks the order paid, so
  // always follow up with a paid update to the admin group (best-effort here,
  // retried by the operations cron via its own durable marker).
  try {
    if (database.canSpend(5)) await notifyTelegramPaidAdmin(orderCode, database);
  } catch { /* Cron retries via telegram_paid_admin_notified_at. */ }
  return true;
}

/** Notify Axvara_Notif as soon as a WhatsApp order exists.
 *
 * Idempoten via kolom marker yang sama dengan jalur Telegram
 * (`telegram_order_notified_at`): klaim CAS `IS NULL` + kirim + tandai,
 * sehingga redelivery webhook / retry cron tidak mengirim ganda.
 */
export async function notifyWhatsAppOrderCreated(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;

  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.channel_member_id, o.customer_wa,
            o.payment_method, o.created_at, o.telegram_order_notified_at,
            pt.payable_amount, o.subtotal
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=? AND o.sales_channel='whatsapp'
       AND o.telegram_order_notified_at IS NULL`,
    orderCode,
  );
  if (!order) return true;

  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const member = String(order.channel_member_id || order.customer_wa || "");
  const paymentMethod = String(order.payment_method || "qris");
  const sent = await sendMessage({
    chat_id: adminChatId,
    text: adminWhatsAppOrderCreatedMessage({
      createdAt: order.created_at,
      orderCode: String(order.code),
      productNames: productNames(order.items),
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

/** Announce a paid WhatsApp order to the admin group (separate from order-created). */
export async function notifyWhatsAppPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
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
  if (!order) return true;

  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const member = String(order.channel_member_id || order.customer_wa || "");
  const paymentMethod = String(order.payment_method || "qris");
  const summary = await adminDeliverySummary(order, database);
  const sent = await sendMessage({
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
    }),
  });
  if (!sent.ok) return false;

  await execRun(
    `UPDATE orders SET telegram_paid_admin_notified_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_paid_admin_notified_at IS NULL`,
    orderCode,
  );
  return true;
}

/** Announce a paid Telegram order to the admin group (separate from order-created). */
export async function notifyTelegramPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {  const { queryFirst, execRun } = database;
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
  if (!order) return true;

  const username = String(order.username || "").replace(/^@/, "");
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  const summary = await adminDeliverySummary(order, database);
  const sent = await sendMessage({
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
    }),
  });
  if (!sent.ok) return false;

  await execRun(
    `UPDATE orders SET telegram_paid_admin_notified_at=datetime('now'), updated_at=datetime('now')
     WHERE code=? AND telegram_paid_admin_notified_at IS NULL`,
    orderCode,
  );
  return true;
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
  if (items.length) {
    for (const [index] of expandDeliveryLines(order.items).entries()) {
      if (!items.some(item => Number(item.item_index) === index)) items.push({ status: "queued" });
    }
    return summarizeWebDelivery(items);
  }
  const profile = await telegramPaidDeliveryProfile(order, database);
  return { needsAdmin: profile.hasLocalManual,
    orderStatus: profile.hasLocalManual ? "MENUNGGU PENGIRIMAN ADMIN" : "DIPROSES OTOMATIS",
    lines: [profile.hasLocalManual ? "🛠 Pengiriman manual oleh admin" : "🤖 Pengiriman otomatis"] };
}

/**
 * Notif admin "Lunas — Web" (2026-09-25). Dulu order web hanya mengirim
 * "Order Baru — Web" saat dibuat, dengan tombol `SITE_URL ?? fallback` yang
 * menjadi URL relatif ketika SITE_URL kosong (§16.4) sehingga Telegram menolak
 * seluruh pesan, dan hasil kirimnya diabaikan. Kini: sekali per order lewat
 * buyer_notice_log (kunci `admin-paid:<kode>`, kanal telegram, kolom `error`
 * menyimpan alasan gagal), URL tombol selalu absolut (`siteOrigin`), dan bila
 * Telegram tetap menolak tombol (400 Bad Request) pesan dikirim ulang tanpa
 * tombol. Cron mengulang yang gagal (retryPendingTelegramNotifications).
 */
export async function notifyWebPaidAdmin(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
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
  if (!order) return true;
  const { claimNotice, settleNotice } = await import("@/lib/notify-buyer");
  const key = `admin-paid:${orderCode}`;
  if (!(await claimNotice(database, key, orderCode, "telegram"))) return true;
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
  const failed = (description: string) => ({ ok: false as const, description });
  let sent = await sendMessage({
    chat_id: adminChatId,
    text,
    parse_mode: "HTML",
    reply_markup: webPaidAdminKeyboard({ customerWa: String(order.customer_wa || ""), orderCode: String(order.code), siteUrl: siteOrigin(), orderKind: String(order.order_kind || "apps") }),
  }).catch(() => failed("telegram_send_failed"));
  let note: string | null = null;
  // Hanya 400 (pesan ditolak, jadi pasti belum terkirim) yang dikirim ulang;
  // timeout bisa saja sudah sampai, jadi tidak diulang di sini agar tidak dobel.
  if (!sent?.ok && String(sent?.description ?? "").startsWith("Bad Request")) {
    const plain = await sendMessage({ chat_id: adminChatId, text, parse_mode: "HTML" }).catch(() => failed("telegram_send_failed"));
    if (plain?.ok) note = `terkirim tanpa tombol: ${String(sent?.description ?? "")}`;
    sent = plain;
  }
  await settleNotice(database, key, Boolean(sent?.ok), undefined, sent?.ok ? undefined : String(sent?.description ?? "telegram_send_failed"));
  if (note) {
    await database.execRun(`UPDATE buyer_notice_log SET error=? WHERE idempotency_key=?`, note.slice(0, 300), key).catch(() => undefined);
  }
  return Boolean(sent?.ok);
}

/** Order web lunas dalam 6 jam terakhir yang notif adminnya belum terkirim (retry cron). */
export const WEB_PAID_ADMIN_PENDING_WHERE = `o.sales_channel='web' AND o.status='lunas' AND o.payment_status='paid'
  AND julianday(COALESCE(o.paid_at, o.updated_at)) >= julianday('now','-6 hours')
  AND NOT EXISTS(SELECT 1 FROM buyer_notice_log b WHERE b.idempotency_key='admin-paid:' || o.code AND b.status='sent')`;

/** Retry best-effort Telegram notifications from the five-minute operations cron.
 *
 * RR3-09: ketiga jenis pekerjaan (order-created, paid buyer, paid admin)
 * dihitung dan di-retry TERPISAH per marker — tidak lagi digantungkan pada
 * satu gerbang "created IS NULL". `only` memungkinkan cron memanggil tiap
 * jenis hanya bila antreannya > 0 (hemat query baca kosong, RR3-01).
 */
export async function retryPendingTelegramNotifications(limit = 8, only?: {
  created?: boolean; paid?: boolean; paidAdmin?: boolean; paidAdminWeb?: boolean;
}, database: DatabaseAccess = createDatabaseAccess()): Promise<{
  created: number;
  paid: number;
  paidAdmin: number;
  paidAdminWeb: number;
}> {
  const { queryAll } = database;
  const max = Math.min(4, Math.max(0, Math.floor(Number(limit) || 0)));
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
      if (!database.canSpend(6)) break;
      try {
        if (await notifyTelegramBuyerPaid(String(order.code), database)) paid++;
      } catch { /* Retry the same durable marker on the next cron run. */ }
    }
  }

  if (want.paidAdmin && database.canSpend(1)) {
    const pendingPaidAdmin = await queryAll(
      `SELECT code, sales_channel FROM orders
       WHERE sales_channel IN ('telegram','whatsapp') AND status='lunas' AND payment_status='paid'
         AND telegram_paid_admin_notified_at IS NULL
       ORDER BY updated_at ASC LIMIT ?`,
      max,
    ).catch(() => [] as Row[]);
    for (const order of pendingPaidAdmin) {
      if (!database.canSpend(7)) break;
      try {
        const ok = String(order.sales_channel || "telegram") === "whatsapp"
          ? await notifyWhatsAppPaidAdmin(String(order.code), database)
          : await notifyTelegramPaidAdmin(String(order.code), database);
        if (ok) paidAdmin++;
      } catch { /* Retry the same durable marker on the next cron run. */ }
    }
  }
  let paidAdminWeb = 0;
  if (want.paidAdminWeb && database.canSpend(1)) {
    const pendingWeb = await queryAll(
      `SELECT o.code FROM orders o WHERE ${WEB_PAID_ADMIN_PENDING_WHERE}
       ORDER BY COALESCE(o.paid_at, o.updated_at) ASC LIMIT ?`,
      max,
    ).catch(() => [] as Row[]);
    for (const order of pendingWeb) {
      if (!database.canSpend(7)) break;
      try {
        if (await notifyWebPaidAdmin(String(order.code), database)) paidAdminWeb++;
      } catch { /* Ledger tetap failed/sending; run berikutnya mencoba lagi. */ }
    }
  }
  return { created, paid, paidAdmin, paidAdminWeb };
}

// Reminder order pending Telegram: maksimal 2x per order (interval ≥60 mnt,
// hanya saat invoice masih aktif). Marker telegram_reminder_count membuat
// retry cron idempoten; order lunas/kadaluarsa otomatis tidak memenuhi
// predicate sehingga tidak pernah diingatkan lagi.
export const TELEGRAM_REMINDER_MAX = 2;
export const TELEGRAM_REMINDER_INTERVAL_MINUTES = 60;

export async function sendPendingOrderReminders(limit = 8, database: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  const { queryAll, execRun } = database;
  if (!telegramNotificationsConfigured()) return 0;
  // Same canonical JS expiry check as webhook/crons: only invoices whose
  // ISO `expires_at` is still in the future are reminded.
  const candidates = await queryAll(
    `SELECT o.code, o.items, o.telegram_chat_id, o.telegram_reminder_count,
            o.telegram_reminder_sent_at, pt.payable_amount, pt.expires_at, o.subtotal,
            pt.provider, o.payment_method, o.locale
     FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code AND pt.status='pending'
     WHERE o.sales_channel='telegram' AND o.status='pending'
       AND o.payment_status IN ('unpaid','pending')
       AND o.telegram_reminder_count < ?
       AND (o.telegram_reminder_sent_at IS NULL
         OR datetime(o.telegram_reminder_sent_at, '+' || ? || ' minutes') <= datetime('now'))
     ORDER BY o.created_at ASC LIMIT ?`,
    TELEGRAM_REMINDER_MAX, TELEGRAM_REMINDER_INTERVAL_MINUTES, limit * 4,
  );
  const pending = candidates
    .filter((order) => isFutureIso(order.expires_at))
    .slice(0, limit);
  let sent = 0;
  for (const order of pending) {
    if (!database.canSpend(1)) break;
    const code = String(order.code);
    const chatId = String(order.telegram_chat_id || "");
    if (!chatId) continue;
    const attempt = Number(order.telegram_reminder_count || 0) + 1;
    const claimed = await execRun(
      `UPDATE orders SET telegram_reminder_count=telegram_reminder_count+1,
         telegram_reminder_sent_at=datetime('now'), updated_at=datetime('now')
       WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')
         AND telegram_reminder_count=?`,
      code, Number(order.telegram_reminder_count || 0),
    );
    if (!claimed.changes) continue; // dimenangkan worker lain / sudah berubah
    try {
      // R3: gateway/crypto orders (saved TX provider, else saved payment_method)
      // get generic saved-locale copy + a refresh button — never QRIS wording.
      const method = String(order.payment_method ?? "");
      const newRail = ["nowpayments", "sekalipay_gateway"].includes(String(order.provider ?? ""))
        || method.startsWith("nowpayments:") || method.startsWith("sekalipay_gateway:");
      const result = await sendMessage(newRail ? {
        chat_id: chatId,
        text: providerOrderReminderMessage({
          orderCode: code,
          productName: productNames(order.items),
          attempt,
        }, { locale: String(order.locale ?? "") === "en" ? "en" : "id" }),
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: String(order.locale ?? "") === "en" ? "🔄 Open payment details" : "🔄 Buka detail pembayaran", callback_data: `refresh:${code}` }]] },
      } : {
        chat_id: chatId,
        text: orderReminderMessage({
          orderCode: code,
          productName: productNames(order.items),
          payableAmount: Number(order.payable_amount ?? order.subtotal ?? 0),
          attempt,
        }),
        parse_mode: "HTML",
      });
      if (result.ok) sent++;
    } catch { /* marker sudah dicatat; interval mencegah spam */ }
  }
  return sent;
}
