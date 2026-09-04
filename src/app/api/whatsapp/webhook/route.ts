// POST /api/whatsapp/webhook — Fonnte WhatsApp group bot webhook handler

import { NextRequest, NextResponse } from "next/server";
import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import {
  listActiveProducts,
  getProductDetail,
  searchProductByName,
  getActiveVariant,
  formatDuration,
  formatWarranty,
  formatRupiah,
} from "@/lib/catalog";
import { getSession, upsertSession } from "@/lib/whatsapp/session";
import {
  authenticateWebhook,
  parseFonntePayload,
  isGroupAllowed,
  isSelfMessage,
  sendTextMessage,
  sendImageMessage,
  downloadMediaSafely,
  MAX_BODY_SIZE,
} from "@/lib/whatsapp/gateway";
import { createPendingChannelOrder, getActivePaymentMethods } from "@/lib/commerce";
import * as msg from "@/lib/whatsapp/messages";
import { getR2Bucket } from "@/lib/r2";
import { getPaymentProvider } from "@/lib/payments/klikqris";

export const runtime = "edge";

const ITEMS_PER_PAGE = 15;

function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  // 1. Content-Type check
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Timing-safe webhook authentication
  const auth = authenticateWebhook(request);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  // 3. Feature flag check
  if (!isEnabled("WHATSAPP_ENABLED")) {
    return NextResponse.json({ ok: true, status: "disabled" });
  }

  // 4. Body size limit
  const rawText = await request.text().catch(() => "");
  if (rawText.length > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawText);
      const obj: Record<string, string> = {};
      params.forEach((val, key) => { obj[key] = val; });
      body = obj;
    } else {
      body = JSON.parse(rawText);
    }
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 5. Parse Fonnte payload
  const incoming = parseFonntePayload(body);
  if (!incoming) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // 6. Group allowlist & Self check
  if (!incoming.isGroup) {
    return NextResponse.json({ ok: true, status: "not_group" });
  }
  if (isSelfMessage(incoming.memberId)) {
    return NextResponse.json({ ok: true, status: "self" });
  }
  if (!isGroupAllowed(incoming.conversationId)) {
    return NextResponse.json({ ok: true, status: "not_allowed" });
  }

  // 7. Inbox deduplication with lease
  if (incoming.inboxId && isD1Mode()) {
    try {
      const existing = await queryFirst(
        `SELECT id, status FROM whatsapp_inbox_events WHERE provider='fonnte' AND external_message_id=?`,
        incoming.inboxId,
      );
      if (existing) {
        return NextResponse.json({ ok: true, status: "duplicate" });
      }

      await execRun(
        `INSERT INTO whatsapp_inbox_events (provider, external_message_id, event_type, conversation_id, member_id, status)
         VALUES ('fonnte',?,?,?,?,'processed')`,
        incoming.inboxId,
        incoming.attachment ? "media" : "text",
        incoming.conversationId,
        incoming.memberId,
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) {
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
    }
  }

  const { conversationId, memberId, inboxId, message, attachment } = incoming;

  try {
    // 8. Payment Proof Intake (media with BUKTI caption)
    if (attachment && message.toUpperCase().startsWith("BUKTI") && isEnabled("WHATSAPP_PROOF_INTAKE")) {
      await handleProofUpload(conversationId, memberId, inboxId, message, attachment.url, incoming.replyToInboxId);
      return NextResponse.json({ ok: true });
    }

    const cmd = message.toLowerCase().trim();

    // Command: list [page]
    if (cmd === "list" || cmd.startsWith("list ")) {
      const pageMatch = cmd.match(/^list\s+(\d+)$/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      await handleList(conversationId, page, inboxId);
      return NextResponse.json({ ok: true });
    }

    // Command: garansi or /garansi
    if (cmd === "garansi" || cmd === "/garansi") {
      await sendTextMessage({ target: conversationId, message: msg.warrantyMessage(), inboxId });
      return NextResponse.json({ ok: true });
    }

    // Command: pay or payment
    if (cmd === "pay" || cmd === "payment") {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await handlePay(conversationId, memberId, inboxId);
      }
      return NextResponse.json({ ok: true });
    }

    // Variant number selection (digits only)
    if (/^\d+$/.test(cmd)) {
      await handleNumberSelection(conversationId, memberId, Number(cmd), inboxId);
      return NextResponse.json({ ok: true });
    }

    // Product search (only if discovery enabled)
    if (cmd.length >= 2 && isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
      await handleProductSearch(conversationId, memberId, message, inboxId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WA webhook error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: true, status: "error_handled" });
  }
}

