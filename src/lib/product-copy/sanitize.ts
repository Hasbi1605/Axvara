// src/lib/product-copy/sanitize.ts — Sanitasi salinan teks supplier ("pemasok")
// untuk output pembeli.
//
// Murni tanpa import DB:
// 1. Ganti URL / bare domain yang cocok dengan baris aktif `supplier_links`
//    menjadi `axvara.tech/go/<slug>` (exact host+path lebih dulu, lalu host root).
// 2. Tegaskan frasa ajakan menghubungi admin ("hubungi/chat/kontak admin",
//    "contact [the] admin") agar menyebut AXVARA bila belum diikuti "AXVARA".
// 3. Hanya berlaku untuk salinan bersumber "pemasok"; "admin" dan "axvara"
//    tidak pernah diubah. Tidak pernah memutasi input.
import type { VariantCopy } from "./format";

export type SupplierLinkEntry = {
  slug: string;
  destination: string;
};

export type SupplierLinkMap = {
  /** Kunci `${host}${pathTanpaTrailingSlash}${search}` → slug. */
  exact: Map<string, string>;
  /** Kunci `${host}` untuk destination path "/" tanpa query → slug. */
  hostRoot: Map<string, string>;
};

export const EMPTY_SUPPLIER_LINK_MAP: SupplierLinkMap = {
  exact: new Map(),
  hostRoot: new Map(),
};

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function normalizePath(url: URL): string {
  const cleanPathname = url.pathname.replace(/\/+$/, "");
  return `${cleanPathname}${url.search}`;
}

/** Bangun indeks lookup dari baris `supplier_links` aktif. Tujuan internal ("/...") diabaikan. */
export function buildSupplierLinkMap(rows: readonly SupplierLinkEntry[]): SupplierLinkMap {
  const exact = new Map<string, string>();
  const hostRoot = new Map<string, string>();
  for (const row of rows) {
    const slug = String(row.slug ?? "").trim();
    const destination = String(row.destination ?? "").trim();
    if (!slug || !destination || destination.startsWith("/")) continue;
    if (!/^https?:\/\//i.test(destination)) continue;
    let parsed: URL;
    try {
      parsed = new URL(destination);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const host = normalizeHost(parsed.hostname);
    if (!host || !host.includes(".") || host === "axvara.tech") continue;
    const exactKey = `${host}${normalizePath(parsed)}`;
    if (!exact.has(exactKey)) exact.set(exactKey, slug);
    if (parsed.pathname === "/" && !parsed.search && !hostRoot.has(host)) {
      hostRoot.set(host, slug);
    }
  }
  return { exact, hostRoot };
}

function lookupSupplierSlug(rawUrl: string, links: SupplierLinkMap): string | null {
  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = normalizeHost(parsed.hostname);
  if (!host || !host.includes(".")) return null;
  const exactKey = `${host}${normalizePath(parsed)}`;
  return links.exact.get(exactKey) ?? links.hostRoot.get(host) ?? null;
}

const URL_OR_DOMAIN_RE =
  /https?:\/\/[^\s<>"')\]]+|(?<![a-z0-9_@./-])(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;
const ID_ADMIN_RE = /\b(?:hubungi|chat|kontak)\s+admin\b(?!\s+axvara\b)/gi;
const EN_ADMIN_RE = /\bcontact(?:\s+the)?\s+admin\b(?!\s+axvara\b)/gi;

function startsUpper(text: string): boolean {
  const first = text.charAt(0);
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
}

function sanitizeSupplierLine(line: string, links: SupplierLinkMap): string {
  let out = line;
  if (links.exact.size > 0 || links.hostRoot.size > 0) {
    out = out.replace(URL_OR_DOMAIN_RE, (match) => {
      const clean = match.replace(TRAILING_PUNCT_RE, "");
      if (!clean) return match;
      const slug = lookupSupplierSlug(clean, links);
      if (!slug) return match;
      const suffix = match.slice(clean.length);
      return `axvara.tech/go/${slug}${suffix}`;
    });
  }
  out = out.replace(ID_ADMIN_RE, (match) => (startsUpper(match) ? "Hubungi admin AXVARA" : "hubungi admin AXVARA"));
  out = out.replace(EN_ADMIN_RE, (match) => (startsUpper(match) ? "Contact AXVARA admin" : "contact AXVARA admin"));
  return out;
}

export function sanitizeSupplierCopy(copy: VariantCopy, links: SupplierLinkMap): VariantCopy;
export function sanitizeSupplierCopy(copy: VariantCopy | null, links: SupplierLinkMap): VariantCopy | null;
export function sanitizeSupplierCopy(copy: VariantCopy | null, links: SupplierLinkMap): VariantCopy | null {
  if (!copy || copy.source !== "pemasok") return copy;
  return {
    source: "pemasok",
    sections: copy.sections.map((section) => ({
      kind: section.kind,
      items: section.items.map((item) => sanitizeSupplierLine(item, links)),
    })),
    activation: copy.activation.map((group) => ({
      title: group.title,
      steps: group.steps.map((step) => sanitizeSupplierLine(step, links)),
    })),
    notes: copy.notes.map((note) => sanitizeSupplierLine(note, links)),
  };
}
