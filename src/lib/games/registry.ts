// src/lib/games/registry.ts — registry 4 game gelombang 1 (docs/GAMES.md §12).
// Satu sumber untuk slug, brand Digiflazz, label field, regex input, dan cara
// menyusun customer_no. Validasi server WAJIB memakai registry ini; jangan
// menyalin regex ke route.
import { GAMES_WAVE1_BRANDS, normalizeBrand } from "./admin";

export type GamesCurrency = "diamond" | "uc";
export type GamesInputMode = "numeric" | "text";

export interface GamesFieldCopy {
  id: string;
  en: string;
}

export interface GamesField {
  key: string;
  label: GamesFieldCopy;
  inputMode: GamesInputMode;
  /** Regex sumber (anchored). Dipakai server dan boleh dipakai UI untuk hint. */
  pattern: string;
  min: number;
  max: number;
  hint: GamesFieldCopy;
}

export interface GamesDefinition {
  slug: string;
  /** Brand Digiflazz gelombang 1; dicocokkan case-insensitive + trim. */
  brands: string[];
  name: string;
  publisher: string;
  currency: GamesCurrency;
  fields: GamesField[];
  /** Susun customer_no Digiflazz dari field yang sudah tervalidasi. */
  buildCustomerNo(fields: Record<string, string>): string;
  /** Diisi paket terpisah; B1 belum punya endpoint cek nickname. */
  nicknameSku: null;
  icon: string | null;
  banner: string | null;
}

const digits = (min: number, max: number): Pick<GamesField, "pattern" | "min" | "max"> => ({
  pattern: `^\\d{${min},${max}}$`,
  min,
  max,
});

const PLAYER_ID_HINT: GamesFieldCopy = {
  id: "Tempel angka ID yang terlihat di profil game.",
  en: "Paste the numeric ID shown in the game profile.",
};

export const GAMES_REGISTRY: readonly GamesDefinition[] = Object.freeze([
  {
    slug: "free-fire",
    brands: [GAMES_WAVE1_BRANDS[0]],
    name: "Free Fire",
    publisher: "Garena",
    currency: "diamond",
    fields: [{
      key: "playerId",
      label: { id: "Player ID", en: "Player ID" },
      inputMode: "numeric",
      ...digits(6, 14),
      hint: PLAYER_ID_HINT,
    }],
    buildCustomerNo: (fields) => fields.playerId,
    nicknameSku: null,
    icon: null,
    banner: null,
  },
  {
    slug: "free-fire-max",
    brands: [GAMES_WAVE1_BRANDS[1]],
    name: "Free Fire MAX",
    publisher: "Garena",
    currency: "diamond",
    fields: [{
      key: "playerId",
      label: { id: "Player ID", en: "Player ID" },
      inputMode: "numeric",
      ...digits(6, 14),
      hint: PLAYER_ID_HINT,
    }],
    buildCustomerNo: (fields) => fields.playerId,
    nicknameSku: null,
    icon: null,
    banner: null,
  },
  {
    slug: "mobile-legends",
    brands: [GAMES_WAVE1_BRANDS[2]],
    name: "Mobile Legends",
    publisher: "Moonton",
    currency: "diamond",
    fields: [
      {
        key: "userId",
        label: { id: "User ID", en: "User ID" },
        inputMode: "numeric",
        ...digits(1, 12),
        hint: {
          id: "Angka di atas nama karakter (sebelum tanda kurung).",
          en: "The number above the character name (before the parentheses).",
        },
      },
      {
        key: "zoneId",
        label: { id: "Zone ID", en: "Zone ID" },
        inputMode: "numeric",
        ...digits(1, 6),
        hint: {
          id: "Angka di dalam tanda kurung, mis. (1234).",
          en: "The number inside the parentheses, e.g. (1234).",
        },
      },
    ],
    buildCustomerNo: (fields) => `${fields.userId}${fields.zoneId}`,
    nicknameSku: null,
    icon: null,
    banner: null,
  },
  {
    slug: "pubg-mobile",
    brands: [GAMES_WAVE1_BRANDS[3]],
    name: "PUBG Mobile",
    publisher: "Level Infinite",
    currency: "uc",
    fields: [{
      key: "playerId",
      label: { id: "Player ID", en: "Player ID" },
      inputMode: "numeric",
      ...digits(6, 15),
      hint: PLAYER_ID_HINT,
    }],
    buildCustomerNo: (fields) => fields.playerId,
    nicknameSku: null,
    icon: null,
    banner: null,
  },
]);

const BY_SLUG = new Map(GAMES_REGISTRY.map((game) => [game.slug, game]));

export function gamesRegistryGame(slug: unknown): GamesDefinition | null {
  return BY_SLUG.get(String(slug ?? "").trim().toLowerCase()) ?? null;
}

/** Game pemilik brand tertentu (case-insensitive). */
export function gamesGameForBrand(brand: unknown): GamesDefinition | null {
  const normalized = normalizeBrand(brand);
  if (!normalized) return null;
  return GAMES_REGISTRY.find((game) => game.brands.some((b) => normalizeBrand(b) === normalized)) ?? null;
}

export function gamesBrandMatches(game: GamesDefinition, brand: unknown): boolean {
  const normalized = normalizeBrand(brand);
  return Boolean(normalized) && game.brands.some((b) => normalizeBrand(b) === normalized);
}

export type GamesFieldsResult =
  | { ok: true; customerNo: string; values: Record<string, string> }
  | { ok: false; field: string | null; message: GamesFieldCopy };

/** Validasi server field game. Hanya key registry yang dibaca; nilai harus
 * string/angka dan cocok dengan regex/length registry. */
export function validateGamesFields(game: GamesDefinition, input: unknown): GamesFieldsResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      field: null,
      message: { id: "Data akun tidak valid.", en: "The account details are invalid." },
    };
  }
  const source = input as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const field of game.fields) {
    const raw = source[field.key];
    if (typeof raw !== "string" && typeof raw !== "number") {
      return {
        ok: false,
        field: field.key,
        message: { id: `${field.label.id} wajib diisi.`, en: `${field.label.en} is required.` },
      };
    }
    const value = String(raw).trim();
    if (value === "") {
      return {
        ok: false,
        field: field.key,
        message: { id: `${field.label.id} wajib diisi.`, en: `${field.label.en} is required.` },
      };
    }
    const pattern = new RegExp(field.pattern);
    if (value.length < field.min || value.length > field.max || !pattern.test(value)) {
      return {
        ok: false,
        field: field.key,
        message: { id: `${field.label.id} tidak valid.`, en: `${field.label.en} is invalid.` },
      };
    }
    values[field.key] = value;
  }
  const customerNo = String(game.buildCustomerNo(values) ?? "").trim();
  if (!/^\d{1,32}$/.test(customerNo)) {
    return {
      ok: false,
      field: null,
      message: { id: "Data akun tidak valid.", en: "The account details are invalid." },
    };
  }
  return { ok: true, customerNo, values };
}

/** Bentuk game yang aman dipublikasikan (tanpa fungsi builder). */
export function publicGamesGame(game: GamesDefinition) {
  return {
    slug: game.slug,
    name: game.name,
    publisher: game.publisher,
    currency: game.currency,
    icon: game.icon,
    banner: game.banner,
    fields: game.fields.map((field) => ({
      key: field.key,
      label: field.label,
      inputMode: field.inputMode,
      pattern: field.pattern,
      min: field.min,
      max: field.max,
      hint: field.hint,
    })),
  };
}
