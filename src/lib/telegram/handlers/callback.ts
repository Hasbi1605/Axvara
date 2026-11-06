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
import { sendMessage, safeEditOrSend, answerCallbackQuery } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, orderStatusKeyboard, parseCallback, cancelConfirmationKeyboard,
  languageChooserKeyboard, settingsKeyboard,
} from "@/lib/telegram/keyboards";
import {
  helpMessage, warrantyFullMessage, alreadyPendingMessage,
  languageChooserMessage, tgPrefText, settingsMessage, resumePayloadMessage,
} from "@/lib/telegram/messages";
import {
  readTgPreferences, saveTgLocaleChoice, saveTgLocaleOnly, saveTgCurrencyChoice,
  isValidTgLocale, isValidTgCurrency,
} from "@/lib/telegram/preferences";
import { getCartSummary, clearCart } from "@/lib/telegram/cart";
import { clearPendingAction, getBestsellers, setPendingActionUnlessCreating } from "./shared";
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

export async function handleCallback(data: string, chatId: number, messageId: number, from: { id: number; first_name: string; username?: string }, callbackId?: string) {
  const { action, params } = parseCallback(data);
  const answer = async (text?: string, alert = false) => {
    if (callbackId) await answerCallbackQuery(callbackId, text, alert);
  };

  // Ownership guard (issue #5): callback sensitif order (bayar, keranjang,
  // batal, refresh, status, wainput, qrenew) hanya boleh dieksekusi pemilik order.
  // from.id adalah identitas penekan tombol terverifikasi Telegram — chat_id
  // grup tidak boleh dipakai untuk mengambil alih order orang lain.
  // R2 note: pm/pgo/gconsent/pmentry handlers each enforce chatId===from.id
  // + owned telegram_user_id before any DB read/write (private only).
  const ownerBound = new Set(["pay", "pm", "pmc", "pmb", "pgo", "gconsent", "pmentry", "qinput", "epay", "eedit", "ceedit", "cadd", "cinc", "cdec", "crm", "ccheckout", "cconfirm", "cclear", "cancel", "cancelok", "refresh", "order", "cred", "wainput", "qrenew"]);
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
  // Preference callbacks answer exactly once here; route skips pre-answer.
  // TG2a: home is answered in the SAVED locale after a language change.
  // NOTE: `params` is preserved for order-bound cases below; pm:/pgo: do not
  // consume legacy ephemeral params (frozen payq1 binds everything).
  if (action === "lang" || action === "cur") {
    if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) {
      await answer();
      return;
    }
    if (action === "lang") {
      const want = String(params[0] || "").toLowerCase();
      if (!isValidTgLocale(want)) {
        await answer(tgPrefText("id", "invalid_choice"), true);
        return;
      }
      const before = await readTgPreferences(String(from.id));
      const { consumeOnboardingPayload } = await import("@/lib/telegram/preferences");
      const savedNow = before.locale == null
        ? await saveTgLocaleChoice(String(from.id), want)
        : await saveTgLocaleOnly(String(from.id), want);
      if (!savedNow) {
        await answer();
        return;
      }
      await answer();
      const payload = before.locale == null ? await consumeOnboardingPayload(String(from.id)) : null;
      const after = await readTgPreferences(String(from.id));
      const { welcomeMessageLocalized } = await import("@/lib/telegram/messages/preferences");
      const { getBestsellers } = await import("./shared");
      const bestsellers = await getBestsellers(3);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessageLocalized(after.locale ?? want, from.first_name, bestsellers),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(after.locale ?? want),
      });
      await sendMessage({ chat_id: chatId, text: tgPrefText(want, "language_saved"), parse_mode: "HTML" });
      if (payload) {
        await sendMessage({
          chat_id: chatId,
          text: resumePayloadMessage(want, payload),
          parse_mode: "HTML",
        });
      }
      return;
    }
    const want = String(params[0] || "").toUpperCase();
    if (!isValidTgCurrency(want)) {
      await answer(tgPrefText("id", "invalid_choice"), true);
      return;
    }
    const prefs = await readTgPreferences(String(from.id));
    if (prefs.locale == null) {
      // No locale yet: ask language first, never persist currency alone.
      await answer();
      await sendMessage({
        chat_id: chatId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    const ok = await saveTgCurrencyChoice(String(from.id), want);
    if (!ok) {
      await answer();
      return;
    }
    await answer();
    await sendMessage({ chat_id: chatId, text: tgPrefText(prefs.locale, "currency_saved"), parse_mode: "HTML" });
    return;
  }
  if (["cats", "cat", "prd", "vars", "buy", "myorders", "cart", "help", "warranty"].includes(action)) {
    // Guard COMMON clear: preserve a durable creating intent (quoted stays
    // clearable); navigation away never silently discards the anchor.
    const { readPayq1State } = await import("@/lib/telegram/payment-quote");
    const storedNav = await readPayq1State(String(from.id)).catch(() => null);
    if (!storedNav?.state || storedNav.state.st !== "creating") {
      await clearPendingAction(from);
    }
  }

  switch (action) {
    case "home": {
      if (await notifyPaymentMaintenance(chatId)) return;
      // Guard COMMON clear (same creating-preserve rule as navigation).
      {
        const { readPayq1State } = await import("@/lib/telegram/payment-quote");
        const storedHome = await readPayq1State(String(from.id)).catch(() => null);
        if (!storedHome?.state || storedHome.state.st !== "creating") {
          await clearPendingAction(from);
        }
      }
      const { readTgPreferences: readHomePrefs } = await import("@/lib/telegram/preferences");
      const homePrefs = await readHomePrefs(String(from.id)).catch(() => ({ locale: null }));
      const homeLocale = homePrefs.locale ?? "id";
      const { welcomeMessageLocalized: homeWelcome } = await import("@/lib/telegram/messages/preferences");
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: homeWelcome(homeLocale, from.first_name, await getBestsellers(3)),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(homeLocale),
      });
      break;
    }

    case "catalog":
      // Guard COMMON clear (same creating-preserve rule as navigation).
      {
        const { readPayq1State } = await import("@/lib/telegram/payment-quote");
        const storedCatalog = await readPayq1State(String(from.id)).catch(() => null);
        if (!storedCatalog?.state || storedCatalog.state.st !== "creating") {
          await clearPendingAction(from);
        }
      }
      await handleShowCatalogEdit(chatId, messageId, Number(params[0] || 0), from);
      break;

    case "cats":
      await handleShowCategoriesEdit(chatId, messageId, Number(params[0] || 0), from);
      break;

    case "cat":
      await handleShowProducts(chatId, messageId, Number(params[0]), Number(params[1] || 0), from);
      break;

    case "prd":
      await handleShowProduct(chatId, messageId, Number(params[0]), from);
      break;

    case "buy":
      // Always use variant flow — stock synced with web/WA via product_variants
      await handleShowVariants(chatId, messageId, Number(params[0]), from);
      break;

    case "vars":
      await handleShowVariants(chatId, messageId, Number(params[0]), from);
      break;

    case "var":
      await handleVariantConfirm(chatId, messageId, Number(params[0]), from);
      break;

    case "terms":
      await handleProductTerms(chatId, Number(params[0]), Number(params[1] || 0), Number(params[2] || 0), from);
      break;

    case "qty":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), 1, from);
      break;

    case "q":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "qinput":
      await handleQtyInputPrompt(chatId, Number(params[0]), Number(params[1]), from);
      break;

    case "pay":
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from, false, params[3]);
      break;

    case "pm": {
      // R2 frozen offer selection: index into the FROZEN payq1 array only
      // (nonce-bound). Legacy ephemeral `pm:a:b:c` buttons no longer exist;
      // treat unparseable legacy data as a no-op (never QRIS fallback).
      const { handlePayMethodSelect } = await import("./payment-methods");
      await handlePayMethodSelect(chatId, messageId, String(data), from, callbackId);
      break;
    }

    case "pmc":
    case "pmb": {
      // Sub-menu koin crypto (buka / kembali): render dari array beku, tanpa mutasi.
      const { handlePayCryptoMenu } = await import("./payment-methods");
      await handlePayCryptoMenu(chatId, messageId, String(data), from, callbackId);
      break;
    }

    case "pgo": {
      // R2 create entry: quoted->creating CAS + provider dispatch. New
      // protocol confirm — legacy pay/epay ALWAYS explicit QRIS, never
      // borrow new-method state.
      const { handlePayMethodConfirm } = await import("./payment-methods");
      await handlePayMethodConfirm(chatId, messageId, String(data), from, callbackId);
      break;
    }

    case "gconsent": {
      const { handleGatewayConsent } = await import("./payment-consent");
      await handleGatewayConsent(chatId, messageId, String(data), from, callbackId);
      break;
    }

    case "pmentry": {
      // R1: render the frozen offer bound to the approved current cart/single
      // identity. Client sends no price/method — state binds everything.
      const { showPaymentMethodOffer } = await import("./payment-methods");
      const { getCartSummary } = await import("@/lib/telegram/cart");
      const summary = await getCartSummary(String(from.id));
      if (!summary.lines.length) {
        const { handleShowCart } = await import("./cart");
        await handleShowCart(chatId, messageId, from);
        break;
      }
      if (summary.issues.length) {
        const { handleShowCart } = await import("./cart");
        await handleShowCart(chatId, messageId, from);
        break;
      }
      const cartTag = await checkoutApprovalTag(summary.lines);
      let cartEmail: string | null = null;
      try {
        const checked = await (await import("@/lib/telegram/checkout-email")).readCheckoutEmail(String(from.id), summary.lines);
        cartEmail = checked.email;
        if (checked.required && !checked.email) {
          const { showCartEmailConfirmation } = await import("./discovery");
          const buyer = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?", String(from.id));
          await showCartEmailConfirmation(chatId, from, undefined, buyer?.pending_action == null ? null : String(buyer.pending_action), messageId);
          break;
        }
      } catch {
        await sendMessage({ chat_id: chatId, text: "Email belum bisa diperiksa. Coba lagi sebelum memilih metode.", parse_mode: "HTML" });
        break;
      }
      await showPaymentMethodOffer(chatId, messageId, from, {
        mode: "cart", tag: cartTag, cartName: `Keranjang (${summary.lines.length} item)`,
        subtotal: summary.subtotal, identity: { kind: "cart" }, contactEmail: cartEmail,
      });
      break;
    }

    case "epay": {
      const buyer = await queryFirst("SELECT buyer_email,pending_action FROM telegram_users WHERE user_id=?", String(from.id));
      const email = String(buyer?.buyer_email ?? "");
      // Legacy QRIS-only rail: epay NEVER reads a new-method payq1 draft.
      // Quoted payq1 rows keep the email_confirm namespace untouched; the
      // legacy pending winner below preserves the existing rail.
      if (buyer?.pending_action != null && String(buyer.pending_action).startsWith("payq1:")) break;
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
      const { readTgPreferences: readEmailPrefs } = await import("@/lib/telegram/preferences");
      const emailPrefs = await readEmailPrefs(String(from.id)).catch(() => ({ locale: null as null }));
      const enEmail = (emailPrefs.locale ?? "id") === "en";
      const { isD1Mode } = await import("@/lib/db");
      if (isD1Mode() && !(await setPendingActionUnlessCreating(String(from.id), chatId, `email_for:${productId}:${variantId}:${qty}`))) break;
      await sendMessage({
        chat_id: chatId,
        text: enEmail ? "Send an active email to receive the product. Type /batal to go back." : "Kirim email aktif untuk menerima produk. Ketik /batal untuk kembali.",
        parse_mode: "HTML",
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "nama@email.com" },
      });
      break;
    }

    case "ceedit":
      if (!(await setPendingActionUnlessCreating(String(from.id), chatId, "emailcart:"))) break;
      await sendMessage({ chat_id: chatId, text: "Kirim email aktif untuk menerima produk. Ketik /batal untuk kembali.", reply_markup: { force_reply: true, input_field_placeholder: "nama@email.com" } });
      break;

    case "wainput":
      await handleWaInput(chatId, String(params[0] || ""), from);
      break;

    case "cfv":
      // Legacy "Saya Paham, Lanjut Bayar" buttons route into the qty step now.
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), 1, from);
      break;

    case "confirm":
      await handleConfirmPurchase(chatId, messageId, Number(params[0]), from);
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
        await handleBuyConfirm(chatId, messageId, productId, from);
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
          await showCartEmailConfirmation(chatId, from, undefined, buyer?.pending_action == null ? null : String(buyer.pending_action), messageId);
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

    case "help": {
      const { readTgPreferences: readHelpPrefs } = await import("@/lib/telegram/preferences");
      const helpPrefs = await readHelpPrefs(String(from.id)).catch(() => ({ locale: null }));
      await sendMessage({ chat_id: chatId, text: helpMessage({ locale: helpPrefs.locale ?? "id" }), parse_mode: "HTML" });
      break;
    }

    default:
      break;
  }
}
