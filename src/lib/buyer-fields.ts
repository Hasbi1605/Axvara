import { z } from "zod";
import { miraiEligibility } from "@/lib/mirai/purchase";
export { miraiEligibility, type MiraiEligibility } from "@/lib/mirai/purchase";
import { parsePixelverifInput } from "@/lib/pixelverif/purchase";
export { pixelverifEligibility, parsePixelverifInput, type PixelverifEligibility, type PixelverifInput } from "@/lib/pixelverif/purchase";

export const BUYER_FIELD_KEYS = ["muse_invite_code", "invite_email", "custom"] as const;
export type BuyerFieldKey = (typeof BUYER_FIELD_KEYS)[number];
export const buyerFieldKeySchema = z.enum(BUYER_FIELD_KEYS);
export const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CUSTOM_BUYER_FIELD_TYPES = ["text", "email", "password", "textarea"] as const;
export type CustomBuyerFieldType = (typeof CUSTOM_BUYER_FIELD_TYPES)[number];

export const customBuyerFieldDefSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, "Key kolom harus huruf kecil, angka, atau underscore (1–40 karakter)."),
  label: z.string().trim().min(1, "Label kolom wajib diisi.").max(60, "Label kolom maksimal 60 karakter."),
  type: z.enum(CUSTOM_BUYER_FIELD_TYPES).default("text"),
  placeholder: z.string().trim().max(80, "Placeholder maksimal 80 karakter.").optional(),
  helper: z.string().trim().max(120, "Keterangan maksimal 120 karakter.").optional(),
  required: z.boolean().optional().default(true),
}).strict();

export const customBuyerFieldsConfigSchema = z.object({
  title: z.string().trim().max(80, "Judul seksi maksimal 80 karakter.").optional(),
  note: z.string().trim().max(160, "Catatan singkat maksimal 160 karakter.").optional(),
  fields: z.array(customBuyerFieldDefSchema).min(1, "Minimal 1 kolom khusus.").max(6, "Maksimal 6 kolom khusus per varian."),
}).strict().superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  cfg.fields.forEach((f, idx) => {
    if (seen.has(f.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", idx, "key"], message: `Key "${f.key}" duplikat.` });
    }
    seen.add(f.key);
  });
});

export type CustomBuyerFieldDef = z.infer<typeof customBuyerFieldDefSchema>;
export type CustomBuyerFieldsConfig = z.infer<typeof customBuyerFieldsConfigSchema>;

export const CUSTOM_FIELD_TEMPLATES: { id: string; name: string; config: CustomBuyerFieldsConfig }[] = [
  {
    id: "invite_email",
    name: "Email Invite",
    config: {
      title: "Data Invite",
      note: "Masukkan email akun yang akan menerima undangan paket ini.",
      fields: [{ key: "invite_email", label: "Email yang ingin di-invite", type: "email", placeholder: "nama@gmail.com", required: true }],
    },
  },
  {
    id: "account_login",
    name: "Login Akun",
    config: {
      title: "Data Akun untuk Aktivasi",
      note: "Data hanya dipakai oleh admin untuk memproses aktivasi akun kamu.",
      fields: [
        { key: "account_email", label: "Email akun", type: "email", placeholder: "nama@gmail.com", required: true },
        { key: "account_password", label: "Password akun", type: "password", placeholder: "Password login akun", required: true },
      ],
    },
  },
  {
    id: "gmail_2fa",
    name: "Aktivasi Akun + 2FA",
    config: {
      title: "Data Akun yang Diaktivasi",
      note: "Dipakai sekali oleh admin untuk proses aktivasi paket di akun kamu.",
      fields: [
        { key: "account_email", label: "Email Gmail", type: "email", placeholder: "nama@gmail.com", required: true },
        { key: "account_password", label: "Password Gmail", type: "password", placeholder: "Password login akun Google", required: true },
        { key: "totp_key", label: "Kunci Setup 2FA / Backup Code", type: "text", placeholder: "JBSW Y3DP EHPK 3PXP", required: true },
      ],
    },
  },
];

