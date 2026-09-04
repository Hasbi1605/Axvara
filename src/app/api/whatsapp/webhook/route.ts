// POST /api/whatsapp/webhook — Fonnte WhatsApp webhook handler

import { NextRequest, NextResponse } from "next/server";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import { listActiveProducts, getProductDetail, searchProductByName, getActiveVariant, formatDuration, formatWarranty, formatRupiah } from "@/lib/catalog";
import { getSession, upsertSession } from "@/lib/whatsapp/session";
import { sendTextMessage, sendImageMessage, isGroupAllowed, isSelfMessage } from "@/lib/whatsapp/gateway";
import { createPendingChannelOrder, getActivePaymentMethods } from "@/lib/commerce";
import * as msg from "@/lib/whatsapp/messages";

export const runtime = "edge";

const ITEMS_PER_PAGE = 15;

export async function POST(request: NextRequest) {
  // Validate Fonnte webhook token
  const expectedToken = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expectedToken) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // Check feature flag
  if (!isEnabled("WHATSAPP_ENABLED")) {
    return NextResponse.json({ ok: true, status: "disabled" });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Extract Fonnte payload fields
  const sender = String(body.sender || "");
  const message = String(body.message || "").trim();
  const groupId = String(body.group || body.from || "");
  const messageId = String(body.id || body.messageId || "");
  const isGroup = Boolean(body.isGroup || body.group);
  const hasMedia = Boolean(body.url || body.media);
  const mediaUrl = String(body.url || body.media || "");
  const quotedMsg = body.quotedMsg as Record<string, unknown> | undefined;
  const quotedId = String(quotedMsg?.id || body.quotedId || body.replied || "");

  // Ignore non-group or self messages
  if (!isGroup) return NextResponse.json({ ok: true, status: "not_group" });
  if (isSelfMessage(sender)) return NextResponse.json({ ok: true, status: "self" });
  if (!isGroupAllowed(groupId)) return NextResponse.json({ ok: true, status: "not_allowed" });

  // Dedup webhook
  if (messageId && isD1Mode()) {
    try {
      const existing = await queryFirst(
        `SELECT id FROM whatsapp_inbox_events WHERE provider='fonnte' AND external_message_id=?`,
        messageId
      );
      if (existing) return NextResponse.json({ ok: true, status: "duplicate" });

      await execRun(
        `INSERT INTO whatsapp_inbox_events (provider, external_message_id, event_type, conversation_id, member_id)
         VALUES ('fonnte',?,?,?,?)`,
        messageId, hasMedia ? "media" : "text", groupId, sender
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) return NextResponse.json({ ok: true, status: "duplicate" });
    }
  }

  try {
    // Check for proof image first (media with BUKTI caption)
    if (hasMedia && message.toUpperCase().startsWith("BUKTI") && isEnabled("WHATSAPP_PROOF_INTAKE")) {
      await handleProofUpload(groupId, sender, messageId, message, mediaUrl, quotedId);
      return NextResponse.json({ ok: true });
    }

    const cmd = message.toLowerCase().trim();

    // Command: list
    if (cmd === "list" || cmd.startsWith("list ")) {
      const pageMatch = cmd.match(/^list\s+(\d+)$/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      await handleList(groupId, page);
      return NextResponse.json({ ok: true });
    }

    // Command: garansi or /garansi
    if (cmd === "garansi" || cmd === "/garansi") {
      await sendTextMessage({ target: groupId, message: msg.warrantyMessage() });
      return NextResponse.json({ ok: true });
    }

    // Command: pay or payment
    if (cmd === "pay" || cmd === "payment") {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await handlePay(groupId, sender);
      }
      return NextResponse.json({ ok: true });
    }

    // Check if it's a number (variant selection)
    if (/^\d+$/.test(cmd)) {
      await handleNumberSelection(groupId, sender, Number(cmd));
      return NextResponse.json({ ok: true });
    }

    // Try product name search (only if discovery is enabled)
    if (cmd.length >= 2 && isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
      await handleProductSearch(groupId, sender, message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WA webhook error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: true, status: "error_handled" });
  }
}

// --- Handler implementations ---

async function handleList(groupId: string, page: number) {
  const products = await listActiveProducts();
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const slice = products.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  await sendTextMessage({
    target: groupId,
    message: msg.listProductsMessage(slice, safePage, totalPages),
  });
}

