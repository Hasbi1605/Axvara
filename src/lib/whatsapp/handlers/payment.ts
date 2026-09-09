// Handler jalur uang WhatsApp: memilih metode, membuat/menggunakan-ulang order
// pending, menerbitkan invoice QRIS dinamis, dan mengirim instruksi pembayaran.
//
// MENGAPA dipisah: ini jalur paling sensitif (uang) dengan idempotensi order,
// preflight metode, kompensasi stok saat setup QRIS gagal, dan snapshot copy.
// Mengisolasinya dari discovery/proof memudahkan audit tanpa mengubah SATU pun
// SQL, urutan statement, teks pesan, atau best-effort notifikasi. PURE MOVE.

import { queryAll, queryFirst, execRun, transitionPendingOrder } from "@/lib/db";
import { preflightWhatsAppPayment } from "@/lib/feature-flags";
import {
  getProductDetail,
  getActiveVariant,
  formatDuration,
  formatWarranty,
  formatRupiah,
} from "@/lib/catalog";
import { getSession, upsertSession } from "@/lib/whatsapp/session";
import {
  buildWhatsAppOrderIdempotencyKey,
  createPendingChannelOrder,
  getActivePaymentMethods,
  isReusablePendingOrder,
  parsePaymentDisplaySnapshot,
} from "@/lib/commerce";
import { createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import * as msg from "@/lib/whatsapp/messages";
import {
  PaymentMethodChoice,
  sendTextMessage,
  sendImageMessage,
  paymentMethodId,
  paymentAccountSnapshot,
} from "./shared";

export async function handlePay(groupId: string, memberId: string, inboxId: string, method: PaymentMethodChoice) {
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
    // Notif order-baru WA ke grup Telegram admin: best-effort di sini,
    // gagal kirim disapu cron via marker telegram_order_notified_at.
    try {
      const { notifyWhatsAppOrderCreated } = await import("@/lib/telegram/order-notifications");
      await notifyWhatsAppOrderCreated(order.code).catch(() => false);
    } catch { /* cron retry */ }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "unknown";
    // Jalur uang tanpa jejak = penjualan hilang tanpa petunjuk. Web
    // (orders/route.ts) dan Telegram sudah melog; WA sebelumnya diam total.
    if (errMsg !== "out_of_stock") console.error("WA handlePay failed:", errMsg);
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
