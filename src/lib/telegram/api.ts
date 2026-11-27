// src/lib/telegram/api.ts — Thin wrapper over Telegram Bot API via fetch
// No framework dependencies. Edge-compatible. Timeout-aware.

import type {
  AnyReplyMarkup,
  TelegramApiResponse,
  SendMessageParams,
  SendPhotoParams,
  EditMessageTextParams,
  EditMessageMediaParams,
  EditMessageCaptionParams,
  TelegramMessage,
  TelegramUser,
  TelegramChatMember,
  WebhookInfo,
} from "./types";
import { applyButtonStyles } from "./button-style";
import { applyCustomEmoji, hasCustomEmoji, stripCustomEmoji } from "./custom-emoji";
import { siteOrigin } from "@/lib/site-url";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

export const TELEGRAM_WEBHOOK_MAX_CONNECTIONS = 40;
export const TELEGRAM_WEBHOOK_ALLOWED_UPDATES = ["message", "callback_query"] as const;

export function canonicalWebhookUrl(): string {
  return `${siteOrigin()}/api/telegram/webhook`;
}

export function buildCanonicalWebhookParams(
  secretToken: string,
  url = canonicalWebhookUrl(),
  maxConnections = TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
) {
  return {
    url,
    secret_token: secretToken,
    max_connections: maxConnections,
    allowed_updates: [...TELEGRAM_WEBHOOK_ALLOWED_UPDATES],
    drop_pending_updates: false as const,
  };
}

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

  const styled = body && "reply_markup" in body && body.reply_markup != null
    ? { ...body, reply_markup: applyButtonStyles(body.reply_markup as AnyReplyMarkup) }
    : body;
  // Custom emoji animasi (Bot API 9.4+, pemilik bot Premium). Bila Telegram
  // menolak payload berhias (400, mis. Premium pemilik habis atau ID emoji
  // tidak valid), kirim ulang sekali dengan emoji standar agar pesan tetap
  // sampai. "message is not modified" bukan kegagalan emoji; jangan diulang.
  const decorated = applyCustomEmoji(styled);
  const first = await postToTelegram<T>(url, decorated, timeoutMs, signal);
  if (
    hasCustomEmoji(decorated) &&
    !first.ok &&
    first.error_code === 400 &&
    !/message is not modified/i.test(String(first.description || ""))
  ) {
    return postToTelegram<T>(url, stripCustomEmoji(styled), timeoutMs, signal);
  }
  return first;
}

async function postToTelegram<T>(
  url: string,
  payload: Record<string, unknown> | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TelegramApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const json = (await res.json()) as TelegramApiResponse<T>;
    return json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, description: "Request timeout" };
    }
    const raw = error instanceof Error ? error.message : "Unknown error";
    return {
      ok: false,
      description: raw.replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "https://api.telegram.org/bot[REDACTED]"),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(params: SendMessageParams): Promise<TelegramApiResponse<TelegramMessage>> {
  return callApi<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
}

export async function getMe(): Promise<TelegramApiResponse<TelegramUser>> {
  return callApi<TelegramUser>("getMe", undefined, 5_000);
}

const GET_CHAT_MEMBER_TIMEOUT_MS = 4_000;

export async function getChatMember(
  chatId: number | string,
  userId: number,
  timeoutMs = GET_CHAT_MEMBER_TIMEOUT_MS,
): Promise<TelegramApiResponse<TelegramChatMember>> {
  return callApi<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: userId }, timeoutMs);
}

export { classifyTelegramSend, type TelegramSendOutcome } from "./send-outcome";

// Telegram harus mengambil URL foto lalu mengunggahnya; saat API lambat
// (insiden 2026-11-03) 10 detik terlalu pendek dan foto tetap terkirim
// SETELAH kita menyerah. Beri waktu lebih panjang khusus sendPhoto.
const SEND_PHOTO_TIMEOUT_MS = 25_000;

export async function sendPhoto(params: SendPhotoParams): Promise<TelegramApiResponse<TelegramMessage>> {
  return callApi<TelegramMessage>("sendPhoto", params as unknown as Record<string, unknown>, SEND_PHOTO_TIMEOUT_MS);
}

export async function editMessageText(params: EditMessageTextParams): Promise<TelegramApiResponse> {
  return callApi("editMessageText", params as unknown as Record<string, unknown>);
}

export async function editMessageMedia(params: EditMessageMediaParams): Promise<TelegramApiResponse<TelegramMessage>> {
  return callApi<TelegramMessage>("editMessageMedia", params as unknown as Record<string, unknown>);
}

export async function editMessageCaption(params: EditMessageCaptionParams): Promise<TelegramApiResponse<TelegramMessage>> {
  return callApi<TelegramMessage>("editMessageCaption", params as unknown as Record<string, unknown>);
}

export async function deleteMessage(chatId: number | string, messageId: number): Promise<TelegramApiResponse> {
  return callApi("deleteMessage", { chat_id: chatId, message_id: messageId });
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
  maxConnections = TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
): Promise<TelegramApiResponse> {
  return callApi("setWebhook", buildCanonicalWebhookParams(secretToken, url, maxConnections));
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
      { command: "katalog", description: "🛍 Katalog produk" },
      { command: "games", description: "🎮 Top up game instan" },
      { command: "pedia", description: "📈 Layanan sosial media" },
      { command: "orders", description: "📦 Pesanan saya" },
      { command: "bantuan", description: "💬 Bantuan" },
      { command: "bahasa", description: "🌐 Bahasa / Language" },
    ],
  });
}
