import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
// src/lib/telegram/handlers/callback.ts — Router callback + GUARD KEAMANAN.
//
// MENGAPA dipisah: handleCallback adalah SATU-SATUNYA pintu masuk callback
// button. Ia memuat kontrol keamanan `ownerBound` (issue #5): sebelum handler
// sensitif apa pun dipanggil (bayar, keranjang, batal, refresh, status,
// wainput, qrenew), guard WAJIB memverifikasi bahwa penekan tombol (from.id)
// adalah pemilik order dan bukan dari chat grup. Karena guard ini berjalan di
// dalam switch SEBELUM setiap case, memindahkan router utuh (bukan memecah per
// case) menjaga jaminan bahwa TIDAK ADA handler yang bisa dicapai tanpa melewati
// guard. Pemindahan murni dari route.ts — set ownerBound, SQL, teks identik.

import { queryFirst, execRun } from "@/lib/db";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, orderStatusKeyboard, parseCallback, cancelConfirmationKeyboard,
} from "@/lib/telegram/keyboards";
import {
  welcomeMessage, helpMessage, warrantyFullMessage, alreadyPendingMessage,
} from "@/lib/telegram/messages";
import { getCartSummary, clearCart } from "@/lib/telegram/cart";
import { clearPendingAction, getBestsellers } from "./shared";
import {
  handleShowCatalogEdit, handleShowCategoriesEdit, handleShowProducts,
  handleShowProduct, handleShowVariants, handleVariantConfirm, handleShowQty,
  handleQtyInputPrompt,
  handleProductTerms,
} from "./catalog";
import {
  handleMyOrders, handleSearchPrompt, handleBuyConfirm, handleConfirmPurchase,
  handleWaInput, showCartEmailConfirmation,
} from "./discovery";
import {
  handleOrderStatus, handleOrderRefresh, handleOrderCancel, handleQrisRenew,
} from "./orders";
import { handlePayWithQris } from "./invoice";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { readCheckoutEmail, checkoutEmailFingerprint } from "@/lib/telegram/checkout-email";
import {
  handleShowCart, handleCartAdd, handleCartAdjust, handleCartCheckout,
  createAndSendCartInvoice,
} from "./cart";

