import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
// src/lib/telegram/handlers/command.ts — Router perintah teks (/start, dll).
//
// MENGAPA dipisah: handleCommand memetakan perintah slash + label reply-keyboard
// ke handler yang sesuai. Ini "tabel routing" — dipisah dari handler leaf agar
// mudah melihat perintah apa yang tersedia tanpa menggulir implementasi. Router
// mempertahankan URUTAN pengecekan asli (pending WA → /start → label menu →
// qty → search → /chatid → /garansi → /pesanan → fallback). Pemindahan murni.

import { sendMessage, sendPhoto, withLoadingIndicator } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, languageChooserKeyboard, settingsKeyboard,
  MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS, MENU_LABEL_HELP,
  MENU_LABEL_CART, MENU_LABEL_EN,
} from "@/lib/telegram/keyboards";
import { welcomeMessage, helpMessage, warrantyFullMessage } from "@/lib/telegram/messages";
import {
  languageChooserMessage, welcomeMessageLocalized, settingsMessage,
  resumePayloadMessage,
} from "@/lib/telegram/messages/preferences";
import { readTgPreferences, isValidTgLocale } from "@/lib/telegram/preferences";
import type { Locale } from "@/lib/i18n/locale";
import { clearPayq1DraftForCancel, clearPendingAction, getBestsellers } from "./shared";
import { handleShowCatalog } from "./catalog";
import {
  handleSearchPrompt, handleMyOrders, handlePendingSearchInput,
  handlePendingQtyInput, handlePendingWaInput, handlePendingEmailInput,
} from "./discovery";
import { handleOrderStatus } from "./orders";
import { handleShowCart } from "./cart";

