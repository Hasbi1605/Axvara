// POST /api/whatsapp/webhook — Baileys WhatsApp group bot webhook handler

import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryFirst, execRun, isD1Mode, transitionPendingOrder } from "@/lib/db";
import { isEnabled, preflightWhatsAppPayment } from "@/lib/feature-flags";
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
  parseWhatsAppPayload,
  isGroupAllowed,
  isSelfMessage,
  sendTextMessage as sendTextViaGateway,
  sendImageMessage as sendImageViaGateway,
  downloadMediaSafely,
  MAX_BODY_SIZE,
} from "@/lib/whatsapp/gateway";
import {
  buildWhatsAppOrderIdempotencyKey,
  createPendingChannelOrder,
  getActivePaymentMethods,
  isReusablePendingOrder,
  parsePaymentDisplaySnapshot,
} from "@/lib/commerce";
import * as msg from "@/lib/whatsapp/messages";
import { getR2Bucket } from "@/lib/r2";
import { createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { canAcceptWhatsAppPaymentProof } from "@/lib/payment-proofs";

export const runtime = "edge";

const WHATSAPP_MEMBER_EVENTS_PER_MINUTE = 12;
type PaymentMethodChoice = msg.WhatsAppPaymentMethod;

async function sendTextMessage(params: Parameters<typeof sendTextViaGateway>[0]) {
  const result = await sendTextViaGateway(params);
  if (!result.ok) throw new Error(`whatsapp_send_failed:${result.error || "unknown"}`);
  return result;
}

async function sendImageMessage(params: Parameters<typeof sendImageViaGateway>[0]) {
  const result = await sendImageViaGateway(params);
  if (!result.ok) throw new Error(`whatsapp_image_send_failed:${result.error || "unknown"}`);
  return result;
}

function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parsePaymentMethod(input: string): PaymentMethodChoice | null {
  const normalized = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (normalized === "QRIS") return "QRIS";
  if (normalized === "SEABANK") return "SEABANK";
  if (normalized === "EWALLET") return "EWALLET";
  return null;
}

function isPaymentProofCaption(input: string): boolean {
  return Boolean(parsePaymentMethod(input)) || /^BUKTI\s+AXV-\S+\s+(QRIS|SEABANK|EWALLET)$/i.test(input.trim());
}

export async function POST(request: NextRequest) {
  // 1. Content-Type check
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json") && !contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 415 });
  }

  // 2. Body size limit. Parse the bounded payload before provider-compatible auth.
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const rawText = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_SIZE) {
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

  // 3. Timing-safe webhook authentication (header/query/payload secret)
  const auth = authenticateWebhook(request, body);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.reason }, { status: 401 });
  }

  // 4. Feature flag check
  if (!isEnabled("WHATSAPP_ENABLED")) {
    return NextResponse.json({ ok: true, status: "disabled" });
  }

  // 5. Parse the gateway's provider-compatible payload
  const incoming = parseWhatsAppPayload(body);
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
  if (!incoming.inboxId) {
    return NextResponse.json({ error: "missing_inbox_id" }, { status: 400 });
  }

  // 7. Inbox deduplication. `processed` doubles as the active claim; a caught
  // failure is changed to `failed`, which lets exactly one gateway retry reclaim it.
  let inboxClaimed = false;
  if (incoming.inboxId && isD1Mode()) {
    try {
      const existing = await queryFirst(
        `SELECT id, status FROM whatsapp_inbox_events WHERE provider='baileys' AND external_message_id=?`,
        incoming.inboxId,
      );
      if (existing) {
        if (String(existing.status) !== "failed") {
          return NextResponse.json({ ok: true, status: "duplicate" });
        }
        const reclaimed = await execRun(
          `UPDATE whatsapp_inbox_events SET status='processed'
           WHERE id=? AND status='failed'`,
          Number(existing.id),
        );
        if (!reclaimed.changes) {
          return NextResponse.json({ ok: true, status: "duplicate" });
        }
        inboxClaimed = true;
      } else {
        await execRun(
          `INSERT INTO whatsapp_inbox_events (provider, external_message_id, event_type, conversation_id, member_id, status)
           VALUES ('baileys',?,?,?,?,'processed')`,
          incoming.inboxId,
          incoming.attachment ? "media" : "text",
          incoming.conversationId,
          incoming.memberId,
        );
        inboxClaimed = true;
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "";
      if (errMsg.includes("UNIQUE")) {
        return NextResponse.json({ ok: true, status: "duplicate" });
      }
      console.error("WA inbox claim failed");
      return NextResponse.json({ error: "inbox_unavailable" }, { status: 503 });
    }
  }

  if (inboxClaimed && isD1Mode()) {
    const recent = await queryFirst(
      `SELECT COUNT(*) as count FROM whatsapp_inbox_events
       WHERE provider='baileys' AND conversation_id=? AND member_id=?
         AND created_at>=datetime('now','-1 minute')`,
      incoming.conversationId,
      incoming.memberId,
    ).catch(() => null);
    if (Number(recent?.count || 0) > WHATSAPP_MEMBER_EVENTS_PER_MINUTE) {
      await execRun(
        `UPDATE whatsapp_inbox_events SET status='ignored'
         WHERE provider='baileys' AND external_message_id=? AND status='processed'`,
        incoming.inboxId,
      ).catch(() => {});
      return NextResponse.json({ ok: true, status: "rate_limited" });
    }
  }

  const { conversationId, memberId, inboxId, message, attachment } = incoming;

  try {
    // 8. A screenshot only needs the selected payment method as caption.
    if (attachment && (isPaymentProofCaption(message) || Boolean(incoming.replyToInboxId)) && isEnabled("WHATSAPP_PROOF_INTAKE")) {
      await handleProofUpload(conversationId, memberId, inboxId, message, attachment.url, incoming.replyToInboxId);
      return NextResponse.json({ ok: true });
    }

    const cmd = message.toLowerCase().trim();

    // Command: list [page]
    if (cmd === "list" || cmd.startsWith("list ")) {
      if (!isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
        return NextResponse.json({ ok: true, status: "discovery_disabled" });
      }
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

    // `pay` remains a friendly shortcut that only shows the choices.
    if (cmd === "pay" || cmd === "payment") {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await sendTextMessage({ target: conversationId, message: msg.paymentChoiceMessage(), inboxId });
      }
      return NextResponse.json({ ok: true });
    }

    const paymentMethod = parsePaymentMethod(cmd);
    if (paymentMethod) {
      if (isEnabled("WHATSAPP_GROUP_PAYMENT")) {
        await handlePay(conversationId, memberId, inboxId, paymentMethod);
      }
      return NextResponse.json({ ok: true });
    }

    // Variant number selection (digits only)
    if (/^\d+$/.test(cmd)) {
      if (!isEnabled("WHATSAPP_GROUP_DISCOVERY")) {
        return NextResponse.json({ ok: true, status: "discovery_disabled" });
      }
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
    if (inboxClaimed && incoming.inboxId && isD1Mode()) {
      await execRun(
        `UPDATE whatsapp_inbox_events SET status='failed'
         WHERE provider='baileys' AND external_message_id=? AND status='processed'`,
        incoming.inboxId,
      ).catch(() => {});
    }
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

// ---- Handlers ----

async function handleList(groupId: string, _page: number, inboxId: string) {
  const products = await listActiveProducts();

  await sendTextMessage({
    target: groupId,
    message: msg.listProductsMessage(products),
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

  await upsertSession("baileys", groupId, memberId, {
    selected_product_id: detail.id,
    numbered_variant_map: variantMap,
    selected_variant_id: null,
    current_order_id: null,
    current_order_code: null,
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.productDetailMessage(msg.getWhatsAppDisplayName(detail), detail.description, detail.variants),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("baileys", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}

async function handleNumberSelection(groupId: string, memberId: string, num: number, inboxId: string) {
  const session = await getSession("baileys", groupId, memberId);
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
  const productName = detail ? msg.getWhatsAppDisplayName(detail) : "PRODUK";

  await upsertSession("baileys", groupId, memberId, {
    selected_variant_id: variantId,
    ...(session.selected_variant_id !== variantId
      ? {
          current_order_id: null,
          current_order_code: null,
          current_payment_transaction_id: null,
          payment_message_id: null,
        }
      : {}),
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.variantSelectedMessage(productName, variant),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("baileys", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}

function paymentMethodId(method: PaymentMethodChoice): string {
  if (method === "SEABANK") return "seabank";
  if (method === "EWALLET") return "ewallet";
  return "qris";
}

function paymentAccountSnapshot(
  method: PaymentMethodChoice,
  methods: Awaited<ReturnType<typeof getActivePaymentMethods>>,
): string {
  if (method === "SEABANK") return methods.seabank?.account || "";
  if (method === "EWALLET") return methods.ewallet?.account || "";
  return methods.qris?.name || "QRIS AXVARA";
}

async function handlePay(groupId: string, memberId: string, inboxId: string, method: PaymentMethodChoice) {
  const session = await getSession("baileys", groupId, memberId);

  if (!session || !session.selected_variant_id || !session.selected_product_id) {
    await sendTextMessage({ target: groupId, message: msg.noSelectionMessage(), inboxId });
    return;
  }

  const paymentPreflight = await preflightWhatsAppPayment(queryAll, method);
  if (!paymentPreflight.ok) {
    await sendTextMessage({
      target: groupId,
      message: "Metode pembayaran sedang belum lengkap. Hubungi admin dan jangan transfer terlebih dahulu.",
      inboxId,
    });
    return;
  }

  // Idempotency: reuse existing pending order if available
  if (session.current_order_code) {
    const existingOrder = await queryFirst(
      `SELECT o.code, o.subtotal, o.status, o.payment_status, o.expires_at,
              pt.payable_amount, pt.qris_url, pt.provider AS payment_provider,
              pt.status AS payment_transaction_status
       FROM orders o
       LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       WHERE o.code=? AND o.variant_id=?`,
      session.current_order_code,
      session.selected_variant_id,
    );
    if (existingOrder && isReusablePendingOrder(existingOrder)) {
      if (
        method !== "QRIS"
        && String(existingOrder.payment_provider || "") === "dana"
        && String(existingOrder.payment_transaction_status || "") === "pending"
      ) {
        await sendTextMessage({
          target: groupId,
          message: "Invoice QRIS untuk pesanan ini masih aktif. Selesaikan QRIS tersebut atau tunggu 15 menit sebelum memilih metode lain.",
          inboxId,
        });
        return;
      }
      const paymentMethods = await getActivePaymentMethods();
      await execRun(
        `UPDATE orders SET payment_method=?, payment_account=?, updated_at=datetime('now') WHERE code=? AND status='pending'`,
        paymentMethodId(method),
        paymentAccountSnapshot(method, paymentMethods),
        String(existingOrder.code),
      );
      const payableAmount = existingOrder.payable_amount == null
        ? Number(existingOrder.subtotal)
        : Number(existingOrder.payable_amount);
      if (method === "QRIS") {
        await createAndSendDanaQrisPayment(groupId, memberId, session, String(existingOrder.code), Number(existingOrder.subtotal), inboxId);
      } else {
        await sendPaymentInfo(groupId, memberId, session, String(existingOrder.code), payableAmount, method, inboxId);
      }
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

  if (!inboxId) {
    await sendTextMessage({
      target: groupId,
      message: "Pembayaran belum dapat dibuat karena ID pesan WhatsApp tidak tersedia. Hubungi admin.",
    });
    return;
  }

  const idempotencyKey = buildWhatsAppOrderIdempotencyKey(
    groupId,
    memberId,
    inboxId,
    session.selected_variant_id,
  );

  try {
    const paymentMethods = await getActivePaymentMethods();
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
      paymentMethod: paymentMethodId(method),
      paymentAccount: paymentAccountSnapshot(method, paymentMethods),
    });

    await upsertSession("baileys", groupId, memberId, {
      current_order_code: order.code,
      current_order_id: order.orderId,
    });

    if (method === "QRIS") {
      await createAndSendDanaQrisPayment(groupId, memberId, session, order.code, order.subtotal, inboxId);
    } else {
      await sendPaymentInfo(groupId, memberId, session, order.code, order.subtotal, method, inboxId);
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

async function createAndSendDanaQrisPayment(
  groupId: string,
  memberId: string,
  session: { selected_product_id: number | null; selected_variant_id: number | null },
  orderCode: string,
  total: number,
  inboxId: string,
) {
  const existingTransaction = await queryFirst(
    `SELECT payable_amount, qris_url FROM payment_transactions WHERE order_code=? AND provider='dana'`,
    orderCode,
  );
  if (existingTransaction) {
    await sendPaymentInfo(
      groupId,
      memberId,
      session,
      orderCode,
      Number(existingTransaction.payable_amount || total),
      "QRIS",
      inboxId,
      existingTransaction.qris_url ? String(existingTransaction.qris_url) : undefined,
    );
    return;
  }

  try {
    const invoice = await createDanaQrisInvoice(orderCode, total);
    await sendPaymentInfo(groupId, memberId, session, orderCode, invoice.payableAmount, "QRIS", inboxId, invoice.qrisUrl);
  } catch (error) {
    const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode);
    const transaction = await queryFirst(`SELECT id FROM payment_transactions WHERE order_code=?`, orderCode);
    if (order && !transaction) {
      try {
        const items = JSON.parse(String(order.items || "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        await transitionPendingOrder(orderCode, "dibatalkan", "dana_qris_setup_failed", items);
      } catch { /* Another request may have completed the invoice. */ }
    }
    throw error;
  }
}

async function sendPaymentInfo(
  groupId: string,
  memberId: string,
  session: { selected_product_id: number | null; selected_variant_id: number | null },
  orderCode: string,
  total: number,
  method: PaymentMethodChoice,
  inboxId: string,
  dynamicQrisUrl?: string,
) {
  const order = await queryFirst(
    `SELECT items, variant_snapshot FROM orders WHERE code=?`,
    orderCode,
  );
  const snapshot = parsePaymentDisplaySnapshot(order?.variant_snapshot);
  const detail = session.selected_product_id
    ? await getProductDetail(session.selected_product_id)
    : null;
  const variant = snapshot
    ? null
    : session.selected_variant_id
      ? await getActiveVariant(session.selected_variant_id)
      : null;
  const paymentMethods = await getActivePaymentMethods();

  const dur = snapshot?.duration || (variant ? formatDuration(variant) : "");
  const war = snapshot?.warranty || (variant ? formatWarranty(variant) : "");
  const qrisUrl = method === "QRIS" ? dynamicQrisUrl : undefined;

  const result = await sendTextMessage({
    target: groupId,
    message: msg.paymentMessage({
      orderCode,
      productName: detail ? msg.getWhatsAppDisplayName(detail) : snapshot?.productName || "Produk",
      variantLabel: snapshot?.variantLabel || variant?.label || "",
      duration: dur,
      warranty: war,
      total,
      method,
      qrisUrl,
      seabankAccount: paymentMethods.seabank?.account,
      seabankName: paymentMethods.seabank?.name,
      ewalletAccount: paymentMethods.ewallet?.account,
      ewalletName: paymentMethods.ewallet?.name,
    }),
    inboxId,
  });

  // Send QRIS image if available
  if (method === "QRIS" && qrisUrl) {
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
    await upsertSession("baileys", groupId, memberId, {
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
  const legacyMatch = caption.trim().match(/^BUKTI\s+(AXV-\S+)\s+(QRIS|SEABANK|E[\s-]?WALLET)$/i);
  let claimedMethod = parsePaymentMethod(legacyMatch?.[2] || caption);
  const session = await getSession("baileys", groupId, sender);
  let orderCode = legacyMatch?.[1]?.toUpperCase() || session?.current_order_code || null;

  if (!orderCode) {
    const expectedMethod = claimedMethod ? paymentMethodId(claimedMethod) : null;
    const latest = await queryFirst(
      `SELECT code FROM orders
       WHERE sales_channel='whatsapp' AND channel_conversation_id=? AND channel_member_id=?
         AND status='pending' AND payment_status IN ('unpaid','pending')
         AND (expires_at IS NULL OR expires_at>datetime('now'))
         AND (? IS NULL OR payment_method=?)
       ORDER BY created_at DESC LIMIT 1`,
      groupId,
      sender,
      expectedMethod,
      expectedMethod,
    );
    orderCode = latest?.code ? String(latest.code) : null;
  }

  if (!orderCode) {
    await sendTextMessage({ target: groupId, message: msg.proofFormatErrorMessage("pesanan terakhir Anda"), inboxId: messageId });
    return;
  }

  // Validate order belongs to sender & conversation, and is still pending & not expired
  const order = await queryFirst(
    `SELECT id, code, status, payment_status, payment_method, channel_conversation_id, channel_member_id, expires_at FROM orders
     WHERE code=? AND sales_channel='whatsapp'`,
    orderCode,
  );

  if (!order) {
    await sendTextMessage({ target: groupId, message: msg.proofWrongOwnerMessage(), inboxId: messageId });
    return;
  }

  const storedMethod = parsePaymentMethod(String(order.payment_method || ""));
  if (!claimedMethod) claimedMethod = storedMethod;
  if (!claimedMethod) {
    await sendTextMessage({ target: groupId, message: msg.proofFormatErrorMessage(orderCode), inboxId: messageId });
    return;
  }
  if (storedMethod && storedMethod !== claimedMethod) {
    await sendTextMessage({
      target: groupId,
      message: `Metode bukti tidak cocok. Pesanan aktif ini menggunakan *${storedMethod}*. Kirim ulang screenshot dengan caption *${storedMethod}*.`,
      inboxId: messageId,
    });
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

  if (!canAcceptWhatsAppPaymentProof(order)) {
    await sendTextMessage({
      target: groupId,
      message: "Pesanan ini sudah kedaluwarsa atau tidak dapat menerima bukti. Silakan buat pesanan baru.",
      inboxId: messageId,
    });
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
  const bucket = getR2Bucket();
  if (!bucket) {
    await sendTextMessage({
      target: groupId,
      message: "Penyimpanan bukti sedang tidak tersedia. Coba lagi dalam beberapa saat.",
      inboxId: messageId,
    });
    return;
  }

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
  try {
    await bucket.put(r2Key, downloaded.buffer, {
      httpMetadata: { contentType: downloaded.contentType },
    });
  } catch (e) {
    console.error("R2 upload error:", e);
    await sendTextMessage({ target: groupId, message: "Penyimpanan bukti gagal. Coba lagi dalam beberapa saat.", inboxId: messageId });
    return;
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
      await bucket.delete(r2Key).catch(() => {});
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
