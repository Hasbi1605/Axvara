import { isPaymentMaintenanceEnabled, PAYMENT_MAINTENANCE_MESSAGE, PAYMENT_MANUAL_ORDER_URL } from "@/lib/payment-maintenance";
import { sendMessage } from "./api";

export async function notifyPaymentMaintenance(chatId: number): Promise<boolean> {
  if (!isPaymentMaintenanceEnabled()) return false;
  const sent = await sendMessage({
    chat_id: chatId,
    text: `<b>Pembayaran sedang maintenance</b>\n\n${PAYMENT_MAINTENANCE_MESSAGE}\n\nSudah membayar? Simpan bukti pembayaran dan hubungi admin dengan kode pesananmu.`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [
      [{ text: "Order manual via WhatsApp", url: PAYMENT_MANUAL_ORDER_URL }],
      [{ text: "Lihat katalog", callback_data: "catalog:0" }, { text: "Pesanan saya", callback_data: "myorders" }],
    ] },
  });
  if (!sent.ok) throw new Error("Telegram API temporarily unavailable: payment maintenance notice");
  return true;
}
