// Handler intake bukti pembayaran WhatsApp (SeaBank/e-wallet) ke R2 privat.
//
// MENGAPA dipisah: ini fungsi terpanjang di route.ts (~201 baris) dan menampung
// kontrol keamanan unduhan lampiran — batas 5 MB, verifikasi magic bytes gambar,
// dan URL media yang TIDAK membawa token gateway — via downloadMediaSafely, plus
// dedup, validasi kepemilikan order, dan rollback R2 jika insert D1 gagal.
// Mengisolasinya memudahkan audit kontrol keamanan tersebut tanpa mengubah satu
// pun urutan pemeriksaan atau teks pesan. PURE MOVE dari route.ts.

import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { getSession } from "@/lib/whatsapp/session";
import { downloadMediaSafely } from "@/lib/whatsapp/gateway";
import * as msg from "@/lib/whatsapp/messages";
import { getR2Bucket } from "@/lib/r2";
import { canAcceptWhatsAppPaymentProof } from "@/lib/payment-proofs";
import { parsePaymentMethod, paymentMethodId, randHex, sendTextMessage } from "./shared";

export async function handleProofUpload(
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
    // Expiry is re-checked in JS via canAcceptWhatsAppPaymentProof (canonical
    // Date.parse semantics shared with both crons); the SQL predicate below
    // is only a coarse pre-filter so ISO rows are never skipped here.
    const latest = await queryFirst(
      `SELECT code FROM orders
       WHERE sales_channel='whatsapp' AND channel_conversation_id=? AND channel_member_id=?
         AND status='pending' AND payment_status IN ('unpaid','pending')
         AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
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
