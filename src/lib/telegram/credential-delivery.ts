// src/lib/telegram/credential-delivery.ts — Kirim kredensial ke pembeli Telegram
// dengan FALLBACK target + tombol ambil ulang (2026-10-04, permintaan owner).
//
// Masalah: kredensial WR/SK dulu hanya dicoba ke SATU target
// (`telegram_users.chat_id`). Produk stok sendiri terbukti sampai karena
// dikirim ke `telegram_user_id` (identitas pembeli — di Telegram id user =
// id chat pribadi dengan bot). Bila satu target gagal (chat_id basi, salah
// simpan), kredensial supplier jatuh ke retry tanpa jalan lain.
//
// Kini SEMUA kanal kredensial Telegram (WR, SK, dan tombol ambil ulang) memakai
// daftar target yang sama, dicoba berurutan sampai satu berhasil:
//   1. telegram_users.chat_id  — chat pribadi terakhir yang terverifikasi
//   2. orders.telegram_user_id — jalur yang dipakai produk stok sendiri
//   3. orders.telegram_chat_id — chat tempat order dibuat (bila pribadi)
// Id negatif (grup/kanal) TIDAK PERNAH dipakai: kredensial tidak boleh bocor ke
// anggota grup (issue #5).
//
// Fallback terakhir: tombol "📦 Ambil Detail Produk" pada pesan lunas — pembeli
// menekannya di chat bot dan bot mengirim ulang semua detail yang sudah siap
// (dibaca dari fulfillment_items.delivered_ciphertext — WR, SK, stok sendiri,
// dan serah terima admin semuanya menulis kolom ini).

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

type Row = Record<string, unknown>;

/** All parts must succeed before callers settle delivery. Never send to a group. */
export async function sendTelegramCredentialParts(
  chatId: string | number,
  messages: string[],
): Promise<{ chatId: string; messageId: string }> {
  const target = positiveId(chatId);
  if (!target) throw new Error("no_private_telegram_chat");
  if (!messages.length) throw new Error("telegram_credential_empty");
  const { sendMessage } = await import("@/lib/telegram/api");
  let messageId = "";
  for (const text of messages) {
    const sent = await sendMessage({ chat_id: target, text, parse_mode: "HTML", disable_web_page_preview: true });
    if (!sent?.ok) throw new Error("telegram_credential_part_failed");
    messageId = String((sent as { result?: { message_id?: unknown } }).result?.message_id ?? "");
  }
  return { chatId: target, messageId };
}

function positiveId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : "";
}

/** Target chat pribadi pembeli, urut prioritas, tanpa duplikat, tanpa id grup. */
export async function telegramPrivateTargets(order: Row, database: DatabaseAccess): Promise<string[]> {
  const buyerId = positiveId(order.telegram_user_id);
  const saved = buyerId
    ? positiveId((await database.queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null))?.chat_id)
    : "";
  const out: string[] = [];
  for (const id of [saved, buyerId, positiveId(order.telegram_chat_id)]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Kirim satu pesan kredensial ke target pertama yang berhasil. Melempar bila
 * semua target gagal agar pemanggil menjadwalkan retry (WR backoff / SK
 * reconcile). `no_private_telegram_chat` = belum ada target pribadi sama
 * sekali (order dari grup sebelum pembeli START).
 */
export async function sendTelegramCredential(
  order: Row,
  text: string | string[],
  database: DatabaseAccess,
): Promise<{ chatId: string; messageId: string }> {
  const targets = await telegramPrivateTargets(order, database);
  if (!targets.length) throw new Error("no_private_telegram_chat");
  const errors: string[] = [];
  for (const chatId of targets) {
    try {
      return await sendTelegramCredentialParts(chatId, Array.isArray(text) ? text : [text]);
    } catch {
      errors.push(`${chatId}:telegram_send_failed`);
    }
  }
  throw new Error(`telegram_delivery_failed ${errors.join(" | ")}`.slice(0, 300));
}

/**
 * Tombol "📦 Ambil Detail Produk": kirim ulang SEMUA detail yang sudah siap
 * untuk order milik pembeli ini ke chat pribadi tempat tombol ditekan.
 * Pemanggil (router callback) sudah memastikan from.id = pemilik order dan
 * chat bukan grup. Mengembalikan jumlah item yang dikirim (0 = belum siap).
 */
export async function resendTelegramCredentials(
  orderCode: string,
  chatId: number,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<number> {
  const code = String(orderCode || "").toUpperCase();
  const { sendMessage } = await import("@/lib/telegram/api");
  const order = await database
    .queryFirst(
      `SELECT code, items, status, payment_status FROM orders WHERE code=? AND sales_channel='telegram'`,
      code,
    )
    .catch(() => null);
  if (!order || Number(chatId) <= 0) return 0;
  const paid = String(order.status) === "lunas" && String(order.payment_status) === "paid";
  const rows = paid
    ? await database
        .queryAll(
          `SELECT item_index, variant_id, delivered_ciphertext, delivered_iv, delivered_message_id
           FROM fulfillment_items
           WHERE order_code=? AND status='delivered'
             AND delivered_ciphertext IS NOT NULL AND delivered_iv IS NOT NULL
           ORDER BY item_index ASC`,
          code,
        )
        .catch(() => [] as Row[])
    : [];
  const { decryptSecret } = await import("@/lib/fulfillment/crypto");
  const { orderLineLabel } = await import("@/lib/fulfillment/delivery/buyer-email");
  const { credentialMessages } = await import("@/lib/telegram/messages/credential");
  const { resolveCredentialTermsForVariants } = await import("@/lib/orders/credential-terms");
  const copies = await resolveCredentialTermsForVariants(rows.map(row => Number(row.variant_id)), database);
  const { normalizeAccountDetailsForDisplay } = await import("@/lib/warung-rebahan/deliver");
  let sent = 0;
  for (const row of rows) {
    let plaintext = "";
    try {
      plaintext = await decryptSecret(String(row.delivered_ciphertext), String(row.delivered_iv));
    } catch {
      continue; // kunci rotasi / data korup: lewati, jangan bocorkan
    }
    if (String(row.delivered_message_id ?? "").startsWith("wr:")) {
      plaintext = normalizeAccountDetailsForDisplay(plaintext);
    }
    if (!plaintext.trim()) continue;
    const result = await sendTelegramCredentialParts(chatId, credentialMessages({
      orderCode: code,
      productName: orderLineLabel(order.items, Number(row.item_index ?? 0)),
      plaintext,
      copy: copies.get(Number(row.variant_id)),
    })).catch(() => null);
    if (result) sent++;
  }
  if (!sent) {
    await sendMessage({
      chat_id: chatId,
      text: paid
        ? `⏳ <b>Detail produk belum siap</b>\nOrder: <code>${code}</code>\n\nPesananmu masih disiapkan. Detailnya dikirim <b>otomatis ke chat ini</b> begitu siap — tekan tombol ini lagi nanti bila belum masuk.`
        : `ℹ️ Pesanan <code>${code}</code> belum lunas, jadi belum ada detail produk.`,
      parse_mode: "HTML",
    }).catch(() => undefined);
  }
  return sent;
}
