// Matematika tampilan grosir (estimasi klien; server otoritatif).
import { describe, expect, it } from "vitest";
import { validateBulkPricing } from "@/lib/bulk-pricing";
import {
  activeTier, bulkRows, bulkUnitEstimate, nextReachableTier, quoteLineSavings, quoteTotalSavings,
  quoteVariantQty, safeBulkTiers, savePercent, tierLimitReason, tierPriceChanges, usableBulkTiers,
} from "@/lib/bulk-display";

const tiers = [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }];

describe("tier aktif all-units", () => {
  it("threshold-1, tepat di threshold, dan multi-tier memakai satuan tier tertinggi untuk semua unit", () => {
    expect(bulkUnitEstimate(10_000, tiers, 1)).toBe(10_000);
    expect(bulkUnitEstimate(10_000, tiers, 9)).toBe(10_000);
    expect(bulkUnitEstimate(10_000, tiers, 10)).toBe(9000);
    expect(bulkUnitEstimate(10_000, tiers, 49)).toBe(9000);
    expect(bulkUnitEstimate(10_000, tiers, 50)).toBe(8000);
    expect(bulkUnitEstimate(10_000, tiers, 100)).toBe(8000);
    // Total 50 pcs = 50 x 8000, bukan graduated.
    expect(bulkUnitEstimate(10_000, tiers, 50) * 50).toBe(400_000);
  });

  it("threshold boleh sama dengan Min. beli dan tier di bawah Min. beli berlaku sejak Min. beli", () => {
    const eq = [{ min_qty: 5, unit_price: 9000 }];
    expect(bulkRows(10_000, eq, 5)).toEqual([{ kind: "tier", start: 5, end: null, price: 9000, threshold: 5 }]);
    expect(bulkUnitEstimate(10_000, eq, 5)).toBe(9000);
    const rows = bulkRows(10_000, [{ min_qty: 2, unit_price: 9500 }, { min_qty: 3, unit_price: 9000 }, { min_qty: 20, unit_price: 8000 }], 5);
    expect(rows.map((r) => [r.kind, r.start, r.end])).toEqual([["tier", 5, 19], ["tier", 20, null]]);
  });

  it("baris dasar dimulai dari Min. beli varian", () => {
    expect(bulkRows(10_000, tiers, 1)[0]).toEqual({ kind: "base", start: 1, end: 9, price: 10_000 });
    expect(bulkRows(60_000, [{ min_qty: 100, unit_price: 55_000 }], 50)[0]).toEqual({ kind: "base", start: 50, end: 99, price: 60_000 });
  });
});

describe("config tidak valid tidak pernah memberi harga/hemat palsu", () => {
  const base = 10_000;
  it("disabled, invalid, korup, dan basi (tier > harga dasar) = tanpa tier", () => {
    expect(usableBulkTiers({ bulk_pricing_enabled: false, bulk_pricing_tiers: tiers }, base)).toEqual([]);
    expect(usableBulkTiers({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers, bulk_pricing_invalid: true }, base)).toEqual([]);
    expect(usableBulkTiers({}, base)).toEqual([]);
    expect(usableBulkTiers(undefined, base)).toEqual([]);
    expect(usableBulkTiers({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers }, 8500)).toEqual([]); // 9000 > 8500
    expect(bulkUnitEstimate(8500, tiers, 60)).toBe(8500);
    expect(safeBulkTiers(base, [{ min_qty: 1, unit_price: 9000 }])).toEqual([]);
    expect(safeBulkTiers(base, [{ min_qty: 10, unit_price: 9000.5 }])).toEqual([]);
    expect(safeBulkTiers(base, [{ min_qty: 10, unit_price: 9000, extra: 1 }])).toEqual([]);
    expect(safeBulkTiers(base, "nope")).toEqual([]);
    expect(usableBulkTiers({ bulk_pricing_enabled: true, bulk_pricing_tiers: tiers }, base)).toEqual(tiers);
  });

  it("selaras dengan validator server untuk config yang dipakai", () => {
    for (const config of [tiers, [{ min_qty: 2, unit_price: 10_000 }]]) {
      expect(safeBulkTiers(10_000, config).length > 0).toBe(validateBulkPricing({ enabled: true, tiers: config }, 10_000) !== null);
    }
  });
});

