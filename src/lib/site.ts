// Single source of truth untuk kontak & brand — jangan hardcode wa.me di komponen.
export const SITE = {
  name: "AXVARA",
  tagline: "Toko akun premium, AI gateway, dan tools pro.",
  adminWaLocal: "089519388264",
  adminWaIntl: "6289519388264",
  supportHours: "09.00–23.00 WIB",
} as const;

export function adminWaLink(text?: string): string {
  const base = `https://wa.me/${SITE.adminWaIntl}`;
  if (!text) return `${base}?text=${encodeURIComponent("Halo AXVARA")}`;
  return `${base}?text=${encodeURIComponent(text)}`;
}
