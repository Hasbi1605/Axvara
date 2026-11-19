import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
// src/lib/telegram/handlers/discovery.ts — Handler cari, riwayat, & input teks.
//
// MENGAPA dipisah: penelusuran (my-orders, search prompt/results), konfirmasi
// beli, serta handler input percakapan (pending qty/search/WA) semuanya berbagi
// pola "baca pending_action → validasi teks → lanjut ke langkah berikut". Handler
// input WA berisi cek kepemilikan sendiri (WHERE telegram_user_id=?). Dipisah dari
// siklus-hidup order agar router tetap ramping. Pemindahan murni dari route.ts.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { sendMessage, sendChatAction, safeEditOrSend } from "@/lib/telegram/api";
import {
  homeKeyboard, orderStatusKeyboard, myOrdersKeyboard, searchResultsKeyboard, searchNoResultsKeyboard,
  orderPaidKeyboard, TELEGRAM_MAX_QTY, emailConfirmationKeyboard, minimalMenuKeyboard,
} from "@/lib/telegram/keyboards";
import {
  outOfStockMessage, alreadyPendingMessage, errorMessage,
  myOrdersPrompt, myOrdersMessage, invalidWhatsAppMessage, waSavedAfterPaymentMessage,
  whatsAppInputPromptMessage, searchPromptMessage, searchResultsMessage,
  type TelegramOrderRow,
  emailConfirmationMessage,
} from "@/lib/telegram/messages";
import { tgCtxFor, tgUsdAlternate, type TgCtx } from "@/lib/telegram/render-prefs";
import { getProductDetail, formatVariantLabel, effectiveVariantStock } from "@/lib/catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { getCartSummary } from "@/lib/telegram/cart";
import { readCheckoutEmail, checkoutEmailFingerprint } from "@/lib/telegram/checkout-email";
import { cartCheckoutSummaryMessage, escapeHtml } from "@/lib/telegram/messages";
import { productDisplayName } from "@/lib/i18n/product-name";
import { countInventory } from "@/lib/fulfillment/inventory";
import { clampQty, getBestsellers, replaceWithText, setPendingActionUnlessCreating, type ScreenSourceMeta } from "./shared";
import { handleShowCatalog, handleShowQty, handleShowVariants } from "./catalog";

/**
 * Jawaban email untuk alur email_for: (migrasi 0033): user diminta email
 * karena varian butuh Invite/Link WR atau produk require_email. Validasi,
 * simpan ke telegram_users.buyer_email, lalu tampilkan konfirmasi masked
 * sebelum invoice diterbitkan. /batal membersihkan state.
 */
export async function handlePendingEmailInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!text.trim() || !isD1Mode()) return false;
  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("email_for:") && !action.startsWith("emailcart:")) return false;
  if (action.startsWith("emailcart:")) {
    // Alur keranjang: tidak ada product/variant tunggal — setelah email
    // tersimpan, user menekan Lanjut lagi (cconfirm) seperti biasa.
    const cartCtx = await tgCtxFor(from.id);
    const enCart = cartCtx.locale === "en";
    if (/^\/batal$/i.test(text.trim())) {
      await execRun(
        `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
        String(from.id),
      ).catch(() => {});
      await sendMessage({ chat_id: chatId, text: enCart ? "Cancelled." : "Dibatalkan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: enCart ? "en" : "id" }) });
      return true;
    }
    const cartEmail = text.trim();
    if (cartEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cartEmail)) {
      await sendMessage({
        chat_id: chatId,
        text: enCart ? "❌ Invalid email format. Example: <code>name@email.com</code>\nType /batal to cancel." : "❌ Format email tidak valid. Contoh: <code>nama@email.com</code>\nKetik /batal untuk membatalkan.",
        parse_mode: "HTML",
      });
      return true;
    }
    const stored = await execRun(
      `UPDATE telegram_users SET buyer_email=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
      cartEmail,
      String(from.id),
      action,
    );
    if (stored.changes) await showCartEmailConfirmation(chatId, from, cartEmail, action);
    return true;
  }
  const [, productIdRaw, variantIdRaw, qtyRaw] = action.split(":");
  const productId = Number(productIdRaw);
  const variantId = Number(variantIdRaw);
  const qty = Math.max(1, Number(qtyRaw) || 1);
  if (!productId || !variantId) return false;
  const mailCtx = await tgCtxFor(from.id);
  const enMail = mailCtx.locale === "en";
  if (/^\/batal$/i.test(text.trim())) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(from.id),
   );
    await sendMessage({ chat_id: chatId, text: enMail ? "Cancelled." : "Dibatalkan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: enMail ? "en" : "id" }) });
    return true;
  }
  const email = text.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await sendMessage({
      chat_id: chatId,
      text: enMail ? "❌ Invalid email format. Example: <code>name@email.com</code>\nType /batal to cancel." : "❌ Format email tidak valid. Contoh: <code>nama@email.com</code>\nKetik /batal untuk membatalkan.",
      parse_mode: "HTML",
    });
    return true;
  }
  const stored = await execRun(
    `UPDATE telegram_users SET buyer_email=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    email,
    String(from.id),
    action,
  );
  if (stored.changes) await showEmailConfirmation(chatId, productId, variantId, qty, email, action, 0, from);
  return true;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.length <= 2 ? local[0] ?? "*" : `${local[0]}***${local.at(-1)}`}@${domain}`;
}

