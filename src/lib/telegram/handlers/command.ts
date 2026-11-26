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
import { SITE } from "@/lib/site";
import {
  cb, homeKeyboard, warrantyKeyboard, languageChooserKeyboard, settingsKeyboard,
  helpKeyboard, mainReplyMenu, MENU_LABEL_CATALOG, MENU_LABEL_PEDIA, MENU_LABEL_GAMES,
  MENU_LABEL_SEARCH, MENU_LABEL_ORDERS,
  MENU_LABEL_WARRANTY, MENU_LABEL_HELP, MENU_LABEL_HELP_LEGACY,
  MENU_LABEL_SETTINGS, MENU_LABEL_SETTINGS_GLOBE_LEGACY, MENU_LABEL_SETTINGS_LEGACY, MENU_LABEL_EN,
} from "@/lib/telegram/keyboards";
import { readHomeTelegramCategories } from "@/lib/telegram/catalog-snapshot";
import { welcomeMessage, helpMessage, warrantyFullMessage } from "@/lib/telegram/messages";
import {
  languageChooserMessage, welcomeMessageLocalized, settingsMessage,
  resumePayloadMessage,
} from "@/lib/telegram/messages/preferences";
import { readTgPreferences, isValidTgLocale } from "@/lib/telegram/preferences";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import {
  checkUserChannelMembership,
  forceSubGateKeyboard,
  forceSubGateMessage,
} from "@/lib/telegram/force-sub";
import type { Locale } from "@/lib/i18n/locale";
import { clearPayq1DraftForCancel, clearPendingAction, runInBackground, sendTgHome } from "./shared";
import { handleShowCatalog, handleShowProduct } from "./catalog";
import {
  handleSearchPrompt, handleSearchResults, handleMyOrders, handlePendingSearchInput,
  handlePendingQtyInput, handlePendingWaInput, handlePendingEmailInput,
} from "./discovery";
import { handleOrderStatus } from "./orders";

async function clearPendingUnlessCreating(from?: { id: number }) {
  if (from) {
    const { readPayq1State } = await import("@/lib/telegram/payment-quote");
    const stored = await readPayq1State(String(from.id)).catch(() => null);
    if (!stored?.state || stored.state.st !== "creating") {
      if (
        stored?.raw?.startsWith("pvinput:")
        || stored?.raw?.startsWith("custominput:")
        || (stored?.state?.source.kind === "single" && (stored.state.source.pvFlowId || stored.state.source.customFlowId))
      ) {
        const { clearPixelverifStash } = await import("./buyer-input");
        await clearPixelverifStash(String(from.id));
      }
      await clearPendingAction(from);
    }
  } else {
    await clearPendingAction(from);
  }
}

async function maybeBlockForceSubCommand(
  chatId: number,
  chatType: string,
  from?: { id: number },
  options?: { bypassCache?: boolean; startPayload?: string | null; locale?: Locale | null },
): Promise<boolean> {
  if (!from || chatType !== "private" || chatId !== from.id) return false;
  const check = await checkUserChannelMembership({
    userId: from.id,
    bypassCache: options?.bypassCache,
  });
  if (check.allowed) return false;
  if (options?.startPayload) {
    const { saveOnboardingPayload } = await import("@/lib/telegram/preferences");
    await saveOnboardingPayload(String(from.id), options.startPayload);
  }
  const locale = options && "locale" in options
    ? (options.locale ?? null)
    : (await readTgPreferences(String(from.id)).catch(() => ({ locale: null as Locale | null }))).locale;
  await sendMessage({
    chat_id: chatId,
    text: forceSubGateMessage(check.config, locale),
    parse_mode: "HTML",
    reply_markup: forceSubGateKeyboard(check.config, locale),
    disable_web_page_preview: true,
  });
  return true;
}

