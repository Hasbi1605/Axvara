// src/lib/tunvn/families.ts — peta keluarga produk TUNVN → katalog AXVARA.
//
// Keputusan owner 15 November 2026: SEMUA produk mirror TUNVN (kecuali #60
// API TEST) masuk katalog admin "Produk" seperti produk WR/SK. Produk serupa
// dikelompokkan sebagai VARIAN satu produk AXVARA (family). Semua produk/
// varian baru dibuat NONAKTIF; sync tidak pernah mengaktifkan apa pun.
//
// Peta ini statis dan murni: dipakai publisher (catalog.ts), panel admin, dan
// test. Label adalah teks pembeli berbahasa Indonesia tanpa nama supplier.
// `imageFromSlugs` dibaca sekali saat produk dibuat (bukan tiap sync): produk
// existing dengan slug tersebut diurutkan sesuai daftar, yang pertama punya
// image_url dipakai.

export const TUNVN_EXCLUDED_PRODUCT_IDS: readonly number[] = [60];

export type TunvnFamilyMember = { supplier_product_id: number; label: string; sort: number };

export type TunvnFamily = {
  key: string;
  name: string;
  slug: string;
  imageFromSlugs: string[];
  members: TunvnFamilyMember[];
  /** false = produk milik owner; jangan tulis products.tunvn_family. */
  markFamily?: boolean;
  /** Aset tetap bila tidak ada produk kandidat bergambar. */
  imageUrl?: string;
};

/** Aset gambar ChatGPT TUNVN yang disetujui owner 9 Nov 2026. */
export const TUNVN_CHATGPT_IMAGE_URL = "/r2/products/f87f491ee2f9034845db18eb08c9236d.webp";

export const TUNVN_MUSE_SLUG = "muse-ai-1-miliar-token";

