import { describe, expect, it } from "vitest";
import { computeGamesSellPrice, gamesPriceFloor } from "../src/lib/games/pricing";

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
