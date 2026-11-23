// src/lib/telegram/handlers/shared.ts — Helper kecil bersama antar-handler.
//
// MENGAPA dipisah: markDone, clearPendingAction, getBestsellers, dan clampQty
// dipakai oleh beberapa handler (command, callback, invoice). Menaruhnya di
// satu tempat mencegah impor melingkar antar-handler dan menjaga perilaku
// konsisten di seluruh bot Telegram.

import { execRun, getD1, isD1Mode, queryFirst } from "@/lib/db";
import * as tgApi from "@/lib/telegram/api";
import { homeKeyboard, mainReplyMenu, TELEGRAM_MAX_QTY, type TgPriceCtx } from "@/lib/telegram/keyboards";
import type { TelegramBestseller } from "@/lib/telegram/messages";
import { welcomeMessageLocalized } from "@/lib/telegram/messages/preferences";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import type { Locale } from "@/lib/i18n/locale";
import type { InlineKeyboardMarkup, SendMessageParams, SendPhotoParams, TelegramApiResponse, TelegramMessage } from "@/lib/telegram/types";
import { unwrapD1 } from "@/lib/db-access";

const CF_CTX_SYMBOL = Symbol.for("__cloudflare-request-context__");
type CfCtx = { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } };

/** Schedule background work on Cloudflare waitUntil when present, without ever leaking rejections. */
export function runInBackground(work: Promise<unknown>): void {
  const safe = Promise.resolve(work).catch(() => {});
  try {
    const reqCtx = (globalThis as unknown as Record<symbol, CfCtx | undefined>)[CF_CTX_SYMBOL];
    if (typeof reqCtx?.ctx?.waitUntil === "function") {
      reqCtx.ctx.waitUntil(safe);
      return;
    }
  } catch { /* fall through outside Workers */ }
  void safe;
}

export type ScreenSourceMeta = {
  isPhoto?: boolean;
  isCatalogPhoto?: boolean;
  isProtected?: boolean;
  /** Telegram update_id of this callback (journal key for idempotent mutations). */
  updateId?: string;
};

export const TG_WELCOME_BANNER_VERSION = "20261120";
export const TG_CATALOG_BANNER_VERSION = "20261120b";

export function tgBannerUrl(filename: string, version: string): string {
  const rawSite = (process.env.SITE_URL ?? "").trim().replace(/\/$/, "");
  const siteUrl = /^https?:\/\//i.test(rawSite) ? rawSite : "https://axvara.tech";
  return `${siteUrl}/banners/${filename}?v=${version}`;
}

const TG_PHOTO_FILE_IDS_KEY = "tg_photo_file_ids";
const PHOTO_HYDRATE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_PHOTO_URLS = 50;
const NO_PHOTO_D1_KEY = {};
type PhotoCacheBucket = { hydratedAt: number; loaded: boolean; map: Map<string, string> };
const photoCacheByD1 = new WeakMap<object, PhotoCacheBucket>();

function getPhotoBucket(): { bucket: PhotoCacheBucket; persistent: boolean } {
  let d1Key: object = NO_PHOTO_D1_KEY;
  try {
    const raw = typeof getD1 === "function" ? getD1() : null;
    if (raw) d1Key = unwrapD1(raw) as object;
  } catch { /* fallback */ }
  if (d1Key === NO_PHOTO_D1_KEY) {
    return { bucket: { hydratedAt: 0, loaded: false, map: new Map() }, persistent: false };
  }
  let bucket = photoCacheByD1.get(d1Key);
  if (!bucket) {
    bucket = { hydratedAt: 0, loaded: false, map: new Map() };
    photoCacheByD1.set(d1Key, bucket);
  }
  return { bucket, persistent: isD1Mode() };
}

async function hydratePhotoBucket(bucket: PhotoCacheBucket, persistent: boolean): Promise<void> {
  if (!persistent) return;
  const now = Date.now();
  if (bucket.loaded && now - bucket.hydratedAt < PHOTO_HYDRATE_TTL_MS) return;
  bucket.loaded = true;
  bucket.hydratedAt = now;
  try {
    const row = await queryFirst(`SELECT value FROM store_settings WHERE key=?`, TG_PHOTO_FILE_IDS_KEY);
    if (row?.value) {
      const parsed = JSON.parse(String(row.value)) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v.trim()) bucket.map.set(k, v.trim());
        }
      }
    }
  } catch { /* best-effort */ }
}

