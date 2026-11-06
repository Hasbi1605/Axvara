// tests/payment-fx.test.ts — W3 FX snapshot + quote metadata unit tests.
// No provider IO, no floats in cents: env fixtures + pure functions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutQuoteToken, verifyCheckoutQuoteToken } from "@/lib/auth";
import { SignJWT } from "jose";
import { buildCryptoOffer, cryptoRailEnabled } from "@/lib/payments/crypto-preflight";
import {
  idrToUsdCents,
  isExactUsdPrice,
  loadFxSnapshot,
  usdCentsToProviderAmount,
} from "@/lib/payments/fx";

const FRESH = new Date(Date.now() - 60_000).toISOString();
const USDT_BSC = { ticker: "usdtbsc", minUsdText: "0.08" };

beforeEach(() => {
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", FRESH);
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("loadFxSnapshot (strict ISO+zone, no silent guesses)", () => {
  it("accepts fresh zoned snapshot; 250000@16000 => 1563 cents => 15.63", () => {
    const snap = loadFxSnapshot();
    expect(snap).toMatchObject({ rateNum: "16000", rateDen: "1", source: "operator-fixed" });
    const cents = idrToUsdCents(250000, snap!);
    expect(cents).toBe(BigInt(1563));
    expect(usdCentsToProviderAmount(cents)).toBe("15.63");
    expect(isExactUsdPrice("15.63", cents)).toBe(true);
  });

  it.each([
    ["date-only rejected (no zone)", "2026-11-03", "USD_IDR_RATE"],
    ["epoch rejected (no zone)", "123", "USD_IDR_RATE"],
    ["natural language rejected", "tomorrow at noon", "USD_IDR_RATE"],
    ["naive datetime rejected (no zone)", "2026-11-03 12:00:00", "USD_IDR_RATE"],
    ["invalid calendar date", "2026-02-30T12:00:00Z", "USD_IDR_RATE"],
  ])("invalid effective_at %s => null", (_label, effective) => {
    vi.stubEnv("USD_FX_EFFECTIVE_AT", effective);
    expect(loadFxSnapshot()).toBeNull();
  });

  it.each([
    ["stale snapshot hidden", new Date(Date.now() - 25 * 60 * 60_000).toISOString()],
    ["future snapshot invalid", new Date(Date.now() + 30_000).toISOString()],
  ])("%s => null", (_label, effective) => {
    vi.stubEnv("USD_FX_EFFECTIVE_AT", effective);
    expect(loadFxSnapshot()).toBeNull();
  });

  it.each([
    ["zero rate", "0"],
    ["negative rate rejected by shape", "-5"],
    ["exponent rejected", "1.6e4"],
    ["garbage rejected", "soon"],
  ])("invalid rate %s => null", (_label, rate) => {
    vi.stubEnv("USD_IDR_RATE", rate);
    expect(loadFxSnapshot()).toBeNull();
  });

  it("missing env => null (crypto hidden, no defaults)", () => {
    vi.stubEnv("USD_IDR_RATE", "");
    expect(loadFxSnapshot()).toBeNull();
  });
});

describe("buildCryptoOffer gate (outcome env + exact math + 1.5% surcharge)", () => {
  it("offer carries the signed USD snapshot with the TOTAL incl. surcharge; policy merchant/floating", () => {
    const offer = buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC);
    // base 1563 cents; surcharge ceil(1563*150/10000)=ceil(23.445)=24; total 1587 => "15.87"
    expect(offer).toMatchObject({
      id: "nowpayments:usdtbsc", kind: "crypto", currency: "USD", label: "USDT", sublabel: "BNB Smart Chain", group: "stable",
      amount_text: "15.87", pay_currency: "usdtbsc", network: "bsc",
      base_cents: 1563, surcharge_cents: 24, total_cents: 1587, surcharge_bps: 150,
      fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true,
    });
    expect(offer!.usd).toMatchObject({ cents: "1563", idr_subtotal: 250000, pay_currency: "usdtbsc", network: "bsc" });
    expect(offer).not.toHaveProperty("fee_unknown");
  });

  it("unconfigured outcome hides the rail (NOWPAYMENTS_PAY_CURRENCY no longer gates anything)", () => {
    vi.stubEnv("NOWPAYMENTS_PAY_CURRENCY", "btc");
    expect(cryptoRailEnabled()).toBe(true);
    expect(buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)).not.toBeNull();
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    expect(cryptoRailEnabled()).toBe(false);
    expect(buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)).toBeNull();
  });

  it("stale FX hides the rail (no fallback price)", () => {
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 25 * 60 * 60_000).toISOString());
    expect(buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)).toBeNull();
  });

  it("missing or noncanonical outcome hides the rail", () => {
    for (const value of ["", "USDTBSC", "bad-network", "x".repeat(33)]) {
      vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", value);
      expect(buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)).toBeNull();
    }
  });

  it("non-curated ticker yields no offer", () => {
    expect(buildCryptoOffer(250000, loadFxSnapshot(), { ticker: "doge", minUsdText: "0.1" })).toBeNull();
    expect(buildCryptoOffer(250000, loadFxSnapshot(), { ticker: "usddtrc20", minUsdText: "0.1" })).toBeNull();
  });
});

