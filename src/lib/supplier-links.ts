// src/lib/supplier-links.ts — Shortlink internal axvara.tech/go/:slug.
//
// Pembungkus link supplier + artikel AXVARA yang panjang agar tampil pendek
// di PDP/email/panel. BUKAN SaaS publik ala Kliqs: CRUD hanya admin
// (/api/admin/supplier-links), pembeli hanya redirect 307 + hitung klik.
//
// Aturan:
// - slug: lowercase a-z0-9-dash (validasi di API + route).
// - destination: path internal ("/artikel/...", prioritas — navigasi dalam
//   toko) atau https full (mailbox supplier, portal resmi, video tutorial).
//   Skema selain https + path internal ditolak (anti open-redirect).
// - redirect 307 (bukan 308): browser selalu cek ulang sehingga ganti tujuan
//   di admin berlaku seketika tanpa cache permanen.
// - noindex: link operasional, bukan konten SEO (robots.ts + metadata page).

export type SupplierLink = {
  id: number;
  slug: string;
  destination: string;
  title: string;
  is_active: boolean;
  click_count: number;
  last_clicked_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Slug yang sah: tak boleh tabrakan dengan route + API existing. */
export const SUPPLIER_LINK_RESERVED = new Set([
  "admin", "api", "produk", "produk-baru", "pesanan", "checkout",
  "link", "go", "artikel", "lacak-pesanan", "cara-order",
  "garansi-replace", "kategori", "sitemap", "robots", "favicon",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidSupplierSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !SUPPLIER_LINK_RESERVED.has(slug);
}

/**
 * Normalisasi + validasi tujuan. Kembalikan destination kanonis atau null.
 * - Path internal "/..." (artikel/produk/halaman) → apa adanya.
 * - Bare axvara.tech/... → path internal.
 * - https://... host lain → URL penuh (hanya http/https).
 */
export function normalizeSupplierDestination(raw: string): string | null {
  const text = String(raw ?? "").trim().replace(/[.,;:!?)\]]+$/, "");
  if (!text || text.length > 2048) return null;
  if (text.startsWith("/")) {
    return /^\/[a-z0-9\-_./?#&=%]*$/i.test(text) ? text : null;
  }
  let candidate = text;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;
  if (/^(?:www\.)?axvara\.tech$/i.test(parsed.hostname)) {
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return path && /^[a-z0-9\-_./?#&=%]*$/i.test(path) ? path : null;
  }
  return parsed.toString();
}

type Row = Record<string, unknown>;

export function normalizeSupplierLink(row: Row): SupplierLink {
  return {
    id: Number(row.id ?? 0),
    slug: String(row.slug ?? ""),
    destination: String(row.destination ?? ""),
    title: String(row.title ?? ""),
    is_active: Number(row.is_active ?? 0) === 1,
    click_count: Number(row.click_count ?? 0),
    last_clicked_at: row.last_clicked_at == null ? null : String(row.last_clicked_at),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
