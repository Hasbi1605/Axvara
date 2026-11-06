export type BulkTier = { min_qty: number; unit_price: number };
export type BulkPricing = { enabled: boolean; tiers: BulkTier[] };

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

export function resolveBulkPrice(base: number, quantity: number, enabled: unknown, serialized: unknown): { price: number; tier?: number } {
  if (Number(enabled) === 0) return { price: bulkUnitPrice(base, quantity, { enabled: false, tiers: [] }) };
  if (Number(enabled) !== 1 || typeof serialized !== "string") throw new Error("bulk_pricing_invalid");
  const config = validateBulkPricing({ enabled: true, tiers: JSON.parse(serialized) }, base);
  if (!config) throw new Error("bulk_pricing_invalid");
  return { price: bulkUnitPrice(base, quantity, config), tier: config.tiers.filter((row) => row.min_qty <= quantity).at(-1)?.min_qty };
}
