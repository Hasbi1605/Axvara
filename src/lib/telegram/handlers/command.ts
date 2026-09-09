// src/lib/telegram/handlers/command.ts — Router perintah teks (/start, dll).
//
// MENGAPA dipisah: handleCommand memetakan perintah slash + label reply-keyboard
// ke handler yang sesuai. Ini "tabel routing" — dipisah dari handler leaf agar
// mudah melihat perintah apa yang tersedia tanpa menggulir implementasi. Router
// mempertahankan URUTAN pengecekan asli (pending WA → /start → label menu →
// qty → search → /chatid → /garansi → /pesanan → fallback). Pemindahan murni.

import { sendMessage, sendPhoto, showLoadingBar } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, mainReplyMenu,
  MENU_LABEL_CATALOG, MENU_LABEL_SEARCH, MENU_LABEL_ORDERS, MENU_LABEL_HELP,
  MENU_LABEL_CART,
} from "@/lib/telegram/keyboards";
import { welcomeMessage, helpMessage, warrantyFullMessage } from "@/lib/telegram/messages";
import { clearPendingAction, getBestsellers } from "./shared";
import { handleShowCatalog } from "./catalog";
import {
  handleSearchPrompt, handleMyOrders, handlePendingSearchInput,
  handlePendingQtyInput, handlePendingWaInput,
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

  // Check for pending WA input before processing commands
  if (from && !cmd.startsWith("/")) {
    const handled = await handlePendingWaInput(text, chatId, from);
    if (handled) return;
  }

  if (cmd === "/start") {
    // Clear any pending conversational state
    await clearPendingAction(from);
    await showLoadingBar(chatId, "🚀 Menyiapkan AXVARA");
    const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";
    const bestsellers = await getBestsellers(3);
    await sendPhoto({
      chat_id: chatId,
      photo: `${siteUrl}/r2/banners/tg-welcome.png`,
      caption: welcomeMessage(from?.first_name ?? "Pengguna", bestsellers),
      parse_mode: "HTML",
      reply_markup: homeKeyboard(),
    });
    // Tombol tetap bawah (reply keyboard): Katalog · Cari · Keranjang · Pesanan · Bantuan.
    // Dikirim sebagai pesan terpisah karena sendPhoto caption memakai inline keyboard.
    // is_persistent=true → tetap nempel di semua chat private; user lama yang
    // belum pernah /start ulang tetap bisa pakai /cart atau tombol 🛒 + Keranjang.
    await sendMessage({
      chat_id: chatId,
      text: "👇 <b>Menu Cepat</b> — tombol tetap di bawah kolom ketik.",
      parse_mode: "HTML",
      reply_markup: mainReplyMenu(),
    });
    return;
  }

  // Persistent reply-menu taps arrive as plain text — route them like commands.
  if (text === MENU_LABEL_CATALOG || cmd === "/katalog") {
    await clearPendingAction(from);
    await handleShowCatalog(chatId);
    return;
  }

  if (text === MENU_LABEL_SEARCH || cmd === "/cari" || cmd === "/search") {
    await clearPendingAction(from);
    await handleSearchPrompt(chatId, from);
    return;
  }

  if (text === MENU_LABEL_ORDERS || cmd === "/orders" || cmd === "/riwayat") {
    await clearPendingAction(from);
    await handleMyOrders(chatId, from);
    return;
  }

  if (text === MENU_LABEL_CART || cmd === "/cart" || cmd === "/keranjang") {
    await clearPendingAction(from);
    await handleShowCart(chatId, 0, from);
    return;
  }

  if (text === MENU_LABEL_HELP || cmd === "/bantuan" || cmd === "/help") {
    await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
    return;
  }

  // Qty manual input: user typed a number while choosing qty (up to 100 for bulk)
  if (from && /^\d{1,3}$/.test(cmd)) {
    const handled = await handlePendingQtyInput(text, chatId, from);
    if (handled) return;
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
      await handleOrderStatus(chatId, parts[1]);
    } else {
      await handleMyOrders(chatId, from);
    }
    return;
  }

  // Unknown command: show welcome
  await sendMessage({
    chat_id: chatId,
    text: welcomeMessage(from?.first_name ?? "Pengguna", await getBestsellers(3)),
    parse_mode: "HTML",
    reply_markup: homeKeyboard(),
  });
}
