export type PixelverifFlowType = "normal" | "full";
export type PixelverifFamilyKey = "google_ai_pro_3m";

export type PixelverifVariantSpec = {
  flow_type: PixelverifFlowType;
  validity: 3;
  sku: string;
  label: string;
  service_key: string;
};

export const PIXELVERIF_FAMILY: { key: PixelverifFamilyKey; name: string; slug: string; category: number; imageUrl: string; description: string; description_en: string | null } = {
  key: "google_ai_pro_3m",
  name: "Google AI Pro 3 Bulan",
  slug: "google-ai-pro-3-bulan",
  category: 1,
  imageUrl: "/brand/catalog/products/google-ai-pro-pv.webp",
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
    "Untuk Full: setelah sukses, cek dan batalkan perpanjangan otomatis di one.google.com bila ada — perpanjangan otomatis belum terkonfirmasi (unconfirmed) dan mungkin menambah metode pembayaran.",
  description_en: null,
};

export const PIXELVERIF_VARIANTS: PixelverifVariantSpec[] = [
  { flow_type: "normal", validity: 3, sku: "PV-NORMAL-3", label: "Link Redeem 3 Bulan", service_key: "normal_3" },
  { flow_type: "full", validity: 3, sku: "PV-FULL-3", label: "Aktivasi Langsung 3 Bulan", service_key: "full_3" },
];

export function pixelverifFamilyForFlow(flow: PixelverifFlowType): typeof PIXELVERIF_FAMILY {
  return PIXELVERIF_FAMILY;
}

export function pixelverifVariantForSku(sku: string): PixelverifVariantSpec | undefined {
  return PIXELVERIF_VARIANTS.find((v) => v.sku === sku);
}

export function pixelverifVariantForServiceKey(key: string): PixelverifVariantSpec | undefined {
  return PIXELVERIF_VARIANTS.find((v) => v.service_key === key);
}
