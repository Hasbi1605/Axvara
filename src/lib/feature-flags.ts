// src/lib/feature-flags.ts — Feature flags for phased rollout

export const flags = {
  PRODUCT_VARIANTS_READ: () => process.env.PRODUCT_VARIANTS_READ === "true",
  PRODUCT_VARIANTS_WRITE: () => process.env.PRODUCT_VARIANTS_WRITE === "true",
  TELEGRAM_VARIANT_FLOW: () => process.env.TELEGRAM_VARIANT_FLOW === "true",
  WHATSAPP_ENABLED: () => process.env.WHATSAPP_ENABLED === "true",
  WHATSAPP_GROUP_DISCOVERY: () => process.env.WHATSAPP_GROUP_DISCOVERY === "true",
  WHATSAPP_GROUP_PAYMENT: () => process.env.WHATSAPP_GROUP_PAYMENT === "true",
  WHATSAPP_PROOF_INTAKE: () => process.env.WHATSAPP_PROOF_INTAKE === "true",
  WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT: () => process.env.WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT === "true",
  WHATSAPP_KLIKQRIS: () => process.env.WHATSAPP_KLIKQRIS === "true",
  WHATSAPP_FULFILLMENT: () => process.env.WHATSAPP_FULFILLMENT === "true",
} as const;

export type FlagName = keyof typeof flags;

export function isEnabled(flag: FlagName): boolean {
  return flags[flag]();
}

// Preflight check for WhatsApp payment activation
export async function preflightWhatsAppPayment(queryAll: (sql: string, ...p: unknown[]) => Promise<Record<string, unknown>[]>): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];

  const methods = await queryAll(`SELECT id, account_number, account_name, qris_url, is_active FROM payment_methods WHERE is_active=1`);

  const qris = methods.find(m => String(m.id) === "qris");
  if (!qris || !qris.qris_url) missing.push("QRIS (gambar/URL belum diatur)");

  const seabank = methods.find(m => String(m.id) === "seabank");
  if (!seabank || !seabank.account_number || !seabank.account_name) missing.push("SeaBank (rekening/nama belum diatur)");

  const ewallet = methods.find(m => String(m.id) === "ewallet");
  if (!ewallet || !ewallet.account_number || !ewallet.account_name) missing.push("E-Wallet (nomor/nama belum diatur)");

  return { ok: missing.length === 0, missing };
}
