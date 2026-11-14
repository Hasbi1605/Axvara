// src/lib/games/variant-kind.ts — helper MURNI klasifikasi varian Sekalipay
// untuk storefront Games (docs/GAMES.md §14, keputusan owner OD4 14 Nov 2026).
// Tidak menyentuh DB/network: dipakai katalog publik, sitemap, dan admin.
//
//  * `type_label` = `product_type_name` supplier dengan ejaan Indonesia.
//  * `region_code` = ISO-2 (atau "GLOBAL") hanya bila tipenya negara/global.
//  * `category` = override admin `games_products.display_group` bila terisi,
//    selain itu hasil aturan otomatis (urutan first_topup → pass → pack →
//    topup → other, sama seperti spesifikasi B6).

/** Nilai `games_products.display_group` yang sah (sinkron dengan CHECK schema). */
export const GAMES_DISPLAY_GROUP_VALUES = [
  "special",
  "bestseller",
  "promo",
  "first_topup",
  "pass",
  "pack",
  "topup",
  "other",
] as const;
export type GamesDisplayGroupValue = (typeof GAMES_DISPLAY_GROUP_VALUES)[number];
export type GamesCategory = GamesDisplayGroupValue;

/**
 * Urutan section Oura-style + label Indonesia. Urutan array ini adalah urutan
 * section di UI; UI hanya merender section yang tidak kosong.
 */
export const GAMES_CATEGORY_SECTIONS: readonly { key: GamesCategory; label: string }[] = Object.freeze([
  { key: "bestseller", label: "Terlaris" },
  { key: "special", label: "Spesial" },
  { key: "promo", label: "Promo" },
  { key: "first_topup", label: "Top up pertama" },
  { key: "pass", label: "Pass & membership" },
  { key: "pack", label: "Paket mingguan/bulanan" },
  { key: "topup", label: "Top up" },
  { key: "other", label: "Lainnya" },
] as const);

export const GAMES_CATEGORY_ORDER: readonly GamesCategory[] = Object.freeze(
  GAMES_CATEGORY_SECTIONS.map((section) => section.key),
);

const CATEGORY_LABELS = new Map<GamesCategory, string>(
  GAMES_CATEGORY_SECTIONS.map((section) => [section.key, section.label]),
);

export function gamesCategoryLabel(key: GamesCategory): string {
  return CATEGORY_LABELS.get(key) ?? "Lainnya";
}

export const isGamesDisplayGroupValue = (value: unknown): value is GamesDisplayGroupValue =>
  typeof value === "string" && (GAMES_DISPLAY_GROUP_VALUES as readonly string[]).includes(value);

/** Aturan otomatis B6; selalu menghasilkan kategori (fallback `other`). */
const FIRST_TOPUP = /first top ?up|top ?up pertama|isi ulang pertama|double diamond/i;
const PASS = /weekly|twilight|starlight|startlight|\bpass\b|member|wdp/i;
const PACK = /\bpack\b|bundle|elite|epic|paket/i;
const QUANTITY = /\d/;
// Token pendek memakai batas kata agar tidak cocok di tengah kata (mis. "uc" di
// "Voucher"); token panjang aman sebagai substring.
const CURRENCY = /\b(?:uc|vp|cp|gold)\b|diamond|platinum|echoes?|\bcore\b|crystal|genesis|token|coin|gem|point|shell|primogem|oneiric|candy|robux|zems?|credits?|shards?|tickets?|badges?/i;

export function gamesAutoCategory(input: { productName?: unknown; productTypeName?: unknown }): GamesCategory {
  const name = String(input.productName ?? "").trim();
  if (FIRST_TOPUP.test(name)) return "first_topup";
  if (PASS.test(name)) return "pass";
  if (PACK.test(name)) return "pack";
  if (QUANTITY.test(name) && CURRENCY.test(name)) return "topup";
  return "other";
}

/** Override admin menang; nilai asing/legacy dianggap belum diset. */
export function gamesEffectiveCategory(input: {
  displayGroup?: unknown;
  productName?: unknown;
  productTypeName?: unknown;
}): GamesCategory {
  const stored = String(input.displayGroup ?? "").trim().toLowerCase();
  if (isGamesDisplayGroupValue(stored)) return stored;
  return gamesAutoCategory(input);
}

