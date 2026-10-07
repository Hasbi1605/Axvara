// tests/pedia-pricing.test.ts — PEDIA M1: rumus harga §7.2 (murni, tanpa D1).
// Contoh PRD §6.3: Followers IG 250 — Hemat #948 G3, Standar #86 G3, Premium #24 G2.
import { describe, expect, it } from "vitest";
import {
  computePediaPrice,
  passesMarginGuard,
  pediaMargin,
  PRICE_GROUP_DEFAULTS,
  roundUpPedia,
} from "@/lib/pedia/pricing";

describe("rumus harga Pedia §7.2", () => {
  it("roundUpPedia: < Rp10.000 → Rp100, ≥ Rp10.000 → Rp500", () => {
    expect(roundUpPedia(6901)).toBe(7000);
    expect(roundUpPedia(6900)).toBe(6900);
    expect(roundUpPedia(12001)).toBe(12500);
    expect(roundUpPedia(12000)).toBe(12000);
  });

  it("contoh PRD §6.3 — Followers IG 250", () => {
    // Hemat #948: rate 22968.34, G3 (markup 20, min profit 1000).
    // modal = 250 × 22.96834 = 5742.085; mentah = max(6890.5, 6742.085) → 6900.
    expect(computePediaPrice({
      supplierRatePer1k: 22968.34, quantity: 250,
      markupPct: PRICE_GROUP_DEFAULTS.G3.markup_pct,
      minProfitRp: PRICE_GROUP_DEFAULTS.G3.min_profit_rp,
    })).toBe(6900);
    // Standar #86: rate 38750 → modal 9687.5; mentah = max(11625, 10687.5) → 12000.
    expect(computePediaPrice({
      supplierRatePer1k: 38750, quantity: 250,
      markupPct: PRICE_GROUP_DEFAULTS.G3.markup_pct,
      minProfitRp: PRICE_GROUP_DEFAULTS.G3.min_profit_rp,
    })).toBe(12000);
    // Premium #24: rate 100000, G2 (markup 60, min profit 2000).
    // modal = 25000; mentah = max(40000, 27000) → 40000.
    expect(computePediaPrice({
      supplierRatePer1k: 100000, quantity: 250,
      markupPct: PRICE_GROUP_DEFAULTS.G2.markup_pct,
      minProfitRp: PRICE_GROUP_DEFAULTS.G2.min_profit_rp,
    })).toBe(40000);
  });

  it("min_profit mengangkat harga mentah bila markup tidak cukup", () => {
    // qty 100, rate 1000/1K → modal 100; markup 20% = 120 < 100+1000.
    expect(computePediaPrice({
      supplierRatePer1k: 1000, quantity: 100, markupPct: 20, minProfitRp: 1000,
    })).toBe(1100);
  });

  it("floor PEDIA_MIN_ORDER_RP untuk qty kecil", () => {
    expect(computePediaPrice({
      supplierRatePer1k: 100, quantity: 10, markupPct: 150, minProfitRp: 500,
    })).toBe(1000);
    expect(computePediaPrice({
      supplierRatePer1k: 100, quantity: 10, markupPct: 150, minProfitRp: 500, minOrderRp: 2000,
    })).toBe(2000);
  });

  it("margin + guard PD-32", () => {
    // Standar 250 @12000, modal 9687.5 → margin 2312.5 ≥ 1000.
    expect(pediaMargin({ supplierRatePer1k: 38750, quantity: 250, sellPrice: 12000 }))
      .toBeCloseTo(2312.5, 1);
    expect(passesMarginGuard({
      supplierRatePer1k: 38750, quantity: 250, sellPrice: 12000, minProfitRp: 1000,
    })).toBe(true);
    // Rate naik 2× (77500) → modal 19375 > 12000 → guard jebol.
    expect(passesMarginGuard({
      supplierRatePer1k: 77500, quantity: 250, sellPrice: 12000, minProfitRp: 1000,
    })).toBe(false);
  });

  it("default kelompok G1–G3 sesuai PRD", () => {
    expect(PRICE_GROUP_DEFAULTS.G1).toEqual({ markup_pct: 150, min_profit_rp: 500 });
    expect(PRICE_GROUP_DEFAULTS.G2).toEqual({ markup_pct: 60, min_profit_rp: 2000 });
    expect(PRICE_GROUP_DEFAULTS.G3).toEqual({ markup_pct: 20, min_profit_rp: 1000 });
  });
});
