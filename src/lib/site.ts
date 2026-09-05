// Single source of truth untuk kontak & brand — jangan hardcode wa.me di komponen.
export const SITE = {
  name: "AXVARA",
  tagline: "Toko akun premium, AI gateway, dan tools pro.",
  adminWaLocal: "089519388264",
  adminWaIntl: "6289519388264",
  adminTelegram: "axvara_support",
  webUrl: "https://axvara.tech",
  supportHours: "09.00–23.00 WIB",
} as const;

export type StoreSettings = {
  name: string;
  tagline: string;
  whatsappNumber: string;
  supportHours: string;
  footerText: string;
  logoUrl: string;
};

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  name: SITE.name,
  tagline: SITE.tagline,
  whatsappNumber: SITE.adminWaLocal,
  supportHours: SITE.supportHours,
  footerText: "AXVARA adalah third-party independen, tidak terafiliasi dengan brand manapun.",
  logoUrl: "",
};

const STORE_SETTING_KEYS: Record<string, keyof StoreSettings> = {
  store_name: "name",
  tagline: "tagline",
  whatsapp_number: "whatsappNumber",
  support_hours: "supportHours",
  footer_text: "footerText",
  logo_url: "logoUrl",
};

export function storeSettingsFromRows(rows: Record<string, unknown>[]): StoreSettings {
  const settings = { ...DEFAULT_STORE_SETTINGS };
  rows.forEach((row) => {
    const property = STORE_SETTING_KEYS[String(row.key ?? "")];
    if (property && typeof row.value === "string") settings[property] = row.value;
  });
  return settings;
}

export function normalizeWhatsAppNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

export function whatsappLink(number: string, text = "Halo AXVARA"): string {
  return `https://wa.me/${normalizeWhatsAppNumber(number)}?text=${encodeURIComponent(text)}`;
}

export function adminWaLink(text?: string): string {
  return whatsappLink(SITE.adminWaIntl, text ?? "Halo AXVARA");
}

export function adminTelegramLink(): string {
  return `https://t.me/${SITE.adminTelegram}`;
}