export function slugifyCustomFieldKey(label: string, fallbackIndex = 1): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return base || `kolom_${fallbackIndex}`;
}

export function parseCustomBuyerFieldsConfig(raw: unknown): CustomBuyerFieldsConfig | null {
  if (raw == null || raw === "") return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  const parsed = customBuyerFieldsConfigSchema.safeParse(obj);
  return parsed.success ? parsed.data : null;
}

export function serializeCustomBuyerFieldsConfig(raw: unknown): string {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = customBuyerFieldsConfigSchema.parse(obj);
  const cleaned: CustomBuyerFieldsConfig = {
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.note ? { note: parsed.note } : {}),
    fields: parsed.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.helper ? { helper: f.helper } : {}),
      required: f.required !== false,
    })),
  };
  const json = JSON.stringify(cleaned);
  if (json.length > 4096) throw new Error("Konfigurasi kolom khusus terlalu panjang (maks 4096 karakter).");
  return json;
}

export function normalizeBuyerFieldKey(raw: unknown): BuyerFieldKey | null {
  return raw === "muse_invite_code" || raw === "invite_email" || raw === "custom" ? raw : null;
}

export function resolveBuyerFieldKey(
  row: { buyer_field_key?: unknown; custom_buyer_field?: unknown } | null | undefined,
): BuyerFieldKey | null {
  return normalizeBuyerFieldKey(row?.buyer_field_key ?? row?.custom_buyer_field);
}

export function splitBuyerFieldKeyColumns(
  key: BuyerFieldKey | null,
  customFields?: unknown,
): {
  buyer_field_key: "muse_invite_code" | null;
  custom_buyer_field: "invite_email" | "custom" | null;
  custom_buyer_fields_json: string | null;
} {
  if (key === "muse_invite_code") {
    return { buyer_field_key: "muse_invite_code", custom_buyer_field: null, custom_buyer_fields_json: null };
  }
  if (key === "invite_email") {
    return { buyer_field_key: null, custom_buyer_field: "invite_email", custom_buyer_fields_json: null };
  }
  if (key === "custom") {
    return {
      buyer_field_key: null,
      custom_buyer_field: "custom",
      custom_buyer_fields_json: serializeCustomBuyerFieldsConfig(customFields),
    };
  }
  return { buyer_field_key: null, custom_buyer_field: null, custom_buyer_fields_json: null };
}

export const customValuesSchema = z.record(
  z.string().regex(/^[a-z0-9_]{1,40}$/),
  z.string().max(500),
).refine((obj) => Object.keys(obj).length <= 6, "Maksimal 6 kolom khusus.");

export const buyerFieldsSchema = z.object({
  muse_invite_code: z.string().trim().regex(/^[A-Za-z0-9]{6}$/, "Kode Invite Muse harus 6 huruf/angka ASCII.").optional(),
  invite_email: z.string().trim().toLowerCase().max(254).regex(INVITE_EMAIL_REGEX, "Format email yang ingin di-invite tidak valid.").optional(),
  custom_values: customValuesSchema.optional(),
  // Pixel Verification credentials: validated strictly in pixelverif/purchase.ts.
  // Kept as opaque strings here so validateBuyerFields can route per variant type.
  pv_email: z.string().trim().max(254).optional(),
  pv_password: z.string().max(200).optional(),
  pv_totp_secret: z.string().trim().max(120).optional(),
}).strict();
export type BuyerFields = z.infer<typeof buyerFieldsSchema>;
export type BuyerFieldSnapshot = { buyer_field_key?: BuyerFieldKey | null; buyer_fields?: BuyerFields; max_qty?: number | null };
export const buyerFieldLabel = (keyOrLocale: BuyerFieldKey | string = "id", locale?: string) => {
  if (keyOrLocale === "invite_email") return locale === "en" ? "Email to invite" : "Email yang ingin di-invite";
  if (keyOrLocale === "custom") return locale === "en" ? "Custom details" : "Data khusus";
  if (keyOrLocale === "muse_invite_code") return locale === "en" ? "Muse invite code" : "Kode Invite Muse";
  return keyOrLocale === "en" ? "Muse invite code" : "Kode Invite Muse";
};

