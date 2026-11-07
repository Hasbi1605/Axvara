// tests/crypto-multicoin.test.ts — crypto multi-koin (LOCAL ONLY): harga + biaya layanan 2% (tanpa lantai US$2),
// buffer minimum provider x1,15 per koin, katalog per koin, token bertanda tangan, create web non-USDT, guard memo/extra id,
// rekonsiliasi baris 0/0 dan 1/1 lama. Tanpa jaringan nyata: fetch di-mock; D1 = fixture SQLite.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { createCheckoutQuoteToken, isCanonicalMethodOption, verifyCheckoutQuoteToken } from "@/lib/auth";
import type { FxSnapshot } from "@/lib/payments/fx";
import { CRYPTO_ASSETS } from "@/lib/payments/crypto-assets";
import {
  CRYPTO_SURCHARGE_BPS, centsToUsdText, cryptoPricing, cryptoRequiredTotalCents,
  cryptoSurchargeCents, minIdrSubtotalForTotal,
} from "@/lib/payments/crypto-pricing";
import { buildCryptoCatalog, buildCryptoOffer, isCryptoTotalStillPayable } from "@/lib/payments/crypto-preflight";
import { buildMethodCatalog, buildMethodOptions } from "@/lib/payments/method-options";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(async () => true) }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: mocks.ensure }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })), sendPhoto: vi.fn(async () => ({ ok: true })), sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(async () => {}), safeEditOrNoop: vi.fn(), safeEditOrSend: vi.fn(),
}));

const FX: FxSnapshot = { rateText: "16000", rateNum: "16000", rateDen: "1", effectiveAt: new Date(Date.now() - 60_000).toISOString(), source: "operator-fixed" };

describe("pricing rules (pure, BigInt)", () => {
  it("constants: 2% service fee (temporary), no AXVARA US$2 floor", () => {
    expect(CRYPTO_SURCHARGE_BPS).toBe(200);
  });

  it.each([
    [0, 0], [1, 1], [50, 1], [66, 2], [67, 2], [100, 2], [133, 3], [134, 3], [1563, 32], [10_000, 200], [10_001, 201], [6666, 134], [6667, 134],
  ])("surcharge = ceil(base x 200 / 10000): base %i cents => %i cents", (base, surcharge) => {
    expect(cryptoSurchargeCents(BigInt(base))).toBe(BigInt(surcharge));
    const p = cryptoPricing(BigInt(base));
    expect(p.totalCents).toBe(BigInt(base + surcharge));
    expect(p.surchargeBps).toBe(200);
  });

  it("negative base throws; cents text is exact 2dp", () => {
    expect(() => cryptoSurchargeCents(BigInt(-1))).toThrow();
    expect(centsToUsdText(BigInt(5))).toBe("0.05");
    expect(centsToUsdText(BigInt(200))).toBe("2.00");
    expect(centsToUsdText(BigInt(123456))).toBe("1234.56");
  });

  it.each([
    ["0.08", 10], ["0.50", 58], ["1.95", 225], ["1.74", 201], ["1.7391", 200], ["1.73", 199], ["2", 230], ["2.5", 288], ["5", 575], ["0.000001", 1],
  ])("required total = ceil(minUsd x 1.15) to the cent, WITHOUT a US$2 floor: min %s => %i cents", (min, required) => {
    expect(cryptoRequiredTotalCents(min)).toBe(BigInt(required));
  });

  it.each(["", "abc", "-1", "0", "1e3", null, undefined, 5 as unknown as string])("unparseable/non-positive provider minimum %p => null", (value) => {
    expect(cryptoRequiredTotalCents(value)).toBeNull();
  });

  it("min IDR subtotal is the SMALLEST subtotal whose total reaches the requirement (exact boundary)", () => {
    const idr = minIdrSubtotalForTotal(BigInt(200), FX)!;
    expect(idr).toBe(31_280);
    const totalAt = (subtotal: number) => {
      // reuse the public offer builder at the boundary
      const offer = buildCryptoOffer(subtotal, FX, { ticker: "usdtbsc", minUsdText: "0.08" });
      return offer ? offer.total_cents : 0;
    };
    process.env.NOWPAYMENTS_OUTCOME_CURRENCY = "usdtbsc";
    try {
      expect(totalAt(idr)).toBeGreaterThanOrEqual(200);
      expect(totalAt(idr - 1)).toBeLessThan(200);
    } finally { delete process.env.NOWPAYMENTS_OUTCOME_CURRENCY; }
    expect(minIdrSubtotalForTotal(BigInt(0), FX)).toBeNull();
  });
});

