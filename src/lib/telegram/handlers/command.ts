import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
// src/lib/telegram/handlers/command.ts — Router perintah teks (/start, dll).
//
// MENGAPA dipisah: handleCommand memetakan perintah slash + label reply-keyboard
// ke handler yang sesuai. Ini "tabel routing" — dipisah dari handler leaf agar
// mudah melihat perintah apa yang tersedia tanpa menggulir implementasi. Router
// mempertahankan URUTAN pengecekan asli (pending WA → /start → label menu →
// qty → search → /garansi → /pesanan → fallback). Pemindahan murni.

import * as tgApi from "@/lib/telegram/api";
import { sendMessage } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, languageChooserKeyboard, currencyKeyboard, settingsKeyboard,
  helpKeyboard, mainReplyMenu, MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS,
  MENU_LABEL_WARRANTY, MENU_LABEL_HELP, MENU_LABEL_HELP_LEGACY, MENU_LABEL_CART, MENU_LABEL_EN,
} from "@/lib/telegram/keyboards";
import { welcomeMessage, helpMessage, warrantyFullMessage } from "@/lib/telegram/messages";
import {
  languageChooserMessage, welcomeCaption, welcomeMessageLocalized, settingsMessage,
  currencyChooserMessage, resumePayloadMessage,
} from "@/lib/telegram/messages/preferences";
import { readTgPreferences, isValidTgLocale } from "@/lib/telegram/preferences";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { clearPayq1DraftForCancel, clearPendingAction, getBestsellers, runInBackground, sendCachedPhoto } from "./shared";
import { handleShowCatalog, handleShowProduct } from "./catalog";
import {
  handleSearchPrompt, handleSearchResults, handleMyOrders, handlePendingSearchInput,
  handlePendingQtyInput, handlePendingWaInput, handlePendingEmailInput,
} from "./discovery";
import { handleOrderStatus } from "./orders";
import { handleShowCart } from "./cart";

async function clearPendingUnlessCreating(from?: { id: number }) {
  if (from) {
    const { readPayq1State } = await import("@/lib/telegram/payment-quote");
    const stored = await readPayq1State(String(from.id)).catch(() => null);
    if (!stored?.state || stored.state.st !== "creating") {
      await clearPendingAction(from);
    }
  } else {
    await clearPendingAction(from);
  }
}

