export type BulkTier = { min_qty: number; unit_price: number };
export type BulkPricing = { enabled: boolean; tiers: BulkTier[] };

/**
 * Kepemilikan produk untuk harga grosir (keputusan owner 2026-11-08, direvisi
 * 2026-11-17): grosir berlaku untuk produk manual dan varian supplier AIVault
 * (AIVault memakai `source='manual'` tanpa ID/flag WR/SK, namun tier grosirnya
 * dikelola di menu AIVault → Markup berbasis markup %). Tetap dilarang untuk
 * supplier WR/Sekalipay-SK (ditandai `source != 'manual'`,
 * `wr_product_id`/`sk_product_id` terisi, atau flag auto-managed = 1).
 */
export type BulkProductOwner = {
  source?: unknown;
  wrProductId?: unknown;
  wrAutoManaged?: unknown;
  skProductId?: unknown;
  skAutoManaged?: unknown;
};

function hasValue(value: unknown): boolean {
  return value != null && String(value).trim() !== "";
}

/** Baris `products` apa adanya (snake_case) → identitas kepemilikan. */
export function bulkOwnerFromProductRow(row: Record<string, unknown> | null | undefined): BulkProductOwner | null {
  if (!row) return null;
  return {
    source: row.source,
    wrProductId: row.wr_product_id,
    wrAutoManaged: row.wr_auto_managed,
    skProductId: row.sk_product_id,
    skAutoManaged: row.sk_auto_managed,
  };
}

/** Baris varian hasil JOIN products dengan alias `p_*` → identitas kepemilikan. */
export function bulkOwnerFromJoinedRow(row: Record<string, unknown> | null | undefined): BulkProductOwner | null {
  if (!row) return null;
  return {
    source: row.p_source,
    wrProductId: row.p_wr_product_id,
    wrAutoManaged: row.p_wr_auto_managed,
    skProductId: row.p_sk_product_id,
    skAutoManaged: row.p_sk_auto_managed,
  };
}

/**
 * `true` untuk produk manual serta produk AIVault (`source='manual'` tanpa
 * identitas WR/SK), sehingga storefront/quote/order/Telegram membaca
 * `bulk_pricing_*` tersimpan. Baris tanpa identitas dianggap bukan manual (fail-closed).
 */
export function isManualProductForBulk(owner: BulkProductOwner | null | undefined): boolean {
  if (!owner) return false;
  if (String(owner.source ?? "manual") !== "manual") return false;
  if (hasValue(owner.wrProductId) || Number(owner.wrAutoManaged ?? 0) === 1) return false;
  if (hasValue(owner.skProductId) || Number(owner.skAutoManaged ?? 0) === 1) return false;
  return true;
}

/**
 * `resolveBulkPrice` yang mengabaikan konfigurasi tersimpan pada produk
 * supplier, sehingga data lama di varian WR/SK tidak pernah menurunkan harga.
 */
export function resolveBulkPriceForProduct(
  base: number,
  quantity: number,
  enabled: unknown,
  serialized: unknown,
  owner: BulkProductOwner | null | undefined,
): { price: number; tier?: number } {
  if (!isManualProductForBulk(owner)) return resolveBulkPrice(base, quantity, 0, serialized);
  return resolveBulkPrice(base, quantity, enabled, serialized);
}

