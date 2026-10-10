// Single source of truth untuk kontak & brand — jangan hardcode wa.me di komponen.
//
// HUB WA (2026-10-10, keputusan owner): SEMUA tombol "Chat WA admin" mengarah
// ke halaman perantara /wa (bukan wa.me langsung) agar suspend satu nomor
// tidak mematikan seluruh traffic WA — user memilih nomor aktif di sana.
// Satu-satunya pengecualian: chat-balik admin → buyer (nomor buyer, langsung
// wa.me) dan tombol Share artikel (wa.me/?text=, bukan chat admin).
export const SITE = {
  name: "AXVARA",
  tagline: "Toko akun premium, AI gateway, dan tools pro.",
  adminWaLocal: "089519388264",
  adminWaIntl: "6289519388264",
  adminTelegram: "Axvara_bot",
  supportTelegram: "axvara_support",
  webUrl: "https://axvara.tech",
  supportHours: "09.00–23.00 WIB",
  social: {
    instagram: "https://www.instagram.com/axvara.tech/",
    threads: "https://www.threads.com/@axvara.tech",
    tiktok: "https://www.tiktok.com/@axvara.tech",
    facebook: "https://www.facebook.com/Axvara.tech/",
  },
} as const;

/** Daftar nomor WA admin di hub /wa. `suspended` = tampil dengan badge jujur
 *  (tetap bisa diklik — user yang sudah chat di sana perlu tahu kenapa sepi),
 *  bukan disembunyikan. Urutan = urutan tampil. */
export const SUPPORT_WA_NUMBERS = [
  { label: "AXVARA 1", local: "083177738496", intl: "6283177738496", status: "active" as const, hint: "Fast respon" },
  { label: "AXVARA 2", local: "089519388264", intl: "6289519388264", status: "suspended" as const, hint: "Suspend sementara" },
  { label: "AXVARA 3", local: "083826039171", intl: "6283826039171", status: "active" as const, hint: "Fast respon" },
] as const;

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

/** Hub pemilih nomor WA admin (/wa). Pesan bawaan diteruskan via ?pesan=
 *  agar konteks ("tanya pesanan AXV-…") tetap kebawa ke nomor yang dipilih. */
export function waHubLink(text?: string): string {
  const msg = (text ?? "Halo AXVARA").trim() || "Halo AXVARA";
  return `/wa?pesan=${encodeURIComponent(msg)}`;
}

export function adminWaLink(text?: string): string {
  // 2026-10-10: lewat hub /wa (bukan wa.me langsung) — suspend satu nomor
  // tidak mematikan tombol. Berlaku untuk web + keyboard Telegram (URL
  // absolut https://axvara.tech/wa?... dibentuk pemanggil bila perlu).
  return waHubLink(text ?? "Halo AXVARA");
}

export function adminTelegramLink(): string {
  return `https://t.me/${SITE.adminTelegram}`;
}

export function supportTelegramLink(): string {
  return `https://t.me/${SITE.supportTelegram}`;
}
