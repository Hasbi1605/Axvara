// src/lib/telegram/games-checkout.ts — Mesin checkout AXVARA Games untuk Bot Telegram.
// Menjaga seluruh invarian jalur uang yang sama dengan POST /api/games/orders:
// - Verifikasi ulang harga, stok, kontrak SK, dan cost dari D1 (tidak percaya draft).
// - Guard 1 pesanan pending per chat Telegram + guard duplicate_active_order per (customer_no, sku).
// - INSERT orders (order_kind='games', items='[]', sales_channel='telegram') + games_order_items
//   dalam SATU db.batch atomik. TIDAK PERNAH menyentuh stok Market.
// - Cancel / definitive failure selalu restock `[]` + expire item Games.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { getD1, queryFirst, transitionPendingOrder } from "@/lib/db";
import { generateOrderCode } from "@/lib/security";
import { gamesMaxPrice, GAMES_QRIS_EXPIRY_MINUTES } from "@/lib/games/checkout";
import { gamesOrderingOpen, gamesPreviewMessage } from "@/lib/games/ordering";
import {
  gamesSkContractDigest,
  parseGamesSkContract,
  validateGamesSkTarget,
  type GamesSkTarget,
} from "@/lib/games/registry";
import { isGamesNicknameProduct, sanitizeGamesNickname } from "@/lib/games/sellable";
import { skGamesRef } from "@/lib/games/sk-dispatch";
import { gamesVariantName } from "@/lib/games/display-name";
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
import type { Payq1GamesSource, Payq1State } from "@/lib/telegram/payment-quote";
import type { Locale } from "@/lib/i18n/locale";

const ACTIVE_GAMES_ITEM_STATUSES = "('awaiting_payment','queued','submitting','pending','needs_check')";

export async function gamesApprovalTag(params: {
  productId: number;
  skVariantId: number;
  price: number;
  cost: number;
  contractDigest: string;
  display: string;
}): Promise<string> {
  const payload = JSON.stringify([
    "games",
    params.productId,
    params.skVariantId,
    params.price,
    params.cost,
    params.contractDigest,
    params.display,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type GamesPreflightResult =
  | {
      ok: true;
      product: {
        id: number;
        buyer_sku_code: string;
        product_name: string;
        game_slug: string;
        game_name: string;
        package_name: string;
        cost: number;
        sell_price: number;
        sk_variant_id: number;
        required_fields_json: string;
      };
      target: GamesSkTarget;
      display: string;
      fields: Record<string, string>;
      contractDigest: string;
      nickname: string | null;
      tag: string;
    }
  | { ok: false; reason: "ordering_closed" | "unavailable" | "price_changed" | "invalid_target" | "tag_changed" };

/** Validasi ulang snapshot Games terhadap baris D1 terkini sebelum membuat order. */
export async function preflightGamesSource(
  source: Payq1GamesSource,
  expectedSubtotal: number,
  expectedTag: string,
  db: DatabaseAccess = createDatabaseAccess(),
): Promise<GamesPreflightResult> {
  if (!gamesOrderingOpen()) return { ok: false, reason: "ordering_closed" };
  const row = await db.queryFirst(
    `SELECT gp.id, gp.buyer_sku_code, gp.product_name, gp.game_brand, gp.sk_product_name, gp.game_slug,
            gp.cost, gp.sell_price, gp.supplier, gp.supplier_active, gp.stock, gp.min_order,
            gp.required_fields_json, gp.enabled, gp.sk_variant_id, gm.display_name AS game_display_name
       FROM games_products gp
       LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
      WHERE gp.id=?`,
    source.productId,
  ).catch(() => null);
  if (!row || isGamesNicknameProduct(row)) return { ok: false, reason: "unavailable" };
  if (
    String(row.supplier ?? "") !== "sekalipay"
    || Number(row.enabled) !== 1
    || Number(row.supplier_active) !== 1
    || !(Number(row.stock) === -1 || Number(row.stock) > 0)
    || Number(row.min_order) !== 1
    || String(row.buyer_sku_code ?? "") !== source.sku
    || Number(row.sk_variant_id) !== source.skVariantId
    || String(row.game_slug ?? "") !== source.slug
  ) {
    return { ok: false, reason: "unavailable" };
  }
  const price = Number(row.sell_price);
  const cost = Number(row.cost);
  if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(cost) || cost <= 0) {
    return { ok: false, reason: "unavailable" };
  }
  if (price !== expectedSubtotal || cost !== source.costSnapshot) {
    return { ok: false, reason: "price_changed" };
  }
  const contract = parseGamesSkContract(row.required_fields_json);
  const targetInput: Record<string, string> = { note: source.note, ...(source.zoneId ? { zone_id: source.zoneId } : {}) };
  const target = contract ? validateGamesSkTarget(contract, targetInput) : null;
  if (!contract?.supported || !target?.ok) return { ok: false, reason: "invalid_target" };
  const digest = await gamesSkContractDigest(row.required_fields_json);
  if (digest !== source.contractDigest) return { ok: false, reason: "unavailable" };

  const tag = await gamesApprovalTag({
    productId: Number(row.id),
    skVariantId: Number(row.sk_variant_id),
    price,
    cost,
    contractDigest: digest,
    display: target.display,
  });
  if (tag !== expectedTag) return { ok: false, reason: "tag_changed" };

  const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").trim().slice(0, 120);
  const packageName = gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug: source.slug }) || String(row.product_name ?? "Top Up");
  const nickname = source.nickname ? sanitizeGamesNickname(source.nickname) || null : null;

  return {
    ok: true,
    product: {
      id: Number(row.id),
      buyer_sku_code: String(row.buyer_sku_code),
      product_name: String(row.product_name ?? ""),
      game_slug: source.slug,
      game_name: gameName,
      package_name: packageName,
      cost,
      sell_price: price,
      sk_variant_id: Number(row.sk_variant_id),
      required_fields_json: String(row.required_fields_json ?? ""),
    },
    target: target.target,
    display: target.display,
    fields: target.fields,
    contractDigest: digest,
    nickname,
    tag,
  };
}

