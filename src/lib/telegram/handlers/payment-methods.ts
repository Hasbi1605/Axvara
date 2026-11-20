// src/lib/telegram/handlers/payment-methods.ts — R2 frozen offer + create.
// Narrow module: render the frozen payq1 offer, handle pm: selection, and run
// the R2 quoted->creating->provider dispatch. Reads the FROZEN array only
// for selection (never rebuilds live options); legacy QRIS flow stays
// untouched (pay/epay never read payq1).
import { execRun } from "@/lib/db";
import { sendMessage, safeEditOrSend, answerCallbackQuery } from "@/lib/telegram/api";
import {
  paymentMethodOfferKeyboard,
  cryptoCoinKeyboard,
  otherMethodsEntryKeyboard,
  minimalMenuKeyboard,
} from "@/lib/telegram/keyboards";
import {
  paymentMethodOfferMessage,
  paymentMethodOfferDetails,
  paymentMethodNoticeMessage,
  cryptoPickerMessage,
} from "@/lib/telegram/messages/purchase";
import { tgCtxFor, tgUsdAlternate } from "@/lib/telegram/render-prefs";
import { outOfStockMessage } from "@/lib/telegram/messages/status";
import {
  freezePayq1,
  parsePayq1Callback,
  parsePayq1CryptoCallback,
  payq1Expired,
  readPayq1State,
  type Payq1LineIdentity,
} from "@/lib/telegram/payment-quote";

export type OfferRenderTarget =
  | { mode: "single"; productId: number; variantId: number; qty: number; tag: string; productName: string; subtotal: number; identity: Payq1LineIdentity; contactEmail: string | null; allowPendingAction?: string }
  | { mode: "cart"; tag: string; cartName: string; subtotal: number; identity: Payq1LineIdentity; contactEmail: string | null; allowPendingAction?: string };

/** Canonical 12-hex line identity: SHA-256 over canonical product/variant/qty/effective-price lines. */
export async function approvalLinesHash(lines: import("@/lib/telegram/checkout-approval").CheckoutApprovalLine[]): Promise<string> {
  return (await import("@/lib/telegram/checkout-approval")).checkoutApprovalTag(lines);
}