describe("quote token USD metadata survives auth create+verify", () => {
  it("signed nested usd round-trips; tampered cents rotated FX rejected downstream", async () => {
    const offer = buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)!;
    const signed = await createCheckoutQuoteToken({
      items: [{ product_id: 1, name: "Fixture", price: 250000, qty: 1 }],
      subtotal: 250000,
      payment_methods: [{
        id: "nowpayments:usdtbsc", account_number: "", kind: "crypto", currency: "USD",
        amount_text: offer.amount_text, pay_currency: offer.pay_currency, network: offer.network,
        fee_payer: offer.fee_payer, fixed_rate: offer.fixed_rate, surcharge_bps: offer.surcharge_bps,
        base_cents: offer.base_cents, surcharge_cents: offer.surcharge_cents, total_cents: offer.total_cents,
        usd: offer.usd,
      }],
      locale: "en",
    });
    const verified = await verifyCheckoutQuoteToken(signed.token);
    expect(verified?.locale).toBe("en");
    expect(verified?.payment_methods[0]).toMatchObject({ id: "nowpayments:usdtbsc", kind: "crypto", currency: "USD", amount_text: "15.87", total_cents: 1587, surcharge_cents: 24 });
    const usd = (verified!.payment_methods[0] as unknown as { usd: { cents: string; rate_num: string } }).usd;
    expect(usd).toMatchObject({ cents: "1563", rate_num: "16000" });
    const tampered = signed.token.slice(0, -1) + (signed.token.endsWith("a") ? "b" : "a");
    expect(await verifyCheckoutQuoteToken(tampered)).toBeNull();
  });

  it("usd on non-crypto row stripped to rejection; forgery hidden fields dropped", async () => {
    await expect(createCheckoutQuoteToken({
      items: [{ product_id: 1, name: "Fixture", price: 89000, qty: 1 }],
      subtotal: 89000,
      payment_methods: [{
        id: "qris", account_number: "-",
        usd: { cents: "999", rate_num: "1", rate_den: "1", rate_text: "1", source: "operator-fixed", effective_at: FRESH, idr_subtotal: 89000, pay_currency: "usdtbsc", network: "bsc" },
      } as unknown as { id: string; account_number: string }],
      locale: "id",
    })).rejects.toThrow();
  });

  it("validates independently signed metadata and strips unknown fields", async () => {
    const offer = buildCryptoOffer(250000, loadFxSnapshot(), USDT_BSC)!;
    const base = { items: [{ product_id: 1, name: "Fixture", price: 250000, qty: 1 }], subtotal: 250000,
      payment_methods: [{ ...offer, account_number: "" }], locale: "en" };
    const sign = (data: object) => new SignJWT({ purpose: "checkout_quote", ...data }).setProtectedHeader({ alg: "HS256" })
      .setJti("independent").setExpirationTime("1h").sign(new TextEncoder().encode("fixture-secret"));
    const bad = [
      { ...base, payment_methods: [{ ...base.payment_methods[0], usd: { ...offer.usd, cents: "1564" } }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], usd: { ...offer.usd, rate_num: "16001" } }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], usd: { ...offer.usd, idr_subtotal: 250001 } }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], usd: { ...offer.usd, effective_at: "123" } }] },
      { ...base, locale: "xx" },
      { ...base, payment_methods: [{ ...base.payment_methods[0], pay_currency: "btc" }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], fixed_rate: true }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], fee_payer: "buyer" }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], kind: "qris" }] },
      // amount/surcharge consistency: total != base + surcharge, wrong ceil, amount_text not the total
      { ...base, payment_methods: [{ ...base.payment_methods[0], total_cents: 1586 }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], surcharge_cents: 23, total_cents: 1586, amount_text: "15.86" }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], amount_text: "15.63" }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], surcharge_bps: 100 }] },
      // network must equal the curated network for the ticker; ticker must be curated
      { ...base, payment_methods: [{ ...base.payment_methods[0], network: "trx", usd: { ...offer.usd, network: "trx" } }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], id: "nowpayments:doge", pay_currency: "doge", usd: { ...offer.usd, pay_currency: "doge" } }] },
      { ...base, payment_methods: [{ ...base.payment_methods[0], id: "nowpayments:USDTBSC" }] },
    ];
    for (const value of bad) {
      expect(await verifyCheckoutQuoteToken(await sign(value))).toBeNull();
      await expect(createCheckoutQuoteToken(value as never)).rejects.toThrow();
    }
    const extra = { ...base, payment_methods: [{ ...base.payment_methods[0], extra: true, usd: { ...offer.usd, extra: true } }] };
    const result = await verifyCheckoutQuoteToken(await sign(extra));
    expect(result?.payment_methods[0]).not.toHaveProperty("extra");
    expect(result?.payment_methods[0].usd).not.toHaveProperty("extra");
    const legacy = await sign({ items: base.items, subtotal: base.subtotal, payment_methods: [{ id: "qris", account_number: "-" }] });
    expect((await verifyCheckoutQuoteToken(legacy))?.locale).toBe("id");
  });
});
