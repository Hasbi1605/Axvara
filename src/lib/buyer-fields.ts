import { z } from "zod";
export { miraiEligibility, type MiraiEligibility } from "@/lib/mirai/purchase";

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
