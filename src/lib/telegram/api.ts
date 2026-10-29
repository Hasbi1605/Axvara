// src/lib/telegram/api.ts — Thin wrapper over Telegram Bot API via fetch
// No framework dependencies. Edge-compatible. Timeout-aware.

import type {
  TelegramApiResponse,
  SendMessageParams,
  SendPhotoParams,
  EditMessageTextParams,
  TelegramMessage,
  WebhookInfo,
} from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  return token;
}

async function callApi<T>(
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<TelegramApiResponse<T>> {
  const token = getToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const json = (await res.json()) as TelegramApiResponse<T>;
    return json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, description: "Request timeout" };
    }
    return { ok: false, description: error instanceof Error ? error.message : "Unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(params: SendMessageParams): Promise<TelegramApiResponse<TelegramMessage>> {
  return callApi<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
}

export async function sendPhoto(params: SendPhotoParams): Promise<TelegramApiResponse> {
  return callApi("sendPhoto", params as unknown as Record<string, unknown>);
}

export async function editMessageText(params: EditMessageTextParams): Promise<TelegramApiResponse> {
  return callApi("editMessageText", params as unknown as Record<string, unknown>);
}

/**
 * Try editMessageText first; fall back to sendMessage ONLY when the target
 * message cannot hold this text (photo caption message, deleted message).
 *
 * Dulu fallback berlaku untuk kegagalan APA PUN, sehingga paginasi katalog
 * kadang memunculkan pesan katalog baru: ketuk ▶️ dua kali cepat → dua
 * callback `catalog:N` yang sama → edit kedua ditolak Telegram "message is
 * not modified" → pesan baru. 429 dan timeout juga memicu pesan baru padahal
 * edit pertama mungkin sudah mendarat.
 */
export async function safeEditOrSend(params: EditMessageTextParams): Promise<TelegramApiResponse> {
  if (!params.message_id) return sendMessage(params);
  const editResult = await editMessageText(params);
  if (editResult.ok) return editResult;
  const description = String(editResult.description || "");
  // Pesan sudah menampilkan isi yang diminta — itu keberhasilan, bukan gagal.
  if (/message is not modified/i.test(description)) return { ok: true, description };
  // Hanya 400 (pesan target tak bisa diedit) yang layak diganti pesan baru;
  // 429/5xx/timeout/jaringan tanpa error_code 400 tidak.
  if (editResult.error_code !== 400) return editResult;
  return sendMessage({
    chat_id: params.chat_id,
    text: params.text,
    parse_mode: params.parse_mode,
    reply_markup: params.reply_markup,
    disable_web_page_preview: params.disable_web_page_preview,
  });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<TelegramApiResponse> {
  return callApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function setWebhook(
  url: string,
  secretToken: string,
  maxConnections = 40,
): Promise<TelegramApiResponse> {
  return callApi("setWebhook", {
    url,
    secret_token: secretToken,
    max_connections: maxConnections,
    allowed_updates: ["message", "callback_query"],
  });
}

export async function getWebhookInfo(): Promise<TelegramApiResponse<WebhookInfo>> {
  return callApi<WebhookInfo>("getWebhookInfo");
}

export async function deleteWebhook(): Promise<TelegramApiResponse> {
  return callApi("deleteWebhook", { drop_pending_updates: false });
}

/**
 * Show typing/upload indicator to user.
 * Actions: "typing", "upload_photo", "upload_document", etc.
 */
export async function sendChatAction(
  chatId: number | string,
  action: "typing" | "upload_photo" | "upload_document" | "upload_video" = "typing",
): Promise<TelegramApiResponse> {
  return callApi("sendChatAction", { chat_id: chatId, action });
}

// Compatibility wrapper for the welcome/product presentation only.
export async function withLoadingIndicator<T>(
  chatId: number | string,
  label: string,
  work: (beforeResult: () => Promise<void>) => Promise<T>,
): Promise<T> {
  await showLoadingBar(chatId, label).catch(() => {});
  return work(async () => {});
}

export async function showLoadingBar(chatId: number | string, label = "Memuat"): Promise<void> {
  const bar = (filled: number) => `${"▓".repeat(filled)}${"░".repeat(10 - filled)} ${filled * 10}%`;
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const sent = await sendMessage({ chat_id: chatId, text: `${label}\n${bar(0)}` });
  if (!sent.ok || !sent.result) return;
  const messageId = sent.result.message_id;
  try {
    for (const [delay, filled] of [[400, 4], [500, 7], [400, 10]]) {
      await wait(delay);
      const edited = await editMessageText({ chat_id: chatId, message_id: messageId, text: `${label}\n${bar(filled)}` });
      if (!edited.ok) return;
    }
    await wait(300);
  } finally {
    await callApi("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
  }
}

/**
 * Register bot commands in Telegram menu (the "/" button).
 */
export async function setMyCommands(): Promise<TelegramApiResponse> {
  return callApi("setMyCommands", {
    commands: [
      { command: "start", description: "🏠 Menu utama" },
      { command: "katalog", description: "🛍 Lihat katalog produk" },
      { command: "cari", description: "🔎 Cari produk" },
      { command: "cart", description: "🛒 Keranjang belanja" },
      { command: "orders", description: "📦 Riwayat pesanan saya" },
      { command: "pesanan", description: "📋 Cek status pesanan" },
      { command: "bantuan", description: "❓ Bantuan & cara beli" },
      { command: "garansi", description: "🛡 Garansi & replace" },
      { command: "chatid", description: "🔔 Lihat ID grup notifikasi" },
    ],
  });
}
