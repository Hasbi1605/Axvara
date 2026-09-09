// Handler perintah admin `.d` — menandai order lunas menjadi delivered.
//
// MENGAPA dipisah: ini satu-satunya jalur yang mengubah fulfillment dari input
// grup dan memuat guard status berlapis (harus lunas + paid + belum delivered)
// serta UPDATE bersyarat idempoten. Mengisolasinya membuat kontrol status mudah
// diaudit terpisah dari jalur pembeli. PURE MOVE — SQL/urutan/teks identik.

import { queryFirst, execRun } from "@/lib/db";
import { parsePaymentDisplaySnapshot } from "@/lib/commerce";
import * as msg from "@/lib/whatsapp/messages";
import { sendTextMessage } from "./shared";

export async function handleAdminDone(
  groupId: string,
  inboxId: string,
  rawMessage: string,
  quotedText?: string,
) {
  // Extract order code: try explicit `.d AXV-xxx`, then quoted text regex
  const explicitMatch = rawMessage.match(/\.d\s+(AXV-\S+)/i);
  let orderCode = explicitMatch?.[1]?.toUpperCase() || null;

  if (!orderCode && quotedText) {
    const quotedMatch = quotedText.match(/AXV-[A-Z0-9-]+/i);
    orderCode = quotedMatch?.[0]?.toUpperCase() || null;
  }

  if (!orderCode) {
    await sendTextMessage({ target: groupId, message: msg.adminDoneNoOrderMessage(), inboxId });
    return;
  }

  const order = await queryFirst(
    `SELECT code, status, payment_status, fulfillment_status, subtotal, variant_snapshot FROM orders WHERE code=?`,
    orderCode,
  );

  if (!order) {
    await sendTextMessage({ target: groupId, message: msg.adminDoneNoOrderMessage(), inboxId });
    return;
  }

  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    await sendTextMessage({
      target: groupId,
      message: `Pembayaran pesanan *${orderCode}* belum berstatus lunas.`,
      inboxId,
    });
    return;
  }

  if (String(order.fulfillment_status) === "delivered") {
    await sendTextMessage({ target: groupId, message: msg.orderAlreadyProcessedMessage(orderCode), inboxId });
    return;
  }

  const completed = await execRun(
    `UPDATE orders SET fulfillment_status='delivered',
     admin_note=COALESCE(admin_note,'') || ' [WA .d]', updated_at=datetime('now')
     WHERE code=? AND status='lunas' AND payment_status='paid' AND fulfillment_status!='delivered'`,
    orderCode,
  );
  if (!completed.changes) {
    await sendTextMessage({ target: groupId, message: msg.orderAlreadyProcessedMessage(orderCode), inboxId });
    return;
  }

  const snap = parsePaymentDisplaySnapshot(order.variant_snapshot);
  await sendTextMessage({
    target: groupId,
    message: msg.orderCompletedMessage({
      orderCode,
      productName: snap?.productName,
      variantLabel: snap?.variantLabel,
      total: Number(order.subtotal || 0),
    }),
    inboxId,
  });
}