async function persistPhotoBucket(bucket: PhotoCacheBucket, persistent: boolean): Promise<void> {
  if (!persistent) return;
  while (bucket.map.size > MAX_CACHED_PHOTO_URLS) {
    const oldest = bucket.map.keys().next().value;
    if (!oldest) break;
    bucket.map.delete(oldest);
  }
  const obj = Object.fromEntries(bucket.map.entries());
  await execRun(
    `INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`,
    TG_PHOTO_FILE_IDS_KEY,
    JSON.stringify(obj),
  ).catch(() => {});
}

function extractLargestFileId(res: TelegramApiResponse<TelegramMessage>): string | null {
  const photos = res.result?.photo;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const last = photos[photos.length - 1];
  return typeof last?.file_id === "string" && last.file_id.trim() ? last.file_id.trim() : null;
}

function isUrlPhoto(photo: string): boolean {
  return /^https?:\/\//i.test(photo.trim());
}

/**
 * Send photo with cached Telegram file_id lookup (isolate + store_settings).
 * Evicts cached file_id on HTTP 400 and retries ONCE with URL; never retries
 * sendPhoto on 4xx URL errors.
 */
export async function sendCachedPhoto(
  params: SendPhotoParams,
): Promise<TelegramApiResponse<TelegramMessage>> {
  const rawPhoto = String(params.photo || "").trim();
  if (!isUrlPhoto(rawPhoto)) {
    return tgApi.sendPhoto(params);
  }
  const { bucket, persistent } = getPhotoBucket();
  await hydratePhotoBucket(bucket, persistent);
  const cachedFileId = bucket.map.get(rawPhoto);
  if (cachedFileId) {
    const res = await tgApi.sendPhoto({ ...params, photo: cachedFileId });
    if (res.ok) return res;
    if (res.error_code === 400) {
      bucket.map.delete(rawPhoto);
      runInBackground(persistPhotoBucket(bucket, persistent));
      // Fall through to retry once with the original URL after evicting stale file_id.
    } else {
      return res;
    }
  }
  const urlRes = await tgApi.sendPhoto({ ...params, photo: rawPhoto });
  if (urlRes.ok) {
    const fileId = extractLargestFileId(urlRes);
    if (fileId) {
      bucket.map.set(rawPhoto, fileId);
      runInBackground(persistPhotoBucket(bucket, persistent));
    }
  }
  return urlRes;
}

async function safeDeleteOldMessage(chatId: number | string, messageId: number | undefined): Promise<void> {
  if (!messageId || messageId <= 0) return;
  if (typeof tgApi.deleteMessage !== "function") return;
  await tgApi.deleteMessage(chatId, messageId).catch(() => {});
}

/** Single-screen helper for transitioning to a text screen. */
export async function replaceWithText(
  params: {
    chat_id: number | string;
    message_id?: number;
    text: string;
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: InlineKeyboardMarkup;
    disable_web_page_preview?: boolean;
  },
  sourceMeta?: ScreenSourceMeta,
): Promise<TelegramApiResponse> {
  const msgId = params.message_id && !sourceMeta?.isProtected ? params.message_id : 0;
  if (sourceMeta?.isPhoto && msgId > 0) {
    const sendParams: SendMessageParams = {
      chat_id: params.chat_id,
      text: params.text,
      parse_mode: params.parse_mode,
      reply_markup: params.reply_markup,
      disable_web_page_preview: params.disable_web_page_preview,
    };
    const sent = await tgApi.sendMessage(sendParams);
    if (sent.ok) runInBackground(safeDeleteOldMessage(params.chat_id, msgId));
    return sent;
  }
  const edited = await tgApi.safeEditOrSend({
    chat_id: params.chat_id,
    message_id: msgId,
    text: params.text,
    parse_mode: params.parse_mode,
    reply_markup: params.reply_markup,
    disable_web_page_preview: params.disable_web_page_preview,
  });
  return edited;
}