export async function showEmailConfirmation(chatId: number, productId: number, variantId: number, qty: number, email?: string, expectedAction: string | null = null, messageId = 0, from?: { id: number }) {
  const { getActiveVariant } = await import("@/lib/catalog");
  const variant = await getActiveVariant(variantId);
  if (!variant || variant.product_id !== productId) return;
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const product = await queryFirst(`SELECT name FROM products WHERE id=?`, productId);
  const saved = email ?? String((await queryFirst(`SELECT buyer_email FROM telegram_users WHERE user_id=?`, String(chatId)))?.buyer_email ?? "");
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  // TG2b: harga efektif server untuk konfirmasi + tombol bayar.
  let confirmationUnit = Number(variant.price);
  let confirmationTier: number | null = null;
  try {
    const { resolveBulkPrice: resolveConfirmBulk } = await import("@/lib/bulk-pricing");
    const resolvedConfirm = resolveConfirmBulk(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? []));
    confirmationUnit = resolvedConfirm.price;
    confirmationTier = resolvedConfirm.tier ?? null;
  } catch {
    await sendMessage({ chat_id: chatId, text: errorMessage(), parse_mode: "HTML", reply_markup: minimalMenuKeyboard() });
    return;
  }
  const tag = await checkoutApprovalTag([{ productId, variantId, qty, price: confirmationUnit }]);
  const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND buyer_email=? AND (pending_action IS ? OR (pending_action LIKE 'payq1:%' AND pending_action LIKE '%\"st\":\"quoted\"%'))", `email_confirm:${productId}:${variantId}:${qty}:${nonce}:${await checkoutEmailFingerprint(saved)}`, String(chatId), saved, expectedAction);
  if (!stored.changes) return;
  await safeEditOrSend({
    chat_id: chatId, message_id: messageId,
    text: emailConfirmationMessage({ productName: String(product?.name ?? "Produk"), variantLabel: formatVariantLabel(variant, ctx.locale), qty, total: confirmationUnit * qty, basePrice: Number(variant.price), appliedTierMinQty: confirmationTier, maskedEmail: maskEmail(saved) }, { locale: ctx.locale, ...tgUsdAlternate(confirmationUnit * qty, ctx) }),
    parse_mode: "HTML",
    reply_markup: emailConfirmationKeyboard(productId, variantId, qty, confirmationUnit * qty, tag, nonce, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx }),
  });
}

