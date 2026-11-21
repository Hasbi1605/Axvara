// Helper bersama handler WhatsApp tingkat grup.
//
// Alur pembeli (katalog/pembayaran/bukti) dipensiunkan 13 November 2026;
// yang tersisa hanya perintah admin `.d` dan balasan info/arahan. Helper di
// sini sengaja mungil: wrapper kirim teks (throw saat gagal agar POST menandai
// inbox event `failed` untuk tepat satu retry gateway) dan parser caption bukti
// yang dipakai untuk mendeteksi pesan alur belanja lama.

import { sendTextMessage as sendTextViaGateway } from "@/lib/whatsapp/gateway";

export type PaymentMethodChoice = "QRIS" | "SEABANK" | "EWALLET";

// Wrapper: gateway mengembalikan {ok:false} pada kegagalan; handler lama
// mengandalkan throw agar blok catch POST menandai inbox event `failed`
// (memungkinkan tepat satu retry gateway). Perilaku throw dipertahankan.
export async function sendTextMessage(params: Parameters<typeof sendTextViaGateway>[0]) {
  const result = await sendTextViaGateway(params);
  if (!result.ok) throw new Error(`whatsapp_send_failed:${result.error || "unknown"}`);
  return result;
}

export function parsePaymentMethod(input: string): PaymentMethodChoice | null {
  const normalized = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (normalized === "QRIS") return "QRIS";
  if (normalized === "SEABANK") return "SEABANK";
  if (normalized === "EWALLET") return "EWALLET";
  return null;
}

export function isPaymentProofCaption(input: string): boolean {
  return Boolean(parsePaymentMethod(input)) || /^BUKTI\s+AXV-\S+\s+(QRIS|SEABANK|EWALLET)$/i.test(input.trim());
}
