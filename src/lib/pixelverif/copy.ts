/**
 * Buyer-facing copy for Google AI Pro 3 Bulan. 100% white label (owner
 * decision 23 Nov 2026): never name the fulfilment partner or call it a
 * supplier; say "bot otomatis" / "automated bot". Written to D1 at first
 * publish (INSERT OR IGNORE), by migration 0157 (initial whitelabel copy),
 * and by migration 0162 (activation pre-order checklist + tutorial note).
 * Refund policy (owner, 23 Nov 2026): failed orders are refunded in full.
 */
const DATA_PACKAGE_ID =
  "- Data yang diminta saat checkout: alamat Gmail, password Gmail, dan kunci setup 2FA (kunci dari aplikasi authenticator, bukan kode 6 digit).";
const DATA_PACKAGE_EN =
  "- Requested at checkout: Gmail address, Gmail password and 2FA setup key (the key from your authenticator app, not the 6-digit code).";
const USAGE_RULES_ID =
  "Aturan pakai:\n" +
  "- Data akun disimpan terenkripsi, hanya dipakai bot otomatis untuk memproses pesanan ini, dan dihapus dari sistem kami setelah pesanan selesai atau gagal.\n" +
  "- Jangan mengubah password atau 2FA selama pesanan diproses.";
const USAGE_RULES_EN =
  "Usage rules:\n" +
  "- Account data is stored encrypted, used only by our automated bot to process this order, and deleted from our system once the order completes or fails.\n" +
  "- Do not change your password or 2FA while the order is being processed.";
const WARRANTY_ID =
  "Garansi:\n" +
  "- Pesanan yang gagal diproses dikembalikan penuh, termasuk gagal karena password, kunci 2FA, atau syarat akun tidak terpenuhi.\n" +
  "- Ingin mencoba lagi dengan data yang sudah diperbaiki? Buat pesanan baru setelah dana dikembalikan.\n" +
  "- Gmail yang dinyatakan tidak memenuhi syarat untuk penawaran ini tidak dapat dipesan ulang; gunakan Gmail lain.";
const WARRANTY_EN =
  "Warranty:\n" +
  "- Orders that fail to process are refunded in full, including failures caused by a wrong password, 2FA key, or unmet account requirements.\n" +
  "- Want to try again with corrected details? Place a new order after the refund.\n" +
  "- A Gmail found ineligible for this offer cannot be ordered again; please use another Gmail.";

const PRE_ORDER_ACTIVATION_ID =
  "Persiapan akun sebelum order:\n" +
  "1. Akun Google harus aktif dan tidak sedang ditandai aktivitas tidak biasa (unusual activity). Pastikan tidak muncul captcha saat login.\n" +
  "2. Hapus passkey jika ada (myaccount.google.com/signinoptions/passkeys).\n" +
  "3. Hapus payment profile lama di Google Payments jika masih ada (payments.google.com).\n" +
  "4. Akun tidak boleh tergabung dalam grup Google Family. Keluar melalui https://families.google.com/families.\n" +
  "5. Akun tidak boleh memiliki langganan Gemini atau Google One yang sedang aktif.\n" +
  "6. Aktifkan Verifikasi 2 Langkah (2-Step Verification) dan tambahkan aplikasi authenticator (myaccount.google.com/signinoptions/twosv). Kunci secret authenticator wajib diisi saat memesan.";
const PRE_ORDER_ACTIVATION_EN =
  "Before ordering:\n" +
  "1. Your Google account must be active and not flagged for unusual activity. Make sure no captcha appears when logging in.\n" +
  "2. Remove any passkey if you have one (myaccount.google.com/signinoptions/passkeys).\n" +
  "3. Remove any old payment profile in Google Payments if one still exists (payments.google.com).\n" +
  "4. The account must not be part of any Google Family group. Leave at https://families.google.com/families.\n" +
  "5. The account must not have an active Gemini or Google One subscription.\n" +
  "6. Turn on 2-Step Verification and add an authenticator app (myaccount.google.com/signinoptions/twosv). Your authenticator setup secret is required when placing an order.";
const TUTORIAL_NOTE_ID =
  "Catatan:\n" +
  "- Tonton video tutorial berikut: yt.....";
const TUTORIAL_NOTE_EN =
  "Notes:\n" +
  "- Watch the tutorial video here: yt.....";

