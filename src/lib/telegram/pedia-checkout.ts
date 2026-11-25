// src/lib/telegram/pedia-checkout.ts — Mesin checkout AXVARA Pedia untuk Bot Telegram.
// Menjaga seluruh invarian jalur uang yang sama dengan POST /api/pedia/orders:
// - Verifikasi ulang produk, tier, layanan live, batas min/max/step, custom comments,
//   margin guard 410 (auto-disable tier + bump catalog revision), dan harga dari D1.
// - Guard 1 pesanan pending per chat Telegram + guard duplicate_active_order per (target, product_id).
// - INSERT orders (order_kind='pedia', sales_channel='telegram') + pedia_order_items
//   dalam SATU db.batch atomik. TIDAK PERNAH menyentuh stok Market.
// - Cancel / definitive failure selalu restock `[]` + expire item Pedia.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { getD1, transitionPendingOrder } from "@/lib/db";
import { generateOrderCode } from "@/lib/security";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { pediaBounds } from "@/lib/pedia/bounds";
import { computePediaPrice, pediaMargin } from "@/lib/pedia/pricing";
import { pediaMinOrderRp } from "@/lib/pedia/ops-config";
import { checkCustomComments, CUSTOM_COMMENT_MAX_LINES, pediaServiceTypeFor } from "@/lib/pedia/custom-comments";
import { capturePediaServiceCopy, type PediaServiceCopy } from "@/lib/pedia/service-copy";
import { whiteLabel } from "@/lib/pedia/terms";
import { activeQrisProvider, createActiveQrisInvoice, isActiveQrisConfigured, qrisPaymentAccountLabel } from "@/lib/payments/qris";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { sendChatAction, sendMessage, sendPhoto } from "@/lib/telegram/api";
import { cb, minimalMenuKeyboard, orderStatusKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";
import { alreadyPendingMessage, errorMessage, invoiceMessage } from "@/lib/telegram/messages";
import {
  claimProviderInvoiceSend,
  isAmbiguousSendResult,
  markInvoicePending,
  markInvoiceSent,
  releaseInvoiceSendClaim,
  settleAmbiguousInvoiceSend,
} from "@/lib/telegram/invoice-retry";
import { isCriticalSendResult } from "@/lib/telegram/webhook-errors";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { sanitizeCustomerName } from "@/lib/telegram/payment-create";
import type { Payq1PediaSource, Payq1State } from "@/lib/telegram/payment-quote";
import type { Locale } from "@/lib/i18n/locale";

const ACTIVE_PEDIA_ITEM_STATUSES = "('awaiting_payment','queued','submitting','submitted','in_progress','needs_check')";

export async function pediaApprovalTag(params: {
  productId: number;
  tierId: number;
  qty: number;
  total: number;
  targetNormalized: string;
  supplier: string;
  supplierServiceId: number;
  comments?: string[];
}): Promise<string> {
  const payload = JSON.stringify([
    "pedia",
    params.productId,
    params.tierId,
    params.qty,
    params.total,
    params.targetNormalized,
    params.supplier,
    params.supplierServiceId,
    params.comments ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type PediaPreflightResult =
  | {
      ok: true;
      productId: number;
      productName: string;
      tierId: number;
      qty: number;
      unitPrice: number;
      total: number;
      supplier: string;
      supplierServiceId: number;
      supplierRateSnapshot: number;
      supplierTarget: string;
      refillDays: number;
      refillAnchor: "created" | "completed";
      minProfitRp: number;
      serviceCopy: PediaServiceCopy;
      customComments?: string[];
      summary: string;
      tag: string;
    }
  | {
      ok: false;
      reason: "pedia_closed" | "unavailable" | "margin_disabled" | "price_changed" | "invalid_comments" | "tag_changed";
    };

function deriveSupplierTarget(targetNormalized: string, targetFormat: unknown): string {
  if (String(targetFormat ?? "") !== "username") return targetNormalized;
  try {
    const seg = new URL(targetNormalized).pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
    return seg || targetNormalized;
  } catch {
    return targetNormalized;
  }
}

/** Validasi ulang snapshot Pedia terhadap D1 terkini (termasuk margin guard 410). */
export async function preflightPediaSource(
  source: Payq1PediaSource,
  expectedSubtotal: number,
  expectedTag: string,
  locale: Locale = "id",
  db: DatabaseAccess = createDatabaseAccess(),
): Promise<PediaPreflightResult> {
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    return { ok: false, reason: "pedia_closed" };
  }
  const product = await db.queryFirst(
    `SELECT * FROM pedia_products WHERE id=? AND is_active=1`,
    source.productId,
  ).catch(() => null);
  const tier = await db.queryFirst(
    `SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`,
    source.tierId,
    source.productId,
  ).catch(() => null);
  if (!product || !tier) return { ok: false, reason: "unavailable" };
  if (
    !isPediaProvider(tier.supplier)
    || tier.supplier !== source.supplier
    || Number(tier.supplier_service_id) !== source.supplierServiceId
  ) {
    return { ok: false, reason: "unavailable" };
  }
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type=? AND rate_idr_per_1k>0`,
    tier.supplier,
    Number(tier.supplier_service_id),
    pediaServiceTypeFor(tier.input_kind),
  ).catch(() => null);
  if (!live) return { ok: false, reason: "unavailable" };

  const qty = source.qty;
  const limits = pediaBounds(
    tier.input_kind === "comments" ? { ...live, max_qty: Math.min(Number(live.max_qty), CUSTOM_COMMENT_MAX_LINES) } : live,
    tier,
    Number(product.step),
  );
  if (!limits || qty < limits.min || qty > limits.max || qty % limits.step !== 0) {
    return { ok: false, reason: "unavailable" };
  }

  let customComments: string[] | undefined;
  if (tier.input_kind === "comments") {
    const raw = (source.comments ?? []).join("\n");
    const checked = checkCustomComments(raw, qty, locale);
    if (!checked.ok) return { ok: false, reason: "invalid_comments" };
    customComments = checked.lines;
  }

  const rate = Number(live.rate_idr_per_1k);
  const freshTotal = computePediaPrice({
    supplierRatePer1k: rate,
    quantity: qty,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp: pediaMinOrderRp(),
  });
  if (!Number.isFinite(freshTotal) || freshTotal <= 0) {
    return { ok: false, reason: "unavailable" };
  }

  // Guard margin di jalur uang (PD-33): nonaktifkan otomatis tier jika margin < min_profit_rp
  const margin = pediaMargin({ supplierRatePer1k: rate, quantity: qty, sellPrice: freshTotal });
  if (margin < Number(tier.min_profit_rp)) {
    const disabled = await db.execRun(
      `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', updated_at=datetime('now')
        WHERE id=? AND is_active=1`,
      Number(tier.id),
    ).catch(() => ({ changes: 0 }));
    if (Number(disabled?.changes ?? 0) > 0) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("pedia", db);
    }
    return { ok: false, reason: "margin_disabled" };
  }

  if (freshTotal !== expectedSubtotal) {
    return { ok: false, reason: "price_changed" };
  }

  const tag = await pediaApprovalTag({
    productId: Number(product.id),
    tierId: Number(tier.id),
    qty,
    total: freshTotal,
    targetNormalized: source.targetNormalized,
    supplier: String(tier.supplier),
    supplierServiceId: Number(tier.supplier_service_id),
    ...(customComments ? { comments: customComments } : {}),
  });
  if (tag !== expectedTag) return { ok: false, reason: "tag_changed" };

  const productName = whiteLabel(String(product.name ?? "Pesanan Pedia")).trim();
  const qtyLabel = qty.toLocaleString(locale === "en" ? "en-US" : "id-ID");
  return {
    ok: true,
    productId: Number(product.id),
    productName,
    tierId: Number(tier.id),
    qty,
    unitPrice: freshTotal / qty,
    total: freshTotal,
    supplier: String(tier.supplier),
    supplierServiceId: Number(tier.supplier_service_id),
    supplierRateSnapshot: rate,
    supplierTarget: deriveSupplierTarget(source.targetNormalized, tier.target_format),
    refillDays: Number(tier.refill_days) || 0,
    refillAnchor: tier.refill_anchor === "completed" ? "completed" : "created",
    minProfitRp: Number(tier.min_profit_rp) || 0,
    serviceCopy: capturePediaServiceCopy(product, tier),
    ...(customComments ? { customComments } : {}),
    summary: `${productName} · ${qtyLabel}`,
    tag,
  };
}

export type CreatePediaTelegramOrderResult =
  | { ok: true; code: string; isExisting: boolean; subtotal: number; summary: string }
  | {
      ok: false;
      reason:
        | "pedia_closed"
        | "unavailable"
        | "margin_disabled"
        | "price_changed"
        | "duplicate_active_order"
        | "pending_order_exists"
        | "db_unavailable"
        | "create_failed";
      existingOrderCode?: string;
    };

/** Buat order Pedia + pedia_order_items atomik untuk kanal Telegram (QRIS maupun Crypto). */
export async function createPediaTelegramOrderAtomic(params: {
  orderCode: string;
  idempotencyKey: string;
  source: Payq1PediaSource;
  expectedSubtotal: number;
  expectedTag: string;
  locale: Locale;
  ownerUserId: string;
  chatId: string;
  customerName: string;
  paymentMethod: string;
  paymentAccount: string;
  orderWindowMinutes: number;
}): Promise<CreatePediaTelegramOrderResult> {
  const db = createDatabaseAccess();

  // 1. Idempotent reuse by quote_id
  const reused = await db.queryFirst(
    `SELECT code, subtotal FROM orders WHERE quote_id=?`,
    params.idempotencyKey,
  ).catch(() => null);
  if (reused) {
    return {
      ok: true,
      code: String(reused.code),
      isExisting: true,
      subtotal: Number(reused.subtotal ?? params.expectedSubtotal),
      summary: params.locale === "en" ? "Pedia Order" : "Pesanan Pedia",
    };
  }

  // 2. Guard 1 pending order per chat Telegram
  const existingPending = await db.queryFirst(
    `SELECT code FROM orders
      WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')
        AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
      ORDER BY id DESC LIMIT 1`,
    params.chatId,
  ).catch(() => null);
  if (existingPending) {
    return { ok: false, reason: "pending_order_exists", existingOrderCode: String(existingPending.code) };
  }

  // 3. Live preflight + margin guard
  const pre = await preflightPediaSource(params.source, params.expectedSubtotal, params.expectedTag, params.locale, db);
  if (!pre.ok) {
    return {
      ok: false,
      reason: pre.reason === "pedia_closed"
        ? "pedia_closed"
        : pre.reason === "margin_disabled"
          ? "margin_disabled"
          : pre.reason === "price_changed"
            ? "price_changed"
            : "unavailable",
    };
  }

  const d1 = getD1();
  if (!d1) return { ok: false, reason: "db_unavailable" };

  const code = params.orderCode;
  const itemsJson = JSON.stringify([{
    product_id: pre.productId,
    variant_id: null,
    qty: 1,
    price: pre.total,
    name: pre.productName,
    pedia: {
      tier_id: pre.tierId,
      quantity: pre.qty,
      target: params.source.targetNormalized,
      unit_price: pre.unitPrice,
      credit_used: 0,
    },
  }]);
  const snapshotJson = JSON.stringify({
    supplier_target: pre.supplierTarget,
    refill_anchor: pre.refillAnchor,
    supplier: pre.supplier,
    supplier_service_id: pre.supplierServiceId,
    refill_days: pre.refillDays,
    min_profit_rp: pre.minProfitRp,
    service_copy: pre.serviceCopy,
    ...(pre.customComments ? { custom_comments: pre.customComments } : {}),
  });
  const expiryModifier = `+${Math.max(15, Math.min(120, Math.floor(params.orderWindowMinutes)))} minutes`;
  const stmt = (sql: string, ...args: unknown[]) => d1.prepare(sql).bind(...args);
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;

  let claimed = false;
  try {
    const result = await d1.batch([
      stmt(
        `INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,sales_channel,order_kind,telegram_chat_id,telegram_user_id,payment_status,paid_at,expires_at,buyer_access_version,buyer_access_format,locale)
         SELECT ?,?,?,'',NULL,?,?,?,?,?,'telegram','pedia',?,?,'pending',NULL,datetime('now',?),0,'code26',?
          WHERE NOT EXISTS(SELECT 1 FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ${ACTIVE_PEDIA_ITEM_STATUSES})
            AND NOT EXISTS(SELECT 1 FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')))`,
        code, params.idempotencyKey, params.customerName, itemsJson, pre.total,
        params.paymentMethod, params.paymentAccount, "pending", params.chatId, params.ownerUserId,
        expiryModifier, params.locale,
        params.source.targetNormalized, pre.productId,
        params.chatId,
      ),
      stmt(
        `INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts)
         SELECT ?,?,?,?,?,?,?,?,?,0,?,?,?,'queued',0 WHERE ${owned}`,
        code, pre.productId, pre.tierId, snapshotJson, params.source.targetRaw.slice(0, 600),
        params.source.targetNormalized, pre.qty, pre.unitPrice, pre.total,
        pre.supplier, pre.supplierServiceId, pre.supplierRateSnapshot,
        code, params.idempotencyKey,
      ),
    ]);
    claimed = Number(result[0]?.meta?.changes) === 1;
  } catch (error) {
    console.error("[tg-pedia-orders] claim batch failed", {
      product_id: pre.productId,
      tier_id: pre.tierId,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    const winner = await db.queryFirst(`SELECT code, subtotal FROM orders WHERE quote_id=?`, params.idempotencyKey).catch(() => null);
    if (winner) return { ok: true, code: String(winner.code), isExisting: true, subtotal: Number(winner.subtotal ?? pre.total), summary: pre.summary };
    return { ok: false, reason: "create_failed" };
  }

  if (!claimed) {
    const raceWinner = await db.queryFirst(`SELECT code, subtotal FROM orders WHERE quote_id=?`, params.idempotencyKey).catch(() => null);
    if (raceWinner) return { ok: true, code: String(raceWinner.code), isExisting: true, subtotal: Number(raceWinner.subtotal ?? pre.total), summary: pre.summary };

    const pendingNow = await db.queryFirst(
      `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')) ORDER BY id DESC LIMIT 1`,
      params.chatId,
    ).catch(() => null);
    if (pendingNow) return { ok: false, reason: "pending_order_exists", existingOrderCode: String(pendingNow.code) };

    const dup = await db.queryFirst(
      `SELECT order_code FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ${ACTIVE_PEDIA_ITEM_STATUSES} ORDER BY id DESC LIMIT 1`,
      params.source.targetNormalized, pre.productId,
    ).catch(() => null);
    if (dup) return { ok: false, reason: "duplicate_active_order", existingOrderCode: String(dup.order_code) };

    return { ok: false, reason: "create_failed" };
  }

  return { ok: true, code, isExisting: false, subtotal: pre.total, summary: pre.summary };
}

/** Jalur 1-klik QRIS untuk Pedia dari frozen `payq1` offer. */
export async function startPediaQrisFromOffer(
  chatId: number,
  _messageId: number,
  from: { id: number; first_name: string; username?: string },
  state: Pick<Payq1State, "source" | "tag" | "locale" | "idrSubtotal" | "nonce">,
): Promise<void> {
  if (state.source.kind !== "pedia") return;
  const locale = state.locale;
  const en = locale === "en";
  if (await notifyPaymentMaintenance(chatId)) return;
  await sendChatAction(chatId, "typing").catch(() => {});

  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    await sendMessage({
      chat_id: chatId,
      text: en ? "AXVARA Pedia ordering is not open yet." : "Pemesanan AXVARA Pedia belum dibuka saat ini.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }

  if (!isActiveQrisConfigured()) {
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "QRIS payment is temporarily unavailable. Try again or contact admin."
        : "Pembayaran QRIS belum tersedia. Coba lagi atau hubungi admin.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }

  const orderCode = generateOrderCode().replace(/^AXV-/, "AXP-");
  const idempotencyKey = `tg:pedia:qris:${from.id}:${state.nonce}`;
  const created = await createPediaTelegramOrderAtomic({
    orderCode,
    idempotencyKey,
    source: state.source,
    expectedSubtotal: state.idrSubtotal,
    expectedTag: state.tag,
    locale,
    ownerUserId: String(from.id),
    chatId: String(chatId),
    customerName: sanitizeCustomerName(from.first_name),
    paymentMethod: "qris",
    paymentAccount: qrisPaymentAccountLabel(),
    orderWindowMinutes: 60,
  });

  if (!created.ok) {
    if (created.reason === "pending_order_exists" && created.existingOrderCode) {
      const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
      await retryTelegramInvoiceDelivery(created.existingOrderCode).catch(() => false);
      await sendMessage({
        chat_id: chatId,
        text: alreadyPendingMessage(created.existingOrderCode, { locale }),
        parse_mode: "HTML",
        reply_markup: orderStatusKeyboard(created.existingOrderCode, { locale }),
      });
      return;
    }
    if (created.reason === "duplicate_active_order") {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `⚠️ This target link already has an active order${created.existingOrderCode ? ` (<code>${created.existingOrderCode}</code>)` : ""}. Wait for it to finish or cancel the pending order first.`
          : `⚠️ Link tujuan ini masih memiliki pesanan aktif${created.existingOrderCode ? ` (<code>${created.existingOrderCode}</code>)` : ""}. Tunggu selesai atau batalkan pesanan pending terlebih dahulu.`,
        parse_mode: "HTML",
        reply_markup: created.existingOrderCode
          ? orderStatusKeyboard(created.existingOrderCode, { locale })
          : minimalMenuKeyboard({ locale }),
      });
      return;
    }
    if (created.reason === "margin_disabled") {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "⚠️ This quality level was just disabled automatically. Please choose another quality."
          : "⚠️ Kualitas layanan ini baru saja dinonaktifkan otomatis. Silakan pilih kualitas lain.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "🔄 Choose Another Quality" : "🔄 Pilih Kualitas Lain", callback_data: cb.pediaTiers(state.source.productId, "a", 0) },
            { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
          ]],
        },
      });
      return;
    }
    if (created.reason === "price_changed" || created.reason === "unavailable") {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "⚠️ Price or service availability just changed. Please choose the service again."
          : "⚠️ Harga atau ketersediaan layanan baru saja berubah. Silakan pilih layanan ulang.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "🔄 Choose Again" : "🔄 Pilih Ulang", callback_data: cb.pediaTiers(state.source.productId, "a", 0) },
            { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
          ]],
        },
      });
      return;
    }
    await sendMessage({
      chat_id: chatId,
      text: errorMessage({ locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }

  const finalCode = created.code;
  let invoice: Awaited<ReturnType<typeof createActiveQrisInvoice>>;
  try {
    invoice = await createActiveQrisInvoice(finalCode, created.subtotal);
  } catch (error) {
    console.error("[tg-pedia-qris] QRIS invoice failed:", error instanceof Error ? error.message : "unknown");
    try {
      await transitionPendingOrder(finalCode, "dibatalkan", "qris_setup_failed", []);
      const { expirePediaCheckouts } = await import("@/lib/pedia/expire");
      await expirePediaCheckouts(createDatabaseAccess()).catch(() => {});
    } catch { /* sudah terminal / kalah balapan */ }
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "QRIS payment could not be created right now. Please try again shortly."
        : "Pembayaran QRIS belum bisa dibuat saat ini. Silakan coba lagi sebentar.",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: en ? "🔄 Try Again" : "🔄 Coba Lagi", callback_data: cb.pediaSelect(state.source.productId, state.source.tierId) },
          { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
        ]],
      },
    });
    return;
  }

  // Shorten order expires_at to provider deadline
  try {
    const db = createDatabaseAccess();
    const tx = await db.queryFirst("SELECT expires_at FROM payment_transactions WHERE order_code=? ORDER BY id DESC LIMIT 1", finalCode).catch(() => null);
    const raw = tx?.expires_at == null ? "" : String(tx.expires_at);
    const parsed = raw ? Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T")) : NaN;
    if (Number.isFinite(parsed)) {
      const iso = new Date(parsed).toISOString();
      await db.execRun(
        `UPDATE orders SET expires_at=datetime(?) WHERE code=? AND status='pending' AND datetime(expires_at)>datetime(?)`,
        iso, finalCode, iso,
      );
    }
  } catch { /* best-effort */ }

  if (!created.isExisting) {
    trackFunnelEvent({
      stage: "order",
      channel: "telegram",
      orderKind: "pedia",
      productId: state.source.productId,
      variantId: state.source.tierId,
      subtotal: created.subtotal,
      quantity: state.source.qty,
      locale,
      method: `qris:${activeQrisProvider()}`,
    });
  }

  await markInvoicePending(finalCode);
  const claim = await claimProviderInvoiceSend(finalCode, { allowFresh: true });
  if (claim !== "claimed") return;

  const caption = invoiceMessage({
    orderCode: finalCode,
    productName: created.summary,
    payableAmount: invoice.payableAmount,
    expiresAt: invoice.expiresAt,
    paymentMethod: "qris",
  }, { locale, chargeNote: true });

  const photo = await sendPhoto({
    chat_id: chatId,
    photo: invoice.qrisUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: qrisInvoiceKeyboard(finalCode, { locale }),
  });

  if (isAmbiguousSendResult(photo)) {
    await settleAmbiguousInvoiceSend(chatId, finalCode, invoice.qrisUrl, undefined, locale);
    return;
  }
  if (isCriticalSendResult(photo, "transactional")) {
    await releaseInvoiceSendClaim(finalCode);
    throw new Error(`telegram_invoice_send_failed:${photo.description || "unknown"}`);
  }
  await markInvoiceSent(finalCode);
}
