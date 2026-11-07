import { describe, expect, it } from "vitest";
import { displayCryptoAmount } from "@/lib/payments/crypto-display";
import { isSufficientDecimal, parseDecimalParts } from "@/lib/payments/decimal";

const pow10 = (exp: number) => BigInt(10) ** BigInt(exp);

/** Kelebihan nominal tampil vs asli ≤ US$0,01, dihitung eksak dari rasio tersimpan. */
function extraWithinCent(shown: string, raw: string, usd: string): boolean {
  const a = parseDecimalParts(shown);
  const b = parseDecimalParts(raw);
  const u = parseDecimalParts(usd);
  if (!a || !b || !u) return false;
  const scale = Math.max(a.scale, b.scale);
  const delta = a.scaled * pow10(scale - a.scale) - b.scaled * pow10(scale - b.scale);
  if (delta < BigInt(0)) return false;
  // kelebihan USD = delta/10^scale × (U/10^u)/(B/10^b.scale) ≤ 1/100
  return delta * u.scaled * BigInt(100) * pow10(b.scale) <= b.scaled * pow10(scale + u.scale);
}

/** Pembulatan ke atas `raw` pada `decimals` desimal, untuk uji kandidat sebelumnya. */
function ceilAt(raw: string, decimals: number): string {
  const p = parseDecimalParts(raw);
  if (!p) throw new Error(`invalid raw ${raw}`);
  if (decimals >= p.scale) return raw;
  const step = pow10(p.scale - decimals);
  const scaled = ((p.scaled + step - BigInt(1)) / step) * step;
  const digits = scaled.toString().padStart(p.scale + 1, "0");
  const integer = digits.slice(0, digits.length - p.scale).replace(/^0+(?=\d)/, "") || "0";
  const fraction = digits.slice(-p.scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

describe("displayCryptoAmount (tampilan saja, kelebihan aktual ≤ US$0,01)", () => {
  it("contoh owner: kelebihan aktual ≤1 sen memilih presisi terpendek, bukan heuristik per langkah", () => {
    expect(displayCryptoAmount("2.24671004", "2.25")).toBe("2.25");
    expect(displayCryptoAmount("0.000468", "1.05")).toBe("0.00047");
    expect(displayCryptoAmount("0.000467123456", "1.05")).toBe("0.00047");
    expect(displayCryptoAmount("0.00075012345", "2.25")).toBe("0.000751");
    expect(displayCryptoAmount("0.0000225123", "2.25")).toBe("0.0000226");
  });

  it("batas persis 1 sen diterima; di bawah/di atas 1 sen mengikuti kelebihan eksak", () => {
    expect(displayCryptoAmount("1.009", "10.09")).toBe("1.01"); // kelebihan TEPAT US$0,01
    expect(displayCryptoAmount("1.009", "10.089999999999999999")).toBe("1.01"); // tepat di bawah 1 sen
    expect(displayCryptoAmount("1.009", "10.090000000000000001")).toBe("1.009"); // 2dp > 1 sen
    expect(displayCryptoAmount("0.000503", "1.13")).toBe("0.000503"); // pembulatan ke 0.00051 > 1 sen
  });

  it("raw/USD di luar batas trust-boundary (18dp atau 64 karakter) dikembalikan apa adanya", () => {
    const longRaw = `1${"0".repeat(62)}.000468`;
    expect(longRaw.length).toBeGreaterThan(64);
    expect(displayCryptoAmount(longRaw, "1.05")).toBe(longRaw);
    expect(displayCryptoAmount("0.1234567890123456789", "1.05")).toBe("0.1234567890123456789"); // 19dp
    const longUsd = `1.${"0".repeat(62)}5`;
    expect(longUsd.length).toBeGreaterThan(64);
    expect(displayCryptoAmount("0.000468", longUsd)).toBe("0.000468");
    expect(displayCryptoAmount("0.000468", "1.0500000000000000001")).toBe("0.000468"); // 19dp USD
  });

  it("TRX/nilai rendah: digit yang cukup, selalu ≥ nominal asli (tanpa float untuk uang)", () => {
    for (const [amount, usd] of [
      ["2.24671004", "2.25"],
      ["0.00075012345", "2.25"],
      ["0.0000225123", "2.25"],
      ["123.456789", "2.25"],
      ["0.000000123", "15.87"],
      ["98765432.123456789", "15.87"],
    ] as const) {
      const shown = displayCryptoAmount(amount, usd);
      expect(isSufficientDecimal(shown, amount), `${amount} -> ${shown}`).toBe(true);
      expect(shown).not.toMatch(/\.$/);
      expect(shown).not.toMatch(/\.\d*0$/); // trailing zero dibuang
    }
  });

  it("cap eksak ≤1 sen dan kandidat desimal terkecil (besar/kecil, 18dp)", () => {
    for (const [raw, usd] of [
      ["0.000468", "1.05"],
      ["0.000467123456", "1.05"],
      ["0.000503", "1.13"],
      ["1.009", "10.09"],
      ["2.24671004", "2.25"],
      ["98765432.123456789", "15.87"],
      ["0.000000000000000123", "15.87"],
      ["1.123456789012345678", "15.87"],
      ["123456789.012345678", "0.99"],
    ] as const) {
      const shown = displayCryptoAmount(raw, usd);
      expect(extraWithinCent(shown, raw, usd), `${raw} @ ${usd} -> ${shown}`).toBe(true);
      expect(isSufficientDecimal(shown, raw), `${raw} -> ${shown}`).toBe(true);
      const visible = shown.includes(".") ? shown.split(".")[1].length : 0;
      if (visible > 2) {
        expect(extraWithinCent(ceilAt(raw, visible - 1), raw, usd), `${raw} @ ${usd} kandidat ${visible - 1}dp`).toBe(false);
      }
    }
  });

  it("trim nol di belakang: '2.2' bukan '2.20'; bilangan bulat tanpa titik", () => {
    expect(displayCryptoAmount("2.20000000", "2.2")).toBe("2.2");
    expect(displayCryptoAmount("2.25000000", "2.25")).toBe("2.25");
    expect(displayCryptoAmount("3.00000000", "3")).toBe("3");
  });

  it("invalid/zero/null atau presisi tidak cukup: dikembalikan apa adanya", () => {
    for (const value of ["", "abc", "1e5", "-1", "0", "0.00", "1.2.3"]) {
      expect(displayCryptoAmount(value, "2.25")).toBe(value);
      expect(displayCryptoAmount("2.24671004", value)).toBe("2.24671004");
    }
    expect(displayCryptoAmount("2.24671004", null)).toBe("2.24671004");
    expect(displayCryptoAmount("0.000000123", "15.87")).toBe("0.000000123"); // presisi asli dipertahankan saat kandidat ≤1 sen tak ada
    expect(displayCryptoAmount("2.25", "2.25")).toBe("2.25"); // sudah pendek
    expect(displayCryptoAmount("2.5", "2.5")).toBe("2.5");
    expect(displayCryptoAmount("3", "3")).toBe("3");
  });
});
