import { describe, expect, it } from "vitest";
import { displayCryptoAmount } from "@/lib/payments/crypto-display";
import { isSufficientDecimal } from "@/lib/payments/decimal";

describe("displayCryptoAmount (tampilan saja, bulat ke atas ≤ ~1 sen)", () => {
  it("contoh owner: stablecoin ~US$1 tetap 2 desimal; ETH/BTC menambah digit sesuai rasio", () => {
    expect(displayCryptoAmount("2.24671004", "2.25")).toBe("2.25");
    expect(displayCryptoAmount("2.25000000", "2.25")).toBe("2.25");
    expect(displayCryptoAmount("0.00075012345", "2.25")).toBe("0.000751"); // rate ≈ 3000 -> 6 dp
    expect(displayCryptoAmount("0.0000225123", "2.25")).toBe("0.0000226"); // rate ≈ 100k -> 7 dp
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

  it("trim nol di belakang: '2.2' bukan '2.20'; bilangan bulat tanpa titik", () => {
    expect(displayCryptoAmount("2.20000000", "2.2")).toBe("2.2");
    expect(displayCryptoAmount("3.00000000", "3")).toBe("3");
  });

  it("invalid/zero/null atau presisi tidak cukup: dikembalikan apa adanya", () => {
    for (const value of ["", "abc", "1e5", "-1", "0", "0.00", "1.2.3"]) {
      expect(displayCryptoAmount(value, "2.25")).toBe(value);
      expect(displayCryptoAmount("2.24671004", value)).toBe("2.24671004");
    }
    expect(displayCryptoAmount("2.24671004", null)).toBe("2.24671004");
    expect(displayCryptoAmount("0.000000123", "15.87")).toBe("0.000000123"); // cap 9 dp < 11 dp butuh
    expect(displayCryptoAmount("2.25", "2.25")).toBe("2.25"); // sudah pendek
    expect(displayCryptoAmount("2.5", "2.5")).toBe("2.5");
    expect(displayCryptoAmount("3", "3")).toBe("3");
  });
});