describe("catalog builder (per coin)", () => {
  beforeEach(() => { vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const coins = [
    { ticker: "usdtbsc", minUsdText: "0.08" }, { ticker: "btc", minUsdText: "1.95" }, { ticker: "eth", minUsdText: "0.5" },
    { ticker: "usdttrc20", minUsdText: "0.1" }, { ticker: "trx", minUsdText: "0.08" },
  ];

  it("ordered popular then stable by curated order (not snapshot order); label/sublabel/group/logo from the curated map", () => {
    const entries = buildCryptoCatalog(250_000, FX, coins);
    expect(entries.map((e) => e.id)).toEqual(["nowpayments:btc", "nowpayments:eth", "nowpayments:trx", "nowpayments:usdtbsc", "nowpayments:usdttrc20"]);
    expect(entries[0]).toMatchObject({ label: "BTC", sublabel: "Bitcoin", group: "popular", logo: "/payments/coins/btc.svg", network: "btc", pay_currency: "btc", currency: "USD" });
    expect(entries[3]).toMatchObject({ label: "USDT", sublabel: "BNB Smart Chain", group: "stable", network: "bsc" });
    expect(entries[4]).toMatchObject({ label: "USDT", sublabel: "Tron (TRC20)", network: "trx" });
    for (const entry of entries) {
      expect(entry).toMatchObject({ available: true, amount_text: "15.95", base_cents: 1563, surcharge_cents: 32, total_cents: 1595, surcharge_bps: 200, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true });
      expect(entry).not.toHaveProperty("fee_unknown");
    }
  });

  it("coins missing from the snapshot are not shown; non-curated snapshot rows never appear", () => {
    const entries = buildCryptoCatalog(250_000, FX, [{ ticker: "btc", minUsdText: "1.95" }, { ticker: "doge", minUsdText: "0.1" }, { ticker: "usddtrc20", minUsdText: "0.1" }, { ticker: "btclightning", minUsdText: "0.1" }]);
    expect(entries.map((e) => e.id)).toEqual(["nowpayments:btc"]);
  });

  it("no AXVARA floor: totals below US$2 are available when they meet the per-coin provider minimum", () => {
    const at = (idr: number, minUsdText: string) => buildCryptoCatalog(idr, FX, [{ ticker: "usdtbsc", minUsdText }])[0];
    expect(at(31_439, "0.08")).toMatchObject({ available: true, total_cents: 200, amount_text: "2.00" });
    expect(at(31_120, "0.08")).toMatchObject({ available: true, total_cents: 199, amount_text: "1.99" });
    // US$0.50 order: USDT BSC (min x1.15 = 10c) offered, BTC (min x1.15 = 58c) stays below_min
    expect(at(8_000, "0.08")).toMatchObject({ available: true, base_cents: 50, surcharge_cents: 1, total_cents: 51, amount_text: "0.51" });
    expect(at(8_000, "0.50")).toMatchObject({ available: false, unavailable_reason: "below_min", min_total_cents: 58, min_total_text: "0.58" });
  });

  it("15% buffer: a coin whose minimum x1.15 exceeds the total is below_min with the SERVER minimum; no amount fields", () => {
    const entry = buildCryptoCatalog(250_000, FX, [{ ticker: "btc", minUsdText: "20" }])[0];
    // total 1595 < 2300 required
    expect(entry).toEqual({
      id: "nowpayments:btc", kind: "crypto", label: "BTC", sublabel: "Bitcoin", group: "popular", logo: "/payments/coins/btc.svg", currency: "USD",
      pay_currency: "btc", network: "btc", available: false, unavailable_reason: "below_min", min_total_cents: 2300, min_total_text: "23.00", min_idr_subtotal: 360_560,
    });
    expect(entry).not.toHaveProperty("amount_text");
    expect(entry).not.toHaveProperty("usd");
  });

  it("exactly at the buffered minimum is available (inclusive)", () => {
    // total is 1595 cents; min 13.86 x 1.15 = 15.939 => required 1594 (available); min 13.87 => ceil(1595.05) = 1596 (not)
    expect(buildCryptoCatalog(250_000, FX, [{ ticker: "btc", minUsdText: "13.86" }])[0]).toMatchObject({ available: true, total_cents: 1595 });
    expect(buildCryptoCatalog(250_000, FX, [{ ticker: "btc", minUsdText: "13.87" }])[0]).toMatchObject({ available: false, min_total_cents: 1596 });
  });

  it("no FX, empty coins or unconfigured outcome => no crypto at all (fail closed)", () => {
    expect(buildCryptoCatalog(250_000, null, coins)).toEqual([]);
    expect(buildCryptoCatalog(250_000, FX, [])).toEqual([]);
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    expect(buildCryptoCatalog(250_000, FX, coins)).toEqual([]);
  });

  it("isCryptoTotalStillPayable re-checks the per-coin minimum x1.15 against the CURRENT snapshot coins (no floor)", () => {
    expect(isCryptoTotalStillPayable(1595, "btc", coins)).toBe(true);
    expect(isCryptoTotalStillPayable(1595, "btc", [{ ticker: "btc", minUsdText: "14" }])).toBe(false); // needs 1610
    expect(isCryptoTotalStillPayable(1595, "doge", [{ ticker: "doge", minUsdText: "0.1" }])).toBe(false);
    expect(isCryptoTotalStillPayable(1595, "btc", [])).toBe(false);
    // sub-US$2 totals are payable as soon as the coin minimum is met
    expect(isCryptoTotalStillPayable(51, "usdtbsc", coins)).toBe(true);
    expect(isCryptoTotalStillPayable(9, "usdtbsc", coins)).toBe(false); // needs 10
    expect(isCryptoTotalStillPayable(0, "usdtbsc", coins)).toBe(false);
    expect(isCryptoTotalStillPayable(Number.NaN, "usdtbsc", coins)).toBe(false);
  });
});

describe("signed quote token with several tickers", () => {
  beforeEach(() => {
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    vi.stubEnv("ADMIN_JWT_SECRET", "fixture-secret");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  const methodsFor = (tickers: string[]) => tickers.map((ticker) => {
    const offer = buildCryptoOffer(250_000, FX, { ticker, minUsdText: "0.08" })!;
    const { label: _l, logo: _g, group: _gr, ...rest } = offer;
    void _l; void _g; void _gr;
    return { ...rest, account_number: "" };
  });
  const base = (tickers: string[]) => ({ items: [{ product_id: 1, name: "Fixture", price: 250_000, qty: 1 }], subtotal: 250_000, payment_methods: methodsFor(tickers), locale: "en" as const });
  const sign = (data: object) => new SignJWT({ purpose: "checkout_quote", ...data }).setProtectedHeader({ alg: "HS256" }).setJti("multi").setExpirationTime("1h").sign(new TextEncoder().encode("fixture-secret"));

  it("round-trips many curated tickers with exact amounts", async () => {
    const tickers = ["btc", "eth", "usdtbsc", "usdttrc20", "usdcsol", "daiarb", "ton"];
    const signed = await createCheckoutQuoteToken(base(tickers) as never);
    const verified = await verifyCheckoutQuoteToken(signed.token);
    expect(verified?.payment_methods.map((m) => m.id)).toEqual(tickers.map((t) => `nowpayments:${t}`));
    for (const method of verified!.payment_methods) {
      expect(method).toMatchObject({ amount_text: "15.95", total_cents: 1595, base_cents: 1563, surcharge_cents: 32, surcharge_bps: 200, fee_payer: "merchant", fixed_rate: false });
      const asset = CRYPTO_ASSETS.find((a) => `nowpayments:${a.ticker}` === method.id)!;
      expect(method.network).toBe(asset.network);
      expect(method.usd).toMatchObject({ pay_currency: asset.ticker, network: asset.network });
    }
  });

  it("tamper: wrong network for a ticker, non-curated ticker, inconsistent totals, legacy buyer/fixed policy are all rejected", async () => {
    const good = base(["usdtbsc"]);
    const [m] = good.payment_methods;
    const bad: object[] = [
      { ...good, payment_methods: [{ ...m, network: "eth", usd: { ...m.usd, network: "eth" } }] }, // usdtbsc is BSC, not ETH
      { ...good, payment_methods: [{ ...m, id: "nowpayments:doge", pay_currency: "doge", usd: { ...m.usd, pay_currency: "doge" } }] },
      { ...good, payment_methods: [{ ...m, id: "nowpayments:usddtrc20", pay_currency: "usddtrc20", network: "trx", usd: { ...m.usd, pay_currency: "usddtrc20", network: "trx" } }] }, // excluded from curation
      { ...good, payment_methods: [{ ...m, pay_currency: "btc" }] }, // pay_currency != id ticker
      { ...good, payment_methods: [{ ...m, total_cents: 1596 }] },
      { ...good, payment_methods: [{ ...m, surcharge_cents: 31, total_cents: 1594, amount_text: "15.94" }] }, // not the ceil formula
      { ...good, payment_methods: [{ ...m, base_cents: 1562 }] },
      { ...good, payment_methods: [{ ...m, amount_text: "15.63" }] }, // base shown as total
      { ...good, payment_methods: [{ ...m, surcharge_bps: 0, surcharge_cents: 0, total_cents: 1563, amount_text: "15.63" }] }, // surcharge stripped
      { ...good, payment_methods: [{ ...m, surcharge_bps: 150, surcharge_cents: 24, total_cents: 1587, amount_text: "15.87" }] }, // legacy bps is not the current fee
      { ...good, payment_methods: [{ ...m, fee_payer: "buyer" }] },
      { ...good, payment_methods: [{ ...m, fixed_rate: true }] },
      { ...good, payment_methods: [{ ...m, kind: "gateway" }] },
      { ...good, payment_methods: [{ ...m, available: false }] }, // unavailable options are never signed
      { ...good, payment_methods: [{ ...m, usd: { ...m.usd, cents: "1564" } }] },
      { ...good, payment_methods: [{ ...m, usd: { ...m.usd, idr_subtotal: 250_001 } }] },
    ];
    for (const value of bad) {
      expect(await verifyCheckoutQuoteToken(await sign(value)), JSON.stringify(value).slice(0, 160)).toBeNull();
      await expect(createCheckoutQuoteToken(value as never)).rejects.toThrow();
      expect(isCanonicalMethodOption((value as typeof good).payment_methods[0], 250_000)).toBe(false);
    }
    // No US$2 floor: a small but self-consistent total IS a valid signed method (2% fee exact)
    const tiny = buildCryptoOffer(10_000, FX, { ticker: "usdtbsc", minUsdText: "0.08" })!;
    expect(tiny).toMatchObject({ base_cents: 63, surcharge_cents: 2, total_cents: 65, amount_text: "0.65" });
    expect(isCanonicalMethodOption({ ...tiny, account_number: "" }, 10_000)).toBe(true);
    // ...but a forged small total (legacy 1,5% math) is still refused
    const forged = { ...m, amount_text: "0.64", total_cents: 64, base_cents: 63, surcharge_cents: 1, usd: { ...m.usd, cents: "63", idr_subtotal: 10_000 } };
    expect(isCanonicalMethodOption(forged, 10_000)).toBe(false);
    expect(isCanonicalMethodOption(m, 250_000)).toBe(true);
  });

  it("non-crypto methods may not carry crypto policy/price fields", async () => {
    const [m] = methodsFor(["btc"]);
    for (const extra of [{ fee_payer: "merchant" }, { total_cents: 1 }, { surcharge_bps: 150 }, { amount_text: "1.00" }, { usd: m.usd }]) {
      expect(isCanonicalMethodOption({ id: "qris", account_number: "", ...extra }, 250_000)).toBe(false);
    }
    expect(isCanonicalMethodOption({ id: "qris", account_number: "" }, 250_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Katalog quote web + create web (route nyata + D1 fixture).
// ---------------------------------------------------------------------------------------------------------------------
const A = "AXV-20261105-MMMMMMM1";
let fixture: ReturnType<typeof createD1Fixture>;
let postBodies: Record<string, unknown>[];
let extraId: string | undefined;

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.exec("UPDATE product_variants SET price=250000");
  fixture.sql.exec("UPDATE products SET is_active=1; UPDATE payment_methods SET is_active=1 WHERE id='qris'");
  postBodies = [];
  extraId = undefined;
  mocks.ensure.mockClear();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-api-key");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture-ipn-secret");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-checkout-secret");
  vi.stubEnv("USD_IDR_RATE", "");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", "");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true"); vi.stubEnv("KLIKQRIS_API_KEY", "fixture"); vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  seedCryptoMarket(fixture.sql, { rate: "16000.00", coins: [
    { ticker: "btc", min_usd_text: "1.95" }, { ticker: "usdtbsc", min_usd_text: "0.08" }, { ticker: "usdttrc20", min_usd_text: "0.1" },
    { ticker: "ton", min_usd_text: "20" },
  ] });
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const q = new URL(target).searchParams;
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "0.0002", currency_from: "usd", currency_to: q.get("currency_to") });
    if (target.includes("/min-amount?")) {
      if (/is_fixed_rate|is_fee_paid_by_user/.test(target)) throw new Error(`min-amount must be floating ${target}`);
      return Response.json({ min_amount: "0.00001", currency_from: q.get("currency_from"), currency_to: "usdtbsc", fiat_equivalent: "1.95" });
    }
    if (target.endsWith("/v1/payment") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      postBodies.push(body);
      return Response.json({
        payment_id: `np-${String(body.order_id).slice(-8)}`, order_id: body.order_id, pay_address: "bc1qfixtureaddress", pay_amount: "0.00021",
        pay_currency: body.pay_currency, price_amount: body.price_amount, price_currency: body.price_currency,
        is_fixed_rate: false, is_fee_paid_by_user: false, ...(extraId !== undefined ? { payin_extra_id: extraId } : {}),
      }, { status: 201 });
    }
    throw new Error(`Unexpected network request ${target}`);
  }));
});
afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const loadQuote = async () => {
  const { POST } = await import("@/app/api/checkout/quote/route");
  return POST(new NextRequest("http://localhost/api/checkout/quote", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: 250000 }] }),
  }));
};
const createOrder = async (quoteToken: string, method: string) => {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: method, quote_token: quoteToken }) }));
  return res;
};

