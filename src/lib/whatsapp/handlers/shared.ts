// Helper bersama seluruh handler WhatsApp.
//
// MENGAPA dipisah: route.ts semula menampung wrapper pengiriman pesan, util acak,
// dan parser metode pembayaran bersama orkestrasi POST. Memindahkan helper murni
// (tanpa efek samping bisnis) ke satu modul kecil membuat setiap handler mengimpor
// kontrak yang sama, tanpa duplikasi dan tanpa perubahan teks/urutan pesan.
// Ini PURE MOVE — logika identik dengan route.ts sebelumnya.

import {
  sendTextMessage as sendTextViaGateway,
  sendImageMessage as sendImageViaGateway,
} from "@/lib/whatsapp/gateway";
import { getActivePaymentMethods } from "@/lib/commerce";
import * as msg from "@/lib/whatsapp/messages";

export type PaymentMethodChoice = msg.WhatsAppPaymentMethod;

// Wrapper: gateway mengembalikan {ok:false} pada kegagalan; handler lama
// mengandalkan throw agar blok catch POST menandai inbox event `failed`
// (memungkinkan tepat satu retry gateway). Perilaku throw dipertahankan.
export async function sendTextMessage(params: Parameters<typeof sendTextViaGateway>[0]) {
  const result = await sendTextViaGateway(params);
  if (!result.ok) throw new Error(`whatsapp_send_failed:${result.error || "unknown"}`);
  return result;
}

export async function sendImageMessage(params: Parameters<typeof sendImageViaGateway>[0]) {
  const result = await sendImageViaGateway(params);
  if (!result.ok) throw new Error(`whatsapp_image_send_failed:${result.error || "unknown"}`);
  return result;
}

export function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
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

export function paymentMethodId(method: PaymentMethodChoice): string {
  if (method === "SEABANK") return "seabank";
  if (method === "EWALLET") return "ewallet";
  return "qris";
}

export function paymentAccountSnapshot(
  method: PaymentMethodChoice,
  methods: Awaited<ReturnType<typeof getActivePaymentMethods>>,
): string {
  if (method === "SEABANK") return methods.seabank?.account || "";
  if (method === "EWALLET") return methods.ewallet?.account || "";
  return methods.qris?.name || "QRIS AXVARA";
}