/** Ejaan Indonesia untuk tipe supplier; DIGITAL/kosong tidak ditampilkan. */
const TYPE_LABELS: Record<string, string> = {
  philippines: "Filipina",
  filipina: "Filipina",
  russia: "Rusia",
  rusia: "Rusia",
  turkey: "Turki",
  turki: "Turki",
  singapore: "Singapura",
  singapura: "Singapura",
  brazil: "Brasil",
  brasil: "Brasil",
  // Sudah benar di Indonesia; dipetakan agar ejaan konsisten (Global/Indonesia/Malaysia/Membership).
};

/** Nama negara → ISO-2, dipakai `region_code` dan hint region storefront. */
const TYPE_REGIONS: Record<string, string> = {
  indonesia: "ID",
  indonesian: "ID",
  malaysia: "MY",
  singapore: "SG",
  singapura: "SG",
  philippines: "PH",
  filipina: "PH",
  brazil: "BR",
  brasil: "BR",
  russia: "RU",
  rusia: "RU",
  turkey: "TR",
  turki: "TR",
  thailand: "TH",
  usa: "US",
  "united states": "US",
  bangladesh: "BD",
  india: "IN",
  vietnam: "VN",
  global: "GLOBAL",
};

/** Label tipe untuk pembeli (null = tidak ditampilkan sebagai chip). */
export function gamesTypeLabel(typeName: unknown): string | null {
  const raw = String(typeName ?? "").trim();
  if (raw === "" || raw.toUpperCase() === "DIGITAL") return null;
  return TYPE_LABELS[raw.toLowerCase()] ?? raw;
}

/** ISO-2/"GLOBAL" hanya bila tipe varian adalah negara/global; selain itu null. */
export function gamesRegionCode(typeName: unknown): string | null {
  const raw = String(typeName ?? "").trim().toLowerCase();
  if (raw === "") return null;
  return TYPE_REGIONS[raw] ?? null;
}

/** Kebalikan `TYPE_REGIONS`: kode region → daftar nama tipe supplier. */
export const GAMES_REGION_TYPE_NAMES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.entries(TYPE_REGIONS).reduce<Record<string, string[]>>((map, [typeName, code]) => {
    (map[code] ??= []).push(typeName);
    return map;
  }, {}),
);

/** Nama tipe untuk filter region admin (null = kode region tidak dikenal). */
export function gamesRegionTypeNames(region: unknown): string[] | null {
  const code = String(region ?? "").trim().toUpperCase();
  const names = GAMES_REGION_TYPE_NAMES[code];
  return names ? [...names] : null;
}

/** Nickname SK berakhiran "(XX)" → ISO-2 (mis. "Sekalipay3121 (ID)" → "ID"). */
export function regionCodeFromNickname(nickname: unknown): string | null {
  const match = /\(([A-Za-z]{2})\)\s*$/.exec(String(nickname ?? ""));
  return match ? match[1].toUpperCase() : null;
}

/** Label field supplier → teks bersih ("User ID :" → "User ID"). */
export function cleanGamesFieldLabel(label: unknown): string {
  return String(label ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s:：]+$/u, "")
    .trim();
}

/**
 * Label generik yang tidak menjelaskan apa pun ke pembeli. Supplier kadang
 * memakai label ini untuk satu varian saja walau varian lain memakai label
 * bermakna untuk key yang sama.
 */
const GENERIC_FIELD_LABELS = new Set(["", "catatan", "note", "notes", "keterangan", "ket"]);

export function isGenericGamesFieldLabel(label: unknown): boolean {
  return GENERIC_FIELD_LABELS.has(cleanGamesFieldLabel(label).toLowerCase());
}

/**
 * Label mayoritas per key field di seluruh varian satu game. Label generik
 * diabaikan; tie dimenangkan label yang lebih dulu muncul. Key tanpa label
 * bermakna tidak masuk peta sehingga pemanggil tetap memakai label asli yang
 * sudah dibersihkan.
 */
export function gamesFieldLabelMajority(
  variants: Iterable<readonly { key: string; label: string }[]>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const fields of variants) {
    for (const field of fields) {
      const key = String(field.key ?? "").trim();
      if (key === "" || isGenericGamesFieldLabel(field.label)) continue;
      const label = cleanGamesFieldLabel(field.label);
      const byLabel = counts.get(key) ?? new Map<string, number>();
      byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
      counts.set(key, byLabel);
    }
  }
  const majority = new Map<string, string>();
  for (const [key, byLabel] of counts) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [label, count] of byLabel) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    if (best) majority.set(key, best);
  }
  return majority;
}