// ponytail: five tiers is the current editor ceiling; raise schema and validation together when expanded.
// Disabled menyimpan tiers yang valid-vs-bentuk SAJA (tanpa cek vs base);
// enabled / re-enable / base-change WAJIB lolos vs base HASIL (cek ketat di
// route admin: tier > base => 400). Jangan andalkan helper longgar ini untuk
// active config tanpa cek tambahan.
export function validateBulkPricing(input: unknown, basePrice: number): BulkPricing | null {
  if (!Number.isSafeInteger(basePrice) || basePrice < 0 || !input || typeof input !== "object" || Array.isArray(input)) return null;
  const config = input as Record<string, unknown>;
  if (typeof config.enabled !== "boolean" || !Array.isArray(config.tiers) || config.tiers.length > 5) return null;
  // Disabled menyimpan tiers apa adanya (retain): validasi bentuk SAJA
  // (5-baris, qty unik-naik, harga positif non-naik); harga-vs-base hanya
  // ditegakkan saat enabled (re-enable/base-change validates vs base hasil).
  const structuralOnly = config.enabled === false;
  let lastQty = 1, lastPrice = structuralOnly ? Number.MAX_SAFE_INTEGER : basePrice;
  const tiers: BulkTier[] = [];
  for (const item of config.tiers) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || !Number.isSafeInteger(row.min_qty) || Number(row.min_qty) <= lastQty
      || !Number.isSafeInteger(row.unit_price) || Number(row.unit_price) <= 0 || Number(row.unit_price) > lastPrice) return null;
    lastQty = Number(row.min_qty); lastPrice = Number(row.unit_price);
    tiers.push({ min_qty: lastQty, unit_price: lastPrice });
  }
  if (config.enabled && tiers.length === 0) return null;
  // Disabled menyimpan tiers yang vs base HASIL tidak valid: tidak dipakai
  // (resolveBulkPrice short-circuit enabled=0), tapi re-enable/base-change
  // WAJIB revalidate vs base hasil sebelum tulis (lihat PUT admin).
  return { enabled: config.enabled, tiers };
}

export function bulkUnitPrice(basePrice: number, quantity: number, input: unknown): number {
  const config = validateBulkPricing(input, basePrice);
  if (!config || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error("bulk_pricing_invalid");
  const price = config.enabled ? config.tiers.reduce((current, tier) => quantity >= tier.min_qty ? tier.unit_price : current, basePrice) : basePrice;
  if (!Number.isSafeInteger(price * quantity)) throw new Error("bulk_pricing_total_overflow");
  return price;
}

export const AIVAULT_BULK_MANAGED_MESSAGE = "Harga grosir AIVault diatur di menu AIVault → Markup.";

/** Cek apakah payload `bulk_pricing` mengubah konfigurasi tersimpan pada varian. */
export function bulkConfigDiffersFromStored(
  incoming: { enabled?: unknown; tiers?: unknown } | undefined,
  storedRow: Record<string, unknown> | null | undefined,
): boolean {
  if (incoming === undefined) return false;
  const storedEnabled = Number(storedRow?.bulk_pricing_enabled ?? 0) === 1;
  let storedTiers: unknown = [];
  try {
    storedTiers = JSON.parse(String(storedRow?.bulk_pricing_tiers ?? "[]"));
  } catch {
    return true;
  }
  if (!Array.isArray(storedTiers)) return true;
  if (incoming.enabled !== storedEnabled) return true;
  if (!Array.isArray(incoming.tiers)) return true;
  if (incoming.tiers.length !== storedTiers.length) return true;
  return incoming.tiers.some((t, idx) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) return true;
    const a = t as Record<string, unknown>;
    const b = storedTiers[idx] as Record<string, unknown>;
    return Object.keys(a).length !== 2 || a.min_qty !== b?.min_qty || a.unit_price !== b?.unit_price;
  });
}

export function resolveBulkPrice(base: number, quantity: number, enabled: unknown, serialized: unknown): { price: number; tier?: number } {
  if (Number(enabled) === 0) return { price: bulkUnitPrice(base, quantity, { enabled: false, tiers: [] }) };
  if (Number(enabled) !== 1 || typeof serialized !== "string") throw new Error("bulk_pricing_invalid");
  const config = validateBulkPricing({ enabled: true, tiers: JSON.parse(serialized) }, base);
  if (!config) throw new Error("bulk_pricing_invalid");
  return { price: bulkUnitPrice(base, quantity, config), tier: config.tiers.filter((row) => row.min_qty <= quantity).at(-1)?.min_qty };
}
