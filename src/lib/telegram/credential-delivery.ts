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

/** Telegram's hard cap on `text`; the same limit applies to captions. */
const TELEGRAM_MAX_TEXT = 4096;

/** `error_code` + `description` (or error name/message), never message content. */
function tgErrorDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail.slice(0, 120);
  const record = detail as { error_code?: unknown; description?: unknown; message?: unknown; name?: unknown };
  const code = Number(record.error_code);
  const description = String(record.description ?? record.message ?? record.name ?? "");
  const text = Number.isFinite(code) && code > 0 ? `${code} ${description}`.trim() : description;
  return text.slice(0, 120);
}

/** Error message that keeps the caller's contract and appends a safe diagnostic. */
function sendRejection(error: string, detail: unknown): string {
  const suffix = tgErrorDetail(detail);
  return suffix ? `${error}:${suffix}` : error;
}

/**
 * Rejections a plain-text resend can actually fix: entity parse errors (buyer
 * text broke our tags) and messages over the 4096 cap. A 400 for "chat not
 * found"/"blocked" must NOT take this path — we would ship an unformatted wall
 * of tags and mask a real delivery failure as formatting.
 */
function shouldFallbackToPlainText(detail: unknown): boolean {
  const record = detail as { error_code?: unknown; description?: unknown } | null;
  if (Number(record?.error_code) !== 400) return false;
  return /parse entities|unsupported start tag|can't find end tag|message is too long/i.test(String(record?.description ?? ""));
}

/**
 * Rendered credential HTML → readable plain text. Only used when Telegram
 * rejects our entities; the credential itself is preserved verbatim.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:pre|code|blockquote)>/gi, "\n")
    .replace(/<(?:pre|code|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split on code points so a too-long part never breaks a surrogate pair. */
