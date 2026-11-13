// src/lib/feature-flags.ts — Feature flags for phased rollout

export const flags = {
  PRODUCT_VARIANTS_READ: () => process.env.PRODUCT_VARIANTS_READ === "true",
  PRODUCT_VARIANTS_WRITE: () => process.env.PRODUCT_VARIANTS_WRITE === "true",
  TELEGRAM_VARIANT_FLOW: () => process.env.TELEGRAM_VARIANT_FLOW === "true",
  // Alur pembeli WhatsApp (pencarian, pemesanan/pembayaran, intake bukti
  // manual) DIPENSUNKAN 13 November 2026 atas keputusan owner: hard off di
  // kode, bukan lewat flag. Jangan menambah flag baru untuk menghidupkannya.
  WHATSAPP_ENABLED: () => process.env.WHATSAPP_ENABLED === "true",
  WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT: () => process.env.WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT === "true",
  WHATSAPP_FULFILLMENT: () => process.env.WHATSAPP_FULFILLMENT === "true",
  // DM kredensial otomatis ke buyer (19 Sep 2026, default MATI pasca-restriction
  // nomor BOT). Grup tetap hidup penuh; kredensial jalan via email + panel web.
  // Kode + mekanisme DM UTUH di bawah gate ini — menyalakan lagi = set env
  // "true" + deploy, tanpa ubah kode (lihat issue disable-wa-credential-dm).
  WHATSAPP_CREDENTIAL_DM_ENABLED: () => process.env.WHATSAPP_CREDENTIAL_DM_ENABLED === "true",
} as const;

export type FlagName = keyof typeof flags;

export function isEnabled(flag: FlagName): boolean {
  return flags[flag]();
}