export async function handleCallback(data: string, chatId: number, messageId: number, from: { id: number; first_name: string; username?: string }) {
  const { action, params } = parseCallback(data);

  // Ownership guard (issue #5): callback sensitif order (bayar, keranjang,
  // batal, refresh, status, wainput) hanya boleh dieksekusi pemilik order.
  // from.id adalah identitas penekan tombol terverifikasi Telegram — chat_id
  // grup tidak boleh dipakai untuk mengambil alih order orang lain.
  const ownerBound = new Set(["pay", "pm", "qinput", "epay", "eedit", "ceedit", "cadd", "cinc", "cdec", "crm", "ccheckout", "cconfirm", "cclear", "cancel", "cancelok", "refresh", "order", "cred", "wainput", "qrenew"]);
  if (ownerBound.has(action)) {
    const targetCode = action === "cancel" || action === "cancelok" || action === "refresh" || action === "order" || action === "cred" || action === "wainput" || action === "qrenew"
      ? String(params[0] || "").toUpperCase()
      : null;
    if (targetCode) {
      const owned = await queryFirst(
        `SELECT code FROM orders WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'`,
        targetCode, String(from.id),
      );
      if (!owned) {
        await sendMessage({ chat_id: chatId, text: "❌ Pesanan ini bukan milikmu. Buka chat pribadi bot dan buat pesanan sendiri.", parse_mode: "HTML" });
        return;
      }
    }
    // verifyPrivateChat: callback dari grup untuk aksi sensitif ditolak
    // (grup sudah di-redirect di POST; ini lapis kedua bila pesan lama
    // diteruskan). Chat pribadi selalu lolos (chatId positif = from.id).
    if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) {
      const { SITE } = await import("@/lib/site");
      const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
      await sendMessage({ chat_id: chatId, text: groupCheckoutRedirectMessage(SITE.adminTelegram), parse_mode: "HTML" });
      return;
    }
  }
  if (["cats", "cat", "prd", "vars", "buy", "myorders", "cart", "help", "warranty"].includes(action)) await clearPendingAction(from);

  switch (action) {
    case "home":
    if (await notifyPaymentMaintenance(chatId)) return;
      await clearPendingAction(from);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessage(from.first_name, await getBestsellers(3)),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(),
      });
      break;

    case "catalog":
      await clearPendingAction(from);
      await handleShowCatalogEdit(chatId, messageId, Number(params[0] || 0));
      break;

    case "cats":
      await handleShowCategoriesEdit(chatId, messageId, Number(params[0] || 0));
      break;

    case "cat":
      await handleShowProducts(chatId, messageId, Number(params[0]), Number(params[1] || 0));
      break;

    case "prd":
      await handleShowProduct(chatId, messageId, Number(params[0]));
      break;

    case "buy":
      // Always use variant flow — stock synced with web/WA via product_variants
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "vars":
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "var":
      await handleVariantConfirm(chatId, messageId, Number(params[0]));
      break;

    case "terms":
      await handleProductTerms(chatId, Number(params[0]), Number(params[1] || 0), Number(params[2] || 0));
      break;

    case "qty":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "q":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]));
      break;

    case "qinput":
      await handleQtyInputPrompt(chatId, Number(params[0]), Number(params[1]), from);
      break;

    case "pay":
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from, false, params[3]);
      break;

    case "pm":
      // Compatibility for buttons from older messages: Telegram now always uses QRIS.
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "epay": {
      const buyer = await queryFirst("SELECT buyer_email,pending_action FROM telegram_users WHERE user_id=?", String(from.id));
      const email = String(buyer?.buyer_email ?? "");
      const state = `email_confirm:${params[0]}:${params[1]}:${params[2]}:${params[4]}:${await checkoutEmailFingerprint(email)}`;
      if (!params[4] || buyer?.pending_action !== state) {
        await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
        break;
      }
      const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=? AND buyer_email=?", String(from.id), state, email);
      if (claim.changes) await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from, true, params[3], email);
      break;
    }

    case "eedit": {
      const productId = Number(params[0]);
      const variantId = Number(params[1]);
      const qty = Number(params[2]);
      const { execRun, isD1Mode } = await import("@/lib/db");
      if (isD1Mode()) await execRun(`UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`, `email_for:${productId}:${variantId}:${qty}`, String(from.id));
      await sendMessage({
        chat_id: chatId,
        text: "Kirim email aktif untuk menerima produk. Ketik /batal untuk kembali.",
        parse_mode: "HTML",
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "nama@email.com" },
      });
      break;
    }

    case "ceedit":
      await execRun("UPDATE telegram_users SET pending_action='emailcart:', updated_at=datetime('now') WHERE user_id=?", String(from.id));
      await sendMessage({ chat_id: chatId, text: "Kirim email aktif untuk menerima produk. Ketik /batal untuk kembali.", reply_markup: { force_reply: true, input_field_placeholder: "nama@email.com" } });
      break;

    case "wainput":
      await handleWaInput(chatId, String(params[0] || ""), from);
      break;

    case "cfv":
      // Legacy "Saya Paham, Lanjut Bayar" buttons route into the qty step now.
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "confirm":
      await handleConfirmPurchase(chatId, messageId, Number(params[0]));
      break;

    case "order":
      await handleOrderStatus(chatId, params[0], from.id);
      break;

    case "cred": {
      // Guard ownerBound di atas sudah memastikan pemilik + chat pribadi.
      const { resendTelegramCredentials } = await import("@/lib/telegram/credential-delivery");
      await resendTelegramCredentials(String(params[0] || ""), chatId);
      break;
    }

    case "refresh":
      await handleOrderRefresh(chatId, messageId, params[0], from.id);
      break;

    case "cancel":
      await sendMessage({ chat_id: chatId, text: `Batalkan pesanan ${String(params[0]).toUpperCase()}? Jika sudah membayar, cek pembayaran atau hubungi admin.`, reply_markup: cancelConfirmationKeyboard(params[0]) });
      break;

    case "cancelok":
      await handleOrderCancel(chatId, messageId, params[0], from);
      break;

    case "qrenew":
      await handleQrisRenew(chatId, params[0]);
      break;

    case "myorders":
      await handleMyOrders(chatId, from);
      break;

    case "search":
      await handleSearchPrompt(chatId, from);
      break;

    case "reorder": {
      const productId = Number(params[0] || 0);
      if (productId > 0) {
        await handleBuyConfirm(chatId, messageId, productId);
      }
      break;
    }

    case "cart":
      await handleShowCart(chatId, messageId, from);
      break;

    case "cadd":
      await handleCartAdd(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), Number(params[2] || 1), from);
      break;

    case "cinc":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), +1);
      break;

    case "cdec":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), -1);
      break;

    case "crm":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), 0);
      break;

    case "cclear":
      await clearCart(String(from.id));
      await handleShowCart(chatId, messageId, from);
      break;

    case "ccheckout":
      await handleCartCheckout(chatId, messageId, from);
      break;

    case "cconfirm": {
      const dupOrder = await queryFirst(
        `SELECT code FROM orders WHERE telegram_user_id=? AND sales_channel='telegram' AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))`,
        String(from.id),
      );
      if (dupOrder) {
        // RR3-05: redelivery setelah foto invoice gagal (update failed +
        // 500) tiba di sini via reclaim — order pending dipakai ulang
        // (TIDAK membuat order kedua). Bila foto invoice order ini belum
        // terkirim, kirim ulang foto yang SAMA sekarang (provider mungkin
        // sudah pulih); cron menyapu sisanya bila masih gagal.
        try {
          const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
          await retryTelegramInvoiceDelivery(String(dupOrder.code)).catch(() => false);
        } catch { /* sapuan cron berikutnya */ }
        await sendMessage({
          chat_id: chatId,
          text: alreadyPendingMessage(String(dupOrder.code)),
          parse_mode: "HTML",
          reply_markup: orderStatusKeyboard(String(dupOrder.code)),
        });
        break;
      }
      const cartSummary = await getCartSummary(String(from.id));
      if (!cartSummary.lines.length) {
        await handleShowCart(chatId, messageId, from);
        break;
      }
      const tag = await checkoutApprovalTag(cartSummary.lines);
      if (params[0] !== tag || cartSummary.issues.length) {
        await handleCartCheckout(chatId, messageId, from);
        break;
      }
      let checked;
      try {
        checked = await readCheckoutEmail(String(from.id), cartSummary.lines);
      } catch {
        await sendMessage({ chat_id: chatId, text: "Email belum bisa diperiksa. Coba lagi sebelum membayar." });
        break;
      }
      if (checked.required || params[1]) {
        const buyer = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?", String(from.id));
        const state = `cart_confirm:${tag}:${params[1]}:${await checkoutEmailFingerprint(checked.email ?? "")}`;
        const claim = params[1] && checked.email
          ? await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=? AND buyer_email=?", String(from.id), state, checked.email)
          : null;
        if (!claim?.changes) {
          await showCartEmailConfirmation(chatId, from, undefined, buyer?.pending_action == null ? null : String(buyer.pending_action));
          break;
        }
      }
      await createAndSendCartInvoice(chatId, cartSummary.lines, from, checked.email);
      break;
    }

    case "warranty":
      await sendMessage({
        chat_id: chatId,
        text: warrantyFullMessage(),
        parse_mode: "HTML",
        reply_markup: warrantyKeyboard(),
      });
      break;

    case "help":
      await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
      break;

    default:
      break;
  }
}
