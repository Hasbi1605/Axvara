// src/lib/telegram/handlers/payment-dispatch.ts — R2 provider dispatch.
// Narrow: order (quoted->creating SAME code/key, stock guards) + core
// adapter create ONCE (claim-first semantics) + resume matrix. No self-HTTP,
// no fake JWT, no fee/FX recompute, no adapter policy rewrites. Recovery:
// ambiguous/network/timeout/POST => durable TX retained, GET-only reconcile,
// next view re-reads saved TX (never re-POST blindly).
import { queryFirst, execRun } from "@/lib/db";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { safeEditOrSend } from "@/lib/telegram/api";
import { otherMethodsEntryKeyboard } from "@/lib/telegram/keyboards";
import { paymentMethodNoticeMessage } from "@/lib/telegram/messages/purchase";
import type { Payq1State } from "@/lib/telegram/payment-quote";
import type { Locale } from "@/lib/i18n/locale";

async function refreshResumeView(
  chatId: number, messageId: number, orderCode: string,
  from: { id: number; first_name: string; username?: string }, locale: Locale,
  currentRaw: string,
  options: { clearAnchor?: boolean } = {},
): Promise<void> {
  const { showProviderInvoiceStatus } = await import("./payment-status");
  // R3 send fence: the first critical send takes the SAME durable claim as the
  // retry BEFORE any HTTP (a concurrent retry tick cannot send while it is in
  // flight; a crashed claim is recovered by the retry after its backoff).
  const { claimProviderInvoiceSend, settleAmbiguousProviderInvoice } = await import("@/lib/telegram/invoice-retry");
  const claim = await claimProviderInvoiceSend(orderCode, { allowFresh: true });
  if (claim !== "busy") {
    const delivery = await showProviderInvoiceStatus(chatId, messageId, orderCode, from, { locale });
    // ok:true already set the delivered marker; a definite rejection leaves the
    // invoice pending for the bounded retry; an ambiguous FIRST send is settled
    // once (marker + same-order nudge), never resent.
    if (claim === "claimed" && delivery.kind === "live" && !delivery.ok && delivery.ambiguous) {
      await settleAmbiguousProviderInvoice(chatId, orderCode);
    }
  }
  // Ambiguous: the anchor stays bound to THIS order (pmentry stays busy), so
  // the buyer can never open a second live checkout while an invoice may exist.
  if (options.clearAnchor !== false) {
    const { clearPayq1AfterDurableTx } = await import("@/lib/telegram/payment-create");
    await clearPayq1AfterDurableTx(String(from.id), currentRaw, orderCode).catch(() => false);
  }
}

