// src/lib/telegram/credential-delivery.ts — Kirim kredensial ke pembeli Telegram
// dengan FALLBACK target + tombol ambil ulang (2026-10-04, permintaan owner).
//
// Masalah: kredensial WR/SK dulu hanya dicoba ke SATU target
// (`telegram_users.chat_id`). Produk stok sendiri terbukti sampai karena
// dikirim ke `telegram_user_id` (identitas pembeli — di Telegram id user =
// id chat pribadi dengan bot). Bila satu target gagal (chat_id basi, salah
// simpan), kredensial supplier jatuh ke retry tanpa jalan lain.
//
// Semua kredensial hanya menuju telegram_user_id pemilik (ID chat pribadi
// kanonis). ID chat tersimpan yang berbeda bukan bukti kepemilikan.
//
// Fallback terakhir: tombol "📦 Ambil Detail Produk" pada pesan lunas — pembeli
// menekannya di chat bot dan bot mengirim ulang semua detail yang sudah siap
// (dibaca dari fulfillment_items.delivered_ciphertext — WR, SK, stok sendiri,
// dan serah terima admin semuanya menulis kolom ini).

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { expandDeliveryLines } from "@/lib/fulfillment/units";

type Row = Record<string, unknown>;

/** All parts must succeed before callers settle delivery. Never send to a group. */
export async function sendTelegramCredentialParts(
  chatId: string | number,
  messages: string[],
): Promise<{ chatId: string; messageId: string }> {
  const target = positiveId(chatId);
  if (!target) throw new Error("no_private_telegram_chat");
  if (!messages.length) throw new Error("telegram_credential_empty");
  const { sendMessage } = await import("@/lib/telegram/api");
  let messageId = "";
  for (const text of messages) {
    const sent = await sendMessage({ chat_id: target, text, parse_mode: "HTML", disable_web_page_preview: true });
    if (!sent?.ok) throw new Error("telegram_credential_part_failed");
    messageId = String((sent as { result?: { message_id?: unknown } }).result?.message_id ?? "");
  }
  return { chatId: target, messageId };
}

function positiveId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : "";
}

/** No fallback to a different private account, even when stored as chat_id. */
export async function telegramPrivateTargets(order: Row, _database: DatabaseAccess): Promise<string[]> {
  void _database;
  const buyerId = positiveId(order.telegram_user_id);
  return buyerId ? [buyerId] : [];
}

/**
 * Kirim satu pesan kredensial ke target pertama yang berhasil. Melempar bila
 * semua target gagal agar pemanggil menjadwalkan retry (WR backoff / SK
 * reconcile). `no_private_telegram_chat` = belum ada target pribadi sama
 * sekali (order dari grup sebelum pembeli START).
 */
export async function sendTelegramCredential(
  order: Row,
  text: string | string[],
  database: DatabaseAccess,
): Promise<{ chatId: string; messageId: string }> {
  const targets = await telegramPrivateTargets(order, database);
  if (!targets.length) throw new Error("no_private_telegram_chat");
  const errors: string[] = [];
  for (const chatId of targets) {
    try {
      return await sendTelegramCredentialParts(chatId, Array.isArray(text) ? text : [text]);
    } catch {
      errors.push(`${chatId}:telegram_send_failed`);
    }
  }
  throw new Error(`telegram_delivery_failed ${errors.join(" | ")}`.slice(0, 300));
}

/**
 * Tombol "📦 Ambil Detail Produk": kirim ulang SEMUA detail yang sudah siap
 * untuk order milik pembeli ini ke chat pribadi tempat tombol ditekan.
 * Pemanggil (router callback) sudah memastikan from.id = pemilik order dan
 * chat bukan grup. Mengembalikan jumlah unit yang berhasil dikirim lengkap;
 * hasil kosong, gagal, dan parsial diberi pesan yang berbeda.
 */