export async function handleCommand(
  text: string,
  chatId: number,
  chatType: string,
  from?: { id: number; first_name: string; username?: string },
  photoFileId?: string,
  messageId?: number,
) {
  const trimmed = text.trim();
  const cmd = trimmed.toLowerCase().split(/\s+/)[0]?.split("@")[0] ?? "";

  if ((cmd === '/stop' || cmd === '/siaran_on') && from && chatType === 'private' && chatId === from.id) {
    const { execRun } = await import('@/lib/db');
    await execRun("UPDATE telegram_users SET broadcast_opt_out=? WHERE user_id=? AND chat_id=?", cmd === '/stop' ? 1 : 0, String(from.id), String(chatId));
    await sendMessage({ chat_id: chatId, text: cmd === '/stop' ? 'Promo dihentikan (notif pesanan tetap aktif). Aktifkan: /siaran_on' : 'Promo diaktifkan kembali. Berhenti: /stop' });
    return;
  }

  // Cancel conversational input explicitly, before leaf slash-command filters.
  // Durable `creating` intents are NEVER cleared here — R2 clears them only
  // after a recoverable TX exists or the order is terminal.
  if (cmd === "/batal") {
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null };
    const locale = prefs.locale ?? "id";
    if (from) {
      const { clearPixelverifStash } = await import("./buyer-input");
      await clearPixelverifStash(String(from.id));
      await clearPayq1DraftForCancel(from);
      await clearPendingAction(from);
    } else {
      await clearPendingAction(from);
    }
    await sendMessage({
      chat_id: chatId,
      text: locale === "en" ? "Cancelled." : "Dibatalkan.",
      reply_markup: mainReplyMenu(locale),
    });
    return;
  }

  if (cmd === "/start") {
    if (await notifyPaymentMaintenance(chatId)) return;
    if (typeof tgApi.sendChatAction === "function") {
      runInBackground(tgApi.sendChatAction(chatId, "typing"));
    }
    if (from) {
      const { clearPixelverifStash } = await import("./buyer-input");
      await clearPixelverifStash(String(from.id));
    }
    await clearPendingUnlessCreating(from);
    const rawPayload = trimmed.split(/\s+/).slice(1).join(" ").trim();
    const { normalizeStartPayload, saveOnboardingPayload } = await import("@/lib/telegram/preferences");
    const payload = normalizeStartPayload(rawPayload);
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null, currency: null };
    if (await maybeBlockForceSubCommand(chatId, chatType, from, { bypassCache: true, startPayload: payload, locale: prefs.locale })) {
      return;
    }
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
    await sendTgHome({
      chatId,
      firstName,
      locale: prefs.locale,
      userId: from?.id,
      installMenu: true,
    });
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
        const [{ tgPrefText }, categories] = await Promise.all([
          import("@/lib/telegram/messages/preferences"),
          readHomeTelegramCategories().catch(() => []),
        ]);
        await sendMessage({
          chat_id: chatId,
          text: tgPrefText(want, "language_saved"),
          parse_mode: "HTML",
          reply_markup: homeKeyboard(want, categories),
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
    await sendMessage({
      chat_id: chatId,
      text: settingsMessage(prefs.locale),
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(prefs.locale),
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
    await sendMessage({
      chat_id: chatId,
      text: settingsMessage(prefs.locale, null, { currencyNote: true }),
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(prefs.locale),
    });
    return;
  }

  // Slash commands first (before pending input & free-text search).
  if (cmd === "/katalog") {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    await handleShowCatalog(chatId, from);
    return;
  }

  if (cmd === "/games") {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    const { handleGamesHome } = await import("./games");
    await handleGamesHome(chatId, 0, from);
    return;
  }

  if (cmd === "/pedia") {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    const { handlePediaHome } = await import("./pedia");
    await handlePediaHome(chatId, 0, from);
    return;
  }

  if (cmd === "/cari" || cmd === "/search") {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
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
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    await handleShowCatalog(chatId, from);
    return;
  }

  if (trimmed === MENU_LABEL_PEDIA || trimmed === MENU_LABEL_EN.pedia) {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    const { handlePediaHome } = await import("./pedia");
    await handlePediaHome(chatId, 0, from);
    return;
  }

  if (trimmed === MENU_LABEL_GAMES || trimmed === MENU_LABEL_EN.games) {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await clearPendingUnlessCreating(from);
    const { handleGamesHome } = await import("./games");
    await handleGamesHome(chatId, 0, from);
    return;
  }

  if (trimmed === MENU_LABEL_SEARCH || trimmed === MENU_LABEL_EN.search) {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
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
    const en = locale === "en";
    await sendMessage({
      chat_id: chatId,
      text: en ? "Need help? Chat admin on WhatsApp." : "Butuh bantuan? Chat admin di WhatsApp.",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "💬 WhatsApp Admin", url: `${SITE.webUrl}/wa` },
          { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
        ]],
      },
    });
    return;
  }

  if (
    trimmed === MENU_LABEL_SETTINGS ||
    trimmed === MENU_LABEL_SETTINGS_GLOBE_LEGACY ||
    trimmed === MENU_LABEL_SETTINGS_LEGACY ||
    trimmed === MENU_LABEL_EN.settings ||
    trimmed === MENU_LABEL_EN.settingsGlobeLegacy ||
    trimmed === MENU_LABEL_EN.settingsLegacy
  ) {
    await clearPendingUnlessCreating(from);
    if (from && chatType === "private" && chatId === from.id) {
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
      await sendMessage({
        chat_id: chatId,
        text: settingsMessage(prefs.locale),
        parse_mode: "HTML",
        reply_markup: settingsKeyboard(prefs.locale),
      });
    } else {
      await sendMessage({
        chat_id: chatId,
        text: settingsMessage("id"),
        parse_mode: "HTML",
        reply_markup: settingsKeyboard("id"),
      });
    }
    return;
  }

  // Pixel Verification buyer-input runs BEFORE the `!cmd.startsWith("/")`
  // guard and receives untrimmed `text` so passwords with leading/trailing
  // spaces or a leading `/` (other than known commands handled above) are
  // preserved verbatim, matching web checkout.
  if (from && text.length > 0) {
    const { handleBuyerInput } = await import("./buyer-input");
    if (await handleBuyerInput(text, chatId, from, messageId)) return;
  }

  // Existing pending-input handlers (only when non-empty non-slash text).
  if (from && trimmed && !cmd.startsWith("/")) {
    if (await handlePendingWaInput(trimmed, chatId, from)) return;
    if (/^\d{1,3}$/.test(cmd)) {
      if (await handlePendingQtyInput(trimmed, chatId, from)) return;
    }
    const { handlePayq1PhoneInput } = await import("./payment-contact");
    if (await handlePayq1PhoneInput(trimmed, chatId, from).catch(() => false)) return;
    if (await handlePendingEmailInput(trimmed, chatId, from)) return;
    if (await handlePendingSearchInput(trimmed, chatId, from)) return;
    const { handleGamesPendingInput } = await import("./games");
    if (await handleGamesPendingInput(trimmed, chatId, from)) return;
    const { handlePediaPendingInput } = await import("./pedia");
    if (await handlePediaPendingInput(text, chatId, from)) return;
  }

  // Extras text / photo handler (e.g. claim proof upload).
  if (from) {
    const { handleExtraText } = await import("./extras");
    if (await handleExtraText(trimmed, chatId, from, photoFileId)) return;
  }

  // Killer UX Pedia: paste link sosmed langsung di chat -> auto-detect layanan cocok.
  if (!cmd.startsWith("/") && trimmed.length >= 8) {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    const { handlePediaPasteLink } = await import("./pedia");
    if (await handlePediaPasteLink(trimmed, chatId, from).catch(() => false)) return;
  }

  // Free-text search: plain text >= 2 chars directly searches catalog instead of dumping home.
  if (!cmd.startsWith("/") && trimmed.length >= 2) {
    if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;
    await handleSearchResults(chatId, trimmed, from);
    return;
  }

  if (photoFileId && !trimmed) return;

  if (await maybeBlockForceSubCommand(chatId, chatType, from)) return;

  // Unknown command or single-character message: show welcome in saved locale.
  const [fallbackCtx, categories] = await Promise.all([
    tgCtxFor(from?.id ?? chatId).catch(() => ({ locale: "id" as const, displayCurrency: null, fx: null })),
    readHomeTelegramCategories().catch(() => []),
  ]);
  await sendMessage({
    chat_id: chatId,
    text: fallbackCtx.locale === "en"
      ? welcomeMessageLocalized(fallbackCtx.locale, from?.first_name ?? "Pengguna")
      : welcomeMessage(from?.first_name ?? "Pengguna"),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(fallbackCtx.locale, categories),
  });
}
