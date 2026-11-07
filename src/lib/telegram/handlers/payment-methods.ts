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
} from "@/lib/telegram/keyboards";
import {
  paymentMethodOfferMessage,
  paymentMethodOfferDetails,
  paymentMethodNoticeMessage,
} from "@/lib/telegram/messages/purchase";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import {
  freezePayq1,
  parsePayq1Callback,
  parsePayq1CryptoCallback,
  payq1Expired,
  readPayq1State,
  type Payq1LineIdentity,
} from "@/lib/telegram/payment-quote";

export type OfferRenderTarget =
  | { mode: "single"; productId: number; variantId: number; qty: number; tag: string; productName: string; subtotal: number; identity: Payq1LineIdentity; contactEmail: string | null }
  | { mode: "cart"; tag: string; cartName: string; subtotal: number; identity: Payq1LineIdentity; contactEmail: string | null };

/** Canonical 12-hex line identity: SHA-256 over canonical product/variant/qty/effective-price lines. */
export async function approvalLinesHash(lines: { productId: number; variantId: number; qty: number; price: number }[]): Promise<string> {
  const canonical = lines.map((l) => [l.productId, l.variantId, l.qty, l.price]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Render (or re-render) the frozen offer after qty/email/cart approval. */
export async function showPaymentMethodOffer(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  target: OfferRenderTarget,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const frozen = await freezePayq1({
    fromUserId: String(from.id),
    locale: ctx.locale,
    tag: target.tag,
    identity: target.identity,
    idrSubtotal: target.subtotal,
    contactEmail: target.contactEmail,
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
    });
    return;
  }
  const title = target.mode === "single" ? target.productName : target.cartName;
  const details = paymentMethodOfferDetails(frozen.state.methods, { locale: ctx.locale });
  await safeEditOrSend({
    chat_id: chatId,
    message_id: messageId,
    text: `${paymentMethodOfferMessage({ productName: title, subtotal: target.subtotal }, { locale: ctx.locale })}\n\n${details.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: paymentMethodOfferKeyboard({ nonce: frozen.state.nonce, methods: frozen.state.methods }, { locale: ctx.locale }),
  });
}

/**
 * Handle pm:<nonce>:<index> selection against the FROZEN array only.
 * Ownership: private chat (chatId===from.id guarded by ownerBound + group
 * redirect in route) + exact raw CAS. Stale/expired/malformed/cross-user/
 * group => no mutation, honest requote/latest notice. Duplicate valid
 * selection is idempotent. R2 creation entry lives behind pgo: (below);
 * R1-style pm never creates orders.
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
  if (chosen.id === "qris" || chosen.kind === "qris") {
    // Legacy QRIS fast path untouched: selection only marks the frozen
    // offer; the existing pay/epay flow creates the order as before.
    // pm: never dispatches a gateway create (even when a payq1 is present).
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("refreshed", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: paymentMethodOfferKeyboard({ nonce: next.nonce, methods: next.methods }, { locale: ctx.locale }),
    });
    return;
  }
  // Intermediate selection for non-QRIS rails: stay local, show the R2
  // confirm entry (pgo:). No order/provider write from pm: itself.
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: paymentMethodNoticeMessage("selected_other", { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: ctx.locale === "en" ? "▶ Continue" : "▶ Lanjut", callback_data: `pgo:${next.nonce}` }], ...paymentMethodOfferKeyboard({ nonce: next.nonce, methods: next.methods }, { locale: ctx.locale }).inline_keyboard] },
  });
}

/**
 * Handle pmc:<nonce> (buka sub-menu koin crypto) dan pmb:<nonce> (kembali ke metode utama).
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
    });
    return;
  }
  const state = stored.state;
  if (state.st !== "quoted") return;
  if (parsed.kind === "open") {
    if (!state.methods.some((method) => method.kind === "crypto")) return;
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("crypto_pick_coin", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: cryptoCoinKeyboard({ nonce: state.nonce, methods: state.methods }, { locale: ctx.locale }),
    });
    return;
  }
  const details = paymentMethodOfferDetails(state.methods, { locale: ctx.locale });
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: `${paymentMethodOfferMessage({ productName: ctx.locale === "en" ? "Your order" : "Pesananmu", subtotal: state.idrSubtotal }, { locale: ctx.locale })}\n\n${details.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: paymentMethodOfferKeyboard({ nonce: state.nonce, methods: state.methods }, { locale: ctx.locale }),
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
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale }),
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
    });
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
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  if (live.methodId === "qris" || live.kind !== "gateway" && live.kind !== "crypto") {
    // Legacy QRIS never flows through pgo: — pay/epay own it.
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("refreshed", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return;
  }
  // Re-read the CURRENT cart/single and bind: mismatch (price/tag drift) =>
  // explicit requote, never create on drifted prices.
  const { resolveCurrentPayq1Lines } = await import("./payment-lines");
  const resolved = await resolveCurrentPayq1Lines(String(from.id), current).catch(() => null);
  if (!resolved || !resolved.ok) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale: ctx.locale }),
      parse_mode: "HTML",
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
      reply_markup: otherMethodsEntryKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const { dispatchPayq1Creating } = await import("./payment-dispatch");
  await dispatchPayq1Creating(chatId, messageId, from, ctx.locale, claim.state, claim.raw, claim.orderCode, claim.idempotencyKey);
}
