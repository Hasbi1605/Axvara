// src/lib/telegram/messages/help.ts — Copy bantuan & garansi.
//
// MENGAPA dipisah: bantuan dan ketentuan garansi jarang berubah dan sumber
// garansi kanonis ada di warranty-policy. Mengelompokkannya memudahkan menjaga
// paritas kebijakan garansi antar-kanal (Telegram/WA). Pemindahan murni.

import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";
import { SITE } from "@/lib/site";

export function helpMessage(): string {
  return [
    "<b>Bantuan AXVARA</b>",
    "",
    "/start: Menu utama",
    "/katalog: Lihat produk",
    "/cari: Cari produk",
    "/cart: Keranjang",
    "/orders: Pesanan saya",
    "/pesanan &lt;kode&gt;: Cek status pesanan",
    "/garansi: Ketentuan dan klaim garansi",
    "/bantuan: Bantuan dan kontak admin",
    "",
    "Pilih produk, varian, dan jumlah. Isi email jika diminta, lalu bayar QRIS sesuai total pada invoice. Bot mengabari setelah pembayaran terkonfirmasi dan produk siap.",
    "",
    "AXVARA third-party, bukan official. Masa dan cakupan garansi mengikuti varian produk. Ketentuan: /garansi.",
    "",
    // 2026-10-10: WA via hub /wa (pilih nomor aktif) — bukan wa.me langsung.
    `WhatsApp admin: ${SITE.webUrl}/wa`,
    `Telegram: @${SITE.supportTelegram}`,
    `Website: ${SITE.webUrl}`,
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