/** Render (or re-render) the frozen offer after qty/email/cart approval. */
export async function showPaymentMethodOffer(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  target: OfferRenderTarget,
): Promise<void> {
  if (target.mode === "single") {
    const { requestBuyerInput } = await import("./buyer-input");
    if (await requestBuyerInput(chatId,from,target.productId,target.variantId,target.qty)) return;
  }
  const ctx = await tgCtxFor(from.id);
  const frozen = await freezePayq1({
    fromUserId: String(from.id),
    locale: ctx.locale,
    tag: target.tag,
    identity: target.identity,
    idrSubtotal: target.subtotal,
    contactEmail: target.contactEmail,
    ...(target.allowPendingAction ? { allowPendingAction: target.allowPendingAction } : {}),
  });
  if (!frozen.ok) {
    // Namespace busy => another flow owns pending_action (including own
    // quoted-invalid): defer without mutation. No-methods/overflow =>
    // honest fail-closed notice.
    await sendMessage({
      chat_id: chatId,
      text: frozen.reason === "namespace_busy"
        ? paymentMethodNoticeMessage("deferred", { locale: ctx.locale })
        : paymentMethodNoticeMessage("unavailable", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const title = target.mode === "single" ? target.productName : target.cartName;
  const details = paymentMethodOfferDetails(frozen.state.methods, { locale: ctx.locale, subtotal: target.subtotal });
  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: `${paymentMethodOfferMessage({ productName: title, subtotal: target.subtotal }, { locale: ctx.locale, ...tgUsdAlternate(target.subtotal, ctx) })}\n\n${details.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: paymentMethodOfferKeyboard({ nonce: frozen.state.nonce, methods: frozen.state.methods, source: frozen.state.source, idrSubtotal: target.subtotal }, { locale: ctx.locale }),
  });
}

/**
 * QRIS dari offer beku: jalankan alur QRIS legacy yang sudah ada. Single
 * source = `handlePayWithQris` (invoice langsung); cart = `handleCartCheckout`
 * (ringkasan persetujuan → `cconfirm:`). Guard pending-order/email/approval
 * milik jalur legacy tetap berlaku; tidak ada order kedua dari sini.
 * Draft payq1 TIDAK dilepas sebelum checkout (AU-E2-9): kegagalan D1 transient
 * setelah titik ini harus menyisakan anchor agar redelivery `pm:`/`pgo:`
 * melanjutkan alur yang sama, bukan "session expired".
 */
async function startLegacyQrisFromOffer(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  state: Pick<import("@/lib/telegram/payment-quote").Payq1State, "source" | "tag" | "contact">,
): Promise<void> {
  if (state.source.kind === "single") {
    const { handlePayWithQris } = await import("./invoice");
    const { readCheckoutEmail } = await import("@/lib/telegram/checkout-email");
    const checked = await readCheckoutEmail(String(from.id), [{ productId: state.source.productId, variantId: state.source.variantId }]).catch(() => null);
    const emailReady = Boolean(checked?.required && state.contact?.email && checked.email === state.contact.email);
    await handlePayWithQris(
      chatId, messageId, state.source.productId, state.source.variantId, state.source.qty, from,
      emailReady, state.tag, emailReady ? state.contact.email! : undefined,
    );
  } else {
    const { handleCartCheckout } = await import("./cart");
    await handleCartCheckout(chatId, messageId, from);
  }
}

/**
 * Lepas draft payq1 HANYA setelah alur QRIS legacy selesai (return normal).
 * CAS exact-raw: bila alur menulis state lanjutan (email_for/email_confirm/
 * qty_for) atau anchor creating, state itu yang dipertahankan. Kegagalan
 * checkout (throw) sengaja tidak melepas draft — redelivery melanjutkan flow.
 */
async function releaseQrisOfferDraft(userId: string, raw: string): Promise<void> {
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    userId, raw,
  ).catch(() => undefined);
}

/**
 * Handle pm:<nonce>:<index> selection against the FROZEN array only.
 * Ownership: private chat (chatId===from.id guarded by ownerBound + group
 * redirect in route) + exact raw CAS. Stale/expired/malformed/cross-user/
 * group => no mutation, honest requote/latest notice. Duplicate valid
 * selection is idempotent. Rail non-QRIS hanya seleksi (create lewat pgo:).
 * QRIS adalah pengecualian: menekan baris QRIS langsung memulai pembayaran
 * QRIS legacy (owner 8 Nov 2026) — draft payq1 dilepas CAS, lalu
 * `startLegacyQrisFromOffer`. Tap ganda: hanya CAS pertama yang menang.
 */
export async function handlePayMethodSelect(
  chatId: number,
  messageId: number,
  data: string,
  from: { id: number; first_name: string; username?: string },
  callbackId?: string,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const answer = async (text?: string, alert = false) => {
    if (callbackId) await answerCallbackQuery(callbackId, text, alert);
  };
  const parsed = parsePayq1Callback(data);
  if (!parsed) {
    await answer();
    return;
  }
  const stored = await readPayq1State(String(from.id));
  if (!stored || !stored.state) {
    // Missing/corrupt frozen offer on a NEW-protocol callback: stable
    // session-expired notice, never QRIS fallback.
    await answer();
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const { raw, state } = stored;
  if (state.nonce !== parsed.nonce || payq1Expired(state)) {
    // Stale nonce (newer screen rendered) or expired: no mutation; honest
    // requote/latest notice. Caller re-renders via showPaymentMethodOffer.
    await answer();
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  if (state.st !== "quoted") {
    // Only quoted offers accept selection; contact/creating are R2 states.
    await answer();
    return;
  }
  const chosen = state.methods[parsed.index];
  if (!chosen || typeof chosen.id !== "string") {
    await answer();
    return;
  }
  // QRIS: BUKAN seleksi payq1 (rail-nya milik alur legacy). Draft beku TIDAK
  // dilepas dulu (AU-E2-9): kalau checkout gagal transient, redelivery `pm:`
  // menemukan anchor dan melanjutkan alur — bukan "session expired". Tap ganda
  // tetap aman: checkout legacy memakai ulang SATU pending order
  // (`createChannelOrderAtomic` isExisting), tidak membuat order kedua.
  if (chosen.id === "qris" || chosen.kind === "qris") {
    await answer();
    await startLegacyQrisFromOffer(chatId, messageId, from, state);
    await releaseQrisOfferDraft(String(from.id), raw);
    return;
  }
  const next = { ...state, sel: chosen.id };
  const nextRaw = `payq1:${JSON.stringify(next)}`;
  // Exact-raw CAS: loser (two-tab/duplicate race) keeps current offer.
  const claimed = await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    nextRaw, String(from.id), raw,
  ).catch(() => ({ changes: 0 }));
  await answer();
  if ((claimed.changes ?? 0) < 1) {
    // Lost the race: keep the current offer as-is (idempotent duplicate
    // taps land here too). No mutation, no error.
    return;
  }
  // Intermediate selection for non-QRIS rails: stay local, show the R2
  // confirm entry (pgo:). No order/provider write from pm: itself.
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: paymentMethodNoticeMessage("selected_other", { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: ctx.locale === "en" ? "▶ Continue" : "▶ Lanjut", callback_data: `pgo:${next.nonce}` }], ...paymentMethodOfferKeyboard({ nonce: next.nonce, methods: next.methods, source: next.source, idrSubtotal: next.idrSubtotal }, { locale: ctx.locale }).inline_keyboard] },
  });
}

/**
 * Handle pmc:<nonce>[:<page>] (coin/network menus) and pmb:<nonce> (back to methods).
 * Tidak ada mutasi: hanya merender ulang dari array beku (nonce-bound, state quoted). Tap koin memakai
 * pm:<nonce>:<index> yang sama dengan metode lain, sehingga freeze/consent/claim tidak berubah.
 */
export async function handlePayCryptoMenu(
  chatId: number,
  messageId: number,
  data: string,
  from: { id: number; first_name: string; username?: string },
  callbackId?: string,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const answer = async () => { if (callbackId) await answerCallbackQuery(callbackId); };
  const parsed = parsePayq1CryptoCallback(data);
  if (!parsed) { await answer(); return; }
  const stored = await readPayq1State(String(from.id));
  await answer();
  if (!stored || !stored.state || stored.state.nonce !== parsed.nonce || payq1Expired(stored.state)) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const state = stored.state;
  if (state.st !== "quoted") return;
  if (parsed.kind === "open") {
    const keyboard = cryptoCoinKeyboard(state, ctx, parsed.page);
    if (!keyboard) return;
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: cryptoPickerMessage(state.methods, parsed.page, ctx),
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
  }
  const details = paymentMethodOfferDetails(state.methods, { locale: ctx.locale, subtotal: state.idrSubtotal });
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: `${paymentMethodOfferMessage({ productName: ctx.locale === "en" ? "Your order" : "Pesananmu", subtotal: state.idrSubtotal }, { locale: ctx.locale, ...tgUsdAlternate(state.idrSubtotal, ctx) })}\n\n${details.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: paymentMethodOfferKeyboard({ nonce: state.nonce, methods: state.methods, source: state.source, idrSubtotal: state.idrSubtotal }, { locale: ctx.locale }),
  });
}

/**
 * Handle pgo:<nonce> — R2 create entry (distinct from legacy pay/epay).
 * Flow: validate frozen selection still configured/supported/amount-eligible
 * against CURRENT live options + current live product/effective price/tag;
 * CAS-claim quoted/contact -> creating with pre-generated orderCode +
 * deterministic idempotencyKey; dispatch ONCE via actual core adapters
 * (gateway fee consent copy first for gateway; crypto uses FROZEN cents);
 * resume matrix on concurrency/crash (same code/rail, never second stock).
 * NEVER clears intent before a known recoverable invoice/order is terminal.
 */
export async function handlePayMethodConfirm(
  chatId: number,
  messageId: number,
  data: string,
  from: { id: number; first_name: string; username?: string },
  callbackId?: string,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const answer = async (text?: string, alert = false) => {
    if (callbackId) await answerCallbackQuery(callbackId, text, alert);
  };
  const { parsePayq1GoCallback, payq1Expired, readPayq1State } = await import("@/lib/telegram/payment-quote");
  const {
    claimPayq1Creating, validateFrozenSelectionLive, decideResumeFromCreating,
    clearPayq1AfterDurableTx, orderLinesFromSource,
  } = await import("@/lib/telegram/payment-create");
  const parsedGo = parsePayq1GoCallback(data);
  if (!parsedGo) {
    await answer();
    return;
  }
  await answer();
  const stored = await readPayq1State(String(from.id)).catch(() => null);
  if (!stored || !stored.state) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  if (stored.state.nonce !== parsedGo.nonce) {
    // Stale confirm (newer screen rendered): no mutation, honest notice.
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  const state = stored.state;
  if (state.st === "creating" && payq1Expired(state)) {
    // R2-C: an expired quote may never CREATE, but a creating anchor must not
    // become a permanent dead end. Existing order/TX => resume/show status
    // (no new money movement); nothing created yet => release for requote.
    const decision = await decideResumeFromCreating(state).catch(() => ({ action: "fail_closed", reason: "resume_failed" }) as const);
    if (decision.action === "resume_status") {
      const { showProviderInvoiceStatus } = await import("./payment-status");
      await showProviderInvoiceStatus(chatId, messageId, decision.orderCode, from, { locale: ctx.locale });
      await clearPayq1AfterDurableTx(String(from.id), stored.raw, decision.orderCode).catch(() => false);
      return;
    }
    if (decision.action === "dispatch" && state.orderCode && state.idempotencyKey) {
      const { releasePayq1CreatingIfNoOrder } = await import("@/lib/telegram/payment-create");
      await releasePayq1CreatingIfNoOrder(String(from.id), stored.raw, state.orderCode, state.idempotencyKey);
    }
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  if (payq1Expired(state)) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  if (state.st !== "quoted" && state.st !== "contact" && state.st !== "creating") {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  // Creating-state re-entry (duplicate tap / retry after crash): resume the
  // SAME orderCode/rail via the durable matrix — never a second intent.
  // IMPORTANT: re-read CURRENT stored state — callers may pass a stale
  // snapshot (e.g. pre-contact); the durable anchor is the DB row.
  const currentStored = await readPayq1State(String(from.id)).catch(() => stored);
  const current = currentStored?.state && currentStored.state.nonce === state.nonce ? currentStored.state : state;
  const currentRaw = currentStored?.state && currentStored.state.nonce === state.nonce ? currentStored.raw : stored.raw;
  if (current.st === "creating") {
    const decision = await decideResumeFromCreating(current).catch(() => ({ action: "fail_closed", reason: "resume_failed" }) as const);
    if (decision.action === "resume_status") {
      const { showProviderInvoiceStatus } = await import("./payment-status");
      await showProviderInvoiceStatus(chatId, messageId, decision.orderCode, from, { locale: ctx.locale });
      await clearPayq1AfterDurableTx(String(from.id), currentRaw, decision.orderCode).catch(() => false);
      return;
    }
    if (decision.action === "dispatch") {
      const { dispatchPayq1Creating } = await import("./payment-dispatch");
      await dispatchPayq1Creating(chatId, messageId, from, ctx.locale, current, currentRaw, decision.orderCode, decision.idempotencyKey);
      return;
    }
    // Definite failure (no durable TX resumed): release the anchor when there
    // is provably no order/TX so the fresh-quote entry below can freeze a new
    // payq1 nonce. Existing order/TX cases are left untouched (resume matrix).
    if (current.orderCode && current.idempotencyKey) {
      const { releasePayq1CreatingIfNoOrder } = await import("@/lib/telegram/payment-create");
      await releasePayq1CreatingIfNoOrder(String(from.id), currentRaw, current.orderCode, current.idempotencyKey).catch(() => false);
    }
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("create_failed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale, source: current.source, tag: current.tag }),
    });
    return;
  }
  // Quote-expiry guard (R2 acceptance): an expired payq1 may NEVER create.
  // No side effects here (no TX write, no overwrite): report honestly, intent
  // stays inspectable until the buyer explicitly re-quotes or cancels
  // (no silent repair, no legacy QRIS fallback, no order/stock/provider).
  if (payq1Expired(current)) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  // QRIS dipilih lewat pgo: dari keyboard LAMA (fallback kompatibilitas): jalur
  // utama sekarang `pm:` baris QRIS. Draft dilepas hanya SETELAH checkout
  // kembali (AU-E2-9) supaya kegagalan transient tetap bisa dilanjutkan.
  if (current.sel === "qris") {
    await startLegacyQrisFromOffer(chatId, messageId, from, current);
    await releaseQrisOfferDraft(String(from.id), currentRaw);
    return;
  }
  // Quoted/contact: validate the frozen selection is still live-supported
  // and the current cart/single matches (price/tag drift => requote).
  // NOTE: `current` is the CURRENT DB row (same nonce across quoted->contact
  // stages). Never validate the stale entry snapshot.
  const live = await validateFrozenSelectionLive(current).catch(() => ({ ok: false, reason: "validate_failed" }) as const);
  if (!live.ok) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: live.reason === "tariff_changed"
        ? paymentMethodNoticeMessage("expired", { locale: ctx.locale })
        : live.reason === "method_unavailable"
          ? paymentMethodNoticeMessage("method_unavailable", { locale: ctx.locale })
          : paymentMethodNoticeMessage("create_failed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale, source: current.source, tag: current.tag }),
    });
    return;
  }
  if (live.kind !== "gateway" && live.kind !== "crypto") {
    // Legacy QRIS never flows through pgo: — pay/epay own it.
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("refreshed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  // Re-read the CURRENT cart/single and bind: mismatch (price/tag drift) =>
  // explicit requote, never create on drifted prices.
  const { resolveCurrentPayq1Lines } = await import("./payment-lines");
  const resolved = await resolveCurrentPayq1Lines(String(from.id), current).catch(() => null);
  if (!resolved || !resolved.ok) {
    const reason = resolved?.reason ?? "catalog_read_failed";
    console.warn("[telegram-checkout] rejected", { method: live.methodId, reason });
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: reason === "stock" ? outOfStockMessage({ locale: ctx.locale }) : paymentMethodNoticeMessage("catalog_changed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: reason === "stock" ? minimalMenuKeyboard({ locale: ctx.locale }) : otherMethodsEntryKeyboard({ locale: ctx.locale, source: current.source, tag: current.tag }),
    });
    return;
  }
  void orderLinesFromSource;
  // Gateway needs provider-required valid email + phone BEFORE creating;
  // crypto needs existing fulfillment email rules ONLY (never phone).
  // NOTE: `current` is the CURRENT DB row — the stale `state` snapshot
  // predates the quoted->contact phone CAS.
  if (live.kind === "gateway") {
    const { readCheckoutEmail } = await import("@/lib/telegram/checkout-email");
    const checked = await readCheckoutEmail(String(from.id), resolved.cartLinesForEmail).catch(() => null);
    if (!checked || !checked.email) {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("contact_needed", { locale: ctx.locale }),
        parse_mode: "HTML",
      });
      return;
    }
    const contactPhone = current.contact?.phone ?? null;
    if (!contactPhone) {
      const { requestPayq1Contact } = await import("./payment-contact");
      await requestPayq1Contact(chatId, messageId, from, ctx.locale, currentRaw, current, checked.email);
      return;
    }
  } else {
    const { readCheckoutEmail } = await import("@/lib/telegram/checkout-email");
    const checked = await readCheckoutEmail(String(from.id), resolved.cartLinesForEmail).catch(() => null);
    if (checked && checked.required && !checked.email) {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("contact_needed", { locale: ctx.locale }),
        parse_mode: "HTML",
      });
      return;
    }
  }
  // Quote-expiry re-check (second seam): the quote may expire between
  // requestPayq1Contact/contact-capture and claim. Never create on an expired
  // quote — even when contact just completed. No side effects, no overwrite.
  {
    const reChecked = await readPayq1State(String(from.id)).catch(() => null);
    const reState = reChecked?.state ?? current;
    if (reState.nonce !== current.nonce || payq1Expired(reState)) {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
        parse_mode: "HTML",
      });
      return;
    }
  }
  // Progress notice (throttle duplicate loading bars: single send).
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: paymentMethodNoticeMessage("creating", { locale: ctx.locale }),
    parse_mode: "HTML",
  });
  const reStored = await readPayq1State(String(from.id)).catch(() => null);
  const activeRaw = reStored?.raw ?? currentRaw;
  const activeState = reStored?.state ?? current;
  if (activeState.nonce !== current.nonce || payq1Expired(activeState)) {
    // State rotated between re-reads (new screen rendered): no claim on a
    // stale snapshot — honest requote instead of a CAS on the wrong row.
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  const claim = await claimPayq1Creating(String(from.id), activeRaw, activeState);
  if (!claim.ok) {
    // Expired between re-check and CAS: honest requote, no order/TX write.
    if (claim.reason === "quote_expired") {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
        parse_mode: "HTML",
      });
      return;
    }
    // Surface the exact gate when it is a contact/precondition failure —
    // fixtures must distinguish "phone not captured" from adapter errors
    // (no silent create_failed on a precondition).
    if (claim.reason === "contact_missing" || claim.reason === "contact_invalid") {
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("contact_needed", { locale: ctx.locale }),
        parse_mode: "HTML",
      });
      return;
    }
    if (claim.state?.st === "creating" && claim.state.orderCode) {
      const decision = await decideResumeFromCreating(claim.state).catch(() => ({ action: "fail_closed", reason: "resume_failed" }) as const);
      if (decision.action === "resume_status") {
        const { showProviderInvoiceStatus } = await import("./payment-status");
        await showProviderInvoiceStatus(chatId, messageId, decision.orderCode, from, { locale: ctx.locale });
        return;
      }
      if (decision.action === "dispatch") {
        const { dispatchPayq1Creating } = await import("./payment-dispatch");
        const freshRaw = (await readPayq1State(String(from.id)).catch(() => null))?.raw ?? activeRaw;
        await dispatchPayq1Creating(chatId, messageId, from, ctx.locale, claim.state, freshRaw, decision.orderCode, decision.idempotencyKey);
        return;
      }
    }
    // Fail closed with the existing generic notice (+ fresh-quote entry). A
    // gateway id submitted against a tampered/legacy offer lands here as
    // `method_unavailable` before any order/TX write.
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage(claim.reason === "method_unavailable" ? "method_unavailable" : "create_failed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale, source: activeState.source, tag: activeState.tag }),
    });
    return;
  }
  const { dispatchPayq1Creating } = await import("./payment-dispatch");
  await dispatchPayq1Creating(chatId, messageId, from, ctx.locale, claim.state, claim.raw, claim.orderCode, claim.idempotencyKey);
}
