// src/lib/fulfillment/handover-template.ts — Template pesan serah terima per
// varian Made By Order non-WR (product_variants.handover_template, 0043).
//
// Placeholder yang didukung sengaja sedikit dan eksplisit supaya admin tidak
// perlu menebak: {email}, {nama}, {kode}, {produk}. Placeholder lain dibiarkan
// apa adanya (bukan dihapus) agar salah ketik terlihat sebelum dikirim.

export const HANDOVER_PLACEHOLDERS = ["{email}", "{nama}", "{kode}", "{produk}"] as const;

export function renderHandoverTemplate(
  template: string,
  values: { email: string; name: string; code: string; product: string },
): string {
  const text = String(template ?? "").trim();
  if (!text) return "";
  const firstName = values.name.trim().split(/\s+/)[0] || "Kak";
  return text
    .replace(/\{email\}/gi, values.email.trim() || "email kamu")
    .replace(/\{nama\}/gi, firstName)
    .replace(/\{kode\}/gi, values.code)
    .replace(/\{produk\}/gi, values.product);
}