export async function dispatchPayq1Creating(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  locale: Locale,
  creating: Payq1State,
  creatingRaw: string,
  orderCode: string,
  idempotencyKey: string,
): Promise<void> {
  const ownerId = String(from.id);
  const selected = creating.selected;
  const selectedId = String(selected?.id ?? creating.sel ?? "");
  const kind = String(selected?.kind ?? "");
  // Telegram create NEVER accepts the gateway rail (owner 7 Nov 2026: bot =
  // QRIS + Crypto; gateway stays web-only). Defense in depth for a tampered or
  // pre-deploy frozen state. Saved gateway invoices with a durable TX are
  // resumed before dispatch (`resume_status`) and never reach this guard.
  if (kind === "gateway" || selectedId.startsWith("sekalipay_gateway:")) {
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("method_unavailable", { locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale }),
    });
    return;
  }
  /**
   * Definite failure notice + "other methods" entry (pmentry → fresh quote/nonce).
   * Releases the creating anchor only when provably no order/TX exists; otherwise
   * release refuses and the stale anchor is left for the existing resume/cancel
   * paths (ambiguous claims are never cancelled here).
   */
  const failureNotice = async (notice: "create_failed" | "method_unavailable" = "create_failed") => {
    const { releasePayq1CreatingIfNoOrder } = await import("@/lib/telegram/payment-create");
    await releasePayq1CreatingIfNoOrder(ownerId, creatingRaw, orderCode, idempotencyKey).catch(() => false);
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage(notice, { locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale }),
    });
  };
  if (creating.st !== "creating" || !selectedId || (kind !== "gateway" && kind !== "crypto")) {
    await failureNotice();
    return;
  }

  // Crash-window check: existing pending winner (same quote_id) => resume
  // ITS order/rail, never a second candidate. Same for a durable creating
  // row re-read here (CAS loser path). Loser DUPLICATE callbacks never
  // dispatch the legacy QRIS gateway — payq1 sel is rail-bound.
  const existingWinner = await queryFirst(
    `SELECT code, payment_method, subtotal, status, payment_status FROM orders WHERE quote_id=? OR code=?`, idempotencyKey, orderCode,
  ).catch(() => null);
  if (existingWinner && String(existingWinner.code) !== orderCode) {
    // A prior attempt under the same idempotency already won: resume it.
    await refreshResumeView(chatId, messageId, String(existingWinner.code), from, locale, creatingRaw);
    return;
  }

  // R2-C: the order for THIS saved code already exists (process lost after the
  // order batch, before the provider POST). Resume from that order's own
  // persisted snapshot: the live cart may have changed since, and the stock is
  // already held — never re-resolve lines or create a second order.
  const savedOrder = existingWinner && String(existingWinner.code) === orderCode ? existingWinner : null;
  if (savedOrder && (
    String(savedOrder.payment_method) !== selectedId
    || savedOrder.status !== "pending"
    || Number(savedOrder.subtotal) !== creating.idrSubtotal
  )) {
    await failureNotice();
    return;
  }

  // Resolve CURRENT lines again (single source; cart cleared by prior QRIS
  // flows stays failed-closed here — R2 never guesses lines).
  const { resolveCurrentPayq1Lines } = await import("./payment-lines");
  const { orderLinesFromSource, sanitizeCustomerName, releasePayq1CreatingIfNoOrder } = await import("@/lib/telegram/payment-create");
  const resolved = savedOrder ? null : await resolveCurrentPayq1Lines(ownerId, creating).catch(() => null);
  const built = savedOrder ? null : (resolved && resolved.ok ? orderLinesFromSource(creating, resolved.cartLines) : null);
  if (!savedOrder && !built) {
    // Tag/price drift or cart gone and NO order/TX exists yet: nothing financial
    // hangs on the anchor, so release it (exact CAS) and let the buyer requote
    // instead of leaving a permanent dead-end creating row.
    await releasePayq1CreatingIfNoOrder(ownerId, creatingRaw, orderCode, idempotencyKey);
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("expired", { locale }),
      parse_mode: "HTML",
    });
    return;
  }
  const orderSubtotal = savedOrder ? Number(savedOrder.subtotal) : built!.subtotal;

  // Outcome-policy preflight (INTERNAL draft, never guessed public
  // field/env/secret log): crypto needs operator outcome currency; gateway
  // uses existing configured flag. Missing => fail closed, no create.
  if (kind === "crypto") {
    const { checkNowpaymentsMinimum } = await import("@/lib/payments/nowpayments");
    const method = creating.methods.find((m) => m.id === selectedId);
    const amountText = String(method?.amount_text ?? "");
    const payCurrency = String(selected?.payCurrency ?? method?.pay_currency ?? "");
    try {
      await checkNowpaymentsMinimum(amountText, "usd", payCurrency);
    } catch {
      await failureNotice();
      return;
    }
    // Unverifiable saved outcome crypto: provider account unverified => never
    // claimed as production. Flag off / missing FX => GET recovery path.
    const { isNowpaymentsConfigured } = await import("@/lib/payments/rails");
    if (!isNowpaymentsConfigured()) {
      await failureNotice();
      return;
    }
  } else {
    const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
    if (!isSekalipayGatewayConfigured()) {
      await failureNotice();
      return;
    }
  }

  // Order BEFORE single POST (quoted->creating SAME code/key). Atomic stock
  // guards preserved; concurrent create => single winner resumes.
  const email = creating.contact.email;
  const phone = creating.contact.phone;
  const customerName = sanitizeCustomerName(from.first_name);
  let orderedCode = orderCode;
  if (built) try {
    const created = await createChannelOrderAtomic({
      orderCode,
      idempotencyKey,
      lines: built.lines,
      items: built.items,
      variantSnapshot: built.variantSnapshot,
      subtotal: built.subtotal,
      locale: creating.locale,
      primaryVariantId: built.primaryVariantId,
      customerName,
      customerWa: kind === "gateway" ? (phone ?? "") : "",
      customerEmail: email ?? null,
      salesChannel: "telegram",
      telegramChatId: ownerId,
      telegramUserId: ownerId,
      conversationId: null,
      channelMemberId: null,
      paymentMethod: selectedId,
      paymentAccount: kind === "gateway" ? "" : "NOWPayments",
      fulfillmentStatus: "not_required",
      orderWindowMinutes: 15,
    });
    orderedCode = created.code;
    if (!created.isExisting) trackFunnelEvent({ stage: "order", channel: "telegram", locale: creating.locale,
      method: selectedId, subtotal: built.subtotal, productId: built.lines[0]?.productId, variantId: built.primaryVariantId,
      quantity: built.lines.reduce((sum, line) => sum + line.qty, 0) });
  } catch {
    // Stock/config/pending-guard failure: fail closed, intent retained for
    // the user to requote honestly (no silent cart mutation here).
    await failureNotice();
    return;
  }

  // Core claim BEFORE one single POST. Adapters own claim-first + known-id
  // recovery (DUPLICATE/409 => GET saved). Ambiguous error => no restock,
  // no re-POST, no provider switch — resume view re-reads saved TX.
  try {
    if (kind === "gateway") {
      const frozen = creating.methods.find((m) => m.id === selectedId);
      const channel = String(selected?.channel ?? "");
      const estimatedFee = Number(selected?.estimatedFee ?? (frozen as { gateway?: { estimated_fee?: number } })?.gateway?.estimated_fee ?? NaN);
      if (!channel || !Number.isSafeInteger(estimatedFee) || estimatedFee < 0 || !email || !phone) {
        throw new Error("gateway_contact_missing");
      }
      const { createSekalipayGatewayInvoice } = await import("@/lib/payments/sekalipay-gateway");
      await createSekalipayGatewayInvoice(orderedCode, orderSubtotal, channel, {
        name: customerName, email, phone,
      }, estimatedFee);
    } else {
      const frozen = creating.methods.find((m) => m.id === selectedId);
      const usd = (selected?.usd ?? frozen?.usd) as {
        cents?: unknown; rate_num?: unknown; rate_den?: unknown; rate_text?: unknown;
        effective_at?: unknown; source?: unknown; pay_currency?: unknown; network?: unknown;
      } | undefined;
      if (!usd || typeof usd.cents !== "string") throw new Error("crypto_snapshot_missing");
      // Koin + jaringan untuk order INI dari id beku -> katalog kurasi (bukan literal / tebakan).
      const { cryptoTickerOfMethodId } = await import("@/lib/payments/crypto-preflight");
      const { getCryptoAsset } = await import("@/lib/payments/crypto-assets");
      const ticker = cryptoTickerOfMethodId(selectedId);
      const asset = ticker ? getCryptoAsset(ticker) : null;
      if (!ticker || !asset || String(selected?.payCurrency ?? ticker) !== ticker) throw new Error("crypto_snapshot_missing");
      const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
      const { cryptoPricing, centsToUsdText } = await import("@/lib/payments/crypto-pricing");
      // Rincian diturunkan ulang dari base beku (1% + biaya tetap koin); adapter
      // membandingkannya dengan kurs bertanda sehingga snapshot yang diubah-ubah ditolak.
      const pricing = cryptoPricing(BigInt(usd.cents), ticker);
      await createNowpaymentsInvoice(orderedCode, orderSubtotal, ticker, {
        payNetwork: asset.network,
        priceCurrency: "usd",
        // FROZEN canonical snapshot (rational + effectiveAt + net): never
        // live FX. Kebijakan: kurs mengambang + fee provider ditanggung merchant.
        expectedUsd: {
          cents: usd.cents,
          priceText: centsToUsdText(pricing.totalCents),
          surchargeBps: pricing.surchargeBps,
          surchargeCents: pricing.surchargeCents.toString(),
          totalCents: pricing.totalCents.toString(),
          rateText: String(usd.rate_text ?? ""),
          rateNum: String(usd.rate_num ?? ""),
          rateDen: String(usd.rate_den ?? ""),
          effectiveAt: String(usd.effective_at ?? ""),
          idrSubtotal: orderSubtotal,
          payCurrency: String(usd.pay_currency ?? ""),
          network: (usd.network ?? null) as string | null,
        },
        feePayer: "merchant",
        fixedRate: false,
      });
    }
  } catch (error) {
    // Memo/extra id: alamat tanpa memo tidak boleh dibayar. Baris TX sudah 'failed'; batalkan order pending
    // (stok kembali) dan beri hasil generik "pilih metode lain" — tidak ada alamat yang ditampilkan.
    if (error instanceof Error && error.message === "nowpayments_extra_id_unsupported") {
      try {
        const orderRow = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderedCode);
        const items = JSON.parse(String(orderRow?.items ?? "[]"));
        const { transitionPendingOrder } = await import("@/lib/db");
        await transitionPendingOrder(orderedCode, "dibatalkan", "nowpayments_extra_id_unsupported", items);
      } catch { /* kalah balapan / sudah terminal: aman */ }
      const { clearPayq1AfterDurableTx } = await import("@/lib/telegram/payment-create");
      await clearPayq1AfterDurableTx(ownerId, creatingRaw, orderedCode).catch(() => false);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: paymentMethodNoticeMessage("method_unavailable", { locale }),
        parse_mode: "HTML",
        // TX terminal + order batal = tidak ada charge tersisa; pembeli boleh
        // langsung memilih metode lain (quote/nonce baru).
        reply_markup: otherMethodsEntryKeyboard({ locale }),
      });
      return;
    }
    const message = error instanceof Error ? error.message : "unknown";
    const { isDefinitiveNowpaymentsFailure, clearPayq1AfterDurableTx } = await import("@/lib/telegram/payment-create");
    // Klasifikasi SAMA dengan web/Pedia: TX klaim initializing|pending atau pesan
    // ambiguous => AMBIGU. Selain itu definitif (tidak ada charge yang bisa direkonsiliasi).
    const definitive = kind === "crypto" && await isDefinitiveNowpaymentsFailure(orderedCode, message).catch(() => false);
    if (!definitive) {
      // AMBIGU: order + klaim DIPERTAHANKAN, tanpa POST ulang, dan anchor TETAP
      // terikat ke order ini — jadi pmentry tidak bisa membuka checkout kedua.
      // View/refresh tetap membaca invoice tersimpan (GET-only). Jangan kirim
      // tombol "metode lain" di sini: switching belum diizinkan.
      await refreshResumeView(chatId, messageId, orderedCode, from, locale, creatingRaw, { clearAnchor: false });
      return;
    }
    // DEFINITIF: tidak ada charge tersisa. Batalkan order (restock Market SEKALI
    // lewat guard atomik), tandai TX terminal bila ada, lepaskan anchor, lalu
    // tawarkan metode lain dengan quote/nonce BARU (callback pm: lama jadi stale).
    try {
      const orderRow = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderedCode);
      const items = JSON.parse(String(orderRow?.items ?? "[]"));
      const { transitionPendingOrder } = await import("@/lib/db");
      await transitionPendingOrder(orderedCode, "dibatalkan", `nowpayments_setup_failed:${message.slice(0, 60)}`, Array.isArray(items) ? items : []);
    } catch { /* sudah terminal / kalah balapan: aman, stok tidak dobel */ }
    await execRun(
      `UPDATE payment_transactions SET status='failed',last_error=COALESCE(last_error,?),updated_at=datetime('now')
       WHERE order_code=? AND provider='nowpayments' AND status IN ('initializing','pending')`,
      message, orderedCode,
    ).catch(() => undefined);
    await clearPayq1AfterDurableTx(ownerId, creatingRaw, orderedCode).catch(() => false);
    await safeEditOrSend({
      chat_id: chatId, message_id: messageId,
      text: paymentMethodNoticeMessage("create_failed", { locale }),
      parse_mode: "HTML",
      reply_markup: otherMethodsEntryKeyboard({ locale }),
    });
    return;
  }

  // Clear cart ONLY on success (purchased snapshot CAS) — matches legacy
  // QRIS behavior; then show the provider-aware view.
  try {
    // Resume from a saved order: the cart may have been edited since the
    // purchase was frozen — only clear it when it still IS the purchased cart.
    const stillPurchased = !savedOrder || (await resolveCurrentPayq1Lines(ownerId, creating).catch(() => null))?.ok === true;
    if (stillPurchased) {
      const { clearCart } = await import("@/lib/telegram/cart");
      await clearCart(ownerId);
    }
  } catch { /* cart cleanup best-effort; order/TX already durable */ }
  await refreshResumeView(chatId, messageId, orderedCode, from, locale, creatingRaw);
  void execRun;
}
