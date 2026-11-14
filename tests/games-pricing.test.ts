import { describe, expect, it } from "vitest";
import {
  computeGamesMarkupPrice,
  computeGamesSellPrice,
  effectiveMarkupPercent,
  gamesPriceFloor,
} from "../src/lib/games/pricing";

describe("rumus harga AXVARA Games (Oura −2%, margin minimum 3%)", () => {
  it("memakai referensi −2% bila masih di atas batas bawah (FF140 snapshot 9 Nov 2026)", () => {
    const r = computeGamesSellPrice({ cost: 15842, referencePrice: 20004, fee: { percent: 0.7 } });
    expect(r).toEqual({ price: 19604, floor: 16433, source: "reference", competitive: true });
  });

  it("jatuh ke batas bawah bila referensi −2% di bawah modal + biaya + 3% (Genshin 60)", () => {
    const r = computeGamesSellPrice({ cost: 16394, referencePrice: 16500, fee: { percent: 0.7 } });
    expect(r.source).toBe("floor");
    expect(r.price).toBe(r.floor);
    expect(r.price).toBe(17005);
    expect(r.competitive).toBe(false);
  });

  it("batas bawah menjamin margin bersih minimal 3% setelah biaya persen + tetap", () => {
    const cost = 25768;
    const fee = { percent: 1.5, flat: 1000 };
    const floor = gamesPriceFloor(cost, fee);
    const net = floor - (floor * fee.percent) / 100 - fee.flat;
    expect(net).toBeGreaterThanOrEqual(cost * 1.03);
    const below = floor - 1;
    expect(below - (below * fee.percent) / 100 - fee.flat).toBeLessThan(cost * 1.03);
  });

  it("tanpa referensi memakai batas bawah dan competitive null", () => {
    expect(computeGamesSellPrice({ cost: 10000 })).toEqual({ price: 10300, floor: 10300, source: "floor", competitive: null });
  });

  it("parameter diskon dan margin bisa diubah", () => {
    const r = computeGamesSellPrice({ cost: 1000, referencePrice: 2000, referenceDiscountPercent: 5, minMarginPercent: 10 });
    expect(r).toEqual({ price: 1900, floor: 1100, source: "reference", competitive: true });
  });

  it("menolak input tidak valid", () => {
    expect(() => computeGamesSellPrice({ cost: 0 })).toThrow(RangeError);
    expect(() => computeGamesSellPrice({ cost: Number.NaN })).toThrow(RangeError);
    expect(() => computeGamesSellPrice({ cost: 100, referencePrice: -1 })).toThrow(RangeError);
    expect(() => gamesPriceFloor(100, { percent: 100 })).toThrow(RangeError);
  });
});

describe("computeGamesMarkupPrice (OD1 14 Nov 2026: markup % + Rp tetap + pembulatan)", () => {
  // Pasangan modal nyata Sekalipay pada 5 %/R100 (spec B1).
  it.each([
    [11750, 12400],
    [321115, 337200],
    [1641500, 1723600],
    [4825225, 5066500],
    [1106018, 1161400],
  ])("modal %i → %i pada 5%%/Rp100", (cost, expected) => {
    expect(computeGamesMarkupPrice({ cost, markupPercent: 5, rounding: 100 })).toBe(expected);
  });

  it("memakai default 5 %/Rp100 bila markup tidak diberikan", () => {
    expect(computeGamesMarkupPrice({ cost: 11750 })).toBe(12400);
    expect(computeGamesMarkupPrice({ cost: 10000, markupPercent: 0 })).toBe(10000);
  });

  it("menghormati pembulatan Rp1/Rp500/Rp1.000", () => {
    expect(computeGamesMarkupPrice({ cost: 11750, markupPercent: 5, rounding: 1 })).toBe(12338);
    expect(computeGamesMarkupPrice({ cost: 11750, markupPercent: 5, rounding: 500 })).toBe(12500);
    expect(computeGamesMarkupPrice({ cost: 11750, markupPercent: 5, rounding: 1000 })).toBe(13000);
    // R=1 tetap pembulatan ke atas: modal tidak pernah turun.
    expect(computeGamesMarkupPrice({ cost: 321115, markupPercent: 5, rounding: 1 })).toBe(337171);
  });

  it("menambahkan markup tetap setelah pembulatan", () => {
    expect(computeGamesMarkupPrice({ cost: 10000, markupPercent: 5, markupFixed: 250, rounding: 100 })).toBe(10750);
    expect(computeGamesMarkupPrice({ cost: 10000, markupPercent: 0, markupFixed: 1000, rounding: 100 })).toBe(11000);
  });

  it("mendukung markup desimal 4,5 %", () => {
    expect(computeGamesMarkupPrice({ cost: 100000, markupPercent: 4.5, rounding: 100 })).toBe(104500);
    expect(computeGamesMarkupPrice({ cost: 10001, markupPercent: 4.5, rounding: 100 })).toBe(10500);
  });

  it("hasil selalu ≥ modal, dan > modal saat ada markup", () => {
    for (const cost of [1, 999, 11750, 321115, 4825225]) {
      for (const rounding of [1, 100, 500, 1000] as const) {
        expect(computeGamesMarkupPrice({ cost, markupPercent: 0, rounding })).toBeGreaterThanOrEqual(cost);
        expect(computeGamesMarkupPrice({ cost, markupPercent: 5, rounding })).toBeGreaterThan(cost);
        expect(computeGamesMarkupPrice({ cost, markupPercent: 0, markupFixed: 1, rounding })).toBeGreaterThan(cost);
      }
    }
  });

  it("menolak input tidak valid", () => {
    const invalid = [
      { cost: 0 },
      { cost: -1 },
      { cost: 10.5 },
      { cost: Number.NaN },
      { cost: Number.MAX_SAFE_INTEGER },
      { cost: 1000, markupPercent: -0.01 },
      { cost: 1000, markupPercent: 100.01 },
      { cost: 1000, markupPercent: Number.NaN },
      { cost: 1000, markupPercent: 4.555 },
      { cost: 1000, markupFixed: -1 },
      { cost: 1000, markupFixed: 1_000_001 },
      { cost: 1000, markupFixed: 10.5 },
      { cost: 1000, rounding: 50 as never },
      { cost: 1000, rounding: 0 as never },
    ];
    for (const input of invalid) {
      expect(() => computeGamesMarkupPrice(input), JSON.stringify(input)).toThrow(RangeError);
    }
  });

  it("effectiveMarkupPercent memakai varian → game → global", () => {
    expect(effectiveMarkupPercent(12, 7, 5)).toBe(12);
    expect(effectiveMarkupPercent(null, 7, 5)).toBe(7);
    expect(effectiveMarkupPercent(null, null, 5)).toBe(5);
    expect(effectiveMarkupPercent(0, 7, 5)).toBe(0);
  });
});
