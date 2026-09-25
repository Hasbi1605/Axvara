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
} from "@/lib/telegram/messages";
import {
  orderPaidKeyboard,
  telegramOrderAdminKeyboard,
  webOrderAdminKeyboard,
  webPaidAdminKeyboard,
} from "@/lib/telegram/keyboards";
import { siteOrigin } from "@/lib/site-url";

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
export async function notifyTelegramOrderCreated(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
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
export async function notifyTelegramBuyerPaid(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
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

  // Private-only (issue #5): notifikasi lunas hanya ke chat pribadi buyer
  // terverifikasi dari telegram_users (tidak pernah id grup). Bila buyer
  // checkout dari grup dan belum START privat, kirim pemberitahuan aman
  // TANPA kredensial ke grup + kembalikan false agar retry cron mengirim
  // ulang ke private chat setelah buyer verifikasi (ensurePrivateRecipient).
  const buyerId = String(order.telegram_user_id || "");
  const privateChat = buyerId
    ? String((await queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId))?.chat_id || "")
    : "";
  const chatId = privateChat && Number(privateChat) > 0 ? privateChat : "";
  if (!chatId) {
    const groupId = String(order.telegram_chat_id || "");
    if (groupId && Number(groupId) < 0) {
      const { groupDeliveryNoticeMessage } = await import("@/lib/telegram/messages");
      await sendMessage({ chat_id: groupId, text: groupDeliveryNoticeMessage(), parse_mode: "HTML" }).catch(() => {});
    }
    return false;
  }
  const needsWhatsApp = fulfillmentMode(order.variant_snapshot) === "manual"
    && !String(order.customer_wa || "").trim();
  const sent = await sendMessage({
    chat_id: chatId,
    text: orderPaidMessage(String(order.code), productNames(order.items), needsWhatsApp),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(String(order.code)),
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

  // The order-created message in Axvara_Notif keeps saying "Menunggu
  // pembayaran otomatis" even after the DANA hook marks the order paid, so
  // always follow up with a paid update to the admin group (best-effort here,
  // retried by the operations cron via its own durable marker).
  try {
    await notifyTelegramPaidAdmin(orderCode, database);
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
            o.payment_method, o.telegram_order_notified_at,
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
            o.payment_method, o.telegram_paid_admin_notified_at,
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
  const sent = await sendMessage({
    chat_id: adminChatId,
    text: adminWhatsAppOrderPaidMessage({
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
    `SELECT o.code, o.items, o.customer_name, o.customer_wa, o.telegram_user_id,
            o.telegram_paid_admin_notified_at, pt.payable_amount, o.subtotal, tu.username
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
  const sent = await sendMessage({
    chat_id: adminChatId,
    text: adminTelegramOrderPaidMessage({
      orderCode: String(order.code),
      productNames: productNames(order.items),
      amount: Number(order.payable_amount ?? order.subtotal ?? 0),
      customerName: String(order.customer_name || "Pengguna Telegram"),
      telegramUser: username || String(order.telegram_user_id || ""),
      customerWa: String(order.customer_wa || ""),
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

/** Ringkasan status kirim order web untuk notif admin (dibaca setelah upaya kirim pertama). */
export function summarizeWebDelivery(items: Row[]): { needsAdmin: boolean; lines: string[] } {
  let auto = 0, manualDone = 0, needsAdmin = 0, inProgress = 0, wr = 0;
  for (const item of items) {
    const status = String(item.status ?? "");
    if (item.wr_link_id != null) wr++;
    else if (status === "delivered") {
      if (String(item.delivered_message_id ?? "").startsWith("item:")) auto++;
      else manualDone++;
    }
    else if (status === "manual_required" || status === "failed") needsAdmin++;
    else inProgress++;
  }
  const lines: string[] = [];
  if (needsAdmin) lines.push(`🛠 ${needsAdmin} item perlu dikirim: Panel → Pesanan → Kirim ke pembeli`);
  if (auto) lines.push(`📧 ${auto} item terkirim otomatis ke email pembeli`);
  if (manualDone) lines.push(`✅ ${manualDone} item sudah diserahkan admin`);
  if (inProgress) lines.push(`⏳ ${inProgress} item sedang dikirim otomatis`);
  if (wr) lines.push(`🤖 ${wr} item diproses otomatis lewat Warung Rebahan`);
  if (!lines.length) lines.push("⏳ Menunggu proses pengiriman");
  return { needsAdmin: needsAdmin > 0, lines };
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
  const { queryFirst, queryAll } = database;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !telegramNotificationsConfigured()) return false;
  const order = await queryFirst(
    `SELECT o.code, o.items, o.customer_name, o.customer_email, o.customer_wa, o.subtotal, o.payment_method,
            (SELECT pt.payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code
              ORDER BY pt.id DESC LIMIT 1) AS payable_amount
     FROM orders o
     WHERE o.code=? AND o.sales_channel='web' AND o.status='lunas' AND o.payment_status='paid'`,
    orderCode,
  ).catch(() => null);
  if (!order) return true;
  const items = await queryAll(
    `SELECT status, delivered_message_id, wr_link_id FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  const { claimNotice, settleNotice } = await import("@/lib/notify-buyer");
  const key = `admin-paid:${orderCode}`;
  if (!(await claimNotice(database, key, orderCode, "telegram"))) return true;
  const delivery = summarizeWebDelivery(items);
  const text = adminWebOrderPaidMessage({
    orderCode: String(order.code),
    productNames: productNames(order.items),
    amount: Number(order.payable_amount ?? order.subtotal ?? 0),
    customerName: String(order.customer_name || ""),
    customerEmail: String(order.customer_email || ""),
    customerWa: String(order.customer_wa || ""),
    paymentMethod: String(order.payment_method || "qris"),
    needsAdmin: delivery.needsAdmin,
    deliveryLines: delivery.lines,
  });
  const failed = (description: string) => ({ ok: false as const, description });
  let sent = await sendMessage({
    chat_id: adminChatId,
    text,
    parse_mode: "HTML",
    reply_markup: webPaidAdminKeyboard({ customerWa: String(order.customer_wa || ""), orderCode: String(order.code), siteUrl: siteOrigin() }),
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
  const want = {
    created: only?.created ?? true,
    paid: only?.paid ?? true,
    paidAdmin: only?.paidAdmin ?? true,
    // Pemanggil lama yang memberi `only` tanpa kunci ini tidak ikut membaca
    // antrean web (menjaga anggaran query cron, RR3-01).
    paidAdminWeb: only ? only.paidAdminWeb === true : true,
  };
  let created = 0;
  let paid = 0;
  let paidAdmin = 0;
  if (want.created && database.canSpend(1)) {
    const pendingCreated = await queryAll(
      `SELECT code, sales_channel FROM orders
       WHERE sales_channel IN ('telegram','whatsapp') AND telegram_order_notified_at IS NULL
       ORDER BY created_at ASC LIMIT ?`,
      limit,
    ).catch(() => [] as Row[]);
    for (const order of pendingCreated) {
      if (!database.canSpend(7)) break;
      try {
        const ok = String(order.sales_channel || "telegram") === "whatsapp"
          ? await notifyWhatsAppOrderCreated(String(order.code), database)
          : await notifyTelegramOrderCreated(String(order.code), database);
        if (ok) created++;
      } catch { /* Retry the same durable marker on the next cron run. */ }
    }
  }

  if (want.paid && database.canSpend(1)) {
    const pendingPaid = await queryAll(
      `SELECT code FROM orders
       WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid'
         AND telegram_paid_notified_at IS NULL
       ORDER BY updated_at ASC LIMIT ?`,
      limit,
    ).catch(() => [] as Row[]);
    for (const order of pendingPaid) {
      if (!database.canSpend(7)) break;
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
      limit,
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
      limit,
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
            o.telegram_reminder_sent_at, pt.payable_amount, pt.expires_at, o.subtotal
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
      const result = await sendMessage({
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
