// src/lib/telegram/messages/help.ts — Copy bantuan & garansi.
//
// MENGAPA dipisah: bantuan dan ketentuan garansi jarang berubah dan sumber
// garansi kanonis ada di warranty-policy. Mengelompokkannya memudahkan menjaga
// paritas kebijakan garansi antar-kanal (Telegram/WA). Pemindahan murni.

import type { Locale } from "@/lib/i18n/locale";
import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";

export function helpMessage(opts?: { locale?: Locale }): string {
  if (opts?.locale === "en") {
    return [
      "<b>💬 AXVARA Help</b>",
      "Pick product → variant → qty → pay. Sent automatically.",
      "Type a product name to search.",
      "/garansi for warranty terms.",
      "AXVARA is a third-party store, not official.",
    ].join("\n");
  }
  return [
    "<b>💬 Bantuan AXVARA</b>",
    "Pilih produk → varian → jumlah → bayar. Produk dikirim otomatis.",
    "Ketik nama produk untuk mencari.",
    "/garansi untuk ketentuan garansi.",
    "AXVARA toko pihak ketiga, bukan official.",
  ].join("\n");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WARRANTY & CLAIMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function warrantyTermsMessage(): string {
  return formatWarrantyTermsTelegram();
}

export function warrantyClaimMessage(): string {
  return formatWarrantyClaimsTelegram();
}

export function warrantyFullMessage(): string {
  return [warrantyTermsMessage(), "", warrantyClaimMessage()].join("\n");
}