/** Single-screen helper for transitioning to a photo screen (editMedia for photo->photo, send+delete for text->photo). */
export async function replaceWithPhoto(
  params: {
    chat_id: number | string;
    message_id?: number;
    photo: string;
    caption?: string;
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: InlineKeyboardMarkup;
  },
  sourceMeta?: ScreenSourceMeta,
): Promise<TelegramApiResponse<TelegramMessage>> {
  const msgId = params.message_id && !sourceMeta?.isProtected ? params.message_id : 0;
  const rawPhoto = String(params.photo || "").trim();

  if (sourceMeta?.isPhoto && msgId > 0 && typeof tgApi.editMessageMedia === "function") {
    const { bucket, persistent } = getPhotoBucket();
    if (isUrlPhoto(rawPhoto)) await hydratePhotoBucket(bucket, persistent);
    const cachedFileId = isUrlPhoto(rawPhoto) ? bucket.map.get(rawPhoto) : undefined;
    const firstMedia = cachedFileId || rawPhoto;
    const res = await tgApi.editMessageMedia({
      chat_id: params.chat_id,
      message_id: msgId,
      media: {
        type: "photo",
        media: firstMedia,
        caption: params.caption,
        parse_mode: params.parse_mode,
      },
      reply_markup: params.reply_markup,
    });
    if (res.ok) {
      if (isUrlPhoto(rawPhoto) && !cachedFileId) {
        const fid = extractLargestFileId(res);
        if (fid) {
          bucket.map.set(rawPhoto, fid);
          runInBackground(persistPhotoBucket(bucket, persistent));
        }
      }
      return res;
    }
    const desc = String(res.description || "");
    if (/message is not modified/i.test(desc)) return { ok: true, description: desc } as TelegramApiResponse<TelegramMessage>;
    if (res.error_code === 400 && cachedFileId) {
      bucket.map.delete(rawPhoto);
      runInBackground(persistPhotoBucket(bucket, persistent));
      const retryUrl = await tgApi.editMessageMedia({
        chat_id: params.chat_id,
        message_id: msgId,
        media: {
          type: "photo",
          media: rawPhoto,
          caption: params.caption,
          parse_mode: params.parse_mode,
        },
        reply_markup: params.reply_markup,
      });
      if (retryUrl.ok) {
        const fid = extractLargestFileId(retryUrl);
        if (fid) {
          bucket.map.set(rawPhoto, fid);
          runInBackground(persistPhotoBucket(bucket, persistent));
        }
        return retryUrl;
      }
      if (/message is not modified/i.test(String(retryUrl.description || ""))) {
        return { ok: true, description: retryUrl.description } as TelegramApiResponse<TelegramMessage>;
      }
      if (retryUrl.error_code !== 400) return retryUrl;
      if (/failed to get HTTP URL|wrong type of the web page content|WEBPAGE_|PHOTO_INVALID/i.test(String(retryUrl.description || ""))) {
        return retryUrl;
      }
    } else if (res.error_code !== 400) {
      return res;
    } else if (/failed to get HTTP URL|wrong type of the web page content|WEBPAGE_|PHOTO_INVALID/i.test(desc)) {
      return res;
    }
    // 400 (message can't be edited / not found): fall through to send new photo + delete old
  }

  const sent = await sendCachedPhoto({
    chat_id: params.chat_id,
    photo: rawPhoto,
    caption: params.caption,
    parse_mode: params.parse_mode,
    reply_markup: params.reply_markup,
  });
  if (sent.ok && msgId > 0) {
    runInBackground(safeDeleteOldMessage(params.chat_id, msgId));
  }
  return sent;
}

/** Tandai update Telegram sebagai selesai (idempotency, issue #6). */
export async function markDone(updateId: string) {
  if (isD1Mode()) {
    await execRun(
      `UPDATE telegram_updates SET status='done', updated_at=datetime('now') WHERE update_id=?`,
      updateId,
    );
  }
}

/** Bersihkan state percakapan (pending_action) milik user, best-effort.
 * R2 anchor guard: durable `creating` payq1 TIDAK PERNAH dihapus di sini —
 * berlaku untuk /start, /language, /currency, /batal, katalog, help,
 * checkout lama, dan navigasi router. Hanya quoted/contact/namespace lain
 * yang boleh dibersihkan. Creating dibersihkan HANYA setelah TX tersimpan
 * (status apa pun) atau order terminal via clearPayq1AfterDurableTx. */