export function validateCustomFieldValues(
  config: CustomBuyerFieldsConfig,
  rawValues: Record<string, string> | undefined,
): Record<string, string> {
  const input = rawValues ?? {};
  const allowedKeys = new Set(config.fields.map((f) => f.key));
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new Error("Konfigurasi kolom khusus berubah. Muat ulang checkout.");
  }
  const normalized: Record<string, string> = {};
  for (const field of config.fields) {
    const raw = input[field.key];
    const value = field.type === "password"
      ? String(raw ?? "")
      : field.type === "email"
        ? String(raw ?? "").trim().toLowerCase()
        : String(raw ?? "").trim();
    const isRequired = field.required !== false;
    if (!value) {
      if (isRequired) throw new Error(`${field.label} wajib diisi.`);
      continue;
    }
    if (field.type === "email" && (value.length > 254 || !INVITE_EMAIL_REGEX.test(value))) {
      throw new Error(`Format ${field.label} tidak valid.`);
    }
    if (value.length > 500) {
      throw new Error(`${field.label} terlalu panjang (maks 500 karakter).`);
    }
    normalized[field.key] = value;
  }
  return normalized;
}

export function canonicalizeCustomValues(values: Record<string, string> | undefined): string {
  if (!values) return "";
  const entries = Object.entries(values)
    .filter(([, v]) => v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.length ? JSON.stringify(entries) : "";
}

export async function computeCustomFieldsFingerprint(values: Record<string, string>): Promise<string> {
  const canonical = canonicalizeCustomValues(values);
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when the variant row is a Pixel Verification variant. */
export function isPixelverifVariantRow(config: { pixelverif_flow_type?: unknown }): boolean {
  return config.pixelverif_flow_type === "normal" || config.pixelverif_flow_type === "full";
}

/** Values never enter public listings, URLs, notices or email templates. */
export function validateBuyerFields(
  config: {
    buyer_field_key?: unknown;
    custom_buyer_field?: unknown;
    custom_buyer_fields_json?: unknown;
    custom_buyer_fields?: unknown;
    max_qty?: unknown;
    pixelverif_flow_type?: unknown;
  },
  fields: unknown,
  qty: number,
): BuyerFields {
  const parsed = buyerFieldsSchema.parse(fields ?? {});
  const cap = config.max_qty == null ? 100 : Number(config.max_qty);
  if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(cap) || cap < 1 || qty > cap) throw new Error(`Maksimal ${cap} unit per varian.`);
  if (isPixelverifVariantRow(config)) {
    // Pixel credentials are validated strictly here; foreign fields rejected.
    if (parsed.muse_invite_code || parsed.invite_email || parsed.custom_values) throw new Error("Konfigurasi input berubah. Muat ulang checkout.");
    const input = parsePixelverifInput(parsed);
    return { pv_email: input.pv_email, pv_password: input.pv_password, pv_totp_secret: input.pv_totp_secret };
  }
  if (parsed.pv_email || parsed.pv_password || parsed.pv_totp_secret) {
    throw new Error("Konfigurasi input berubah. Muat ulang checkout.");
  }
  const rawKey = config.buyer_field_key ?? config.custom_buyer_field;
  if (rawKey == null) {
    if (Object.keys(parsed).length) throw new Error("Konfigurasi input berubah. Muat ulang checkout.");
  } else if (rawKey === "muse_invite_code") {
    if (!parsed.muse_invite_code || parsed.invite_email || parsed.custom_values) throw new Error("Kode Invite Muse wajib diisi (6 huruf/angka ASCII).");
  } else if (rawKey === "invite_email") {
    if (!parsed.invite_email || parsed.muse_invite_code || parsed.custom_values) throw new Error("Email yang ingin di-invite wajib diisi.");
  } else if (rawKey === "custom") {
    if (parsed.muse_invite_code || parsed.invite_email) throw new Error("Konfigurasi input berubah. Muat ulang checkout.");
    const customConfig = parseCustomBuyerFieldsConfig(config.custom_buyer_fields ?? config.custom_buyer_fields_json);
    if (!customConfig) throw new Error("Konfigurasi kolom khusus tidak valid. Hubungi admin.");
    const normalized = validateCustomFieldValues(customConfig, parsed.custom_values);
    return { custom_values: normalized };
  } else {
    throw new Error("Konfigurasi input tidak dikenali. Muat ulang checkout.");
  }
  return parsed;
}


export function assertSameBuyerCode(items: { variant_id?: number; buyer_fields?: BuyerFields }[]): void {
  const codes = new Set(items.flatMap(item => item.buyer_fields?.muse_invite_code ? [item.buyer_fields.muse_invite_code.trim()] : []));
  if (codes.size > 1) throw new Error("Gunakan satu Kode Invite Muse per checkout. Buat checkout terpisah untuk kode lain.");
  const inviteEmails = new Set(items.flatMap(item => item.buyer_fields?.invite_email ? [item.buyer_fields.invite_email.trim().toLowerCase()] : []));
  if (inviteEmails.size > 1) throw new Error("Gunakan satu email invite per checkout. Buat checkout terpisah untuk email lain.");
  const customByVariant = new Map<number, string>();
  for (const item of items) {
    if (!item.buyer_fields?.custom_values) continue;
    const vid = Number(item.variant_id ?? 0);
    const sig = canonicalizeCustomValues(item.buyer_fields.custom_values);
    const prev = customByVariant.get(vid);
    if (prev !== undefined && prev !== sig) {
      throw new Error("Data khusus untuk varian yang sama tidak boleh berbeda dalam satu checkout.");
    }
    customByVariant.set(vid, sig);
  }
}

export function buyerSnapshotMatches(a: BuyerFieldSnapshot, b: BuyerFieldSnapshot): boolean {
  return (a.buyer_field_key ?? null) === (b.buyer_field_key ?? null)
    && (a.max_qty ?? null) === (b.max_qty ?? null)
    && (a.buyer_fields?.muse_invite_code?.trim() ?? "") === (b.buyer_fields?.muse_invite_code?.trim() ?? "")
    && (a.buyer_fields?.invite_email?.trim().toLowerCase() ?? "") === (b.buyer_fields?.invite_email?.trim().toLowerCase() ?? "")
    && canonicalizeCustomValues(a.buyer_fields?.custom_values) === canonicalizeCustomValues(b.buyer_fields?.custom_values)
    && (a.buyer_fields?.pv_email?.trim().toLowerCase() ?? "") === (b.buyer_fields?.pv_email?.trim().toLowerCase() ?? "")
    && (a.buyer_fields?.pv_password ?? "") === (b.buyer_fields?.pv_password ?? "")
    && (a.buyer_fields?.pv_totp_secret?.replace(/[\s-]/g, "").toUpperCase() ?? "") === (b.buyer_fields?.pv_totp_secret?.replace(/[\s-]/g, "").toUpperCase() ?? "");
}

export type TunvnEligibility = { version: 1; kind: "account" | "buff"; source_product_id: number | null; source_variant_id: number; source_unit_b: number | null; quantity: number; cost_usdt?: number };
export function withoutPrivateBuyerData(items: unknown[]): unknown[] {
  return items.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const publicItem = { ...raw } as Record<string,unknown>;
    delete publicItem.buyer_fields;
    delete publicItem.custom_buyer_fields_meta;
    delete publicItem.pixelverif_input;
    delete publicItem.pixelverif_fingerprint;
    delete publicItem.pixelverif_eligibility;
    delete publicItem.tunvn_eligibility;
    delete publicItem.aivault_eligibility;
    delete publicItem.storebat_eligibility;
    delete publicItem.mirai_eligibility;
    return publicItem;
  });
}
/** Server-only opt-in for new, current identities; legacy bundles never qualify.
 *
 * Revisi owner 15 Nov 2026: identitas varian akun = SKU `TUNVN-{id}` DAN
 * kolom durable `tunvn_source_product_id` yang sama (bukan slug produk) — jadi
 * setiap family TUNVN ikut otomatis, sedangkan baris lama/retired tidak.
 * #60 (API TEST) tidak pernah boleh dibeli. Buff tetap perilaku lama. */