export const PIXELVERIF_DESCRIPTION_ID =
  "Langganan Google AI Pro 3 bulan langsung di akun Gmail kamu sendiri, diproses otomatis oleh bot dalam hitungan menit.\n" +
  "- Masa aktif 3 bulan di akun Gmail milikmu\n" +
  "- Diproses otomatis setelah pembayaran terkonfirmasi, status dan urutan antrean tampil di Lacak Pesanan\n" +
  "- Gagal diproses = dana dikembalikan penuh\n\n" +
  "Pilih yang mana?\n" +
  "- Link Redeem: cocok bila kamu ingin menukarkan sendiri. Kamu menerima link resmi one.google.com, buka saat login ke Gmail yang didaftarkan, lalu ikuti langkah di halaman Google. Estimasi ±1–2 menit.\n" +
  "- Aktivasi Langsung: cocok bila ingin beres tanpa langkah tambahan. Bot memasang langganan langsung ke akun Gmail kamu; kamu menerima link beserta keterangan status aktivasi. Estimasi ±3–5 menit.";
export const PIXELVERIF_DESCRIPTION_EN =
  "A 3-month Google AI Pro subscription on your own Gmail account, processed automatically by our bot within minutes.\n" +
  "- 3 months of Google AI Pro on the Gmail you own\n" +
  "- Processed automatically once payment is confirmed; status and queue position appear on Track Order\n" +
  "- Failed to process = full refund\n\n" +
  "Which one should I pick?\n" +
  "- Redeem Link: for buyers who prefer to redeem it themselves. You receive an official one.google.com link; open it while signed in to the registered Gmail and follow the steps on Google's page. About 1–2 minutes.\n" +
  "- Direct Activation: for buyers who want it done with no extra steps. The bot activates the subscription straight on your Gmail; you receive the link plus an activation status note. About 3–5 minutes.";

export const PIXELVERIF_COPY = {
  google_ai_pro_3m: {
    category_id: 1,
    name_en: "Google AI Pro 3 Months",
    description: PIXELVERIF_DESCRIPTION_ID,
    description_en: PIXELVERIF_DESCRIPTION_EN as string | null,
    variants: {
      "PV-NORMAL-3": {
        admin_terms:
          "Detail paket:\n" +
          "- Link redeem resmi Google AI Pro 3 bulan (one.google.com) untuk Gmail yang kamu daftarkan; kamu menukarkannya sendiri.\n" +
          DATA_PACKAGE_ID + "\n\n" +
          "Proses & pengiriman:\n" +
          "- Diproses otomatis oleh bot setelah pembayaran terkonfirmasi, estimasi ±1–2 menit.\n" +
          "- Status dan urutan antrean tampil di halaman Lacak Pesanan; link dikirim ke email/Telegram kontak pesanan.\n\n" +
          USAGE_RULES_ID + "\n\n" +
          WARRANTY_ID,
        admin_terms_en:
          "Package details:\n" +
          "- Official 3-month Google AI Pro redeem link (one.google.com) for the Gmail you register; you redeem it yourself.\n" +
          DATA_PACKAGE_EN + "\n\n" +
          "Process & delivery:\n" +
          "- Processed automatically by our bot once payment is confirmed, about 1–2 minutes.\n" +
          "- Status and queue position appear on the Track Order page; the link is sent to the order's contact email/Telegram.\n\n" +
          USAGE_RULES_EN + "\n\n" +
          WARRANTY_EN as string | null,
        admin_activation:
          PRE_ORDER_ACTIVATION_ID + "\n\n" +
          "Setelah pembayaran:\n" +
          "1. Tunggu link muncul di halaman Lacak Pesanan atau email/Telegram (±1–2 menit setelah pembayaran).\n" +
          "2. Login ke Gmail yang didaftarkan di browser.\n" +
          "3. Buka link one.google.com yang diterima.\n" +
          "4. Ikuti langkah di halaman Google sampai Google AI Pro aktif.\n" +
          "5. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.\n\n" +
          TUTORIAL_NOTE_ID,
        admin_activation_en:
          PRE_ORDER_ACTIVATION_EN + "\n\n" +
          "After payment:\n" +
          "1. Wait for the link on the Track Order page or in your email/Telegram (about 1–2 minutes after payment).\n" +
          "2. Sign in to the registered Gmail in your browser.\n" +
          "3. Open the one.google.com link you received.\n" +
          "4. Follow the steps on Google's page until Google AI Pro is active.\n" +
          "5. Check on one.google.com that the Google AI Pro plan is active.\n\n" +
          TUTORIAL_NOTE_EN as string | null,
      },
      "PV-FULL-3": {
        admin_terms:
          "Detail paket:\n" +
          "- Google AI Pro 3 bulan diaktifkan langsung oleh bot otomatis ke Gmail yang kamu daftarkan, tanpa langkah tambahan.\n" +
          "- Kamu menerima link beserta keterangan status aktivasi.\n" +
          "- Selama aktivasi, metode pembayaran dapat ditambahkan ke akun Google kamu; cek dan matikan perpanjangan otomatis di one.google.com bila ada.\n" +
          DATA_PACKAGE_ID + "\n\n" +
          "Proses & pengiriman:\n" +
          "- Diproses otomatis oleh bot setelah pembayaran terkonfirmasi, estimasi ±3–5 menit.\n" +
          "- Status dan urutan antrean tampil di halaman Lacak Pesanan; hasil dikirim ke email/Telegram kontak pesanan.\n\n" +
          USAGE_RULES_ID + "\n\n" +
          WARRANTY_ID,
        admin_terms_en:
          "Package details:\n" +
          "- 3 months of Google AI Pro activated straight on the Gmail you register by our automated bot, with no extra steps.\n" +
          "- You receive the link plus an activation status note.\n" +
          "- A payment method may be added to your Google account during activation; check and turn off auto-renewal on one.google.com if present.\n" +
          DATA_PACKAGE_EN + "\n\n" +
          "Process & delivery:\n" +
          "- Processed automatically by our bot once payment is confirmed, about 3–5 minutes.\n" +
          "- Status and queue position appear on the Track Order page; the result is sent to the order's contact email/Telegram.\n\n" +
          USAGE_RULES_EN + "\n\n" +
          WARRANTY_EN as string | null,
        admin_activation:
          PRE_ORDER_ACTIVATION_ID + "\n\n" +
          "Setelah pembayaran:\n" +
          "1. Tunggu keterangan aktivasi di halaman Lacak Pesanan atau email/Telegram (±3–5 menit setelah pembayaran).\n" +
          "2. Bila keterangan menyebut Google AI Pro sudah aktif, tidak ada langkah tambahan.\n" +
          "3. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.\n" +
          "4. Matikan perpanjangan otomatis di one.google.com bila ada.\n\n" +
          TUTORIAL_NOTE_ID,
        admin_activation_en:
          PRE_ORDER_ACTIVATION_EN + "\n\n" +
          "After payment:\n" +
          "1. Wait for the activation note on the Track Order page or in your email/Telegram (about 3–5 minutes after payment).\n" +
          "2. If the note says Google AI Pro is already active, there are no extra steps.\n" +
          "3. Check on one.google.com that the Google AI Pro plan is active.\n" +
          "4. Turn off auto-renewal on one.google.com if present.\n\n" +
          TUTORIAL_NOTE_EN as string | null,
      },
    },
  },
} as const;