describe("web quote catalog + token", () => {
  it("quote lists every snapshot coin in curated order (picker sorts available first), below_min ones as disabled with server minimum; token carries ONLY available coins", async () => {
    const body = await (await loadQuote()).json();
    const crypto = (body.paymentMethods as { id: string; kind: string; available: boolean }[]).filter((m) => m.kind === "crypto");
    expect(crypto.map((m) => [m.id, m.available])).toEqual([
      ["nowpayments:btc", true], ["nowpayments:ton", false], ["nowpayments:usdtbsc", true], ["nowpayments:usdttrc20", true],
    ]);
    const ton = crypto.find((m) => m.id === "nowpayments:ton") as unknown as Record<string, unknown>;
    expect(ton).toMatchObject({ unavailable_reason: "below_min", min_total_cents: 2300, min_total_text: "23.00", min_idr_subtotal: 360_560, label: "TON", sublabel: "TON", group: "popular" });
    expect(ton).not.toHaveProperty("amount_text");
    expect(ton).not.toHaveProperty("usd");
    const btc = crypto[0] as unknown as Record<string, unknown>;
    expect(btc).toMatchObject({ label: "BTC", sublabel: "Bitcoin", group: "popular", logo: "/payments/coins/btc.svg", amount_text: "15.95", base_cents: 1563, surcharge_cents: 32, total_cents: 1595, surcharge_bps: 200, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true });
    const verified = (await verifyCheckoutQuoteToken(body.quoteToken))!;
    expect(verified.payment_methods.map((m) => m.id).filter((id) => id === "qris" || id.startsWith("nowpayments:"))).toEqual(["qris", "nowpayments:btc", "nowpayments:usdtbsc", "nowpayments:usdttrc20"]);
    expect(JSON.stringify(verified.payment_methods)).not.toMatch(/below_min|nowpayments:ton|min_total/);
  });

  it("stale coin snapshot (>2h), unconfigured provider or missing FX => no crypto entries at all; QRIS remains", async () => {
    seedCryptoMarket(fixture.sql, { coinsAgeMs: 3 * 3600_000 });
    expect((await buildMethodCatalog(250_000)).some((m) => m.kind === "crypto")).toBe(false);
    seedCryptoMarket(fixture.sql, { fx: false }); // no D1 fx and env pair empty
    expect((await buildMethodCatalog(250_000)).some((m) => m.kind === "crypto")).toBe(false);
    seedCryptoMarket(fixture.sql);
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    expect((await buildMethodCatalog(250_000)).some((m) => m.kind === "crypto")).toBe(false);
    expect((await buildMethodCatalog(250_000)).some((m) => m.id === "qris")).toBe(true);
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    expect((await buildMethodCatalog(250_000)).filter((m) => m.kind === "crypto")).toHaveLength(5); // default test coins
  });

  it("buildMethodOptions (Telegram/token view) never includes unavailable coins; makes zero provider calls", async () => {
    const options = await buildMethodOptions(250_000);
    expect(options.filter((m) => m.kind === "crypto").map((m) => m.id)).toEqual(["nowpayments:btc", "nowpayments:usdtbsc", "nowpayments:usdttrc20"]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("a small cart has no AXVARA floor: coins whose provider minimum allows it stay selectable, others are below_min", async () => {
    fixture.sql.exec("UPDATE product_variants SET price=20000");
    const { POST } = await import("@/app/api/checkout/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1 }] }) }));
    const body = await res.json();
    const crypto = (body.paymentMethods as { kind: string; available: boolean; id: string; amount_text?: string; min_total_text?: string }[]).filter((m) => m.kind === "crypto");
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.find((m) => m.id === "nowpayments:usdtbsc")).toMatchObject({ available: true, amount_text: "1.28" });
    expect(crypto.find((m) => m.id === "nowpayments:btc")).toMatchObject({ available: false, min_total_text: "2.25" });
    expect(crypto.find((m) => m.id === "nowpayments:ton")).toMatchObject({ available: false, min_total_text: "23.00" });
    const verified = (await verifyCheckoutQuoteToken(body.quoteToken))!;
    expect(verified.payment_methods.filter((m) => m.kind === "crypto").map((m) => m.id)).toEqual(["nowpayments:usdtbsc", "nowpayments:usdttrc20"]);
  });
});

describe("web create (non-USDT coin, snapshot gate, memo guard)", () => {
  it("BTC: POST body is floating + merchant fee at the TOTAL USD price, saved ticker/network are BTC's, view uses curated copy", async () => {
    const quote = await (await loadQuote()).json();
    const res = await createOrder(quote.quoteToken, "nowpayments:btc");
    expect(res.status).toBe(201);
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toMatchObject({ pay_currency: "btc", price_amount: "15.95", price_currency: "usd", is_fixed_rate: false, is_fee_paid_by_user: false });
    const order = await res.json();
    expect(fixture.sql.prepare("SELECT payment_method FROM orders WHERE code=?").get(order.code)?.payment_method).toBe("nowpayments:btc");
    expect(fixture.sql.prepare("SELECT pay_currency,pay_network,fee_paid_by_user,fixed_rate,price_amount_text,crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps FROM payment_transactions WHERE order_code=?").get(order.code))
      .toEqual({ pay_currency: "btc", pay_network: "btc", fee_paid_by_user: 0, fixed_rate: 0, price_amount_text: "15.95", crypto_base_usd_cents: 1563, crypto_surcharge_usd_cents: 32, crypto_surcharge_bps: 200 });
    expect(order.payment).toMatchObject({ label: "BTC", sublabel: "Bitcoin", symbol: "BTC", network_label: "Bitcoin", logo: "/payments/coins/btc.svg", amount_text: "15.95", base_amount_text: "15.63", surcharge_amount_text: "0.32", surcharge_bps: 200, pay_currency: "btc", fee_payer: "merchant", fixed_rate: false });
    expect(order.payment.crypto_amount_text).toBe("0.00021 BTC");
  });

  it("a sub-US$2 order (US$0.51) is created with the coin whose provider minimum allows it; BTC stays below_min", async () => {
    fixture.sql.exec("UPDATE product_variants SET price=8000"); // 8000 IDR @16000 => base 50c + 2% (1c) = 51c
    seedCryptoMarket(fixture.sql, { coins: [{ ticker: "usdtbsc", min_usd_text: "0.08" }, { ticker: "btc", min_usd_text: "1.95" }] });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const q = new URL(target).searchParams;
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "0.0002", currency_from: "usd", currency_to: q.get("currency_to") });
      if (target.includes("/min-amount?")) {
        return Response.json({ min_amount: "0.00001", currency_from: q.get("currency_from"), currency_to: "usdtbsc", fiat_equivalent: "0.08" });
      }
      if (target.endsWith("/v1/payment") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        postBodies.push(body);
        return Response.json({
          payment_id: `np-${String(body.order_id).slice(-8)}`, order_id: body.order_id, pay_address: "0xfixtureaddress", pay_amount: "0.00021",
          pay_currency: body.pay_currency, price_amount: body.price_amount, price_currency: body.price_currency,
          is_fixed_rate: false, is_fee_paid_by_user: false,
        }, { status: 201 });
      }
      throw new Error(`Unexpected network request ${target}`);
    }));
    const quote = await (await loadQuote()).json();
    const usdt = (quote.paymentMethods as { id: string; available: boolean; amount_text?: string; total_cents?: number }[]).find((m) => m.id === "nowpayments:usdtbsc");
    expect(usdt).toMatchObject({ available: true, amount_text: "0.51", total_cents: 51 });
    expect((quote.paymentMethods as { id: string; available: boolean }[]).find((m) => m.id === "nowpayments:btc")).toMatchObject({ available: false });
    const res = await createOrder(quote.quoteToken, "nowpayments:usdtbsc");
    expect(res.status).toBe(201);
    expect(postBodies[0]).toMatchObject({ pay_currency: "usdtbsc", price_amount: "0.51", price_currency: "usd", is_fixed_rate: false, is_fee_paid_by_user: false });
    expect(fixture.sql.prepare("SELECT crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps,price_amount_text FROM payment_transactions").get())
      .toEqual({ crypto_base_usd_cents: 50, crypto_surcharge_usd_cents: 1, crypto_surcharge_bps: 200, price_amount_text: "0.51" });
  });

  it("two different coins in the same flow each bind their OWN ticker/network (no leakage from a previous order)", async () => {
    const quote = await (await loadQuote()).json();
    expect((await createOrder(quote.quoteToken, "nowpayments:usdttrc20")).status).toBe(201);
    expect(postBodies[0]).toMatchObject({ pay_currency: "usdttrc20" });
    expect(fixture.sql.prepare("SELECT pay_currency,pay_network FROM payment_transactions").get()).toEqual({ pay_currency: "usdttrc20", pay_network: "trx" });
    const quote2 = await (await loadQuote()).json();
    expect((await createOrder(quote2.quoteToken, "nowpayments:btc")).status).toBe(201);
    expect(postBodies[1]).toMatchObject({ pay_currency: "btc" });
  });

  it("ticker removed from the fresh snapshot after the quote => 409 quote_stale, no order, no POST", async () => {
    const quote = await (await loadQuote()).json();
    seedCryptoMarket(fixture.sql, { coins: [{ ticker: "usdtbsc", min_usd_text: "0.08" }] });
    const res = await createOrder(quote.quoteToken, "nowpayments:btc");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "quote_stale" });
    expect(postBodies).toHaveLength(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  });

  it("provider minimum rose above the signed total => 409 quote_stale; stale snapshot (>2h) => 409; other coins unaffected", async () => {
    const quote = await (await loadQuote()).json();
    seedCryptoMarket(fixture.sql, { coins: [{ ticker: "btc", min_usd_text: "14" }, { ticker: "usdtbsc", min_usd_text: "0.08" }] }); // btc needs 1610 > 1595
    expect((await createOrder(quote.quoteToken, "nowpayments:btc")).status).toBe(409);
    seedCryptoMarket(fixture.sql, { coinsAgeMs: 3 * 3600_000 });
    expect((await createOrder(quote.quoteToken, "nowpayments:usdtbsc")).status).toBe(409);
    expect(postBodies).toHaveLength(0);
    seedCryptoMarket(fixture.sql, { coins: [{ ticker: "btc", min_usd_text: "14" }, { ticker: "usdtbsc", min_usd_text: "0.08" }] });
    expect((await createOrder(quote.quoteToken, "nowpayments:usdtbsc")).status).toBe(201);
  });

  it("a coin that was below_min in the quote (never signed) or a non-curated ticker cannot be created", async () => {
    const quote = await (await loadQuote()).json();
    for (const method of ["nowpayments:ton", "nowpayments:doge", "nowpayments:USDTBSC", "nowpayments:usddtrc20", "nowpayments:"]) {
      const res = await createOrder(quote.quoteToken, method);
      expect([409, 400, 503], method).toContain(res.status);
    }
    expect(postBodies).toHaveLength(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  });

  it("memo guard: a non-empty payin_extra_id fails closed — no address stored/shown, tx failed, order cancelled, stock restored, generic 503", async () => {
    extraId = "987654321";
    const quote = await (await loadQuote()).json();
    const res = await createOrder(quote.quoteToken, "nowpayments:btc");
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("bc1qfixtureaddress");
    expect(postBodies).toHaveLength(1);
    const tx = fixture.sql.prepare("SELECT status,last_error,pay_address,provider_payment_id FROM payment_transactions").get()!;
    expect(tx).toMatchObject({ status: "failed", last_error: "nowpayments_extra_id_unsupported", pay_address: null });
    expect(tx.provider_payment_id).toBeTruthy();
    expect(fixture.sql.prepare("SELECT status FROM orders").get()?.status).toBe("dibatalkan");
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
    const code = String(fixture.sql.prepare("SELECT code FROM orders").get()?.code);
    expect(await buildNowpaymentsPaymentView(code)).toMatchObject({ pay_address: "" });
  });

  it("whitespace-only or empty payin_extra_id is not a memo", async () => {
    extraId = "  ";
    const quote = await (await loadQuote()).json();
    expect((await createOrder(quote.quoteToken, "nowpayments:btc")).status).toBe(201);
  });
});

