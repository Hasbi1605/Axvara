// src/lib/games/registry.ts — registry 4 game gelombang 1 (docs/GAMES.md §12).
// Satu sumber untuk slug, brand Digiflazz, label field, regex input, dan cara
// menyusun customer_no. Validasi server WAJIB memakai registry ini; jangan
// menyalin regex ke route.
import { GAMES_WAVE1_BRANDS, normalizeBrand } from "./admin";

export type GamesCurrency = "diamond" | "uc" | "topup";
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
  nicknameSku: string;
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
    nicknameSku: "ffcekusername",
    icon: "/brand/games/free-fire-icon.webp",
    banner: "/brand/games/free-fire-banner.webp",
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
    nicknameSku: "ffcekusername",
    icon: "/brand/games/free-fire-max-icon.webp",
    banner: "/brand/games/free-fire-max-banner.webp",
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
    nicknameSku: "mlcekusername",
    icon: "/brand/games/mobile-legends-icon.webp",
    banner: "/brand/games/mobile-legends-banner.webp",
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
    nicknameSku: "pubgcekusername",
    icon: "/brand/games/pubg-mobile-icon.webp",
    banner: "/brand/games/pubg-mobile-banner.webp",
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

// ── Sekalipay H2H (P1): slug, kontrak field per-varian, aset ──────────────
// Registry di atas tetap sumber override 4 game lama (slug/ikon/banner).
// Game SK lain diresolusi dari DB: slug stabil dari nama produk supplier,
// field dari `required_fields_json` per varian — bukan regex yang ditebak.

/** Batas panjang note (kontrak supplier: note H2H maks 50 karakter). */
export const GAMES_SK_NOTE_MAX = 50;
/** Batas panjang zone/server id yang wajar untuk input teks. */
export const GAMES_SK_ZONE_MAX = 20;
const GAMES_SK_LABEL_MAX = 40;
const SK_IMAGE_PREFIX = "https://sekalipay.com/images/products/";

export type GamesSkFieldKey = "note" | "zone_id";

export interface GamesSkContractField {
  key: GamesSkFieldKey;
  label: string;
  required: boolean;
  /** Selalu teks: ID/server sah bisa memuat huruf, spasi, #, atau tanda baca. */
  input: "text";
  min: number;
  max: number;
}

/**
 * Kontrak input per varian hasil normalisasi sync. `supported=false` berarti
 * varian tetap diimpor/ditampilkan tetapi tidak boleh dibeli (open denom,
 * key tak dikenal, order process non-H2H, dsb).
 */
export interface GamesSkContract {
  version: 1;
  fields: GamesSkContractField[];
  requires_zone_id: boolean;
  validation_available: boolean;
  open_denom: boolean;
  supported: boolean;
  reason: string | null;
}

/** Slug deterministik dari nama produk: "Pubg Mobile" → "pubg-mobile". */
export function gamesSlugify(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Hanya URL gambar produk Sekalipay yang eksak; selain itu null (initials). */
export function sanitizeSkImageUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (raw === "" || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.hostname.toLowerCase() !== "sekalipay.com") return null;
  if (url.search || url.hash) return null;
  if (!url.pathname.startsWith("/images/products/")) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(url.pathname)) return null;
  return `${url.origin}${url.pathname}`;
}

/** Prefix aset yang diizinkan (dipakai test/UI, bukan untuk fetch server). */
export function isAllowedSkImageUrl(value: unknown): boolean {
  return sanitizeSkImageUrl(value) !== null && String(value).startsWith(SK_IMAGE_PREFIX);
}

const SK_FIELD_KEYS = new Set<GamesSkFieldKey>(["note", "zone_id"]);

function parseSkContractFields(value: unknown): GamesSkContractField[] | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const out: GamesSkContractField[] = [];
  const seen = new Set<GamesSkFieldKey>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const field = item as Record<string, unknown>;
    const key = String(field.key ?? "").trim().toLowerCase() as GamesSkFieldKey;
    if (!SK_FIELD_KEYS.has(key)) return null;
    if (seen.has(key)) return null;
    seen.add(key);
    if (typeof field.label !== "string" || field.label.trim() === "") return null;
    if (typeof field.required !== "boolean") return null;
    if (field.input !== "text") return null;
    if (!Number.isInteger(field.min) || !Number.isInteger(field.max)) return null;
    const min = Number(field.min);
    const max = Number(field.max);
    if (min < 1 || max < min) return null;
    if (key === "note" && max > GAMES_SK_NOTE_MAX) return null;
    if (key === "zone_id" && max > GAMES_SK_ZONE_MAX) return null;
    out.push({ key, label: field.label.trim().slice(0, GAMES_SK_LABEL_MAX), required: field.required, input: "text", min, max });
  }
  return out;
}

/** Parse `required_fields_json` dari DB; null bila bentuknya rusak/tidak konsisten. */
export function parseGamesSkContract(value: unknown): GamesSkContract | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1 || typeof record.supported !== "boolean") return null;
  const requiresZone = record.requires_zone_id;
  const validationAvailable = record.validation_available;
  const openDenom = record.open_denom;
  if (typeof requiresZone !== "boolean" || typeof validationAvailable !== "boolean" || typeof openDenom !== "boolean") return null;
  if (record.reason !== null && typeof record.reason !== "string") return null;
  const supported = record.supported;
  const reason = typeof record.reason === "string" ? record.reason : null;
  // `supported` tidak boleh bertentangan dengan reason/open denom/field wajib.
  if (supported !== (reason === null)) return null;
  const fields = parseSkContractFields(record.fields);
  if (!fields) return null;
  const note = fields.find((field) => field.key === "note");
  const zone = fields.find((field) => field.key === "zone_id");
  if (supported) {
    if (openDenom || !note) return null;
    if (requiresZone && (!zone || !zone.required)) return null;
  }
  return {
    version: 1,
    fields,
    requires_zone_id: requiresZone,
    validation_available: validationAvailable,
    open_denom: openDenom,
    supported,
    reason,
  };
}