async function handleProductSearch(groupId: string, sender: string, input: string) {
  const { exact, candidates } = await searchProductByName(input);

  if (!exact && candidates.length === 0) {
    // Don't respond to every random message — only if it looks like a product query
    // Heuristic: short, single word or known pattern
    if (input.split(/\s+/).length > 3) return; // Skip long sentences
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage() });
    return;
  }

  if (!exact && candidates.length > 1) {
    await sendTextMessage({
      target: groupId,
      message: msg.ambiguousMessage(candidates.map(c => c.name)),
    });
    return;
  }

  const product = exact || candidates[0];
  const detail = await getProductDetail(product.id);
  if (!detail || detail.variants.length === 0) {
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage() });
    return;
  }

  // Build numbered variant map
  const variantMap: Record<number, number> = {};
  detail.variants.forEach((v, i) => {
    variantMap[i + 1] = v.id;
  });

  // Save session
  await upsertSession("fonnte", groupId, sender, {
    selected_product_id: detail.id,
    numbered_variant_map: variantMap,
    selected_variant_id: null,
    current_order_id: null,
    current_order_code: null,
  });

  // Send product detail with variants
  const result = await sendTextMessage({
    target: groupId,
    message: msg.productDetailMessage(detail.name, detail.description, detail.variants),
  });

  // Store variant message ID for reply matching
  if (result.messageId) {
    await upsertSession("fonnte", groupId, sender, {
      variant_message_id: result.messageId,
    });
  }
}

async function handleNumberSelection(groupId: string, sender: string, num: number) {
  const session = await getSession("fonnte", groupId, sender);
  if (!session || !session.numbered_variant_map) {
    // No active session — ignore number
    return;
  }

  const variantId = session.numbered_variant_map[num];
  if (!variantId) {
    await sendTextMessage({
      target: groupId,
      message: msg.sessionExpiredMessage(),
    });
    return;
  }

  // Re-validate variant
  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendTextMessage({
      target: groupId,
      message: msg.variantUnavailableMessage(),
    });
    return;
  }

  if (variant.stock === 0) {
    await sendTextMessage({
      target: groupId,
      message: `Varian ini sedang habis. Pilih varian lain.`,
    });
    return;
  }

  // Get product name
  const detail = await getProductDetail(session.selected_product_id!);
  const productName = detail?.name || "Produk";

  // Save selected variant
  await upsertSession("fonnte", groupId, sender, {
    selected_variant_id: variantId,
  });

  // Send selection confirmation
  const result = await sendTextMessage({
    target: groupId,
    message: msg.variantSelectedMessage(productName, variant),
  });

  if (result.messageId) {
    await upsertSession("fonnte", groupId, sender, {
      variant_message_id: result.messageId,
    });
  }
}

async function handlePay(groupId: string, sender: string) {
  const session = await getSession("fonnte", groupId, sender);

  if (!session || !session.selected_variant_id) {
    await sendTextMessage({
      target: groupId,
      message: msg.noSelectionMessage(),
    });
    return;
  }

  // Check for existing pending order (idempotent pay)
  if (session.current_order_code) {
    const existingOrder = await queryFirst(
      `SELECT code, subtotal, status, payment_status FROM orders WHERE code=?`,
      session.current_order_code
    );
    if (existingOrder && String(existingOrder.status) === "pending") {
      // Resend payment info
      await sendPaymentInfo(groupId, sender, session, String(existingOrder.code), Number(existingOrder.subtotal));
      return;
    }
  }

  // Re-validate variant
  const variant = await getActiveVariant(session.selected_variant_id);
  if (!variant) {
    await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage() });
    return;
  }

  const detail = await getProductDetail(session.selected_product_id!);
  if (!detail) {
    await sendTextMessage({ target: groupId, message: msg.gatewayErrorMessage() });
    return;
  }

  // Create order
  const idempotencyKey = `wa:${groupId}:${sender}:${session.selected_variant_id}:${Date.now()}`;

  try {
    const order = await createPendingChannelOrder({
      salesChannel: "whatsapp",
      productId: detail.id,
      productName: detail.name,
      variantId: session.selected_variant_id,
      variant,
      customerId: sender,
      customerName: sender,
      conversationId: groupId,
      idempotencyKey,
    });

    // Update session with order
    await upsertSession("fonnte", groupId, sender, {
      current_order_code: order.code,
      current_order_id: order.orderId,
    });

    // Send payment info
    await sendPaymentInfo(groupId, sender, session, order.code, order.subtotal);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "unknown";
    if (errMsg === "out_of_stock") {
      await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage() });
    } else {
      await sendTextMessage({ target: groupId, message: msg.gatewayErrorMessage() });
    }
  }
}

