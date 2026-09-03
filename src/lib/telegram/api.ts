// src/lib/telegram/api.ts — Thin wrapper over Telegram Bot API via fetch
// No framework dependencies. Edge-compatible. Timeout-aware.

import type {
  TelegramApiResponse,
  SendMessageParams,
  SendPhotoParams,
  EditMessageTextParams,
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
      signal: controller.signal,
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

export async function sendMessage(params: SendMessageParams): Promise<TelegramApiResponse> {
  return callApi("sendMessage", params as unknown as Record<string, unknown>);
}

export async function sendPhoto(params: SendPhotoParams): Promise<TelegramApiResponse> {
  return callApi("sendPhoto", params as unknown as Record<string, unknown>);
}

export async function editMessageText(params: EditMessageTextParams): Promise<TelegramApiResponse> {
  return callApi("editMessageText", params as unknown as Record<string, unknown>);
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
