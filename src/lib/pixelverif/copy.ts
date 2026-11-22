export const PIXELVERIF_COPY = {
  google_ai_pro_3m: {
    category_id: 1,
    description:
      "Google AI Pro 3 bulan via Pixel Verification. Dua pilihan: Link Redeem (kirim link aktivasi ke Gmail Anda) atau Aktivasi Langsung (tim aktivasi ke akun Anda).\n\n" +
      "Syarat wajib sebelum checkout:\n" +
      "• Akun Gmail aktif tanpa captcha/unusual activity\n" +
      "• Hapus passkey di myaccount.google.com/signinoptions/passkeys\n" +
      "• Tutup payment profile lama di payments.google.com (jika ada)\n" +
      "• Keluar dari Google Family di families.google.com/families\n" +
      "• Tidak ada langganan Gemini/Google One aktif\n" +
      "• 2FA aktif + aplikasi authenticator (myaccount.google.com/signinoptions/twosv dan myaccount.google.com/two-step-verification/authenticator)\n" +
      "• Saran: gunakan Gmail cadangan\n\n" +
      "Normal vs Full:\n" +
      "• Link Redeem 3 Bulan (Normal): Anda menerima link https://one.google.com/ — buka link saat login ke Gmail yang didaftarkan.\n" +
      "• Aktivasi Langsung 3 Bulan (Full): Tim melakukan aktivasi langsung ke akun Anda; Anda menerima link + status aktivasi.\n\n" +
      "Setelah sukses: segera ganti password & kunci authenticator Anda. Untuk Full, cek dan batalkan perpanjangan otomatis di one.google.com bila ada — perpanjangan otomatis belum terkonfirmasi (unconfirmed) dan mungkin menambah metode pembayaran.",
    description_en: null as string | null,
    variants: {
      "PV-NORMAL-3": {
        admin_terms:
          "Syarat: akun aktif tanpa captcha/unusual activity; hapus passkey; tutup payment profile lama di payments.google.com; keluar dari Google Family families.google.com/families; tidak ada langganan Gemini/Google One aktif; 2FA aktif + authenticator (myaccount.google.com/signinoptions/twosv). Saran pakai Gmail cadangan.\n\n" +
          "Jenis: Link Redeem 3 Bulan (Normal) — Anda menerima link redeem Google AI Pro 3 bulan (https://one.google.com/). Buka link saat login ke Gmail yang didaftarkan.",
        admin_terms_en: null as string | null,
        admin_activation:
          "1. Login ke Gmail yang didaftarkan.\n2. Buka link redeem yang diterima (https://one.google.com/...).\n3. Ikuti langkah aktivasi di halaman Google.\n4. Setelah sukses, ganti password & kunci authenticator Anda.",
        admin_activation_en: null as string | null,
      },
      "PV-FULL-3": {
        admin_terms:
          "Syarat: akun aktif tanpa captcha/unusual activity; hapus passkey; tutup payment profile lama di payments.google.com; keluar dari Google Family families.google.com/families; tidak ada langganan Gemini/Google One aktif; 2FA aktif + authenticator (myaccount.google.com/signinoptions/twosv). Saran pakai Gmail cadangan.\n\n" +
          "Jenis: Aktivasi Langsung 3 Bulan (Full) — Tim melakukan aktivasi langsung ke akun Anda. Anda menerima link + status aktivasi. Full dapat menambah metode pembayaran; cek dan batalkan perpanjangan otomatis di one.google.com bila ada (auto-renew belum terkonfirmasi).",
        admin_terms_en: null as string | null,
        admin_activation:
          "1. Tim melakukan aktivasi langsung ke Gmail yang didaftarkan.\n2. Anda menerima link + status aktivasi (activated / already_redeemed).\n3. Verifikasi di one.google.com bahwa Google AI Pro aktif.\n4. Segera ganti password & kunci authenticator; cek perpanjangan otomatis di one.google.com dan batalkan bila ada.",
        admin_activation_en: null as string | null,
      },
    },
  },
} as const;
