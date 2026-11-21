import { isPaymentMaintenanceEnabled, PAYMENT_MANUAL_ORDER_URL } from "@/lib/payment-maintenance";
import { sendMessage } from "./api";

export async function notifyPaymentMaintenance(chatId: number): Promise<boolean> {
  if (!isPaymentMaintenanceEnabled()) return false;
  // Bilingual ID+EN: gate ini berjalan SEBELUM locale dibaca (nol query DB),
  // jadi kedua bahasa ditulis sekaligus. CTA mengarah ke hub admin `/wa`
  // (kontak admin), bukan "order manual via WhatsApp" — alur beli WA pensiun.
  const sent = await sendMessage({
    chat_id: chatId,
    text: [
      "<b>Pembayaran sedang maintenance / Payment under maintenance</b>",
      "",
      "Pembayaran otomatis sedang maintenance. Untuk sementara, hubungi admin jika butuh bantuan. Pemesanan hanya lewat website atau bot Telegram.",
      "Automatic payment is under maintenance. Contact the admin for help. Orders are only available on the website or Telegram bot.",
      "",
      "Sudah membayar? Simpan bukti pembayaran dan hubungi admin dengan kode pesananmu.",
      "Already paid? Keep your payment proof and contact the admin with your order code.",
    ].join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [
      [{ text: "💬 Hubungi admin / Contact admin", url: PAYMENT_MANUAL_ORDER_URL }],
      [{ text: "Lihat katalog", callback_data: "catalog:0" }, { text: "Pesanan saya", callback_data: "myorders" }],
    ] },
  });
  if (!sent.ok) throw new Error("Telegram API temporarily unavailable: payment maintenance notice");
  return true;
}