// ---- Handlers ----

async function handleList(groupId: string, page: number, inboxId: string) {
  const products = await listActiveProducts();
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const slice = products.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  await sendTextMessage({
    target: groupId,
    message: msg.listProductsMessage(slice, safePage, totalPages),
    inboxId,
  });
}

async function handleProductSearch(groupId: string, memberId: string, input: string, inboxId: string) {
  const { exact, candidates } = await searchProductByName(input);

  if (!exact && candidates.length === 0) {
    if (input.split(/\s+/).length > 3) return; // Skip long sentences
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage(), inboxId });
    return;
  }

  if (!exact && candidates.length > 1) {
    await sendTextMessage({
      target: groupId,
      message: msg.ambiguousMessage(candidates.map((c) => c.name)),
      inboxId,
    });
    return;
  }

  const product = exact || candidates[0];
  const detail = await getProductDetail(product.id);
  if (!detail || detail.variants.length === 0) {
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage(), inboxId });
    return;
  }

  const variantMap: Record<number, number> = {};
  detail.variants.forEach((v, i) => {
    variantMap[i + 1] = v.id;
  });

  await upsertSession("fonnte", groupId, memberId, {
    selected_product_id: detail.id,
    numbered_variant_map: variantMap,
    selected_variant_id: null,
    current_order_id: null,
    current_order_code: null,
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.productDetailMessage(detail.name, detail.description, detail.variants),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("fonnte", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}

async function handleNumberSelection(groupId: string, memberId: string, num: number, inboxId: string) {
  const session = await getSession("fonnte", groupId, memberId);
  if (!session || !session.numbered_variant_map) {
    return; // Ignore number if no active session
  }

  const variantId = session.numbered_variant_map[num];
  if (!variantId) {
    await sendTextMessage({ target: groupId, message: msg.sessionExpiredMessage(), inboxId });
    return;
  }

  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage(), inboxId });
    return;
  }

  if (variant.stock === 0) {
    await sendTextMessage({ target: groupId, message: `Varian ini sedang habis. Pilih varian lain.`, inboxId });
    return;
  }

  const detail = await getProductDetail(session.selected_product_id!);
  const productName = detail?.name || "Produk";

  await upsertSession("fonnte", groupId, memberId, {
    selected_variant_id: variantId,
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.variantSelectedMessage(productName, variant),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("fonnte", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}

async function handlePay(groupId: string, memberId: string, inboxId: string) {
  const session = await getSession("fonnte", groupId, memberId);

  if (!session || !session.selected_variant_id || !session.selected_product_id) {
    await sendTextMessage({ target: groupId, message: msg.noSelectionMessage(), inboxId });
    return;
  }

  // Idempotency: reuse existing pending order if available
  if (session.current_order_code) {
    const existingOrder = await queryFirst(
      `SELECT code, subtotal, status, payment_status FROM orders WHERE code=?`,
      session.current_order_code,
    );
    if (existingOrder && String(existingOrder.status) === "pending") {
      await sendPaymentInfo(groupId, memberId, session, String(existingOrder.code), Number(existingOrder.subtotal), inboxId);
      return;
    }
  }

  const variant = await getActiveVariant(session.selected_variant_id);
  if (!variant) {
    await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage(), inboxId });
    return;
  }

  const detail = await getProductDetail(session.selected_product_id);
  if (!detail) {
    await sendTextMessage({ target: groupId, message: msg.gatewayErrorMessage(), inboxId });
    return;
  }

  // Deterministic idempotency key: based on group + member + selected variant (NO Date.now()!)
  const idempotencyKey = `wa:order:${groupId}:${memberId}:${session.selected_variant_id}`;

  try {
    const order = await createPendingChannelOrder({
      salesChannel: "whatsapp",
      productId: detail.id,
      productName: detail.name,
      variantId: session.selected_variant_id,
      variant,
      customerId: memberId,
      customerName: memberId,
      customerWa: memberId,
      conversationId: groupId,
      idempotencyKey,
    });

    await upsertSession("fonnte", groupId, memberId, {
      current_order_code: order.code,
      current_order_id: order.orderId,
    });

    // Check if KlikQRIS is enabled for WhatsApp
    if (isEnabled("WHATSAPP_KLIKQRIS")) {
      await createAndSendKlikQrisPayment(groupId, memberId, session, order.code, order.subtotal, inboxId);
    } else {
      await sendPaymentInfo(groupId, memberId, session, order.code, order.subtotal, inboxId);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "unknown";
    if (errMsg === "out_of_stock") {
      await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage(), inboxId });
    } else {
      await sendTextMessage({ target: groupId, message: msg.gatewayErrorMessage(), inboxId });
    }
  }
}

