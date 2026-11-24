// src/lib/telegram/handlers/extras.ts — Router extras (W-B).
//
// Owns callback prefixes `mo:*`, `claim:*`, `claimstart:*`, `rst:*` plus the
// text/photo input for warranty claims and the `/start restock_<id>` deep link.
// The webhook already answered the callback query before extras runs, so every
// handler here confirms via message/edit and never relies on a callback alert.
// Ownership + private-chat checks live in the orders/* helpers and here; every
// handler swallows its own errors and answers with a friendly 🏠 Menu, never
// throwing back to the caller.

import type { Locale } from "@/lib/i18n/locale";

export type ExtraFrom = { id: number; first_name: string; username?: string };

function isPrivate(from: ExtraFrom, chatId: number): boolean {
  return Number.isSafeInteger(chatId) && chatId > 0 && chatId === from.id;
}

async function friendlyFailure(chatId: number, from: ExtraFrom): Promise<void> {
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
    const locale: Locale = await tgCtxFor(from.id).then((ctx) => ctx.locale).catch(() => "id");
    await sendMessage({
      chat_id: chatId,
      text: locale === "en" ? "Something went wrong. Please try again." : "Terjadi kesalahan. Silakan coba lagi.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: locale === "en" ? "🏠 Home" : "🏠 Menu", callback_data: "home" }]] },
    });
  } catch { /* best effort */ }
}

export async function handleExtraCallback(
  action: string,
  params: string[],
  chatId: number,
  messageId: number,
  from: ExtraFrom,
): Promise<boolean> {
  try {
    if (!isPrivate(from, chatId)) return false;

    if (action === "mo") {
      const { handleMyOrdersPaged } = await import("./orders");
      const tab = params[0] === "a" || params[0] === "s" || params[0] === "g" ? params[0] : undefined;
      const page = Number(params[1] ?? params[0] ?? 0);
      await handleMyOrdersPaged(chatId, messageId, tab, Number.isFinite(page) ? page : 0, from);
      return true;
    }

    if (action === "claim") {
      const code = String(params[0] ?? "");
      if (!code) return false;
      const { handleWarrantyClaim } = await import("./orders");
      await handleWarrantyClaim(chatId, messageId, code, from);
      return true;
    }

    if (action === "claimstart") {
      const code = String(params[0] ?? "");
      if (!code) return false;
      const { handleWarrantyClaimStart } = await import("./orders");
      await handleWarrantyClaimStart(chatId, messageId, code, from);
      return true;
    }

    if (action === "rst") {
      const productId = Number(params[0] ?? 0);
      if (!Number.isSafeInteger(productId) || productId <= 0) return false;
      await replyRestockRetired(chatId, from);
      return true;
    }

    return false;
  } catch {
    await friendlyFailure(chatId, from);
    return true;
  }
}

/** `rst:<pid>` / `/start restock_<id>` — retired (owner 2026-11-24).
 *  Keep graceful reply for old buttons in chat history without subscribing. */
async function replyRestockRetired(chatId: number, from: ExtraFrom): Promise<void> {
  const { sendMessage } = await import("@/lib/telegram/api");
  const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
  const locale: Locale = await tgCtxFor(from.id).then((ctx) => ctx.locale).catch(() => "id");
  const en = locale === "en";
  const text = en
    ? "<b>ℹ️ Restock alerts are no longer available</b>\n\nBrowse the catalog to see products currently in stock."
    : "<b>ℹ️ Pengingat restok sudah tidak tersedia</b>\n\nCek katalog untuk melihat produk yang sedang tersedia.";
  await sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: en ? "🛍 Catalog" : "🛍 Katalog", callback_data: "catalog:0" },
        { text: en ? "🏠 Menu" : "🏠 Menu", callback_data: "home" },
      ]],
    },
  });
}

export async function handleExtraText(
  text: string,
  chatId: number,
  from: ExtraFrom,
  photoFileId?: string,
): Promise<boolean> {
  try {
    if (!isPrivate(from, chatId)) return false;
    const { handlePendingWarrantyClaimInput } = await import("./orders");
    return await handlePendingWarrantyClaimInput(text, chatId, from, photoFileId);
  } catch {
    await friendlyFailure(chatId, from);
    return true;
  }
}

export async function handleExtraStartPayload(
  payload: string,
  chatId: number,
  from: ExtraFrom,
): Promise<boolean> {
  try {
    if (!isPrivate(from, chatId)) return false;
    const match = /^restock_(\d{1,15})$/.exec(payload);
    if (!match) return false;
    const productId = Number(match[1]);
    if (!Number.isSafeInteger(productId) || productId <= 0) return false;
    await replyRestockRetired(chatId, from);
    return true;
  } catch {
    await friendlyFailure(chatId, from);
    return true;
  }
}
