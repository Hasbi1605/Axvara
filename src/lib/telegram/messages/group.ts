// src/lib/telegram/messages/group.ts — Copy keamanan grup (issue #5).
//
// MENGAPA dipisah: pesan-pesan ini adalah KONTROL KEAMANAN — memastikan
// kredensial/checkout tidak pernah bocor ke chat grup dan mengarahkan pembeli
// ke chat pribadi. Mengisolasinya menegaskan bahwa teks ini bagian dari
// batas kepercayaan, bukan sekadar UX. Pemindahan murni — teks identik.

/**
 * Deep-link to continue a purchase in the bot's private chat. Group chats
 * must never carry checkout state: invoices, QR codes, and credentials are
 * private-only. `botUsername` is the bot's username without '@'.
 */
export function privateChatDeepLink(botUsername: string, payload = "beli"): string {
  const clean = botUsername.replace(/^@/, "");
  return `https://t.me/${clean}?start=${encodeURIComponent(payload)}`;
}

export function groupCheckoutRedirectMessage(botUsername: string): string {
  return [
    "🔒 <b>Lanjut di Chat Pribadi</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Demi keamanan, pembelian dan pembayaran hanya dilayani di chat pribadi dengan bot.",
    "",
    `👉 <a href="${privateChatDeepLink(botUsername)}">Tap di sini untuk buka chat pribadi</a> lalu tekan <b>START</b>, kemudian ulangi pilihan produk dari /katalog.`,
    "",
    "Kredensial produk tidak pernah dikirim ke grup.",
  ].join("\n");
}

export function groupDeliveryNoticeMessage(): string {
  return [
    "🔒 <b>Pesanan Lunas — Cek Chat Pribadi</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "Produk sudah dikirim ke <b>chat pribadi</b> kamu dengan bot.",
    "Buka chat pribadi bot dan tekan START bila belum.",
    "",
    "Kredensial tidak pernah ditampilkan di grup.",
  ].join("\n");
}