async function sendPaymentInfo(groupId: string, sender: string, session: { selected_product_id: number | null; selected_variant_id: number | null }, orderCode: string, total: number) {
  const detail = await getProductDetail(session.selected_product_id!);
  const variant = session.selected_variant_id ? await getActiveVariant(session.selected_variant_id) : null;
  const paymentMethods = await getActivePaymentMethods();

  const dur = variant ? formatDuration(variant) : "";
  const war = variant ? formatWarranty(variant) : "";

  // Send text message with all payment info
  const result = await sendTextMessage({
    target: groupId,
    message: msg.paymentMessage({
      orderCode,
      productName: detail?.name || "Produk",
      variantLabel: variant?.label || "",
      duration: dur,
      warranty: war,
      total,
      qrisUrl: paymentMethods.qris?.url,
      seabankAccount: paymentMethods.seabank?.account,
      seabankName: paymentMethods.seabank?.name,
      ewalletAccount: paymentMethods.ewallet?.account,
      ewalletName: paymentMethods.ewallet?.name,
    }),
  });

  // Send QRIS image separately
  if (paymentMethods.qris?.url) {
    const siteUrl = process.env.SITE_URL || "https://axvara.tech";
    const qrisFullUrl = paymentMethods.qris.url.startsWith("http")
      ? paymentMethods.qris.url
      : `${siteUrl}${paymentMethods.qris.url}`;

    await sendImageMessage({
      target: groupId,
      imageUrl: qrisFullUrl,
      caption: `QRIS — ${orderCode} — ${formatRupiah(total)}`,
    });
  }

  // Store payment message ID
  if (result.messageId) {
    await upsertSession("fonnte", groupId, sender, {
      payment_message_id: result.messageId,
    });
  }
}

async function handleProofUpload(
  groupId: string,
  sender: string,
  messageId: string,
  caption: string,
  mediaUrl: string,
  quotedId: string
) {
  // Parse caption: BUKTI <ORDER_CODE> <METHOD>
  const match = caption.toUpperCase().match(/^BUKTI\s+(AXV-\S+)\s+(QRIS|SEABANK|EWALLET)$/i);
  if (!match) {
    const session = await getSession("fonnte", groupId, sender);
    const code = session?.current_order_code || "AXV-XXXXXXXX-XXXXXXXX";
    await sendTextMessage({ target: groupId, message: msg.proofFormatErrorMessage(code) });
    return;
  }

  const orderCode = match[1].toUpperCase();
  const claimedMethod = match[2].toUpperCase() as "QRIS" | "SEABANK" | "EWALLET";

  // Validate order belongs to sender
  const order = await queryFirst(
    `SELECT id, code, status, payment_status, telegram_user_id FROM orders
     WHERE code=? AND sales_channel='whatsapp' AND status='pending'`,
    orderCode
  );

  if (!order) {
    await sendTextMessage({ target: groupId, message: msg.proofWrongOwnerMessage() });
    return;
  }

  // Check if proof already exists (dedup by external_message_id)
  if (isD1Mode()) {
    const existing = await queryFirst(
      `SELECT id FROM payment_proofs WHERE sales_channel='whatsapp' AND external_message_id=?`,
      messageId
    );
    if (existing) {
      await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode) });
      return;
    }

    // Check for existing active proof
    const activeProof = await queryFirst(
      `SELECT id FROM payment_proofs WHERE order_code=? AND status IN ('submitted','approved')`,
      orderCode
    );
    if (activeProof) {
      await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode) });
      return;
    }
  }

  // Download and validate media (basic check — full validation in production)
  // For now, store the reference
  const r2Key = `bukti/whatsapp/${orderCode}-${Date.now()}.proof`;

  // Save proof record
  if (isD1Mode()) {
    try {
      await execRun(
        `INSERT INTO payment_proofs (order_code, sales_channel, conversation_id, member_id,
           external_message_id, reply_to_message_id, claimed_method, r2_key,
           content_type, byte_size, sha256, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderCode, "whatsapp", groupId, sender,
        messageId, quotedId || null, claimedMethod, r2Key,
        "image/jpeg", 0, "pending-download", "submitted"
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) {
        await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode) });
        return;
      }
      throw e;
    }
  }

  // Send acknowledgement
  await sendTextMessage({
    target: groupId,
    message: msg.proofAcknowledgementMessage(orderCode),
    replyMessageId: messageId,
  });

  // Notify admin (best-effort)
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChatId) {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: adminChatId,
        text: [
          "📩 <b>Bukti WA Masuk</b>",
          "━━━━━━━━━━━━━━━━━━━━━",
          "",
          `🔢 <code>${orderCode}</code>`,
          `💳 ${claimedMethod}`,
          `👤 ${sender}`,
          "",
          "Buka panel admin untuk review.",
        ].join("\n"),
        parse_mode: "HTML",
      });
    } catch { /* best effort */ }
  }
}
