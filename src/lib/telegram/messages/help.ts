// src/lib/telegram/messages/help.ts — Copy bantuan & garansi.
//
// MENGAPA dipisah: bantuan dan ketentuan garansi jarang berubah dan sumber
// garansi kanonis ada di warranty-policy. Mengelompokkannya memudahkan menjaga
// paritas kebijakan garansi antar-kanal (Telegram/WA). Pemindahan murni.

import { formatWarrantyTermsTelegram, formatWarrantyClaimsTelegram } from "@/lib/warranty-policy";
import { SITE } from "@/lib/site";
import { formatWIBTime } from "./format";

export function helpMessage(): string {
  const { greeting } = formatWIBTime();
  return [
    "❓ <b>Bantuan AXVARA</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `${greeting}! 👋 Ada yang bisa dibantu?`,
    "",
    "📌 <b>Perintah:</b>",
    "  /start — Menu utama",
    "  /katalog — Lihat produk",
    "  /pesanan &lt;kode&gt; — Cek status",
    "  /garansi — Ketentuan &amp; klaim garansi",
    "  /bantuan — Halaman ini",
    "",
    "🛒 <b>Cara beli (1 menit):</b>",
    "  1️⃣ Pilih produk langsung dari /katalog",
    "  2️⃣ Pilih varian + jumlah",
    "  3️⃣ Konfirmasi jumlah — QRIS dinamis langsung terbit",
    "  4️⃣ Bayar sesuai total — lunas otomatis",
    "  5️⃣ Produk terkirim + notif di sini",
    "",
    "🛡 <b>AXVARA third-party, bukan official.</b> Garansi 1×24 jam–30 hari ikut varian tiap produk. Ketik /garansi.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━",
    `📞 <b>Admin:</b> wa.me/${SITE.adminWaIntl}`,
    `✈️ <b>Telegram Support:</b> @${SITE.supportTelegram}`,
    "🌐 <b>Web:</b> axvara.tech",
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