export interface GamesSkPurchasableRow {
  supplier?: unknown;
  supplier_active?: unknown;
  stock?: unknown;
  min_order?: unknown;
  cost?: unknown;
  sell_price?: unknown;
  required_fields_json?: unknown;
}

/**
 * Dapat dibeli: varian SK aktif, stok > 0, qty 1, modal/harga valid, dan
 * kontrak field didukung. Varian off/stok0/min_order>1/open denom tetap
 * tampil tetapi `available:false`.
 */
export function gamesSkRowPurchasable(row: GamesSkPurchasableRow): boolean {
  if (String(row.supplier ?? "") !== "sekalipay") return false;
  if (Number(row.supplier_active) !== 1) return false;
  const stock = Number(row.stock);
  if (!(stock === -1 || stock > 0)) return false;
  if (Number(row.min_order) !== 1) return false;
  if (!(Number(row.cost) > 0)) return false;
  if (!(Number(row.sell_price) > 0)) return false;
  return parseGamesSkContract(row.required_fields_json)?.supported === true;
}

// ── Target pembeli SK (nilai yang benar-benar dikirim) ────────────────────
// Target disimpan sebagai snapshot di order/item; dispatch tidak pernah
// menyusun ulang dari `customer_no` atau menebak key.

export interface GamesSkTarget {
  note: string;
  zone_id?: string;
}

export type GamesSkTargetResult =
  | { ok: true; target: GamesSkTarget; display: string; fields: Record<string, string> }
  | { ok: false; field: string | null; reason: "missing" | "invalid" | "unknown_field" | "unsupported" };

const CONTROL = /[\u0000-\u001f\u007f]/;
export const GAMES_SK_TARGET_PATTERN = /^[\p{L}\p{N}._@+#\- ]{1,50}(?:\|[\p{L}\p{N}._@+#\- ]{1,20})?$/u;

const targetValue = (raw: unknown): string | null => {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
};

/**
 * Validasi input pembeli terhadap kontrak varian. Hanya key kontrak yang
 * diterima; nilai harus teks/angka, tanpa kontrol, panjang sesuai kontrak.
 * `zone_id` tetap terpisah (tidak pernah digabung ke note).
 */
export function validateGamesSkTarget(contract: GamesSkContract, input: unknown): GamesSkTargetResult {
  if (!contract.supported || contract.open_denom) return { ok: false, field: null, reason: "unsupported" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: null, reason: "invalid" };
  const source = input as Record<string, unknown>;
  const allowed = new Set(contract.fields.map((field) => field.key));
  for (const key of Object.keys(source)) {
    if (!allowed.has(key as GamesSkFieldKey)) return { ok: false, field: key, reason: "unknown_field" };
  }
  const values: Record<string, string> = {};
  const target: Partial<GamesSkTarget> = {};
  for (const field of contract.fields) {
    const raw = source[field.key];
    if (raw === undefined || raw === null || raw === "") {
      if (field.required) return { ok: false, field: field.key, reason: "missing" };
      continue;
    }
    const value = targetValue(raw);
    if (value === null) return { ok: false, field: field.key, reason: "invalid" };
    const trimmed = value.trim();
    if (trimmed === "") {
      if (field.required) return { ok: false, field: field.key, reason: "missing" };
      continue;
    }
    if (CONTROL.test(trimmed) || trimmed.length < field.min || trimmed.length > field.max) {
      return { ok: false, field: field.key, reason: "invalid" };
    }
    values[field.key] = trimmed;
    if (field.key === "note") target.note = trimmed;
    else target.zone_id = trimmed;
  }
  if (!target.note) return { ok: false, field: "note", reason: "missing" };
  if (contract.requires_zone_id && !target.zone_id) return { ok: false, field: "zone_id", reason: "missing" };
  const display = target.zone_id ? `${target.note}|${target.zone_id}` : target.note;
  if (!GAMES_SK_TARGET_PATTERN.test(display)) return { ok: false, field: null, reason: "invalid" };
  return { ok: true, target: target as GamesSkTarget, display, fields: values };
}

/** Snapshot target dari DB; struktural saja, pemanggil tetap memvalidasi kontrak. */
export function parseGamesSkTargetSnapshot(value: unknown): GamesSkTarget | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.note !== "string" || record.note.trim() === "") return null;
  if (record.zone_id !== undefined && typeof record.zone_id !== "string") return null;
  return {
    note: record.note.trim(),
    ...(typeof record.zone_id === "string" && record.zone_id.trim() !== "" ? { zone_id: record.zone_id.trim() } : {}),
  };
}

export function isGamesSkCustomerNo(value: unknown): boolean {
  return typeof value === "string" && GAMES_SK_TARGET_PATTERN.test(value);
}

/** Digest kontrak untuk mengikat quote → order (perubahan kontrak = quote_stale). */
export async function gamesSkContractDigest(value: unknown): Promise<string> {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