export async function handleCommand(
  text: string,
  chatId: number,
  chatType: string,
  from?: { id: number; first_name: string; username?: string },
  photoFileId?: string,
) {
  const trimmed = text.trim();
  const cmd = trimmed.toLowerCase().split(/\s+/)[0]?.split("@")[0] ?? "";

  if ((cmd === '/stop' || cmd === '/siaran_on') && from && chatType === 'private' && chatId === from.id) {
    const { execRun } = await import('@/lib/db');
    await execRun("UPDATE telegram_users SET broadcast_opt_out=? WHERE user_id=? AND chat_id=?", cmd === '/stop' ? 1 : 0, String(from.id), String(chatId));
    await sendMessage({ chat_id: chatId, text: cmd === '/stop' ? 'Siaran Telegram dihentikan. Notifikasi pesanan tetap berjalan. Kirim /siaran_on untuk berlangganan kembali.' : 'Siaran Telegram diaktifkan kembali. Kirim /stop untuk berhenti.' });
    return;
  }

  // Cancel conversational input explicitly, before leaf slash-command filters.
  // Durable `creating` intents are NEVER cleared here — R2 clears them only
  // after a recoverable TX exists or the order is terminal.
  if (cmd === "/batal") {
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null };
    const locale = prefs.locale ?? "id";
    if (from) {
      await clearPayq1DraftForCancel(from);
      await clearPendingAction(from);
    } else {
      await clearPendingAction(from);
    }
    await sendMessage({
      chat_id: chatId,
      text: locale === "en" ? "Input cancelled. Choose a menu below to continue." : "Input dibatalkan. Pilih menu di bawah untuk melanjutkan.",
      reply_markup: mainReplyMenu(locale),
    });
    return;
  }

  async function sendTgHome(
    targetChatId: number,
    firstName: string,
    locale: Locale,
  ): Promise<void> {
    const [bestsellers, ctx] = await Promise.all([
      getBestsellers(3),
      tgCtxFor(from?.id ?? targetChatId),
    ]);
    const rawSite = (process.env.SITE_URL ?? "").trim().replace(/\/$/, "");
    const siteUrl = /^https?:\/\//i.test(rawSite) ? rawSite : "https://axvara.tech";
    const photoUrl = `${siteUrl}/banners/tg-welcome.jpg?v=20261119`;

    // Install persistent 3x2 reply keyboard on the welcome banner photo (never a junk bubble),
    // followed by the welcome card message carrying inline bestsellers + action buttons.
    await sendCachedPhoto({
      chat_id: targetChatId,
      photo: photoUrl,
      caption: welcomeCaption(locale),
      parse_mode: "HTML",
      reply_markup: mainReplyMenu(locale),
    }).catch(() => {});

    await sendMessage({
      chat_id: targetChatId,
      text: welcomeMessageLocalized(locale, firstName, bestsellers),
      parse_mode: "HTML",
      reply_markup: homeKeyboard(locale, bestsellers, ctx),
    });
  }

  if (cmd === "/start") {
    if (await notifyPaymentMaintenance(chatId)) return;
    if (typeof tgApi.sendChatAction === "function") {
      runInBackground(tgApi.sendChatAction(chatId, "typing"));
    }
    await clearPendingUnlessCreating(from);
    const rawPayload = trimmed.split(/\s+/).slice(1).join(" ").trim();
    const { normalizeStartPayload, saveOnboardingPayload } = await import("@/lib/telegram/preferences");
    const payload = normalizeStartPayload(rawPayload);
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null, currency: null };
    if (!prefs.locale) {
      if (from) await saveOnboardingPayload(String(from.id), payload);
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    if (payload) {
      const prdMatch = /^prd_(\d+)$/i.exec(payload);
      if (prdMatch) {
        await handleShowProduct(chatId, 0, Number(prdMatch[1]), from);
        return;
      }
      if (from) {
        const { handleExtraStartPayload } = await import("./extras");
        if (await handleExtraStartPayload(payload, chatId, from)) return;
      }
    }
    const firstName = from?.first_name ?? "Pengguna";
    await sendTgHome(chatId, firstName, prefs.locale);
    if (payload) {
      await sendMessage({
        chat_id: chatId,
        text: resumePayloadMessage(prefs.locale, payload),
        parse_mode: "HTML",
      });
    }
    return;
  }

  // TG1: /language changes locale ONLY (currency untouched); /currency
  // changes currency ONLY (locale untouched); /settings shows both.
  if ((cmd === "/language" || cmd === "/bahasa" || cmd === "/settings") && from && chatType === "private" && chatId === from.id) {
    const prefs = await readTgPreferences(String(from.id));
    if (!prefs.locale) {
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    if (cmd === "/language") {
      const parts = trimmed.split(/\s+/).slice(1);
      const want = parts[0]?.toLowerCase();
      if (want && isValidTgLocale(want)) {
        const { saveTgLocaleOnly } = await import("@/lib/telegram/preferences");
        await saveTgLocaleOnly(String(from.id), want);
        const { tgPrefText } = await import("@/lib/telegram/messages/preferences");
        const [bestsellers, ctx] = await Promise.all([getBestsellers(3), tgCtxFor(from.id)]);
        await sendMessage({
          chat_id: chatId,
          text: tgPrefText(want, "language_saved"),
          parse_mode: "HTML",
          reply_markup: homeKeyboard(want, bestsellers, ctx),
        });
        return;
      }
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    if (cmd === "/bahasa") {
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    await sendMessage({
      chat_id: chatId,
      text: settingsMessage(prefs.locale, prefs.currency),
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(),
    });
    return;
  }

  if (cmd === "/currency" && from && chatType === "private" && chatId === from.id) {
    const prefs = await readTgPreferences(String(from.id));
    if (!prefs.locale) {
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    const parts = trimmed.split(/\s+/).slice(1);
    const want = parts[0]?.toUpperCase();
    const { isValidTgCurrency, saveTgCurrencyChoice } = await import("@/lib/telegram/preferences");
    const { tgPrefText } = await import("@/lib/telegram/messages/preferences");
    if (isValidTgCurrency(want)) {
      await saveTgCurrencyChoice(String(from.id), want);
      await sendMessage({ chat_id: chatId, text: tgPrefText(prefs.locale, "currency_saved"), parse_mode: "HTML" });
      return;
    }
    await sendMessage({
      chat_id: chatId,
      text: currencyChooserMessage(prefs.locale, prefs.currency),
      parse_mode: "HTML",
      reply_markup: currencyKeyboard(prefs.locale, prefs.currency),
    });
    return;
  }

  // Slash commands first (before pending input & free-text search).
  if (cmd === "/katalog") {
    await clearPendingUnlessCreating(from);
    await handleShowCatalog(chatId, from);
    return;
  }

  if (cmd === "/cari" || cmd === "/search") {
    await clearPendingUnlessCreating(from);
    const searchArg = trimmed.replace(/^\/(?:cari|search)(?:@\S+)?/i, "").trim();
    if (searchArg.length >= 2) {
      await handleSearchResults(chatId, searchArg, from);
    } else {
      await handleSearchPrompt(chatId, from);
    }
    return;
  }

  if (cmd === "/orders" || cmd === "/riwayat") {
    await clearPendingUnlessCreating(from);
    await handleMyOrders(chatId, from);
    return;
  }

  if (cmd === "/cart" || cmd === "/keranjang") {
    await clearPendingUnlessCreating(from);
    await handleShowCart(chatId, 0, from);
    return;
  }

  if (cmd === "/garansi") {
    await clearPendingUnlessCreating(from);
    await sendMessage({
      chat_id: chatId,
      text: warrantyFullMessage(),
      parse_mode: "HTML",
      reply_markup: warrantyKeyboard(),
    });
    return;
  }

  if (cmd === "/pesanan") {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      await handleOrderStatus(chatId, parts[1], from?.id);
    } else {
      await handleMyOrders(chatId, from);
    }
    return;
  }

  if (cmd === "/bantuan" || cmd === "/help") {
    await clearPendingUnlessCreating(from);
    const locale = from ? (await readTgPreferences(String(from.id)).catch(() => ({ locale: null as null }))).locale ?? "id" : "id";
    await sendMessage({ chat_id: chatId, text: helpMessage({ locale }), parse_mode: "HTML", reply_markup: helpKeyboard({ locale }) });
    return;
  }

  // Persistent reply-menu labels routed BEFORE pending-input handlers so buyers are never trapped.
  if (trimmed === MENU_LABEL_CATALOG || trimmed === MENU_LABEL_EN.catalog) {
    await clearPendingUnlessCreating(from);
    await handleShowCatalog(chatId, from);
    return;
  }

  if (trimmed === MENU_LABEL_SEARCH || trimmed === MENU_LABEL_EN.search) {
    await clearPendingUnlessCreating(from);
    await handleSearchPrompt(chatId, from);
    return;
  }

  if (
    trimmed === MENU_LABEL_ORDERS ||
    trimmed === MENU_LABEL_EN.orders ||
    trimmed === "📦 Pesanan Saya" ||
    trimmed === "📦 My Orders"
  ) {
    await clearPendingUnlessCreating(from);
    await handleMyOrders(chatId, from);
    return;
  }

  if (trimmed === MENU_LABEL_CART || trimmed === MENU_LABEL_EN.cart) {
    await clearPendingUnlessCreating(from);
    await handleShowCart(chatId, 0, from);
    return;
  }

  if (trimmed === MENU_LABEL_WARRANTY || trimmed === MENU_LABEL_EN.warranty) {
    await clearPendingUnlessCreating(from);
    await sendMessage({
      chat_id: chatId,
      text: warrantyFullMessage(),
      parse_mode: "HTML",
      reply_markup: warrantyKeyboard(),
    });
    return;
  }

  if (
    trimmed === MENU_LABEL_HELP ||
    trimmed === MENU_LABEL_HELP_LEGACY ||
    trimmed === MENU_LABEL_EN.help ||
    trimmed === MENU_LABEL_EN.helpLegacy
  ) {
    await clearPendingUnlessCreating(from);
    const locale = from ? (await readTgPreferences(String(from.id)).catch(() => ({ locale: null as null }))).locale ?? "id" : "id";
    await sendMessage({ chat_id: chatId, text: helpMessage({ locale }), parse_mode: "HTML", reply_markup: helpKeyboard({ locale }) });
    return;
  }

  // Existing pending-input handlers (only when non-empty non-slash text).
  if (from && trimmed && !cmd.startsWith("/")) {
    if (await handlePendingWaInput(trimmed, chatId, from)) return;
    const { handleBuyerInput } = await import("./buyer-input");
    if (await handleBuyerInput(trimmed, chatId, from)) return;
    if (/^\d{1,3}$/.test(cmd)) {
      if (await handlePendingQtyInput(trimmed, chatId, from)) return;
    }
    const { handlePayq1PhoneInput } = await import("./payment-contact");
    if (await handlePayq1PhoneInput(trimmed, chatId, from).catch(() => false)) return;
    if (await handlePendingEmailInput(trimmed, chatId, from)) return;
    if (await handlePendingSearchInput(trimmed, chatId, from)) return;
  }

  // Extras text / photo handler (e.g. claim proof upload).
  if (from) {
    const { handleExtraText } = await import("./extras");
    if (await handleExtraText(trimmed, chatId, from, photoFileId)) return;
  }

  // Free-text search: plain text >= 2 chars directly searches catalog instead of dumping home.
  if (!cmd.startsWith("/") && trimmed.length >= 2) {
    await handleSearchResults(chatId, trimmed, from);
    return;
  }

  if (photoFileId && !trimmed) return;

  // Unknown command or single-character message: show welcome in saved locale.
  const [fallbackCtx, bestsellers] = await Promise.all([
    tgCtxFor(from?.id ?? chatId).catch(() => ({ locale: "id" as const, displayCurrency: null, fx: null })),
    getBestsellers(3),
  ]);
  await sendMessage({
    chat_id: chatId,
    text: fallbackCtx.locale === "en"
      ? welcomeMessageLocalized(fallbackCtx.locale, from?.first_name ?? "Pengguna", bestsellers)
      : welcomeMessage(from?.first_name ?? "Pengguna", bestsellers),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(fallbackCtx.locale, bestsellers, fallbackCtx),
  });
}