export const TUNVN_FAMILIES: readonly TunvnFamily[] = [
  {
    key: "chatgpt",
    name: "ChatGPT Private",
    slug: "chatgpt-tunvn",
    imageFromSlugs: ["chatgpt-pro", "chatgpt-sk"],
    imageUrl: TUNVN_CHATGPT_IMAGE_URL,
    members: [
      { supplier_product_id: 86, label: "Business 1 Bulan", sort: 1 },
      { supplier_product_id: 83, label: "GPay 1 Bulan", sort: 2 },
    ],
  },
  {
    key: "muse",
    name: "Muse AI 1 Miliar Token",
    slug: TUNVN_MUSE_SLUG,
    imageFromSlugs: [],
    markFamily: false,
    members: [
      { supplier_product_id: 97, label: "Akun 1B Token (tanpa garansi)", sort: 20 },
      { supplier_product_id: 111, label: "Akun 1B Token · Gmail (garansi 2 hari)", sort: 21 },
      { supplier_product_id: 114, label: "Akun 25–28B Token (tanpa garansi)", sort: 22 },
      { supplier_product_id: 98, label: "Akun 31B Token (tanpa garansi)", sort: 23 },
      { supplier_product_id: 112, label: "Akun 31B Token · Gmail (garansi 2 hari)", sort: 24 },
      { supplier_product_id: 120, label: "Akun 1B Token (tanpa garansi)", sort: 25 },
    ],
  },
  {
    key: "capcut",
    name: "CapCut Pro",
    slug: "capcut-pro-tunvn",
    imageFromSlugs: ["capcut-pro", "capcut-sk"],
    members: [
      { supplier_product_id: 44, label: "7 Hari · 500 Kredit", sort: 1 },
      { supplier_product_id: 87, label: "1 Bulan", sort: 2 },
      { supplier_product_id: 37, label: "Team 1 Bulan", sort: 3 },
      { supplier_product_id: 67, label: "6 Bulan", sort: 4 },
      { supplier_product_id: 119, label: "Pro 7 Hari (200–500 Kredit)", sort: 5 },
      { supplier_product_id: 121, label: "Pro 6 Hari (Full Garansi)", sort: 6 },
    ],
  },
  {
    key: "grok-cursor",
    name: "Grok + Cursor Premium",
    slug: "grok-cursor-tunvn",
    imageFromSlugs: ["grok-ai", "grok-ai-sk"],
    members: [
      { supplier_product_id: 104, label: "14 Hari (garansi 1 hari)", sort: 1 },
      { supplier_product_id: 99, label: "1 Bulan (garansi 3 hari)", sort: 2 },
      { supplier_product_id: 100, label: "1 Bulan (garansi penuh)", sort: 3 },
    ],
  },
  {
    key: "claude-api",
    name: "Claude API Credit",
    slug: "claude-api-tunvn",
    imageFromSlugs: ["claude-pro"],
    members: [
      { supplier_product_id: 69, label: "Kredit $100 · 30 Hari", sort: 1 },
      { supplier_product_id: 70, label: "Kredit $500 · 30 Hari", sort: 2 },
    ],
  },
  {
    key: "microsoft-365",
    name: "Microsoft 365",
    slug: "microsoft-365-tunvn",
    imageFromSlugs: ["microsoft-365-sk", "office365-lifetime"],
    members: [{ supplier_product_id: 73, label: "Admin 12 Bulan", sort: 1 }],
  },
  {
    key: "microsoft-copilot",
    name: "Microsoft Copilot Premium",
    slug: "microsoft-copilot-tunvn",
    imageFromSlugs: [],
    imageUrl: "/r2/products/a1701a94b1f47ce83ffd1c1527fb9c89.webp",
    members: [{ supplier_product_id: 122, label: "Premium 1 Bulan (Full Garansi)", sort: 1 }],
  },
  {
    key: "spotify",
    name: "Spotify Premium",
    slug: "spotify-premium-tunvn",
    imageFromSlugs: ["spotify-premium", "spotify-premium-sk"],
    members: [{ supplier_product_id: 116, label: "Kupon 3 Bulan", sort: 1 }],
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    slug: "elevenlabs-tunvn",
    imageFromSlugs: [],
    members: [{ supplier_product_id: 47, label: "Creator 3 Bulan", sort: 1 }],
  },
  {
    key: "grammarly",
    name: "Grammarly Pro",
    slug: "grammarly-tunvn",
    imageFromSlugs: ["grammarly-sk"],
    members: [{ supplier_product_id: 117, label: "Pro 12 Bulan", sort: 1 }],
  },
  {
    key: "hma",
    name: "HMA VPN",
    slug: "hma-vpn-tunvn",
    imageFromSlugs: ["hma-vpn", "hidemyass-vpn-sk"],
    members: [{ supplier_product_id: 103, label: "Key 30 Hari", sort: 1 }],
  },
  {
    key: "nord",
    name: "Nord VPN",
    slug: "nord-vpn-tunvn",
    imageFromSlugs: ["nord-vpn-sk"],
    members: [{ supplier_product_id: 105, label: "Kupon 3 Bulan", sort: 1 }],
  },
  {
    key: "gemini",
    name: "Google AI / Gemini",
    slug: "gemini-tunvn",
    imageFromSlugs: ["google-ai-pro-antigravity", "gemini-ai-sk"],
    members: [{ supplier_product_id: 115, label: "Gemini Plus 6 Bulan (link redeem)", sort: 1 }],
  },
  {
    key: "linkedin",
    name: "LinkedIn Premium",
    slug: "linkedin-premium-tunvn",
    imageFromSlugs: [],
    members: [{ supplier_product_id: 59, label: "Career 3 Bulan", sort: 1 }],
  },
  {
    key: "codex-phone",
    name: "Codex Verify Phone",
    slug: "codex-verify-phone-tunvn",
    imageFromSlugs: [],
    members: [{ supplier_product_id: 110, label: "Nomor Verifikasi", sort: 1 }],
  },
];

const memberIndex = new Map<number, { family: TunvnFamily; member: TunvnFamilyMember }>();
for (const family of TUNVN_FAMILIES) {
  for (const member of family.members) {
    memberIndex.set(member.supplier_product_id, { family, member });
  }
}

export function isTunvnExcludedProduct(supplierProductId: number): boolean {
  return TUNVN_EXCLUDED_PRODUCT_IDS.includes(supplierProductId);
}

/** Peta eksplisit; #60 dan id tak dikenal tidak pernah dipetakan di sini. */
export function tunvnFamilyForSupplierId(supplierProductId: number): { family: TunvnFamily; member: TunvnFamilyMember } | null {
  if (!Number.isSafeInteger(supplierProductId) || isTunvnExcludedProduct(supplierProductId)) return null;
  return memberIndex.get(supplierProductId) ?? null;
}

export function tunvnSlugify(name: string): string {
  const slug = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return slug || "produk";
}

/** Fallback 1:1 untuk produk mirror yang belum dipetakan. Nama/label memakai
 *  nama upstream apa adanya; slug dijamin berakhiran -tunvn. */
export function tunvnFallbackFamily(supplierProductId: number, name: string): TunvnFamily {
  const trimmed = String(name ?? "").trim().slice(0, 120) || `Produk TUNVN ${supplierProductId}`;
  return {
    key: `p${supplierProductId}`,
    name: trimmed,
    slug: `${tunvnSlugify(trimmed)}-tunvn`.slice(0, 80),
    imageFromSlugs: [],
    members: [{ supplier_product_id: supplierProductId, label: trimmed, sort: 1 }],
  };
}

export function tunvnDefaultDescription(name: string): string {
  return `${name}. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.`;
}
