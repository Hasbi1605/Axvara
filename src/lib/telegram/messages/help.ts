// src/lib/telegram/messages/help.ts — Copy bantuan & garansi.
//
// MENGAPA dipisah: bantuan dan ketentuan garansi jarang berubah dan sumber
// garansi kanonis ada di warranty-policy. Mengelompokkannya memudahkan menjaga
// paritas kebijakan garansi antar-kanal (Telegram/WA). Pemindahan murni.

import type { Locale } from "@/lib/i18n/locale";
import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";
import { SITE } from "@/lib/site";

export function helpMessage(opts?: { locale?: Locale }): string {
  if (opts?.locale === "en") {
    return [
      "<b>AXVARA Help</b>",
      "",
      "<b>Quick Menu:</b>",
      "🛍 Catalog · 🔎 Search · 🛒 Cart",
      "📦 Orders · 🛡 Warranty · 💬 Help",
      "",
      "Tip: type a product name directly to search (e.g. <code>netflix</code>, <code>canva</code>).",
      "",
      "/start: Home",
      "/katalog: View products",
      "/cari &lt;query&gt;: Search products",
      "/cart: Cart",
      "/orders: My orders",
      "/pesanan &lt;code&gt;: Check order status",
      "/garansi: Warranty terms and claims",
      "/bantuan: Help and admin contact",
      "",
      "Choose a product, variant, and quantity. Enter your email if asked, then pay via QRIS or other methods (e.g. crypto) shown at checkout for the total on the invoice. The bot notifies you after payment is confirmed and the product is ready.",
      "",
      "AXVARA is third-party, not official. Warranty length and coverage follow the chosen variant. Terms: /garansi.",
      "",
      `WhatsApp admin: ${SITE.webUrl}/wa`,
      `Telegram: @${SITE.supportTelegram}`,
      `Website: ${SITE.webUrl}`,
    ].join("\n");
  }
  return [
    "<b>Bantuan AXVARA</b>",
    "",
    "<b>Menu Cepat:</b>",
    "🛍 Katalog · 🔎 Cari · 🛒 Keranjang",
    "📦 Pesanan · 🛡 Garansi · 💬 Bantuan",
    "",
    "Tip: langsung ketik nama produk untuk mencari (mis. <code>netflix</code>, <code>canva</code>).",
    "",
    "/start: Menu utama",
    "/katalog: Lihat produk",
    "/cari &lt;kata&gt;: Cari produk",
    "/cart: Keranjang",
    "/orders: Pesanan saya",
    "/pesanan &lt;kode&gt;: Cek status pesanan",
    "/garansi: Ketentuan dan klaim garansi",
    "/bantuan: Bantuan dan kontak admin",
    "",
    "Pilih produk, varian, dan jumlah. Isi email jika diminta, lalu bayar dengan QRIS atau metode lain (mis. crypto) yang tampil saat checkout sesuai total pada invoice. Bot mengabari setelah pembayaran terkonfirmasi dan produk siap.",
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