export async function showCartEmailConfirmation(chatId: number, from: { id: number }, email?: string, expectedAction: string | null = null, messageId = 0) {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const summary = await getCartSummary(String(from.id));
  if (!summary.lines.length) return;
  if (summary.issues.length) {
    await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "Cart changed. Open the cart and check quantities and stock before paying." : "Keranjang berubah. Buka keranjang dan periksa jumlah serta stok sebelum membayar.", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
    return;
  }
  const checked = await readCheckoutEmail(String(from.id), summary.lines, email);
  if (!checked.email) {
    const stored = await execRun("UPDATE telegram_users SET pending_action='emailcart:', updated_at=datetime('now') WHERE user_id=? AND (pending_action IS ? OR (pending_action LIKE 'payq1:%' AND pending_action LIKE '%\"st\":\"quoted\"%'))", String(from.id), expectedAction);
    if (!stored.changes) return;
    await sendMessage({ chat_id: chatId, text: ctx.locale === "en" ? "Send an active email to receive the product. Type /batal to go back." : "Kirim email aktif untuk menerima produk. Ketik /batal untuk kembali.", reply_markup: { force_reply: true, input_field_placeholder: "nama@email.com" } });
    return;
  }
  const tag = await checkoutApprovalTag(summary.lines);
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND buyer_email=? AND (pending_action IS ? OR (pending_action LIKE 'payq1:%' AND pending_action LIKE '%\"st\":\"quoted\"%'))", `cart_confirm:${tag}:${nonce}:${await checkoutEmailFingerprint(checked.email)}`, String(from.id), checked.email, expectedAction);
  if (!stored.changes) return;
  const en = ctx.locale === "en";
  await safeEditOrSend({ chat_id: chatId, message_id: messageId, text: cartCheckoutSummaryMessage(summary.lines.map((line) => ({ productName: line.productName, variantLabel: line.variantLabel, price: line.price, qty: line.qty, basePrice: line.basePrice, appliedTierMinQty: line.appliedTierMinQty })), summary.subtotal, { locale: ctx.locale, ...tgUsdAlternate(summary.subtotal, ctx) }) + `\n\nEmail: ${escapeHtml(maskEmail(checked.email))}`, parse_mode: "HTML", reply_markup: { inline_keyboard: [
    [{ text: en ? "💳 Pay QRIS" : "💳 Bayar QRIS", callback_data: `cconfirm:${tag}:${nonce}`, style: "success" }],
    [{ text: en ? "💳 Other payment methods" : "💳 Metode pembayaran lain", callback_data: "pmentry" }],
    [{ text: en ? "Change Email" : "Ubah Email", callback_data: "ceedit" }, { text: en ? "Edit Cart" : "Ubah Keranjang", callback_data: "cart" }],
    ...summary.lines.map(line => [{ text: `📋 ${en ? "Terms" : "Ketentuan"} ${line.variantLabel.slice(0, 24)}`, callback_data: `terms:${line.productId}:${line.variantId}` }]),
  ] } });
}

// --- /orders: real order history with reorder shortcuts ---

export async function handleMyOrders(
  chatId: number,
  from?: { id: number; first_name: string; username?: string },
  messageId = 0,
  sourceMeta?: ScreenSourceMeta,
) {
  if (from) {
    const { handleExtraCallback } = await import("./extras");
    if (await handleExtraCallback("mo", [], chatId, messageId ?? 0, from)) return;
  }
  const [ctx, bestsellers] = await Promise.all([
    tgCtxFor(from?.id ?? chatId),
    getBestsellers(3),
  ]);
  if (!from || !isD1Mode()) {
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: myOrdersPrompt({ locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    }, sourceMeta);
    return;
  }
  const rows = await queryAll(
    `SELECT o.code, o.items, pt.payable_amount, o.payment_status, o.fulfillment_status, o.created_at
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.sales_channel='telegram' AND o.telegram_user_id=?
     ORDER BY o.created_at DESC
     LIMIT 10`,
    String(from.id),
  );
  const orders: TelegramOrderRow[] = (rows as {
    code: string; items: string; payable_amount: number | null;
    payment_status: string; fulfillment_status: string; created_at: string | null;
  }[]).map((row) => {
    let productName = "Produk";
    let productId: number | null = null;
    try {
      const items = JSON.parse(String(row.items ?? "[]")) as { product_id?: number; name?: string; qty?: number }[];
      productName = items.map(item => `${String(item.name ?? "Produk").slice(0, 70)} ×${Number(item.qty ?? 1)}`).join("\n");
      productId = Number(items[0]?.product_id) || null;
    } catch { /* keep defaults */ }
    return {
      code: String(row.code),
      productName,
      productId,
      payableAmount: row.payable_amount ?? null,
      paymentStatus: String(row.payment_status || "unpaid"),
      fulfillmentStatus: String(row.fulfillment_status || "not_required"),
      createdAt: row.created_at,
    };
  });
  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: myOrdersMessage(orders.map(({ code, productName, payableAmount, paymentStatus, fulfillmentStatus, createdAt }) => ({
      code, productName, payableAmount, paymentStatus, fulfillmentStatus, createdAt,
    })), { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: orders.length > 0
      ? myOrdersKeyboard(orders.map((order) => ({ code: order.code, productId: order.productId ?? null })), { locale: ctx.locale })
      : homeKeyboard(ctx.locale, bestsellers, ctx),
  }, sourceMeta);
}