export type CreateGamesTelegramOrderResult =
  | { ok: true; code: string; isExisting: boolean; subtotal: number; summary: string }
  | { ok: false; reason: "ordering_closed" | "unavailable" | "price_changed" | "duplicate_active_order" | "pending_order_exists" | "db_unavailable" | "create_failed"; existingOrderCode?: string };

/** Buat order Games + games_order_items atomik untuk kanal Telegram (QRIS maupun Crypto). */
export async function createGamesTelegramOrderAtomic(params: {
  orderCode: string;
  idempotencyKey: string;
  source: Payq1GamesSource;
  expectedSubtotal: number;
  expectedTag: string;
  locale: Locale;
  ownerUserId: string;
  chatId: string;
  customerName: string;
  paymentMethod: string;
  paymentAccount: string;
  orderWindowMinutes: number;
}): Promise<CreateGamesTelegramOrderResult> {
  const db = createDatabaseAccess();
  // 1. Reuse by quote_id (idempotent replay)
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
      summary: `${params.source.slug} — ${params.source.sku}`,
    };
  }

  // 2. Guard 1 pending order per chat Telegram (selaras Market)
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

  // 3. Live preflight terhadap D1
  const pre = await preflightGamesSource(params.source, params.expectedSubtotal, params.expectedTag, db);
  if (!pre.ok) {
    return {
      ok: false,
      reason: pre.reason === "ordering_closed"
        ? "ordering_closed"
        : pre.reason === "price_changed"
          ? "price_changed"
          : "unavailable",
    };
  }

  const d1 = getD1();
  if (!d1) return { ok: false, reason: "db_unavailable" };

  const code = params.orderCode;
  const price = pre.product.sell_price;
  const maxPrice = gamesMaxPrice(price, pre.product.cost);
  const supplierRef = skGamesRef(code);
  const targetJson = JSON.stringify(pre.target);
  const fieldsJson = JSON.stringify(pre.fields);
  const expiryModifier = `+${Math.max(5, Math.min(120, Math.floor(params.orderWindowMinutes)))} minutes`;
  const stmt = (sql: string, ...args: unknown[]) => d1.prepare(sql).bind(...args);
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;
  const summary = `${pre.product.game_name} — ${pre.product.package_name}`;

  let claimed = false;
  try {
    const result = await d1.batch([
      stmt(
        `INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,order_kind,telegram_chat_id,telegram_user_id,expires_at,buyer_access_version,buyer_access_format,locale)
         SELECT ?,?,?,'',NULL,'[]',?,?,?,'pending','pending','telegram','games',?,?,datetime('now',?),0,'code26',?
          WHERE EXISTS(SELECT 1 FROM games_products WHERE id=? AND buyer_sku_code=? AND supplier='sekalipay'
            AND enabled=1 AND supplier_active=1 AND (stock=-1 OR stock>0) AND min_order=1 AND game_slug=? AND sk_variant_id=?
            AND required_fields_json=? AND sell_price=? AND cost=?)
            AND NOT EXISTS(SELECT 1 FROM games_order_items WHERE customer_no=? AND buyer_sku_code=? AND status IN ${ACTIVE_GAMES_ITEM_STATUSES})
            AND NOT EXISTS(SELECT 1 FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')))`,
        code, params.idempotencyKey, params.customerName, price,
        params.paymentMethod, params.paymentAccount, params.chatId, params.ownerUserId, expiryModifier, params.locale,
        pre.product.id, pre.product.buyer_sku_code, pre.product.game_slug, pre.product.sk_variant_id,
        pre.product.required_fields_json, price, pre.product.cost,
        pre.display, pre.product.buyer_sku_code,
        params.chatId,
      ),
      stmt(
        `INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,customer_nickname,quantity,unit_price,total,cost_snapshot,max_price,status,attempt_no,supplier,sk_variant_id,target_snapshot,fields_snapshot,supplier_ref)
         SELECT ?,?,?,?,?,1,?,?,?,?,'awaiting_payment',1,'sekalipay',?,?,?,? WHERE ${owned}`,
        code, pre.product.id, pre.product.buyer_sku_code, pre.display, pre.nickname,
        price, price, pre.product.cost, maxPrice, pre.product.sk_variant_id, targetJson, fieldsJson, supplierRef,
        code, params.idempotencyKey,
      ),
    ]);
    claimed = Number(result[0]?.meta?.changes) === 1;
  } catch (error) {
    console.error("[tg-games-orders] claim batch failed", {
      product_id: pre.product.id,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    const winner = await db.queryFirst(`SELECT code, subtotal FROM orders WHERE quote_id=?`, params.idempotencyKey).catch(() => null);
    if (winner) return { ok: true, code: String(winner.code), isExisting: true, subtotal: Number(winner.subtotal ?? price), summary };
    return { ok: false, reason: "create_failed" };
  }

  if (!claimed) {
    const raceWinner = await db.queryFirst(`SELECT code, subtotal FROM orders WHERE quote_id=?`, params.idempotencyKey).catch(() => null);
    if (raceWinner) return { ok: true, code: String(raceWinner.code), isExisting: true, subtotal: Number(raceWinner.subtotal ?? price), summary };

    const pendingNow = await db.queryFirst(
      `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')) ORDER BY id DESC LIMIT 1`,
      params.chatId,
    ).catch(() => null);
    if (pendingNow) return { ok: false, reason: "pending_order_exists", existingOrderCode: String(pendingNow.code) };

    const dup = await db.queryFirst(
      `SELECT order_code FROM games_order_items WHERE customer_no=? AND buyer_sku_code=? AND status IN ${ACTIVE_GAMES_ITEM_STATUSES} ORDER BY id DESC LIMIT 1`,
      pre.display, pre.product.buyer_sku_code,
    ).catch(() => null);
    if (dup) return { ok: false, reason: "duplicate_active_order", existingOrderCode: String(dup.order_code) };

    return { ok: false, reason: "price_changed" };
  }

  return { ok: true, code, isExisting: false, subtotal: price, summary };
}

/**
 * Jalur 1-klik QRIS untuk Games dari frozen `payq1` offer.
 * Mengikuti semantik delivery & kompensasi yang sama dengan Market (`invoice.ts`),
 * namun tanpa pernah merestock stok Market.
 */
export async function startGamesQrisFromOffer(
  chatId: number,
  _messageId: number,
  from: { id: number; first_name: string; username?: string },
  state: Pick<Payq1State, "source" | "tag" | "locale" | "idrSubtotal" | "nonce">,
): Promise<void> {
  if (state.source.kind !== "games") return;
  const locale = state.locale;
  const en = locale === "en";
  if (await notifyPaymentMaintenance(chatId)) return;
  await sendChatAction(chatId, "typing").catch(() => {});

  if (!gamesOrderingOpen()) {
    await sendMessage({
      chat_id: chatId,
      text: gamesPreviewMessage(locale),
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

  const orderCode = generateOrderCode().replace(/^AXV-/, "AXG-");
  const idempotencyKey = `tg:games:qris:${from.id}:${state.nonce}`;
  const created = await createGamesTelegramOrderAtomic({
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
    orderWindowMinutes: GAMES_QRIS_EXPIRY_MINUTES,
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
          ? `⚠️ This Game ID already has an active order${created.existingOrderCode ? ` (<code>${created.existingOrderCode}</code>)` : ""}. Wait for it to finish or cancel the pending order first.`
          : `⚠️ ID Game ini masih memiliki pesanan aktif${created.existingOrderCode ? ` (<code>${created.existingOrderCode}</code>)` : ""}. Tunggu selesai atau batalkan pesanan pending terlebih dahulu.`,
        parse_mode: "HTML",
        reply_markup: created.existingOrderCode
          ? orderStatusKeyboard(created.existingOrderCode, { locale })
          : minimalMenuKeyboard({ locale }),
      });
      return;
    }
    if (created.reason === "price_changed" || created.reason === "unavailable") {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "⚠️ The package price or availability just changed. Please choose the package again."
          : "⚠️ Harga atau ketersediaan nominal baru saja berubah. Silakan pilih nominal ulang.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "🔄 Choose Package Again" : "🔄 Pilih Nominal Lagi", callback_data: cb.gamesOpen(state.source.slug) },
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
    console.error("[tg-games-qris] QRIS invoice failed:", error instanceof Error ? error.message : "unknown");
    // Rollback atomik tanpa restock Market + bebaskan item Games
    try {
      await transitionPendingOrder(finalCode, "dibatalkan", "qris_setup_failed", []);
      const { expireGamesCheckouts } = await import("@/lib/games/expire");
      await expireGamesCheckouts(createDatabaseAccess()).catch(() => {});
    } catch { /* sudah terminal / kalah balapan */ }
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "QRIS payment could not be created right now. Please try again shortly."
        : "Pembayaran QRIS belum bisa dibuat saat ini. Silakan coba lagi sebentar.",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: en ? "🔄 Try Again" : "🔄 Coba Lagi", callback_data: cb.gamesVariant(state.source.productId) },
          { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
        ]],
      },
    });
    return;
  }

  // Shorten order expires_at to provider deadline (never extend)
  try {
    const db = createDatabaseAccess();
    await db.execRun(
      `UPDATE orders SET expires_at=datetime((SELECT expires_at FROM payment_transactions WHERE order_code=?))
        WHERE code=? AND status='pending' AND julianday(expires_at)>julianday((SELECT expires_at FROM payment_transactions WHERE order_code=?))`,
      finalCode, finalCode, finalCode,
    );
  } catch { /* best-effort */ }

  if (!created.isExisting) {
    trackFunnelEvent({
      stage: "order",
      channel: "telegram",
      orderKind: "games",
      productId: state.source.productId,
      productSlug: state.source.slug,
      variantId: state.source.skVariantId,
      subtotal: created.subtotal,
      quantity: 1,
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

/** Baca ringkasan baris pending order Games untuk verifikasi ulang di payment-dispatch. */
export async function readGamesProductRowById(productId: number): Promise<Record<string, unknown> | null> {
  const row = await queryFirst(`SELECT * FROM games_products WHERE id=?`, productId).catch(() => null);
  return row ?? null;
}