async function createAndSendKlikQrisPayment(
  groupId: string,
  memberId: string,
  session: { selected_product_id: number | null; selected_variant_id: number | null },
  orderCode: string,
  total: number,
  inboxId: string,
) {
  try {
    const provider = getPaymentProvider();
    const providerOrderId = orderCode.replace(/^AXV-/, "");
    const merchantId = process.env.KLIKQRIS_MERCHANT_ID ?? "";

    const invoiceResult = await provider.createInvoice({
      orderId: providerOrderId,
      amount: total,
      merchantId,
    });

    if (invoiceResult && invoiceResult.success) {
      if (isD1Mode()) {
        await execRun(
          `INSERT INTO payment_transactions (order_code, provider, provider_mode, provider_order_id,
             merchant_id, requested_amount, payable_amount, status, provider_signature,
             qris_url, direct_url, expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          orderCode,
          "klikqris",
          provider.mode,
          invoiceResult.providerOrderId,
          invoiceResult.merchantId,
          total,
          invoiceResult.payableAmount,
          "pending",
          invoiceResult.signature,
          invoiceResult.qrisUrl,
          invoiceResult.directUrl,
          invoiceResult.expiresAt,
        );
      }

      await sendPaymentInfo(groupId, memberId, session, orderCode, invoiceResult.payableAmount, inboxId, invoiceResult.qrisUrl ?? undefined);
      return;
    }
  } catch (err) {
    console.error("KlikQRIS creation for WA failed, falling back to static:", err);
  }

  // Fallback to static if dynamic fails
  await sendPaymentInfo(groupId, memberId, session, orderCode, total, inboxId);
}

async function sendPaymentInfo(
  groupId: string,
  memberId: string,
  session: { selected_product_id: number | null; selected_variant_id: number | null },
  orderCode: string,
  total: number,
  inboxId: string,
  dynamicQrisUrl?: string,
) {
  const detail = await getProductDetail(session.selected_product_id!);
  const variant = session.selected_variant_id ? await getActiveVariant(session.selected_variant_id) : null;
  const paymentMethods = await getActivePaymentMethods();

  const dur = variant ? formatDuration(variant) : "";
  const war = variant ? formatWarranty(variant) : "";
  const qrisUrl = dynamicQrisUrl || paymentMethods.qris?.url;

  const result = await sendTextMessage({
    target: groupId,
    message: msg.paymentMessage({
      orderCode,
      productName: detail?.name || "Produk",
      variantLabel: variant?.label || "",
      duration: dur,
      warranty: war,
      total,
      qrisUrl,
      seabankAccount: paymentMethods.seabank?.account,
      seabankName: paymentMethods.seabank?.name,
      ewalletAccount: paymentMethods.ewallet?.account,
      ewalletName: paymentMethods.ewallet?.name,
    }),
    inboxId,
  });

  // Send QRIS image if available
  if (qrisUrl) {
    const siteUrl = process.env.SITE_URL || "https://axvara.tech";
    const qrisFullUrl = qrisUrl.startsWith("http") ? qrisUrl : `${siteUrl}${qrisUrl}`;

    await sendImageMessage({
      target: groupId,
      imageUrl: qrisFullUrl,
      caption: `QRIS — ${orderCode} — ${formatRupiah(total)}`,
      inboxId,
    });
  }

  if (result.messageId) {
    await upsertSession("fonnte", groupId, memberId, {
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
  quotedId?: string,
) {
  const match = caption.toUpperCase().match(/^BUKTI\s+(AXV-\S+)\s+(QRIS|SEABANK|EWALLET)$/i);
  if (!match) {
    const session = await getSession("fonnte", groupId, sender);
    const code = session?.current_order_code || "AXV-XXXXXXXX-XXXXXXXX";
    await sendTextMessage({ target: groupId, message: msg.proofFormatErrorMessage(code), inboxId: messageId });
    return;
  }

  const orderCode = match[1].toUpperCase();
  const claimedMethod = match[2].toUpperCase() as "QRIS" | "SEABANK" | "EWALLET";

  // Validate order belongs to sender & conversation, and is still pending & not expired
  const order = await queryFirst(
    `SELECT id, code, status, payment_status, channel_conversation_id, channel_member_id, expires_at FROM orders
     WHERE code=? AND sales_channel='whatsapp' AND status='pending'`,
    orderCode,
  );

  if (!order) {
    await sendTextMessage({ target: groupId, message: msg.proofWrongOwnerMessage(), inboxId: messageId });
    return;
  }

  // Check channel & member identity matches
  if (
    (order.channel_conversation_id && String(order.channel_conversation_id) !== groupId) ||
    (order.channel_member_id && String(order.channel_member_id) !== sender)
  ) {
    await sendTextMessage({ target: groupId, message: msg.proofWrongOwnerMessage(), inboxId: messageId });
    return;
  }

  // Check expiry
  if (order.expires_at && new Date(String(order.expires_at)).getTime() < Date.now()) {
    await sendTextMessage({ target: groupId, message: "Pesanan ini sudah kedaluwarsa. Silakan buat pesanan baru.", inboxId: messageId });
    return;
  }

  // Check if proof already exists (dedup by external_message_id / inboxId)
  if (isD1Mode()) {
    const existing = await queryFirst(
      `SELECT id FROM payment_proofs WHERE sales_channel='whatsapp' AND external_message_id=?`,
      messageId,
    );
    if (existing) {
      await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode), inboxId: messageId });
      return;
    }

    const activeProof = await queryFirst(
      `SELECT id FROM payment_proofs WHERE order_code=? AND status IN ('submitted','approved')`,
      orderCode,
    );
    if (activeProof) {
      await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode), inboxId: messageId });
      return;
    }
  }

  // Real SSRF-safe streaming download and validation
  const downloaded = await downloadMediaSafely(mediaUrl);
  if (!downloaded) {
    await sendTextMessage({
      target: groupId,
      message: "Gagal mengunduh gambar bukti atau format tidak valid (hanya JPG/PNG/WebP, maks 5 MB). Kirim ulang bukti Anda.",
      inboxId: messageId,
    });
    return;
  }

  const ext = downloaded.contentType === "image/png" ? "png" : downloaded.contentType === "image/webp" ? "webp" : "jpg";
  const r2Key = `bukti/whatsapp/${orderCode}-${randHex(8)}.${ext}`;

  // Upload to R2 private bucket
  const bucket = getR2Bucket();
  if (bucket) {
    try {
      await bucket.put(r2Key, downloaded.buffer, {
        httpMetadata: { contentType: downloaded.contentType },
      });
    } catch (e) {
      console.error("R2 upload error:", e);
      await sendTextMessage({ target: groupId, message: "Penyimpanan bukti gagal. Coba lagi dalam beberapa saat.", inboxId: messageId });
      return;
    }
  }

  // Insert payment_proofs record
  if (isD1Mode()) {
    try {
      await execRun(
        `INSERT INTO payment_proofs (
           order_code, sales_channel, conversation_id, member_id,
           external_message_id, reply_to_message_id, claimed_method, r2_key,
           content_type, byte_size, sha256, status
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderCode,
        "whatsapp",
        groupId,
        sender,
        messageId,
        quotedId || null,
        claimedMethod,
        r2Key,
        downloaded.contentType,
        downloaded.buffer.byteLength,
        downloaded.sha256,
        "submitted",
      );
    } catch (e) {
      // Rollback R2 upload if D1 insert fails
      if (bucket) {
        await bucket.delete(r2Key).catch(() => {});
      }
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) {
        await sendTextMessage({ target: groupId, message: msg.proofDuplicateMessage(orderCode), inboxId: messageId });
        return;
      }
      throw e;
    }
  }

  // Acknowledge user only AFTER R2 and D1 succeed
  await sendTextMessage({
    target: groupId,
    message: msg.proofAcknowledgementMessage(orderCode),
    inboxId: messageId,
  });

  // Notify admin
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