// --- /cari: product search by name/alias ---

export async function handleSearchPrompt(
  chatId: number,
  from?: { id: number },
) {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  if (from && isD1Mode() && !(await setPendingActionUnlessCreating(String(from.id), chatId, "search:"))) return;
  await sendMessage({ chat_id: chatId, text: searchPromptMessage({ locale: ctx.locale }), parse_mode: "HTML" });
}

export async function handlePendingSearchInput(
  text: string,
  chatId: number,
  from: { id: number },
): Promise<boolean> {
  if (!text.trim() || !isD1Mode()) return false;
  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (action !== "search:") return false;
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";

  const keyword = text.trim().replace(/^\/batal$/i, "");
  if (/^\/batal$/i.test(text.trim())) {
    await execRun(
      `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(from.id),
    ).catch(() => {});
    await handleShowCatalog(chatId, from);
    return true;
  }
  if (keyword.length < 2) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "❌ Min 2 chars (e.g. <code>canva</code>)." : "❌ Minimal 2 huruf (mis. <code>canva</code>).",
      parse_mode: "HTML",
    });
    return true;
  }
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  ).catch(() => {});
  await handleSearchResults(chatId, keyword, from);
  return true;
}

export async function handleSearchResults(chatId: number, keyword: string, from?: { id: number }) {
  const [{ readTelegramCatalog, searchTelegramCatalog }, ctx] = await Promise.all([
    import("@/lib/telegram/catalog-snapshot"),
    tgCtxFor(from?.id ?? chatId),
  ]);
  const matching = searchTelegramCatalog(await readTelegramCatalog(), keyword);
  const available = matching.filter(row => row.price !== null);
  const products = available.slice(0, 10).map(row => ({
    id: row.id,
    name: productDisplayName({ name: row.name, nameEn: row.name_en }, ctx.locale),
    price: row.price!,
    stock: row.stock,
  }));
  const soldOut = products.length ? 0 : matching.length;
  await sendMessage({
    chat_id: chatId,
    text: searchResultsMessage(keyword, available.length, soldOut, products.length, { locale: ctx.locale }),
    parse_mode: "HTML",
    reply_markup: products.length > 0
      ? searchResultsKeyboard(products, { locale: ctx.locale, displayCurrency: ctx.displayCurrency, fx: ctx.fx })
      : searchNoResultsKeyboard({ locale: ctx.locale }),
  });
}

export async function handlePendingQtyInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode()) return false;
  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("qty_for:")) return false;
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const [, productIdRaw, variantIdRaw] = action.split(":");
  const productId = Number(productIdRaw);
  const variantId = Number(variantIdRaw);
  if (!productId || !variantId) return false;
  const typedQty = Number(text.trim());
  if (!Number.isInteger(typedQty) || typedQty < 1 || typedQty > TELEGRAM_MAX_QTY) {
    await sendMessage({
      chat_id: chatId,
      text: en ? `❌ Invalid quantity. Type a number 1–${TELEGRAM_MAX_QTY}, for example <code>5</code>.` : `❌ Jumlah tidak valid. Ketik angka 1–${TELEGRAM_MAX_QTY}, misalnya <code>5</code>.`,
      parse_mode: "HTML",
    });
    return true;
  }
  // Validate against the live dynamic range; never silently clamp typed bulk.
  try {
    const { getActiveVariant } = await import("@/lib/catalog");
    const typedVariant = await getActiveVariant(variantId);
    if (typedVariant) typedVariant.stock = effectiveVariantStock(typedVariant);
    const need = Math.max(1, Number(typedVariant?.min_qty ?? 1) || 1);
    const max = typedVariant?.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, typedVariant.stock === -1 ? MAX_UNIQUE_UNITS_PER_ORDER : typedVariant.stock) : typedVariant?.stock === -1 ? TELEGRAM_MAX_QTY : Math.min(Number(typedVariant?.stock ?? 0), TELEGRAM_MAX_QTY);
    if (typedVariant && (typedQty < need || typedQty > max)) {
      await sendMessage({
        chat_id: chatId,
        text: en ? `❌ Out of range. Send a number ${need}–${max}, for example <code>${need}</code>.` : `❌ Jumlah di luar batas. Kirim angka ${need}–${max}, misalnya <code>${need}</code>.`,
        parse_mode: "HTML",
      });
      return true;
    }
  } catch { /* gagal baca = lanjut seperti biasa, stepper+invoice tetap jaga */ }
  const qty = clampQty(typedQty);
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=?`,
    String(from.id),
  ).catch(() => {});
  await handleShowQty(chatId, 0, productId, variantId, qty, from);
  return true;
}

export async function handleBuyConfirm(chatId: number, messageId: number, productId: number, from?: { id: number }) {
  // Use catalog.ts for variant-level stock (synced with web/WA)
  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) return;
  const ctx = from ? await tgCtxFor(from.id) : undefined;

  // Aggregate stock from active variants
  const activeVariants = detail.variants.filter(v => v.is_active);
  const allOutOfStock = activeVariants.every(v => v.stock === 0);

  if (allOutOfStock) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx?.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx?.locale }) });
    return;
  }

  // For unique fulfillment, check inventory on first active variant
  const firstVariant = activeVariants.find(v => v.stock !== 0);
  if (firstVariant && firstVariant.fulfillment_mode === "unique") {
    const counts = await countInventory(productId, firstVariant.id);
    if (counts.available < 1) {
      await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx?.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx?.locale }) });
      return;
    }
  }

  // Check for existing pending order from this user for same product
  // LIKE WAJIB berpembatas (2026-09-23): pola `%"product_id":1%` juga cocok
  // dengan `"product_id":10`, `11`, `100`, … karena JSON tersimpan tanpa spasi
  // (`{"product_id":10,"variant_id":3,...}`). Efeknya pembeli produk #10
  // ditolak `alreadyPendingMessage` gara-gara pending produk #1 — jalan buntu
  // lintas produk yang tidak bisa dijelaskan pembeli maupun admin. Pembatas
  // `,` menutupnya karena `product_id` selalu diikuti field lain pada item
  // order; varian `}` disertakan agar item berfield-tunggal tetap terdeteksi.
  const existingOrder = await queryFirst(
    `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending') AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
     AND (items LIKE ? OR items LIKE ?)`,
    String(chatId), `%"product_id":${productId},%`, `%"product_id":${productId}}%`,
  );
  if (existingOrder) {
    await sendMessage({
      chat_id: chatId,
      text: alreadyPendingMessage(String(existingOrder.code), { locale: ctx?.locale }),
      parse_mode: "HTML",
      reply_markup: orderStatusKeyboard(String(existingOrder.code)),
    });
    return;
  }

  // Single variant — straight to qty step (bulk-aware)
  if (activeVariants.length === 1 && firstVariant) {
    await handleShowQty(chatId, messageId, productId, firstVariant.id, 1, from);
    return;
  }

  // Multiple variants — show variant selector
  await handleShowVariants(chatId, messageId, productId, from);
}