export function tunvnEligibility(row: Record<string, unknown>, qty: number): TunvnEligibility | undefined {
  const sku = String(row.sku ?? "");
  const match = /^TUNVN-(\d+)$/.exec(sku);
  const sourceId = match ? Number(match[1]) : 0;
  const account = sourceId >= 1 && sourceId !== 60 && Number(row.tunvn_source_product_id) === sourceId;
  const buff = sku === "TUNVN-BUFF-1B" && row.product_slug === "muse-ai-1-miliar-token"
    && Number(row.tunvn_buff_quantity_b) === 1 && row.buyer_field_key === "muse_invite_code" && Number(row.max_qty) === 30;
  if (!account && !buff) return undefined;
  const cost = Number(account ? row.tunvn_source_cost_usdt : row.tunvn_cost_usdt);
  return { version: 1, kind: buff ? "buff" : "account", source_product_id: account ? sourceId : null, source_variant_id: Number(row.id), source_unit_b: buff ? 1 : null, quantity: qty,
    ...(Number.isFinite(cost) && cost > 0 ? { cost_usdt: Math.round(cost * qty * 10000) / 10000 } : {}) };
}

export type AivaultEligibility = { version: 1; service_id: string; source_variant_id: number; quantity: number; cost_usd?: number };
/** Only supplier-owned, separate AV variants may opt NEW orders into automatic delivery. */
export function aivaultEligibility(row: Record<string, unknown>, qty: number): AivaultEligibility | undefined {
  const service = row.aivault_service_id;
  if (typeof service !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(service) || row.sku !== `AV-${service}` || !row.aivault_family
    || !Number.isSafeInteger(Number(row.id)) || Number(row.id)<1 || !Number.isSafeInteger(qty) || qty<1 || qty>100) return undefined;
  const cost=Number(row.aivault_source_cost_usd);
  return { version:1,service_id:service,source_variant_id:Number(row.id),quantity:qty,
    ...(Number.isFinite(cost) && cost>0 ? {cost_usd:Math.round(cost*qty*1e8)/1e8} : {}) };
}