export async function clearPendingAction(from?: { id: number }) {
  if (from && isD1Mode()) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action IS NOT NULL AND pending_action NOT LIKE 'payq1:%"st":"creating"%'`,
      String(from.id),
    ).catch(() => {});
  }
}

/** Set a new conversational state (qty/search/email/wa) WITHOUT ever replacing
 * a durable `creating` payq1 anchor (R2-C). Returns true when the state was
 * written (or there is no row to write — legacy no-op), false when a creating
 * anchor blocked it; in that case the buyer gets the existing "creating"
 * notice and the caller must stop (the anchor is resumed with the same
 * confirmation button, never discarded). */
export async function setPendingActionUnlessCreating(
  userId: string,
  chatId: number,
  value: string,
): Promise<boolean> {
  if (!isD1Mode()) return true;
  const { queryFirst } = await import("@/lib/db");
  const written = await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND (pending_action IS NULL OR pending_action NOT LIKE 'payq1:%"st":"creating"%')`,
    value, userId,
  ).catch(() => ({ changes: 1 }));
  if ((written.changes ?? 0) > 0) return true;
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, userId).catch(() => null);
  if (!/^payq1:.*"st":"creating"/.test(String(row?.pending_action ?? ""))) return true;
  const { sendMessage } = await import("@/lib/telegram/api");
  const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
  const { paymentMethodNoticeMessage } = await import("@/lib/telegram/messages/purchase");
  const ctx = await tgCtxFor(Number(userId)).catch(() => ({ locale: "id" as const }));
  await sendMessage({ chat_id: chatId, text: paymentMethodNoticeMessage("creating", { locale: ctx.locale }), parse_mode: "HTML" }).catch(() => {});
  return false;
}

/** Explicit /batal: hapus quoted/contact payq1 via exact-CAS, JANGAN sentuh
 * creating (durable anchor; dibersihkan hanya setelah TX/order terminal). */
export async function clearPayq1DraftForCancel(from?: { id: number }) {
  if (!from || !isD1Mode()) return;
  const { readPayq1State } = await import("@/lib/telegram/payment-quote");
  const stored = await readPayq1State(String(from.id)).catch(() => null);
  if (stored?.state && (stored.state.st === "quoted" || stored.state.st === "contact")) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
      String(from.id),
      stored.raw,
    ).catch(() => {});
  }
}

// Bestsellers for the welcome landing (free marketing from sold_count).
export async function getBestsellers(limit = 3): Promise<TelegramBestseller[]> {
  try {
    // Sapaan /start tidak boleh mempromosikan produk yang habis.
    const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
    return (await readTelegramCatalog()).filter(row => row.price !== null && row.sold_count > 0)
      .sort((a,b) => b.sold_count-a.sold_count || a.sort_order-b.sort_order)
      .slice(0, Math.max(0, limit))
      .map(row => ({ productId: row.id, name: row.name, price: row.price!, soldCount: row.sold_count, stock: row.stock }));
  } catch {
    return [];
  }
}

// --- Clear qty stepper followed directly by dynamic QRIS ---
// (Bulk cap lives in keyboards.ts as TELEGRAM_MAX_QTY.)
export function clampQty(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(TELEGRAM_MAX_QTY, Math.floor(raw)));
}

/**
 * Install the bottom reply menu (mainReplyMenu, is_persistent: false) via a
 * silent carrier message that is deleted immediately afterward so no junk
 * bubble stays in chat. Telegram clients retain the reply keyboard after
 * deletion (PM verifies on live Telegram). Runs in background (`waitUntil`)
 * so it never delays the home card; errors are swallowed.
 */
export function installReplyMenu(chatId: number, locale: Locale): void {
  runInBackground(
    (async () => {
      const sent = await tgApi.sendMessage({
        chat_id: chatId,
        text: "⌨️",
        reply_markup: mainReplyMenu(locale),
        disable_notification: true,
      });
      const carrierId = sent?.ok ? sent.result?.message_id : undefined;
      if (carrierId && typeof tgApi.deleteMessage === "function") {
        await tgApi.deleteMessage(chatId, carrierId).catch(() => {});
      }
    })().catch(() => {}),
  );
}