export async function handleConfirmPurchase(
  chatId: number,
  messageId: number,
  productId: number,
  from?: { id: number },
) {
  // Legacy confirm buttons route into the qty flow (WA parity, bulk-aware).
  const ctx = from ? await tgCtxFor(from.id) : undefined;
  await sendChatAction(chatId, "typing");

  const detail = await getProductDetail(productId);
  if (!detail || detail.variants.length === 0) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: ctx?.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx?.locale }) });
    return;
  }

  const activeVariants = detail.variants.filter(v => v.is_active && v.stock !== 0);
  if (activeVariants.length === 0) {
    await sendMessage({ chat_id: chatId, text: outOfStockMessage({ locale: ctx?.locale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx?.locale }) });
    return;
  }

  if (activeVariants.length === 1) {
    await handleShowQty(chatId, messageId, productId, activeVariants[0].id, 1, from);
    return;
  }
  await handleShowVariants(chatId, messageId, productId, from);
}

export async function handlePendingWaInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode()) return false;

  const user = await queryFirst(
    `SELECT pending_action FROM telegram_users WHERE user_id=?`,
    String(from.id),
  );
  if (!user?.pending_action) return false;

  const action = String(user.pending_action);
  if (!action.startsWith("wa_after_paid:")) return false;

  // Hanya teks yang MIRIP nomor telepon yang dianggap jawaban (audit ronde 4,
  // T-M4). Router memanggil handler ini PERTAMA untuk semua teks non-slash,
  // jadi dulu tombol menu persisten ("🛍 Katalog", "🔎 Cari", …) dan kata
  // kunci biasa dibalas "Nomor WA tidak valid" dan pembeli terjebak sampai
  // /start. Teks lain diteruskan ke router; tombol menu membersihkan state.
  if (!/^[+\d\s().-]{6,}$/.test(text.trim())) return false;

  // Validate WA number
  const waCtx = await tgCtxFor(from.id);
  const wa = text.trim().replace(/\s|-/g, "");
  if (!/^(\+62|62|0)8\d{8,13}$/.test(wa)) {
    await sendMessage({ chat_id: chatId, text: invalidWhatsAppMessage({ locale: waCtx.locale }), parse_mode: "HTML" });
    return true; // handled, but invalid — keep pending_action
  }

  // Normalize WA to 62...
  let normalizedWa = wa;
  if (normalizedWa.startsWith("+62")) normalizedWa = normalizedWa.slice(1);
  else if (normalizedWa.startsWith("0")) normalizedWa = "62" + normalizedWa.slice(1);

  const orderCode = action.slice("wa_after_paid:".length).toUpperCase();
  const saved = await execRun(
    `UPDATE orders SET customer_wa=?, updated_at=datetime('now')
     WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'
       AND status='lunas' AND payment_status='paid'`,
    normalizedWa,
    orderCode,
    String(from.id),
  );
  let orderLocale: "id" | "en" = waCtx.locale;
  try {
    const savedOrder = await queryFirst(`SELECT locale FROM orders WHERE code=?`, orderCode);
    if (savedOrder && (String(savedOrder.locale ?? "") === "en" || String(savedOrder.locale ?? "") === "id")) orderLocale = String(savedOrder.locale) as "id" | "en";
  } catch { /* current prefs fallback */ }
  if (!saved.changes) {
    await sendMessage({ chat_id: chatId, text: errorMessage({ locale: orderLocale }), parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: orderLocale }) });
    return true;
  }
  await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now')
     WHERE user_id=? AND pending_action=?`,
    String(from.id),
    action,
  );
  await sendMessage({
    chat_id: chatId,
    text: waSavedAfterPaymentMessage(orderCode, { locale: orderLocale }),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(orderCode, { locale: orderLocale }),
  });
  return true;
}

export async function handleWaInput(
  chatId: number,
  orderCode: string,
  from: { id: number },
) {
  const waCtx = await tgCtxFor(from.id);
  const normalizedCode = orderCode.toUpperCase();
  const order = await queryFirst(
    `SELECT customer_wa, locale FROM orders
     WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'
       AND status='lunas' AND payment_status='paid'`,
    normalizedCode,
    String(from.id),
  );
  if (!order) {
    await sendMessage({ chat_id: chatId, text: waCtx.locale === "en" ? "❌ Paid order not found." : "❌ Pesanan lunas tidak ditemukan.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: waCtx.locale }) });
    return;
  }
  const orderLocale = String(order.locale ?? "") === "en" ? "en" as const : "id" as const;
  if (String(order.customer_wa || "").trim()) {
    await sendMessage({
      chat_id: chatId,
      text: waSavedAfterPaymentMessage(normalizedCode, { locale: orderLocale }),
      parse_mode: "HTML",
      reply_markup: orderPaidKeyboard(normalizedCode, { locale: orderLocale }),
    });
    return;
  }
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `wa_after_paid:${normalizedCode}`))) return;
  await sendMessage({
    chat_id: chatId,
    text: whatsAppInputPromptMessage(normalizedCode, { locale: orderLocale }),
    parse_mode: "HTML",
    reply_markup: orderPaidKeyboard(normalizedCode, { locale: orderLocale }),
  });
}