export async function handleCommand(
  text: string,
  chatId: number,
  chatType: string,
  from?: { id: number; first_name: string; username?: string },
) {
  const cmd = text.toLowerCase().split(/\s+/)[0].split("@")[0];

  if ((cmd === '/stop' || cmd === '/siaran_on') && from && chatType === 'private' && chatId === from.id) {
    const { execRun } = await import('@/lib/db');
    await execRun("UPDATE telegram_users SET broadcast_opt_out=? WHERE user_id=? AND chat_id=?",cmd==='/stop'?1:0,String(from.id),String(chatId));
    await sendMessage({chat_id:chatId,text:cmd==='/stop'?'Siaran Telegram dihentikan. Notifikasi pesanan tetap berjalan. Kirim /siaran_on untuk berlangganan kembali.':'Siaran Telegram diaktifkan kembali. Kirim /stop untuk berhenti.'});
    return;
  }

  // Cancel conversational input explicitly, before leaf slash-command filters.
  // This clears own quoted/contact frozen offers too (explicit cancel only,
  // exact-CAS). Durable `creating` intents are NEVER cleared here — R2 clears
  // them only after a recoverable TX exists or the order is terminal.
  // It does not cancel or mutate an order.
  // COMMON clear/setPendingAction guard: every other flow that would blanket
  // clear (language/settings/catalog/cart/search/help) preserves a durable
  // creating intent the same way (quoted stays cancellable as before).
  if (cmd === "/batal") {
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null };
    const locale = prefs.locale ?? "id";
    if (from) {
      // Explicit cancel only: clear own payq1 when st is quoted/contact
      // (exact-state CAS). Creating intent is retained here — /batal never
      // silently discards a durable creating anchor (R2 clears it only after
      // a recoverable TX exists or the order is terminal).
      await clearPayq1DraftForCancel(from);
      await clearPendingAction(from);
    } else {
      await clearPendingAction(from);
    }
    await sendMessage({ chat_id: chatId, text: locale === "en" ? "Input cancelled. Choose a menu to continue." : "Input dibatalkan. Pilih menu untuk melanjutkan.", reply_markup: homeKeyboard(locale) });
    return;
  }

  // Check for pending WA input before processing commands
  if (from && (!cmd.startsWith("/") || cmd === "/batal")) {
    const handled = await handlePendingWaInput(text, chatId, from);
    if (handled) return;
  }

  // TG1 /start gate: no saved valid locale => explicit chooser.
  async function sendTgHome(
    chatId: number,
    firstName: string,
    locale: Locale,
  ): Promise<void> {
    const bestsellers = await getBestsellers(3);
    const caption = welcomeMessageLocalized(locale, firstName, bestsellers);
    const rawSite = (process.env.SITE_URL ?? "").trim().replace(/\/$/, "");
    const siteUrl = /^https?:\/\//i.test(rawSite) ? rawSite : "https://axvara.tech";
    const photoUrl = `${siteUrl}/banners/tg-welcome.webp?v=20260928b`;
    await sendPhotoSafe(chatId, photoUrl, caption);
  }

  async function sendPhotoSafe(chatId: number, photoUrl: string, caption: string): Promise<void> {
    const prefs = from ? await readTgPreferences(String(from.id)).catch(() => ({ locale: null })) : { locale: null };
    const locale = prefs.locale ?? "id";
    let photoRes = await sendPhoto({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
      reply_markup: homeKeyboard(locale),
    });
    if (!photoRes.ok) {
      photoRes = await sendPhoto({
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
        reply_markup: homeKeyboard(locale),
      });
    }
    if (!photoRes.ok) {
      await sendMessage({
        chat_id: chatId,
        text: caption,
        parse_mode: "HTML",
        reply_markup: homeKeyboard(locale),
      });
    }
  }

  if (cmd === "/start") {
    if (await notifyPaymentMaintenance(chatId)) return;
    return withLoadingIndicator(chatId, "🚀 Menyiapkan AXVARA", async (beforeResult) => {
    // /start + /language ordinary clear paths MUST NOT erase a durable
    // creating intent blindly: preserve quoted-invalid-vs-creating semantics
    // with the minimal guard — clear only when NOT a creating anchor (no
    // onboarding refactor, no generic state framework).
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const stored = await readPayq1State(String(from.id)).catch(() => null);
      if (!stored?.state || stored.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    const rawPayload = text.split(/\s+/).slice(1).join(" ").trim();
    const { normalizeStartPayload, saveOnboardingPayload } = await import("@/lib/telegram/preferences");
    const payload = normalizeStartPayload(rawPayload);
    const prefs = from ? await readTgPreferences(String(from.id)) : { locale: null, currency: null };
    if (!prefs.locale) {
      if (from) await saveOnboardingPayload(String(from.id), payload);
      await beforeResult();
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    const firstName = from?.first_name ?? "Pengguna";
    await beforeResult();
    await sendTgHome(chatId, firstName, prefs.locale);
    if (payload) {
      await sendMessage({
        chat_id: chatId,
        text: resumePayloadMessage(prefs.locale, payload),
        parse_mode: "HTML",
      });
    }
    });
  }

  // TG1: /language changes locale ONLY (currency untouched); /currency
  // changes currency ONLY (locale untouched); /settings shows both.
  // COMMON guard: the language/settings surface preserves creating (quoted
  // choices still re-render after save — creating anchor never cleared).
  if ((cmd === "/language" || cmd === "/settings") && from && chatType === "private" && chatId === from.id) {
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
        const parts = text.split(/\s+/).slice(1);
        const want = parts[0]?.toLowerCase();
        if (want && isValidTgLocale(want)) {
          const { saveTgLocaleOnly } = await import("@/lib/telegram/preferences");
          await saveTgLocaleOnly(String(from.id), want);
          const { tgPrefText } = await import("@/lib/telegram/messages/preferences");
          await sendMessage({ chat_id: chatId, text: tgPrefText(want, "language_saved"), parse_mode: "HTML", reply_markup: homeKeyboard(want) });
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
    const parts = text.split(/\s+/).slice(1);
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
      text: settingsMessage(prefs.locale, prefs.currency),
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(),
    });
    return;
  }

  // Persistent reply-menu taps arrive as plain text — route them like commands.
  // Old ID keyboards keep routing; new EN labels route to the same targets.
  // TG2a: help answers in the saved locale.
  // COMMON guard (creating-preserve) applies to catalog/search/orders/cart/help
  // menu taps below: quoted stays clearable, creating never blanket-cleared.
  if (text === MENU_LABEL_CATALOG || text === MENU_LABEL_EN.catalog || cmd === "/katalog") {
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const storedMenu = await readPayq1State(String(from.id)).catch(() => null);
      if (!storedMenu?.state || storedMenu.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    await handleShowCatalog(chatId, from);
    return;
  }

  if (text === MENU_LABEL_SEARCH || text === MENU_LABEL_EN.search || cmd === "/cari" || cmd === "/search") {
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const storedMenu = await readPayq1State(String(from.id)).catch(() => null);
      if (!storedMenu?.state || storedMenu.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    await handleSearchPrompt(chatId, from);
    return;
  }

  if (text === MENU_LABEL_ORDERS || text === MENU_LABEL_EN.orders || cmd === "/orders" || cmd === "/riwayat") {
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const storedMenu = await readPayq1State(String(from.id)).catch(() => null);
      if (!storedMenu?.state || storedMenu.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    await handleMyOrders(chatId, from);
    return;
  }

  if (text === MENU_LABEL_CART || text === MENU_LABEL_EN.cart || cmd === "/cart" || cmd === "/keranjang") {
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const storedMenu = await readPayq1State(String(from.id)).catch(() => null);
      if (!storedMenu?.state || storedMenu.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    await handleShowCart(chatId, 0, from);
    return;
  }

  if (text === MENU_LABEL_HELP || text === MENU_LABEL_EN.help || cmd === "/bantuan" || cmd === "/help") {
    if (from) {
      const { readPayq1State } = await import("@/lib/telegram/payment-quote");
      const storedMenu = await readPayq1State(String(from.id)).catch(() => null);
      if (!storedMenu?.state || storedMenu.state.st !== "creating") {
        await clearPendingAction(from);
      }
    } else {
      await clearPendingAction(from);
    }
    const locale = from ? (await readTgPreferences(String(from.id)).catch(() => ({ locale: null as null }))).locale ?? "id" : "id";
    await sendMessage({ chat_id: chatId, text: helpMessage({ locale }), parse_mode: "HTML" });
    return;
  }

  // Qty manual input: user typed a number while choosing qty (up to 100 for bulk)
  if (from && /^\d{1,3}$/.test(cmd)) {
    const handled = await handlePendingQtyInput(text, chatId, from);
    if (handled) return;
  }

  // Email input: user menjawab prompt email_for: (produk Invite/Link WR atau
  // require_email). Dicek SEBELUM search agar alamat email tidak dianggap
  // kata kunci pencarian. R2: payq1 contact.phone input checked FIRST —
  // phone digits must never be mistaken for qty/search/email flows.
  if (from && !cmd.startsWith("/")) {
    const { handlePayq1PhoneInput } = await import("./payment-contact");
    const handledPhone = await handlePayq1PhoneInput(text, chatId, from).catch(() => false);
    if (handledPhone) return;
  }
  if (from && !cmd.startsWith("/")) {
    const handledEmail = await handlePendingEmailInput(text, chatId, from);
    if (handledEmail) return;
  }

  // Search text: user is answering the 🔎 Cari prompt (pending_action=search:).
  if (from && !cmd.startsWith("/")) {
    const handled = await handlePendingSearchInput(text, chatId, from);
    if (handled) return;
  }

  if (cmd === "/chatid") {
    const isGroup = chatType === "group" || chatType === "supergroup";
    await sendMessage({
      chat_id: chatId,
      text: isGroup
        ? [
            "🔔 <b>ID Grup Notifikasi</b>",
            "",
            `<code>${chatId}</code>`,
            "",
            "ID ini dipakai AXVARA untuk mengirim notifikasi order web dan Telegram ke grup ini.",
          ].join("\n")
        : "Tambahkan @Axvara_bot ke grup tujuan, lalu kirim <code>/chatid</code> di dalam grup tersebut.",
      parse_mode: "HTML",
    });
    return;
  }

  if (cmd === "/garansi") {
    await clearPendingAction(from);
    await sendMessage({
      chat_id: chatId,
      text: warrantyFullMessage(),
      parse_mode: "HTML",
      reply_markup: warrantyKeyboard(),
    });
    return;
  }

  if (cmd === "/pesanan") {
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      await handleOrderStatus(chatId, parts[1], from?.id);
    } else {
      await handleMyOrders(chatId, from);
    }
    return;
  }

  // Unknown command: show welcome in saved locale
  const fallbackPrefs = from ? await readTgPreferences(String(from.id)).catch(() => ({ locale: null as null })) : { locale: null as null };
  const fallbackLocale = fallbackPrefs.locale ?? "id";
  await sendMessage({
    chat_id: chatId,
    text: fallbackLocale === "en"
      ? welcomeMessageLocalized(fallbackLocale, from?.first_name ?? "Pengguna", await getBestsellers(3))
      : welcomeMessage(from?.first_name ?? "Pengguna", await getBestsellers(3)),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(fallbackLocale),
  });
}
