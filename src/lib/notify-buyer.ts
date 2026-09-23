// src/lib/notify-buyer.ts — Kabar untuk PEMBELI, lintas kanal.
//
// KENAPA ADA (audit ronde 2, 2026-09-23): keputusan sistem dan aksi admin
// selama ini berhenti di sisi admin. Tiga lubang yang ditutup modul ini:
//   1. Serah terima manual menandai item `delivered` tanpa satu pun pesan,
//      padahal pesan lunas Telegram sudah TERLANJUR berjanji "Produk akan
//      dikirim admin melalui DM Telegram pribadi ini".
//   2. Bukti pembayaran ditolak hanya menulis `status='rejected'` — pembeli
//      melihat "Pending" selamanya tanpa alasan dan tanpa jalan keluar.
//   3. Bukti QRIS disetujui membalas `payment_updated:false` (QRIS Hook tetap
//      otoritatif) sehingga order SENGAJA tetap pending — benar secara sistem,
//      tetapi pembeli tidak pernah diberi tahu harus menunggu apa.
//
// Pengiriman sengaja best-effort dan TIDAK PERNAH melempar: kabar yang gagal
// terkirim tidak boleh membatalkan serah terima atau review bukti yang sudah
// sah tercatat. Idempotensi untuk kanal WA ditegakkan outbox lewat
// `idempotency_key`, jadi klik ganda admin tidak menghasilkan pesan ganda.
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";

/** Kirim satu pesan ke pembeli lewat kanal asal order. */
async function sendToBuyer(
  orderCode: string,
  text: string,
  refKey: string,
  database: DatabaseAccess,
): Promise<boolean> {
  const { queryFirst } = database;
  const order = await queryFirst(
    `SELECT code, sales_channel, customer_wa, telegram_user_id, telegram_chat_id
     FROM orders WHERE code=?`,
    orderCode,
  ).catch(() => null);
  if (!order) return false;

  const channel = String(order.sales_channel || "web");

  if (channel === "telegram") {
    // HANYA chat pribadi terverifikasi — tidak pernah ke id grup (issue #5).
    const buyerId = String(order.telegram_user_id || "");
    if (!buyerId) return false;
    const row = await queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null);
    const chatId = String(row?.chat_id || "");
    if (!chatId || Number(chatId) <= 0) return false;
    const { sendMessage } = await import("@/lib/telegram/api");
    const sent = await sendMessage({ chat_id: chatId, text, parse_mode: "HTML" }).catch(() => ({ ok: false }));
    return Boolean(sent?.ok);
  }

  // Web & WhatsApp sama-sama memakai nomor WA yang diisi saat checkout.
  const target = String(order.customer_wa || "").trim();
  if (!target) return false;
  const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
  return await enqueueWhatsAppMessage(waOutboxKey("text", refKey), target, text).catch(() => false);
}

/** Pesan setelah admin menyerahkan produk secara manual. */
export async function notifyBuyerHandover(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(
    orderCode,
    `✅ <b>Pesanan selesai diserahkan</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Admin sudah mengirimkan produkmu. Jika belum menerimanya, balas pesan ini.",
    `handover:${orderCode}`,
    database,
  ).catch(() => false);
}

/** Pesan saat bukti pembayaran ditolak — alasan WAJIB disertakan. */
export async function notifyBuyerProofRejected(
  orderCode: string,
  reason: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const clean = String(reason || "").trim();
  return await sendToBuyer(
    orderCode,
    `⚠️ <b>Bukti pembayaran ditolak</b>\nOrder: <code>${orderCode}</code>\n`
      + (clean ? `Alasan: ${clean}\n` : "")
      + "\nPesananmu belum lunas. Silakan bayar ulang lewat QRIS atau hubungi admin bila merasa ini keliru.",
    // Alasan ikut kunci: penolakan kedua dengan alasan berbeda tetap terkirim.
    `proof-rejected:${orderCode}:${clean.slice(0, 40)}`,
    database,
  ).catch(() => false);
}

/**
 * Pesan saat screenshot QRIS disetujui admin TETAPI status lunas masih
 * menunggu QRIS Hook. Order sengaja tetap pending — tanpa pesan ini pembeli
 * mengira sudah beres.
 */
export async function notifyBuyerProofPendingHook(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(
    orderCode,
    `ℹ️ <b>Bukti diterima</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaran QRIS dikonfirmasi otomatis oleh sistem, jadi statusnya masih "
      + "menunggu verifikasi. Kamu akan dikabari lagi begitu pembayaran tercatat lunas.",
    `proof-pending-hook:${orderCode}`,
    database,
  ).catch(() => false);
}
