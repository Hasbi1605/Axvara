// src/lib/feature-flags.ts — Feature flags for phased rollout

export const flags = {
  PRODUCT_VARIANTS_READ: () => process.env.PRODUCT_VARIANTS_READ === "true",
  PRODUCT_VARIANTS_WRITE: () => process.env.PRODUCT_VARIANTS_WRITE === "true",
  TELEGRAM_VARIANT_FLOW: () => process.env.TELEGRAM_VARIANT_FLOW === "true",
  // Alur pembeli WhatsApp (pencarian, pemesanan/pembayaran, intake bukti
  // manual) DIPENSUNKAN 13 November 2026 atas keputusan owner: hard off di
  // kode, bukan lewat flag. Jangan menambah flag baru untuk menghidupkannya.
  WHATSAPP_ENABLED: () => process.env.WHATSAPP_ENABLED === "true",
} as const;

export type FlagName = keyof typeof flags;

export function isEnabled(flag: FlagName): boolean {
  return flags[flag]();
}