export type StorebatEligibility = { version: 1; kind: "product" | "muse_buff"; sku: string; product_id: number; family: string; source_variant_id: number; quantity: number; cost_usd?: number; fx_idr_per_usd?: number };
export function storebatEligibility(row: Record<string, unknown>, qty: number): StorebatEligibility | undefined {
  const id = Number(row.storebat_product_id), variant = Number(row.id), family = row.storebat_family;
  const buff = id === 124;
  const sku = buff ? "SB-BUFF" : `SB-${id}`;
  if (!Number.isSafeInteger(id) || id < 1 || id === 129 || id === 2147483000 || row.sku !== sku || typeof family !== "string" || !family
    || (buff && (family !== "muse-buff" || row.buyer_field_key !== "muse_invite_code" || Number(row.max_qty) !== 30))
    || !Number.isSafeInteger(variant) || variant < 1 || !Number.isSafeInteger(qty) || qty < 1 || qty > (buff ? 30 : 100)) return undefined;
  const unit = Number(row.storebat_cost_usd), fx = Number(row.storebat_fx_idr_per_usd), cost = unit * qty;
  return { version:1, kind:buff ? "muse_buff" : "product", sku, product_id:id, family, source_variant_id:variant, quantity:qty,
    ...(Number.isFinite(cost) && cost > 0 ? { cost_usd:cost } : {}), ...(Number.isFinite(fx) && fx > 0 ? { fx_idr_per_usd:fx } : {}) };
}

/** Buyer-facing catalog class, not an order admission or dispatch decision.
 * Pixel Verification is excluded here because it is queued + automatic_processing
 * ("Diproses otomatis", 1–5 min like WR Jaspay), not instant stock delivery. */
export function hasAutomaticSupplierDelivery(row: Record<string, unknown>, qty = 1): boolean {
  return Boolean(aivaultEligibility(row, qty) || storebatEligibility(row, qty) || miraiEligibility(row, qty) || tunvnEligibility(row, qty));
}