export async function sendOrReplaceCatalogPhoto(params: {
  chatId: number | string;
  messageId?: number;
  caption: string;
  replyMarkup: InlineKeyboardMarkup;
  sourceMeta?: ScreenSourceMeta;
}): Promise<void> {
  const photoUrl = tgBannerUrl("tg-catalog.jpg", TG_CATALOG_BANNER_VERSION);
  const msgId = params.messageId && !params.sourceMeta?.isProtected ? params.messageId : 0;

  if (params.caption.length <= 1024) {
    if (
      msgId > 0 &&
      params.sourceMeta?.isPhoto &&
      params.sourceMeta?.isCatalogPhoto &&
      typeof tgApi.editMessageCaption === "function"
    ) {
      const capRes = await tgApi.editMessageCaption({
        chat_id: params.chatId,
        message_id: msgId,
        caption: params.caption,
        parse_mode: "HTML",
        reply_markup: params.replyMarkup,
      }).catch(() => ({ ok: false as const, error_code: undefined, description: undefined }));
      if (capRes?.ok) return;
      const desc = String(capRes?.description || "");
      if (/message is not modified/i.test(desc)) return;
      if (capRes?.error_code !== 400) return;
    }

    const photoRes = await (msgId > 0
      ? replaceWithPhoto({
          chat_id: params.chatId,
          message_id: msgId,
          photo: photoUrl,
          caption: params.caption,
          parse_mode: "HTML",
          reply_markup: params.replyMarkup,
        }, params.sourceMeta)
      : sendCachedPhoto({
          chat_id: params.chatId,
          photo: photoUrl,
          caption: params.caption,
          parse_mode: "HTML",
          reply_markup: params.replyMarkup,
        })
    ).catch(() => ({ ok: false as const }));

    if (photoRes?.ok) return;
  }

  if (msgId > 0) {
    await replaceWithText({
      chat_id: params.chatId,
      message_id: msgId,
      text: params.caption,
      parse_mode: "HTML",
      reply_markup: params.replyMarkup,
    }, params.sourceMeta);
  } else {
    await tgApi.sendMessage({
      chat_id: params.chatId,
      text: params.caption,
      parse_mode: "HTML",
      reply_markup: params.replyMarkup,
    });
  }
}

/**
 * Send or replace the home screen as ONE message: welcome banner photo
 * (file_id cached) + localized greeting/bestsellers caption + inline
 * homeKeyboard, falling back to ONE text message with the same caption and
 * keyboard if sendPhoto fails. Optionally installs the bottom reply menu in
 * background via deleted carrier on /start and onboarding completion.
 */
export async function sendTgHome(params: {
  chatId: number;
  firstName: string;
  locale: Locale;
  userId?: number;
  replaceMessageId?: number;
  sourceMeta?: ScreenSourceMeta;
  bestsellers?: TelegramBestseller[];
  ctx?: TgPriceCtx;
  installMenu?: boolean;
}): Promise<void> {
  const photoUrl = tgBannerUrl("tg-welcome.jpg", TG_WELCOME_BANNER_VERSION);
  const caption = welcomeMessageLocalized(params.locale, params.firstName);
  const keyboard = homeKeyboard(params.locale);

  const canReplace = Boolean(params.replaceMessageId && !params.sourceMeta?.isProtected);
  const photoRes = await (canReplace
    ? replaceWithPhoto({
        chat_id: params.chatId,
        message_id: params.replaceMessageId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }, params.sourceMeta)
    : sendCachedPhoto({
        chat_id: params.chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
  ).catch(() => ({ ok: false as const }));

  if (!photoRes?.ok) {
    if (canReplace) {
      await replaceWithText({
        chat_id: params.chatId,
        message_id: params.replaceMessageId,
        text: caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }, params.sourceMeta);
    } else {
      await tgApi.sendMessage({
        chat_id: params.chatId,
        text: caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
  }

  if (params.installMenu) {
    installReplyMenu(params.chatId, params.locale);
  }
}
