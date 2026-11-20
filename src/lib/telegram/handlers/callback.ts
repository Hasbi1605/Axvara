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
  languageChooserKeyboard, currencyKeyboard, settingsKeyboard, helpKeyboard, minimalMenuKeyboard,
} from "@/lib/telegram/keyboards";
import {
  helpMessage, warrantyFullMessage, alreadyPendingMessage,
  languageChooserMessage, tgPrefText, settingsMessage, currencyChooserMessage, resumePayloadMessage,
} from "@/lib/telegram/messages";
import {
  readTgPreferences, saveTgLocaleChoice, saveTgLocaleOnly, saveTgCurrencyChoice,
  isValidTgLocale, isValidTgCurrency,
} from "@/lib/telegram/preferences";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import { getCartSummary, clearCart } from "@/lib/telegram/cart";
import { clearPendingAction, getBestsellers, installReplyMenu, replaceWithText, sendTgHome, setPendingActionUnlessCreating, type ScreenSourceMeta } from "./shared";
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

export async function handleCallback(
  data: string,
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  callbackId?: string,
  sourceMeta?: ScreenSourceMeta,
) {
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

  // Extras router (orders tabs, warranty claim, restock alerts) — CONTRACT.md.
  if (["mo", "claim", "claimstart", "rst"].includes(action)) {
    const { handleExtraCallback } = await import("./extras");
    if (await handleExtraCallback(action, params, chatId, messageId, from)) return;
  }
  // Dedicated currency picker from the main menu: render only. The route
  // pre-answers non lang:/cur: callbacks, so this handler must not answer.
  // Opening the picker never clears pending state, locale or order snapshots.
  if (action === "curmenu") {
    if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
    const menuPrefs = await readTgPreferences(String(from.id));
    if (!menuPrefs.locale) {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      return;
    }
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: currencyChooserMessage(menuPrefs.locale, menuPrefs.currency),
      parse_mode: "HTML",
      reply_markup: currencyKeyboard(menuPrefs.locale, menuPrefs.currency),
    });
    return;
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
      const savedLocale = after.locale ?? want;
      if (before.locale == null) {
        await sendTgHome({
          chatId,
          firstName: from.first_name,
          locale: savedLocale,
          userId: from.id,
          replaceMessageId: messageId,
          sourceMeta,
          installMenu: true,
        });
      } else {
        const { welcomeMessageLocalized } = await import("@/lib/telegram/messages/preferences");
        const [bestsellers, langCtx] = await Promise.all([getBestsellers(3), tgCtxFor(from.id)]);
        await safeEditOrSend({
          chat_id: chatId, message_id: messageId,
          text: welcomeMessageLocalized(savedLocale, from.first_name, bestsellers),
          parse_mode: "HTML",
          reply_markup: homeKeyboard(savedLocale, bestsellers, langCtx),
        });
        installReplyMenu(chatId, savedLocale);
      }
      if (payload) {
        const prdMatch = /^prd_(\d+)$/i.exec(payload);
        if (prdMatch) {
          await handleShowProduct(chatId, 0, Number(prdMatch[1]), from);
        } else {
          const { handleExtraStartPayload } = await import("./extras");
          if (!(await handleExtraStartPayload(payload, chatId, from))) {
            await sendMessage({
              chat_id: chatId,
              text: resumePayloadMessage(want, payload),
              parse_mode: "HTML",
            });
          }
        }
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
    // Confirm the chosen currency AND re-render the picker with the saved
    // value selected so the result is visible. Locale is untouched.
    const afterCurrency = await readTgPreferences(String(from.id)).catch(() => prefs);
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: currencyChooserMessage(prefs.locale, afterCurrency.currency),
      parse_mode: "HTML",
      reply_markup: currencyKeyboard(prefs.locale, afterCurrency.currency),
    });
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
    case "langmenu": {
      // Tombol bahasa di menu utama: buka pemilih yang sama tanpa menyentuh
      // pending action/order. Locale baru disimpan lewat callback lang:.
      await safeEditOrSend({
        chat_id: chatId,
        message_id: messageId,
        text: languageChooserMessage(),
        parse_mode: "HTML",
        reply_markup: languageChooserKeyboard(),
      });
      break;
    }

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
      const { welcomeMessageLocalized: homeWelcome } = await import("@/lib/telegram/messages/preferences");
      const [homeCtx, bestsellers] = await Promise.all([tgCtxFor(from.id), getBestsellers(3)]);
      if (sourceMeta?.isPhoto || sourceMeta?.isProtected || !messageId) {
        await sendTgHome({
          chatId,
          firstName: from.first_name,
          locale: homeCtx.locale,
          userId: from.id,
          replaceMessageId: messageId,
          sourceMeta,
          bestsellers,
          ctx: homeCtx,
          installMenu: false,
        });
        break;
      }
      await replaceWithText({
        chat_id: chatId, message_id: messageId,
        text: homeWelcome(homeCtx.locale, from.first_name, bestsellers),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(homeCtx.locale, bestsellers, homeCtx),
      }, sourceMeta);
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
      await handleShowCatalogEdit(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      break;

    case "cats":
      await handleShowCategoriesEdit(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      break;

    case "cat":
      await handleShowProducts(chatId, messageId, Number(params[0]), Number(params[1] || 0), from, sourceMeta);
      break;

    case "prd":
      await handleShowProduct(chatId, messageId, Number(params[0]), from, sourceMeta);
      break;

    case "buy":
      // Always use variant flow — stock synced with web/WA via product_variants
      await handleShowVariants(chatId, messageId, Number(params[0]), from, sourceMeta);
      break;

    case "vars":
      await handleShowVariants(chatId, messageId, Number(params[0]), from, sourceMeta);
      break;

    case "var":
      await handleVariantConfirm(chatId, messageId, Number(params[0]), from, sourceMeta);
      break;

    case "terms":
      await handleProductTerms(chatId, Number(params[0]), Number(params[1] || 0), Number(params[2] || 0), from, messageId, sourceMeta);
      break;

    case "qty":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), 1, from, sourceMeta);
      break;

    case "q":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from, sourceMeta);
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
      if (params.length > 0) {
        if (await notifyPaymentMaintenance(chatId)) return;
        const { tgCtxFor } = await import("@/lib/telegram/render-prefs");
        const ctx = await tgCtxFor(from.id);
        const en = ctx.locale === "en";
        const productId = Number(params[0]);
        const variantId = Number(params[1]);
        const rawQty = Number(params[2]);
        const approvalTag = params[3] ? String(params[3]) : undefined;
        if (
          params.length > 4 ||
          !Number.isSafeInteger(productId) || productId <= 0 ||
          !Number.isSafeInteger(variantId) || variantId <= 0 ||
          !Number.isSafeInteger(rawQty) || rawQty <= 0
        ) {
          const { errorMessage } = await import("@/lib/telegram/messages");
          await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
          break;
        }
        const { getActiveVariant, effectiveVariantStock, formatVariantLabel } = await import("@/lib/catalog");
        const { TELEGRAM_MAX_QTY } = await import("@/lib/telegram/keyboards");
        const { MAX_UNIQUE_UNITS_PER_ORDER } = await import("@/lib/fulfillment/units");
        const { errorMessage, outOfStockMessage } = await import("@/lib/telegram/messages");
        const variant = await getActiveVariant(variantId);
        const product = variant && variant.product_id === productId
          ? await queryFirst(`SELECT id, name, name_en, telegram_enabled FROM products WHERE id=? AND is_active=1`, productId)
          : null;
        if (!variant || variant.product_id !== productId || !product || Number(product.telegram_enabled) !== 1) {
          await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
          break;
        }
        variant.stock = effectiveVariantStock(variant);
        const stockMax = variant.stock === -1 ? TELEGRAM_MAX_QTY : Math.max(1, Math.min(variant.stock, TELEGRAM_MAX_QTY));
        const uniqueMax = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, stockMax) : stockMax;
        const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
        const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY, uniqueMax);
        if (variant.stock === 0 || minQty > maxQty) {
          await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
          break;
        }
        if (rawQty < minQty) {
          await sendMessage({
            chat_id: chatId,
            text: en
              ? `Minimum purchase is ${minQty}. Adjust quantity to at least ${minQty} before paying.`
              : `Minimal pembelian ${minQty}. Ubah jumlah ke minimal ${minQty} sebelum membayar.`,
            parse_mode: "HTML",
            reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
          });
          await handleShowQty(chatId, messageId, productId, variantId, minQty, from);
          break;
        }
        if (variant.stock !== -1 && rawQty > variant.stock) {
          await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
          break;
        }
        if (rawQty > maxQty || rawQty > TELEGRAM_MAX_QTY) {
          await handleShowQty(chatId, messageId, productId, variantId, maxQty, from);
          break;
        }
        let effectivePrice = Number(variant.price);
        try {
          const { resolveBulkPrice } = await import("@/lib/bulk-pricing");
          effectivePrice = resolveBulkPrice(Number(variant.price), rawQty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? [])).price;
        } catch {
          await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
          break;
        }
        const currentTag = await checkoutApprovalTag([{ productId, variantId, qty: rawQty, price: effectivePrice }]);
        if (!approvalTag || approvalTag !== currentTag) {
          await handleShowQty(chatId, messageId, productId, variantId, rawQty, from);
          break;
        }
        const { requestBuyerInput } = await import("./buyer-input");
        if (await requestBuyerInput(chatId, from, productId, variantId, rawQty)) break;
        let checked: { required: boolean; email: string | null };
        try {
          checked = await readCheckoutEmail(String(from.id), [{ productId, variantId }]);
        } catch {
          await sendMessage({
            chat_id: chatId,
            text: en ? "Email could not be verified. Try again before choosing a method." : "Email belum bisa diperiksa. Coba lagi sebelum memilih metode.",
            parse_mode: "HTML",
            reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
          });
          break;
        }
        const buyer = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?", String(from.id)).catch(() => null);
        const currentPending = buyer?.pending_action == null ? null : String(buyer.pending_action);
        const { parsePayq1State } = await import("@/lib/telegram/payment-quote");
        const { paymentMethodNoticeMessage } = await import("@/lib/telegram/messages/purchase");
        const fp = checked.email ? await checkoutEmailFingerprint(checked.email) : "";
        const isConfirmedEmail = Boolean(
          checked.required && checked.email && currentPending &&
          new RegExp(`^email_confirm:${productId}:${variantId}:${rawQty}:[a-f0-9]{8}:${fp}$`).test(currentPending),
        );
        if (checked.required && !isConfirmedEmail) {
          const canTransition = currentPending == null
            || currentPending === `qty_for:${productId}:${variantId}`
            || currentPending.startsWith(`email_confirm:${productId}:${variantId}:`)
            || parsePayq1State(currentPending)?.st === "quoted";
          if (!canTransition) {
            await sendMessage({
              chat_id: chatId,
              text: paymentMethodNoticeMessage("deferred", { locale: ctx.locale }),
              parse_mode: "HTML",
              reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
            });
            break;
          }
          if (!checked.email) {
            if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `email_for:${productId}:${variantId}:${rawQty}`))) break;
            await sendMessage({
              chat_id: chatId,
              text: en
                ? "An active email is required to receive this product.\nReply with an active email, e.g. <code>name@email.com</code>.\nType /batal to cancel."
                : "Email dibutuhkan untuk mengirim produk ini.\nBalas dengan email aktif, contoh: <code>nama@email.com</code>.\nKetik /batal untuk membatalkan.",
              parse_mode: "HTML",
              reply_markup: { force_reply: true, selective: true, input_field_placeholder: "nama@email.com" },
            });
            break;
          }
          const { showEmailConfirmation } = await import("./discovery");
          await showEmailConfirmation(chatId, productId, variantId, rawQty, checked.email, currentPending, messageId, from);
          break;
        }
        const allowPendingAction = currentPending === `qty_for:${productId}:${variantId}` || isConfirmedEmail
          ? currentPending ?? undefined
          : undefined;
        const { productDisplayName } = await import("@/lib/i18n/product-name");
        const productName = productDisplayName({ name: String(product.name), nameEn: product.name_en == null ? null : String(product.name_en) }, ctx.locale);
        const label = formatVariantLabel(variant, ctx.locale);
        const displayName = rawQty > 1 ? `${productName} · ${label} ×${rawQty}` : `${productName} · ${label}`;
        const { showPaymentMethodOffer } = await import("./payment-methods");
        await showPaymentMethodOffer(chatId, messageId, from, {
          mode: "single",
          productId,
          variantId,
          qty: rawQty,
          tag: currentTag,
          productName: displayName,
          subtotal: effectivePrice * rawQty,
          identity: { kind: "single", productId, variantId, qty: rawQty },
          contactEmail: checked.email,
          allowPendingAction,
        });
        break;
      }

      // R1: render the frozen offer bound to the approved current cart
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
        await sendMessage({ chat_id: chatId, text: "Email belum bisa diperiksa. Coba lagi sebelum memilih metode.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
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
        text: enEmail ? "Send an active email. /batal to cancel." : "Kirim email aktif. /batal untuk batal.",
        parse_mode: "HTML",
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "nama@email.com" },
      });
      break;
    }

    case "ceedit":
      if (!(await setPendingActionUnlessCreating(String(from.id), chatId, "emailcart:"))) break;
      await sendMessage({ chat_id: chatId, text: "Kirim email aktif. /batal untuk batal.", reply_markup: { force_reply: true, input_field_placeholder: "nama@email.com" } });
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
      await sendMessage({ chat_id: chatId, text: `Batalkan pesanan ${String(params[0]).toUpperCase()}?`, reply_markup: cancelConfirmationKeyboard(params[0]) });
      break;

    case "cancelok":
      await handleOrderCancel(chatId, messageId, params[0], from);
      break;

    case "qrenew":
      await handleQrisRenew(chatId, params[0]);
      break;

    case "myorders":
      await handleMyOrders(chatId, from, messageId, sourceMeta);
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
      await handleShowCart(chatId, messageId, from, sourceMeta);
      break;

    case "cadd":
      await handleCartAdd(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), Number(params[2] || 1), from, sourceMeta);
      break;

    case "cinc":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), +1, sourceMeta);
      break;

    case "cdec":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), -1, sourceMeta);
      break;

    case "crm":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), 0, sourceMeta);
      break;

    case "cclear":
      await clearCart(String(from.id));
      await handleShowCart(chatId, messageId, from, sourceMeta);
      break;

    case "ccheckout":
      await handleCartCheckout(chatId, messageId, from, sourceMeta);
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
        await sendMessage({ chat_id: chatId, text: "Email belum bisa diperiksa. Coba lagi sebelum membayar.", reply_markup: minimalMenuKeyboard() });
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
      const helpLocale = helpPrefs.locale ?? "id";
      await sendMessage({ chat_id: chatId, text: helpMessage({ locale: helpLocale }), parse_mode: "HTML", reply_markup: helpKeyboard({ locale: helpLocale }) });
      break;
    }

    default:
      break;
  }
}
