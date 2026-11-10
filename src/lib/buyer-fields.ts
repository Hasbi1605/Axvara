import { z } from "zod";

export const buyerFieldsSchema = z.object({ muse_invite_code: z.string().trim().regex(/^[A-Za-z0-9]{6}$/, "Kode Invite Muse harus 6 huruf/angka ASCII.").optional() }).strict();
export type BuyerFields = z.infer<typeof buyerFieldsSchema>;
export type BuyerFieldSnapshot = { buyer_field_key?: "muse_invite_code" | null; buyer_fields?: BuyerFields; max_qty?: number | null };
export const buyerFieldLabel = (locale = "id") => locale === "en" ? "Muse invite code" : "Kode Invite Muse";

/** Values never enter public listings, URLs, notices or email templates. */
export function validateBuyerFields(config: { buyer_field_key?: unknown; max_qty?: unknown }, fields: unknown, qty: number): BuyerFields {
  const parsed = buyerFieldsSchema.parse(fields ?? {});
  const cap = config.max_qty == null ? 100 : Number(config.max_qty);
  if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(cap) || cap < 1 || qty > cap) throw new Error(`Maksimal ${cap} unit per varian.`);
  if (config.buyer_field_key == null) {
    if (Object.keys(parsed).length) throw new Error("Konfigurasi input berubah. Muat ulang checkout.");
  } else if (config.buyer_field_key !== "muse_invite_code" || !parsed.muse_invite_code) {
    throw new Error("Kode Invite Muse wajib diisi (6 huruf/angka ASCII).");
  }
  return parsed;
}

export function assertSameBuyerCode(items: { buyer_fields?: BuyerFields }[]): void {
  const codes = new Set(items.flatMap(item => item.buyer_fields?.muse_invite_code ? [item.buyer_fields.muse_invite_code.trim()] : []));
  if (codes.size > 1) throw new Error("Gunakan satu Kode Invite Muse per checkout. Buat checkout terpisah untuk kode lain.");
}

export function buyerSnapshotMatches(a: BuyerFieldSnapshot, b: BuyerFieldSnapshot): boolean {
  return (a.buyer_field_key ?? null) === (b.buyer_field_key ?? null)
    && (a.max_qty ?? null) === (b.max_qty ?? null)
    && (a.buyer_fields?.muse_invite_code?.trim() ?? "") === (b.buyer_fields?.muse_invite_code?.trim() ?? "");
}

export type TunvnEligibility = { version: 1; kind: "account" | "buff"; source_product_id: number | null; source_variant_id: number; source_unit_b: number | null; quantity: number; cost_usdt?: number };
export function withoutPrivateBuyerData(items: unknown[]): unknown[] {
  return items.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const publicItem = { ...raw } as Record<string,unknown>;
    delete publicItem.buyer_fields;
    delete publicItem.tunvn_eligibility;
    return publicItem;
  });
}
/** Server-only opt-in for new, current identities; legacy bundles never qualify. */
export function tunvnEligibility(row: Record<string, unknown>, qty: number): TunvnEligibility | undefined {
  const sku = String(row.sku ?? "");
  const account = (sku === "TUNVN-86" || sku === "TUNVN-83") && row.product_slug === "chatgpt-tunvn";
  const buff = sku === "TUNVN-BUFF-1B" && row.product_slug === "muse-ai-1-miliar-token"
    && Number(row.tunvn_buff_quantity_b) === 1 && row.buyer_field_key === "muse_invite_code" && Number(row.max_qty) === 30;
  if (!account && !buff) return undefined;
  const cost = Number(account ? row.tunvn_source_cost_usdt : row.tunvn_cost_usdt);
  return { version: 1, kind: buff ? "buff" : "account", source_product_id: account ? Number(sku.slice(6)) : null, source_variant_id: Number(row.id), source_unit_b: buff ? 1 : null, quantity: qty,
    ...(Number.isFinite(cost) && cost > 0 ? { cost_usdt: Math.round(cost * qty * 10000) / 10000 } : {}) };
}