export async function resendTelegramCredentials(
  orderCode: string,
  chatId: number,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<number> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return 0;
  const code = String(orderCode || "").toUpperCase();
  const { sendMessage } = await import("@/lib/telegram/api");
  const { credentialResendOutcomeKeyboard, minimalMenuKeyboard, orderTerminalKeyboard } = await import("@/lib/telegram/keyboards");
  const { escapeHtml } = await import("@/lib/telegram/messages/format");
  let order;
  let rows: Row[];
  try {
    order = await database.queryFirst(
      `SELECT code, items, status, payment_status, fulfillment_status, locale FROM orders WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'`,
      code, String(chatId),
    );
    rows = order?.status === "lunas" && order.payment_status === "paid"
      ? await database.queryAll(
        `SELECT item_index, variant_id, status, delivered_ciphertext, delivered_iv, delivered_message_id
         FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
        code,
      ) : [];
  } catch {
    await sendMessage({
      chat_id: chatId,
      text: "Detail produk gagal dibaca. Coba lagi atau hubungi admin.",
      parse_mode: "HTML",
      reply_markup: credentialResendOutcomeKeyboard(code, "transient"),
    });
    return 0;
  }
  if (!order) {
    await sendMessage({
      chat_id: chatId,
      text: "Pesanan tidak ditemukan.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard(),
    });
    return 0;
  }
  const locale = String(order.locale ?? "") === "en" ? "en" as const : "id" as const;
  const paid = String(order.status) === "lunas" && String(order.payment_status) === "paid";
  if (!paid) {
    await sendMessage({
      chat_id: chatId,
      text: locale === "en"
        ? "Order is not paid yet. Product details are available after payment is received."
        : "Pesanan belum lunas. Detail produk tersedia setelah pembayaran diterima.",
      parse_mode: "HTML",
      reply_markup: orderTerminalKeyboard({ locale }),
    });
    return 0;
  }
  const ready = rows.filter(row => row.status === "delivered");
  const { decryptSecret } = await import("@/lib/fulfillment/crypto");
  const { orderLineLabel } = await import("@/lib/fulfillment/delivery/buyer-email");
  const { credentialMessages } = await import("@/lib/telegram/messages/credential");
  const { resolveCredentialTermsForVariants } = await import("@/lib/orders/credential-terms");
  let copies;
  try {
    copies = await resolveCredentialTermsForVariants(ready.map(row => Number(row.variant_id)), database);
  } catch {
    await sendMessage({
      chat_id: chatId,
      text: locale === "en" ? "Product details failed to read. Try again or contact admin." : "Detail produk gagal dibaca. Coba lagi atau hubungi admin.",
      parse_mode: "HTML",
      reply_markup: credentialResendOutcomeKeyboard(code, "transient", { locale }),
    });
    return 0;
  }
  const { normalizeAccountDetailsForDisplay } = await import("@/lib/warung-rebahan/deliver");
  let sent = 0;
  let transientFailed = 0;
  let missingStored = 0;
  for (const row of ready) {
    if (!row.delivered_ciphertext || !row.delivered_iv) {
      missingStored++;
      continue;
    }
    try {
      let plaintext = await decryptSecret(String(row.delivered_ciphertext), String(row.delivered_iv));
      if (String(row.delivered_message_id ?? "").startsWith("wr:")) {
        plaintext = normalizeAccountDetailsForDisplay(plaintext);
      }
      if (!plaintext.trim()) {
        missingStored++;
        continue;
      }
      await sendTelegramCredentialParts(chatId, credentialMessages({
        orderCode: code,
        productName: orderLineLabel(order.items, Number(row.item_index ?? 0)),
        plaintext,
        copy: copies.get(Number(row.variant_id)),
        locale,
      }));
      sent++;
    } catch {
      transientFailed++;
    }
  }
  const expected = Math.max(rows.length, expandDeliveryLines(order.items).length);
  const hasFailedOrManual = rows.some(row => ["failed", "manual_required"].includes(String(row.status)))
    || ["failed", "manual_required"].includes(String(order.fulfillment_status));
  const missingDeliveredRows = String(order.fulfillment_status) === "delivered" && (!ready.length || ready.length < expected);
  const permanentMissing = (missingStored > 0 || missingDeliveredRows) && transientFailed === 0;
  const waiting = expected - ready.length;
  let text = "";
  let replyMarkup: import("@/lib/telegram/types").InlineKeyboardMarkup | undefined;
  if (transientFailed > 0 || (hasFailedOrManual && !permanentMissing)) {
    text = locale === "en"
      ? `${sent ? `${sent} product details sent. ` : ""}Product details failed to read or send. Fetch details again or contact admin.`
      : `${sent ? `${sent} detail produk berhasil dikirim. ` : ""}Detail produk gagal dibaca atau dikirim. Coba ambil detail lagi atau hubungi admin.`;
    replyMarkup = credentialResendOutcomeKeyboard(code, "transient", { locale });
  } else if (permanentMissing) {
    text = locale === "en"
      ? `${sent ? `${sent} product details sent. ` : ""}Details for this order are not stored in the bot. Contact admin with order code <code>${escapeHtml(code)}</code>.`
      : `${sent ? `${sent} detail produk berhasil dikirim. ` : ""}Detail untuk pesanan ini tidak tersimpan di bot. Hubungi admin dengan kode pesanan <code>${escapeHtml(code)}</code>.`;
    replyMarkup = credentialResendOutcomeKeyboard(code, "permanent", { locale });
  } else if (!sent) {
    text = locale === "en"
      ? "Product details are not ready yet. The order is still being prepared. Check status again later."
      : "Detail produk belum siap. Pesanan masih disiapkan. Cek status lagi nanti.";
    replyMarkup = orderTerminalKeyboard({ locale });
  } else if (waiting) {
    text = locale === "en"
      ? `${sent} product details sent. The rest are not ready yet. Check status again later.`
      : `${sent} detail produk berhasil dikirim. Detail lainnya belum siap. Cek status lagi nanti.`;
    replyMarkup = orderTerminalKeyboard({ locale });
  }
  if (text) await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  return sent;
}