describe("reconcile: 0/0 rows and legacy 1/1 rows", () => {
  async function seedOrder(code: string) {
    await createChannelOrderAtomic({
      orderCode: code, lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
      items: [{ product_id: 1, variant_id: 1, qty: 1, price: 250000, name: "Fixture" }], variantSnapshot: "{}", subtotal: 250000,
      primaryVariantId: 1, customerName: "Fixture", salesChannel: "web", paymentMethod: "crypto", paymentAccount: "NOWPayments", fulfillmentStatus: "not_required",
    });
    fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(new Date(Date.now() + 15 * 60_000).toISOString(), code);
  }
  const saveTx = (code: string, flags: { fee: number; fixed: number }, ticker = "btc", network = "btc") => {
    fixture.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,price_amount_text,price_currency,pay_currency,pay_network,
       provider_payment_id,pay_address,pay_amount_text,fx_rate_text,fx_effective_at,fee_paid_by_user,fixed_rate,status,expires_at,created_at,updated_at)
      VALUES (?,'nowpayments','hosted',?,'nowpayments',250000,'IDR','15.87','usd',?,?,?, 'bc1qfixture','0.00021','16000/1@x',?,?,?,'pending',datetime('now','+15 minutes'),datetime('now'),datetime('now'))`)
      .run(code, code, ticker, network, `np-${code.slice(-4)}`, new Date().toISOString(), flags.fee, flags.fixed);
  };
  const remoteStatus = (code: string, over: Record<string, unknown> = {}) => ({
    payment_id: `np-${code.slice(-4)}`, order_id: code, price_amount: "15.87", price_currency: "usd", pay_currency: "btc", network: "btc",
    payment_status: "finished", pay_amount: "0.00021", actually_paid: "0.00021", updated_at: new Date().toISOString(), ...over,
  });
  const reconcileWith = async (code: string, status: Record<string, unknown>) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(status);
      throw new Error(`unexpected ${String(url)}`);
    }));
    const { reconcileNowpaymentsPayment } = await import("@/lib/payments/nowpayments");
    return reconcileNowpaymentsPayment(code);
  };

  it("0/0 row, non-USDT ticker: finished + gross >= pay_amount => paid exactly once (no valid_until needed)", async () => {
    await seedOrder(A); saveTx(A, { fee: 0, fixed: 0 });
    expect(await reconcileWith(A, remoteStatus(A, { is_fixed_rate: false, is_fee_paid_by_user: false }))).toBe("paid");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)?.status).toBe("lunas");
    expect(await reconcileWith(A, remoteStatus(A, { payment_status: "waiting", actually_paid: "0" }))).toBe("already_paid");
  });

  it("0/0 row: ticker mismatch in the provider status is rejected (compares to THIS order's ticker)", async () => {
    await seedOrder(A); saveTx(A, { fee: 0, fixed: 0 }, "btc", "btc");
    await expect(reconcileWith(A, remoteStatus(A, { pay_currency: "usdtbsc" }))).rejects.toThrow("nowpayments_currency_mismatch");
    await expect(reconcileWith(A, remoteStatus(A, { network: "bsc" }))).rejects.toThrow("nowpayments_network_mismatch");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)?.status).toBe("pending");
  });

  it.each([
    ["fixed-rate", { is_fixed_rate: true, is_fee_paid_by_user: false }], ["fee-by-user", { is_fixed_rate: false, is_fee_paid_by_user: true }], ["both", { is_fixed_rate: true, is_fee_paid_by_user: true }],
  ])("0/0 row: provider reports %s => manual review, sticky, never paid", async (_label, flags) => {
    await seedOrder(A); saveTx(A, { fee: 0, fixed: 0 });
    expect(await reconcileWith(A, remoteStatus(A, flags))).toBe("manual_review");
    expect(await reconcileWith(A, remoteStatus(A, { is_fixed_rate: false, is_fee_paid_by_user: false }))).toBe("manual_review");
    expect(fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(A)?.last_error).toBe("nowpayments_policy_manual_review");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(A)?.status).toBe("pending");
  });

  it("0/0 row: under-payment and late payment still go to manual review", async () => {
    await seedOrder(A); saveTx(A, { fee: 0, fixed: 0 });
    expect(await reconcileWith(A, remoteStatus(A, { actually_paid: "0.0001" }))).toBe("manual_review");
    const B = "AXV-20261105-MMMMMMM2";
    await seedOrder(B); saveTx(B, { fee: 0, fixed: 0 });
    fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(new Date(Date.now() - 1000).toISOString(), B);
    expect(await reconcileWith(B, remoteStatus(B))).toBe("manual_review");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });

  it("LEGACY 1/1 row still reconciles with its OLD checks: needs fixed+fee echo and a valid deadline; paid when satisfied", async () => {
    await seedOrder(A); saveTx(A, { fee: 1, fixed: 1 }, "usdtbsc", "bsc");
    const legacy = (code: string, over: Record<string, unknown> = {}) => remoteStatus(code, { pay_currency: "usdtbsc", network: "bsc", is_fixed_rate: true, is_fee_paid_by_user: true, valid_until: new Date(Date.now() + 600_000).toISOString(), ...over });
    // old rule: false policy flags or a malformed provider deadline => manual review
    expect(await reconcileWith(A, legacy(A, { is_fixed_rate: false }))).toBe("manual_review");
    const B = "AXV-20261105-MMMMMMM2";
    await seedOrder(B); saveTx(B, { fee: 1, fixed: 1 }, "usdtbsc", "bsc");
    expect(await reconcileWith(B, legacy(B, { valid_until: "tomorrow" }))).toBe("manual_review");
    const C = "AXV-20261105-MMMMMMM3";
    await seedOrder(C); saveTx(C, { fee: 1, fixed: 1 }, "usdtbsc", "bsc");
    expect(await reconcileWith(C, legacy(C))).toBe("paid");
    expect(fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(C)?.status).toBe("lunas");
  });

  it("legacy 1/1 view keeps buyer-fee metadata without the new breakdown; new rows expose merchant fee + breakdown", async () => {
    await seedOrder(A); saveTx(A, { fee: 1, fixed: 1 }, "usdtbsc", "bsc");
    const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
    expect(await buildNowpaymentsPaymentView(A)).toMatchObject({ label: "USDT", sublabel: "BNB Smart Chain", fee_payer: "buyer", fixed_rate: true, base_amount_text: null, surcharge_amount_text: null, surcharge_bps: null });
    const B = "AXV-20261105-MMMMMMM2";
    await seedOrder(B); saveTx(B, { fee: 0, fixed: 0 });
    fixture.sql.prepare("UPDATE payment_transactions SET crypto_base_usd_cents=1563,crypto_surcharge_usd_cents=24,crypto_surcharge_bps=150 WHERE order_code=?").run(B);
    expect(await buildNowpaymentsPaymentView(B)).toMatchObject({ label: "BTC", sublabel: "Bitcoin", network_label: "Bitcoin", fee_payer: "merchant", fixed_rate: false, base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150, amount_text: "15.87" });
  });

  it("a saved 150-bps invoice keeps its stored fee (copy + amounts) and still reconciles; the 200-bps constant is never applied", async () => {
    await seedOrder(A); saveTx(A, { fee: 0, fixed: 0 });
    fixture.sql.prepare("UPDATE payment_transactions SET crypto_base_usd_cents=1563,crypto_surcharge_usd_cents=24,crypto_surcharge_bps=150 WHERE order_code=?").run(A);
    const { buildNowpaymentsPaymentView } = await import("@/lib/payments/payment-view");
    expect(await buildNowpaymentsPaymentView(A)).toMatchObject({ amount_text: "15.87", base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150 });
    const { payCopy } = await import("@/lib/payment-ui");
    expect(payCopy("id").cryptoCaption("15.87", 150)).toBe("US$15,87 · termasuk biaya layanan 1,5%");
    expect(payCopy("en").cryptoCaption("15.87", 150)).toBe("US$15.87 · incl. 1.5% service fee");
    expect(payCopy("id").cryptoCaption("15.95", 200)).toBe("US$15,95 · termasuk biaya layanan 2%");
    expect(await reconcileWith(A, remoteStatus(A, { is_fixed_rate: false, is_fee_paid_by_user: false }))).toBe("paid");
    expect(fixture.sql.prepare("SELECT crypto_surcharge_bps,price_amount_text FROM payment_transactions WHERE order_code=?").get(A))
      .toEqual({ crypto_surcharge_bps: 150, price_amount_text: "15.87" });
  });
});

describe("migration 0102 matches schema.sql", () => {
  it("adds exactly the three surcharge columns, nullable, on top of a table without them", () => {
    const cols = ["crypto_base_usd_cents", "crypto_surcharge_usd_cents", "crypto_surcharge_bps"];
    const info = () => fixture.sql.prepare("PRAGMA table_info(payment_transactions)").all() as { name: string; type: string; notnull: number }[];
    expect(info().filter((c) => cols.includes(c.name)).map((c) => [c.name, c.type, c.notnull])).toEqual(cols.map((c) => [c, "INTEGER", 0]));
    for (const col of cols) fixture.sql.exec(`ALTER TABLE payment_transactions DROP COLUMN ${col}`);
    expect(info().some((c) => cols.includes(c.name))).toBe(false);
    fixture.sql.exec(fs.readFileSync("drizzle/migrations/0102_crypto_surcharge.sql", "utf8"));
    expect(info().filter((c) => cols.includes(c.name)).map((c) => [c.name, c.type, c.notnull])).toEqual(cols.map((c) => [c, "INTEGER", 0]));
  });
});

describe("create adapter guards (no network)", () => {
  const expected = {
    cents: "1563", priceText: "15.95", surchargeBps: 200, surchargeCents: "32", totalCents: "1595", rateText: "16000", rateNum: "16000", rateDen: "1",
    effectiveAt: new Date(Date.now() - 60_000).toISOString(), idrSubtotal: 250000, payCurrency: "btc", network: "btc",
  };
  async function seedOrder(code: string) {
    await createChannelOrderAtomic({
      orderCode: code, lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
      items: [{ product_id: 1, variant_id: 1, qty: 1, price: 250000, name: "Fixture" }], variantSnapshot: "{}", subtotal: 250000,
      primaryVariantId: 1, customerName: "Fixture", salesChannel: "web", paymentMethod: "nowpayments:btc", paymentAccount: "NOWPayments", fulfillmentStatus: "not_required",
    });
    fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(new Date(Date.now() + 15 * 60_000).toISOString(), code);
  }
  const create = async (over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}, ticker = "btc") => {
    const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
    return createNowpaymentsInvoice(A, 250000, ticker, { payNetwork: "btc", priceCurrency: "usd", feePayer: "merchant", fixedRate: false, expectedUsd: { ...expected, ...over }, ...opts } as never);
  };

  it.each([
    ["wrong surcharge", { surchargeCents: "25" }], ["wrong total", { totalCents: "1588" }], ["total text != total", { priceText: "15.63" }],
    ["wrong bps", { surchargeBps: 100 }], ["wrong base", { cents: "1564" }], ["network != curated network", { network: "bsc" }],
  ])("refuses to POST when the snapshot is inconsistent (%s)", async (_label, over) => {
    await seedOrder(A);
    await expect(create(over, "network" in over ? { payNetwork: "bsc" } : {})).rejects.toThrow("nowpayments_invoice_mismatch");
    expect(postBodies).toHaveLength(0);
  });

  it("refuses non-curated tickers and the legacy buyer/fixed policy", async () => {
    await seedOrder(A);
    await expect(create({ payCurrency: "doge", network: "doge" }, { payNetwork: "doge" }, "doge")).rejects.toThrow("nowpayments_invoice_mismatch");
    await expect(create({}, { feePayer: "buyer", fixedRate: true })).rejects.toThrow("nowpayments_policy_required");
    expect(postBodies).toHaveLength(0);
  });

  it("a sub-US$2 total is no longer blocked by an AXVARA floor: it reaches the provider preflight", async () => {
    await seedOrder(A);
    fixture.sql.prepare("UPDATE orders SET subtotal=10000 WHERE code=?").run(A);
    const tiny = { cents: "63", priceText: "0.65", surchargeBps: 200, surchargeCents: "2", totalCents: "65", idrSubtotal: 10_000 };
    const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
    // fixture /min-amount reports fiat_equivalent 1.95 > 0.65 => provider preflight rejects; NOT a floor error
    await expect(createNowpaymentsInvoice(A, 10_000, "btc", { payNetwork: "btc", priceCurrency: "usd", feePayer: "merchant", fixedRate: false, expectedUsd: { ...expected, ...tiny } } as never)).rejects.toThrow("nowpayments_preflight_invalid");
    expect(postBodies).toHaveLength(0);
  });

  it("preflight: total below the provider minimum rejects with ZERO POST (floating min-amount form)", async () => {
    await seedOrder(A);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const q = new URL(target).searchParams;
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "0.0002", currency_from: "usd", currency_to: q.get("currency_to") });
      if (target.includes("/min-amount?")) {
        expect(target).not.toMatch(/is_fixed_rate|is_fee_paid_by_user/);
        return Response.json({ min_amount: "0.00001", currency_from: "btc", currency_to: "usdtbsc", fiat_equivalent: "25.00" });
      }
      throw new Error(`Unexpected POST ${target}`);
    }));
    await expect(create()).rejects.toThrow("nowpayments_preflight_invalid");
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions").get()?.status).toBe("initializing");
  });

  it("a saved row bound to one coin refuses a retry for another coin (no re-POST)", async () => {
    await seedOrder(A);
    await create();
    expect(postBodies).toHaveLength(1);
    const { createNowpaymentsInvoice } = await import("@/lib/payments/nowpayments");
    await expect(createNowpaymentsInvoice(A, 250000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "usd", feePayer: "merchant", fixedRate: false, expectedUsd: { ...expected, payCurrency: "usdtbsc", network: "bsc" } } as never)).rejects.toThrow("nowpayments_invoice_mismatch");
    expect(postBodies).toHaveLength(1);
    const again = await create();
    expect(again.isExisting).toBe(true);
    expect(postBodies).toHaveLength(1);
  });
});