function splitPlainText(text: string, limit = TELEGRAM_MAX_TEXT): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of text) {
    if (current.length + char.length > limit) {
      chunks.push(current);
      current = "";
    }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * One HTML attempt, then plain text when Telegram rejects the entities or the
 * part already exceeds the 4096 cap (splitting is always on the plain
 * rendering, so a tag is never cut in half).
 */
async function sendCredentialText(target: string, text: string): Promise<string> {
  const { sendMessage } = await import("@/lib/telegram/api");
  const sendPlain = async (html: string): Promise<string> => {
    const plainText = htmlToPlainText(html) || html.replace(/<[^>]*>/g, "").trim();
    let messageId = "";
    for (const chunk of splitPlainText(plainText)) {
      const plain = await sendMessage({ chat_id: target, text: chunk, disable_web_page_preview: true });
      if (!plain?.ok) throw new Error(sendRejection("telegram_credential_part_failed", plain));
      messageId = String((plain as { result?: { message_id?: unknown } }).result?.message_id ?? "");
    }
    return messageId;
  };
  if (text.length > TELEGRAM_MAX_TEXT) return sendPlain(text);
  const sent = await sendMessage({ chat_id: target, text, parse_mode: "HTML", disable_web_page_preview: true });
  if (sent?.ok) return String((sent as { result?: { message_id?: unknown } }).result?.message_id ?? "");
  if (!shouldFallbackToPlainText(sent)) throw new Error(sendRejection("telegram_credential_part_failed", sent));
  return sendPlain(text);
}

/** All parts must succeed before callers settle delivery. Never send to a group. */
export async function sendTelegramCredentialParts(
  chatId: string | number,
  messages: string[],
): Promise<{ chatId: string; messageId: string }> {
  const target = positiveId(chatId);
  if (!target) throw new Error("no_private_telegram_chat");
  if (!messages.length) throw new Error("telegram_credential_empty");
  let messageId = "";
  for (const text of messages) messageId = await sendCredentialText(target, text);
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
      `SELECT code, items, status, payment_status, fulfillment_status, locale, order_kind FROM orders WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'`,
      code, String(chatId),
    );
    const kind = String(order?.order_kind ?? "apps");
    rows = order?.status === "lunas" && order.payment_status === "paid" && kind === "apps"
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
  const orderKind = String(order.order_kind ?? "apps");
  if (orderKind === "games" || orderKind === "pedia") {
    await sendMessage({
      chat_id: chatId,
      text: locale === "en"
        ? `This is ${orderKind === "games" ? "a Games top up" : "a Pedia"} order — it does not have account credentials. Tap <b>View Order</b> to check its latest status.`
        : `Pesanan ini adalah pesanan ${orderKind === "games" ? "Top Up Games" : "AXVARA Pedia"} — tidak memiliki detail akun. Tekan <b>Lihat Pesanan</b> untuk cek status terbarunya.`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: locale === "en" ? "📋 View Order" : "📋 Lihat Pesanan", callback_data: `order:${code}` }],
          [{ text: locale === "en" ? "🏠 Home" : "🏠 Menu", callback_data: "home" }],
        ],
      },
    });
    return 0;
  }
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
  // One structured diagnostic per failed unit; never the plaintext/ciphertext.
  const warnFailed = (item: unknown, stage: "decrypt" | "empty" | "render" | "send", detail?: unknown) => {
    console.warn("[tg-resend] failed", { order: code, item: Number(item ?? 0), stage, tg: tgErrorDetail(detail) || undefined });
  };
  // Decrypt every ready unit first so the multi-unit / long path can decide
  // between ONE .txt file and the existing per-unit messages.
  type PreparedUnit = { plaintext: string; productName: string; itemIndex: number; copy: ReturnType<typeof copies.get> };
  const prepared: PreparedUnit[] = [];
  let missingStored = 0;
  for (const row of ready) {
    const productName = orderLineLabel(order.items, Number(row.item_index ?? 0));
    const itemIndex = Number(row.item_index ?? 0);
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
        // Stored but blank: the text is not recoverable from the bot either.
        missingStored++;
        warnFailed(itemIndex, "empty");
        continue;
      }
      prepared.push({ plaintext, productName, itemIndex, copy: copies.get(Number(row.variant_id)) });
    } catch (error) {
      // Undecryptable is PERMANENT, not transient: AES-GCM is authenticated, so
      // an auth-tag mismatch means a different key (the 2026-11-10
      // FULFILLMENT_ENCRYPTION_KEY replacement) or tampered data. Retrying can
      // never succeed; this is what made "Ambil Ulang" loop forever on old sk: rows.
      missingStored++;
      warnFailed(itemIndex, "decrypt", error);
    }
  }
  let sent = 0;
  let transientFailed = 0;
  const renderable = prepared.filter(unit => unit.plaintext.trim());
  // Item 14: one .txt for multi-unit or long credentials. Fall back to the
  // existing per-unit messages if the document upload fails.
  const combinedLength = renderable.reduce((sum, unit) => sum + unit.plaintext.length, 0);
  const useTxt = renderable.length > 1 || combinedLength > 1500;
  let txtFellBack = false;
  let txtDelivered = false;
  if (useTxt && renderable.length) {
    try {
      const { sendDocument } = await import("@/lib/telegram/send-document");
      const { buildCredentialsTxtFile, credentialsTxtFilename } = await import("@/lib/telegram/messages/credential");
      const file = buildCredentialsTxtFile({
        orderCode: code,
        units: renderable.map(unit => ({ plaintext: unit.plaintext, productName: unit.productName, copy: unit.copy })),
        locale,
      });
      const doc = await sendDocument({
        chat_id: chatId,
        content: file,
        filename: credentialsTxtFilename(code),
        caption: locale === "en"
          ? `<b>📦 Product details</b>\n<code>${escapeHtml(code)}</code>\n${renderable.length} file(s) of credentials in the attached .txt.`
          : `<b>📦 Detail produk</b>\n<code>${escapeHtml(code)}</code>\n${renderable.length} kredensial ada di file .txt terlampir.`,
        parse_mode: "HTML",
        reply_markup: orderTerminalKeyboard({ locale }),
      });
      if (doc.ok) {
        sent = renderable.length;
        txtDelivered = true;
      } else {
        txtFellBack = true;
        warnFailed(renderable[0].itemIndex, "send", doc);
      }
    } catch (error) {
      txtFellBack = true;
      warnFailed(renderable[0].itemIndex, "send", error);
    }
  }
  if (!useTxt || txtFellBack) {
    for (const unit of renderable) {
      let messages: string[];
      try {
        messages = credentialMessages({
          orderCode: code,
          productName: unit.productName,
          plaintext: unit.plaintext,
          copy: unit.copy,
          locale,
        });
      } catch (error) {
        transientFailed++;
        warnFailed(unit.itemIndex, "render", error);
        continue;
      }
      try {
        await sendTelegramCredentialParts(chatId, messages);
        sent++;
      } catch (error) {
        transientFailed++;
        warnFailed(unit.itemIndex, "send", error);
      }
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
  // The .txt caption already confirms the delivery; only add a separate
  // summary bubble when something still needs the buyer's attention.
  if (text && !(txtDelivered && !waiting)) await sendMessage({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  return sent;
}