/**
 * Fixed buyer guidance per provider error code (README "Error Codes"). White
 * label: never mention the partner. The provider's own user_message is never forwarded verbatim (it may echo buyer
 * data); only these fixed texts reach the buyer. Unknown codes → null (generic notice).
 */
const REFUND_NOTE = " Dana pesanan ini dikembalikan penuh; hubungi admin dengan kode pesanan. Untuk mencoba lagi, buat pesanan baru setelah dana kembali.";
const PIXELVERIF_BUYER_ERROR_MESSAGES: Record<string, string> = {
  WRONG_PASSWORD: "Password Gmail yang dikirim salah." + REFUND_NOTE,
  WRONG_2FA_CODE: "Kunci setup 2FA tidak valid. Pastikan yang dikirim adalah kunci setup dari aplikasi authenticator, bukan kode 6 digit." + REFUND_NOTE,
  WRONG_EMAIL: "Alamat Gmail tidak valid." + REFUND_NOTE,
  "2FA_WARNING": "Verifikasi 2 langkah di akun belum diatur dengan benar; aktifkan 2FA dengan aplikasi authenticator." + REFUND_NOTE,
  PAYMENT_WARNING: "Ada masalah payment profile Google di akun ini; tutup payment profile lama di payments.google.com." + REFUND_NOTE,
  CAPTCHA_DETECTED: "Google meminta captcha untuk akun ini; login manual sekali ke Gmail tersebut." + REFUND_NOTE,
  ACTIVATION_ITEM_NOT_AVAILABLE: "Akun Gmail ini tidak memenuhi syarat untuk penawaran ini dan tidak bisa dipesan ulang; gunakan Gmail lain. Dana pesanan ini dikembalikan penuh; hubungi admin dengan kode pesanan.",
  ACTIVATION_FAILED: "Aktivasi otomatis di akun kamu gagal." + REFUND_NOTE,
};

export function pixelverifBuyerErrorMessage(code: string | null | undefined): string | undefined {
  return code ? PIXELVERIF_BUYER_ERROR_MESSAGES[code] : undefined;
}