describe("tier berikutnya, batas, pembulatan", () => {
  it("hanya tier yang TERCAPAI yang dipromosikan; alasan stok vs plafon", () => {
    expect(nextReachableTier(tiers, 8, 100)).toEqual(tiers[0]);
    expect(nextReachableTier(tiers, 10, 100)).toEqual(tiers[1]);
    expect(nextReachableTier(tiers, 50, 100)).toBeNull();
    expect(nextReachableTier(tiers, 8, 30)).toEqual(tiers[0]);
    expect(nextReachableTier(tiers, 10, 30)).toBeNull(); // 50 > batas 30
    expect(nextReachableTier(tiers, 8, 9)).toBeNull();
    expect(tierLimitReason(tiers[1], { stockMax: 30, capMax: 100 })).toBe("stock");
    expect(tierLimitReason(tiers[1], { stockMax: -1, capMax: 10 })).toBe("cap");
    expect(tierLimitReason(tiers[1], { stockMax: -1, capMax: 100 })).toBeNull();
    expect(tierLimitReason(tiers[0], { stockMax: 5, capMax: 10 })).toBe("stock");
    expect(tierLimitReason(tiers[1], { stockMax: 80, capMax: 10 })).toBe("cap");
    expect(activeTier(tiers, 9)).toBeNull();
    expect(activeTier(tiers, 12)).toEqual(tiers[0]);
  });

  it("persen hemat dibulatkan, IDR bulat tanpa FX", () => {
    expect(savePercent(10_000, 9000)).toBe(10);
    expect(savePercent(3, 2)).toBe(33);
    expect(savePercent(10_000, 10_000)).toBe(0);
    expect(savePercent(0, 0)).toBe(0);
    expect(Number.isInteger(bulkUnitEstimate(9_999, [{ min_qty: 3, unit_price: 6_667 }], 7) * 7)).toBe(true);
  });
});

describe("quote server: hemat dan agregasi", () => {
  const lines = [
    { product_id: 1, variant_id: 11, price: 9000, base_price: 10_000, applied_tier_min_qty: 10, qty: 12 },
    { product_id: 1, variant_id: 12, price: 25_000, qty: 2 },
  ];
  it("hemat hanya bila tier berlaku; tanpa baris pengurang", () => {
    expect(quoteLineSavings(lines[0])).toBe(12_000);
    expect(quoteLineSavings(lines[1])).toBe(0);
    expect(quoteTotalSavings(lines)).toBe(12_000);
    expect(quoteLineSavings({ ...lines[0], applied_tier_min_qty: undefined })).toBe(0);
    expect(quoteLineSavings({ ...lines[0], base_price: 9000 })).toBe(0);
  });
  it("qty varian sama dijumlah, varian berbeda tidak", () => {
    const split = [{ ...lines[0], qty: 7 }, { ...lines[0], qty: 5 }, lines[1]];
    expect(quoteVariantQty(split, split[0])).toBe(12);
    expect(quoteVariantQty(split, split[2])).toBe(2);
  });
});

describe("tierPriceChanges: kebenaran dialog perubahan harga", () => {
  const quoted = [{ product_id: 1, variant_id: 11, name: "GPT", price: 9000 }];
  it("tidak ada perubahan bila estimasi (qty saat ini) sama dengan satuan server, termasuk saat melewati ambang", () => {
    expect(tierPriceChanges([{ variantId: 11, unit: 9000 }], quoted, [])).toEqual([]);
  });
  it("satuan server berbeda dari estimasi = perubahan tier nyata", () => {
    const changes = tierPriceChanges([{ variantId: 11, unit: 8500 }], quoted, []);
    expect(changes).toEqual([expect.objectContaining({ variant_id: 11, previous_price: 8500, current_price: 9000, tier: true })]);
  });
  it("perubahan harga dasar dari server tidak digandakan; baris tanpa cache tidak memicu apa pun", () => {
    expect(tierPriceChanges([{ variantId: 11, unit: 8500 }], quoted, [{ variant_id: 11 }])).toEqual([]);
    expect(tierPriceChanges([], quoted, [])).toEqual([]);
  });
});

describe("salinan ringkasan: hemat tidak diulang", () => {
  it("baris item = info tier saja; satu baris agregat 'Hemat grosir' / 'Bulk savings'; ringkasan PDP 'Hemat' / 'You save'", async () => {
    const { bulkCopy } = await import("@/lib/bulk-display");
    expect(bulkCopy("id").line(3)).toBe("Harga grosir 3+");
    expect(bulkCopy("en").line(3)).toBe("Bulk price 3+");
    expect(bulkCopy("id").included("Rp 16.000")).toBe("Hemat grosir Rp 16.000");
    expect(bulkCopy("en").included("Rp 16.000")).toBe("Bulk savings Rp 16.000");
    expect(bulkCopy("id").savedSummary("Rp 16.000")).toBe("Hemat Rp 16.000");
    expect(bulkCopy("en").savedSummary("Rp 16.000")).toBe("You save Rp 16.000");
    expect(bulkCopy("id").line(3)).not.toMatch(/Rp|hemat/i);
  });
});
