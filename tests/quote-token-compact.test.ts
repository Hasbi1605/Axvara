// tests/quote-token-compact.test.ts — token quote web ringkas: 28 koin kurasi + QRIS + kanal gateway tetap << 8000 karakter
// (batas `quote_token` di POST /api/orders), diperluas kembali ke payload penuh identik, dan tamper ditolak.
// Tanpa jaringan nyata: fetch di-mock; D1 = fixture SQLite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, decodeJwt } from "jose";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { createCheckoutQuoteToken, verifyCheckoutQuoteToken } from "@/lib/auth";
import { CRYPTO_ASSETS } from "@/lib/payments/crypto-assets";
import { buildCryptoOffer } from "@/lib/payments/crypto-preflight";
import { loadFxSnapshot } from "@/lib/payments/fx";

const mocks = vi.hoisted(() => ({ ensure: vi.fn(async () => true) }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: mocks.ensure }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })), sendPhoto: vi.fn(async () => ({ ok: true })), sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(async () => {}), safeEditOrNoop: vi.fn(), safeEditOrSend: vi.fn(),
}));

const FRESH = new Date(Date.now() - 60_000).toISOString();
const SECRET = "fixture-secret";
const SUBTOTAL = 250_000;
const ITEMS = [{ product_id: 1, name: "Fixture", price: SUBTOTAL, qty: 1 }];
const MAX_QUOTE_TOKEN = 8000;

const qris = (n: number) => ({ id: n === 0 ? "qris" : `qris${n}`, account_number: `Fixture ${n}`, kind: "qris" as const, currency: "IDR" as const });
const gateway = (n: number) => ({
  id: `sekalipay_gateway:CH${n}`, kind: "gateway" as const, account_number: "", currency: "IDR" as const, sublabel: "Estimasi biaya pembayaran", available: true as const,
  gateway: { channel: `CH${n}`, estimated_fee: 500 + n, estimated_total: SUBTOTAL + 500 + n, idr_subtotal: SUBTOTAL },
});
function cryptoMethods(count = CRYPTO_ASSETS.length) {
  const snap = loadFxSnapshot();
  return CRYPTO_ASSETS.slice(0, count).map((asset) => {
    const offer = buildCryptoOffer(SUBTOTAL, snap, { ticker: asset.ticker, minUsdText: "0.08" })!;
    return {
      id: offer.id, account_number: "", kind: "crypto" as const, sublabel: offer.sublabel, available: true as const, currency: "USD" as const,
      amount_text: offer.amount_text, pay_currency: offer.pay_currency, network: offer.network, fee_payer: offer.fee_payer, fixed_rate: offer.fixed_rate,
      base_cents: offer.base_cents, surcharge_cents: offer.surcharge_cents, total_cents: offer.total_cents, surcharge_bps: offer.surcharge_bps,
      sender_gas_extra: offer.sender_gas_extra, usd: offer.usd,
    };
  });
}
const sign = (payload: object) => new SignJWT({ purpose: "checkout_quote", ...payload }).setProtectedHeader({ alg: "HS256" })
  .setJti("tamper").setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));
const signedPayload = async (methods: unknown[]) => {
  const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods as never, locale: "id" });
  const payload = { ...decodeJwt(token) } as Record<string, unknown>;
  for (const key of ["iat", "exp", "jti"]) delete payload[key];
  return payload as { payment_methods: unknown[]; crypto: Record<string, unknown> & { items: { ticker: string; total_cents: number }[]; usd: Record<string, unknown> } };
};

describe("compact quote token (pure)", () => {
  beforeEach(() => {
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    vi.stubEnv("USD_IDR_RATE", "16000");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", FRESH);
    vi.stubEnv("ADMIN_JWT_SECRET", SECRET);
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("28 koin + 3 QRIS: token jauh di bawah 8000 dan verifikasi mengembalikan metode penuh identik urutan semula", async () => {
    const crypto = cryptoMethods();
    expect(crypto).toHaveLength(28);
    const input = { items: ITEMS, subtotal: SUBTOTAL, payment_methods: [qris(0), qris(1), qris(2), ...crypto], locale: "en" as const };
    const { token } = await createCheckoutQuoteToken(input);
    expect(token.length).toBeLessThan(3500);
    expect(token.length).toBeLessThan(MAX_QUOTE_TOKEN / 2);
    const verified = (await verifyCheckoutQuoteToken(token))!;
    expect(verified.locale).toBe("en");
    expect(verified.payment_methods).toEqual(input.payment_methods);
    expect(verified.payment_methods.map((m) => m.id)).toEqual(["qris", "qris1", "qris2", ...CRYPTO_ASSETS.map((a) => `nowpayments:${a.ticker}`)]);
  });

  it("token memuat satu blok crypto, bukan metode kripto penuh", async () => {
    const payload = await signedPayload([qris(0), ...cryptoMethods()]);
    expect(payload.payment_methods).toHaveLength(1);
    expect(payload.crypto.items).toHaveLength(28);
    expect(payload.crypto.items.map((item) => item.ticker)).toEqual(CRYPTO_ASSETS.map((a) => a.ticker));
    expect(JSON.stringify(payload.payment_methods)).not.toContain("nowpayments:");
  });

  it("varian dengan ~15 kanal gateway + 3 QRIS + 28 koin tetap di bawah 8000", async () => {
    const methods = [qris(0), qris(1), qris(2), ...Array.from({ length: 15 }, (_, i) => gateway(i)), ...cryptoMethods()];
    const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods });
    expect(token.length).toBeLessThan(MAX_QUOTE_TOKEN);
    const verified = (await verifyCheckoutQuoteToken(token))!;
    expect(verified.payment_methods).toEqual(methods);
  });

  it("urutan asli dipertahankan walau kripto di tengah (insertion index)", async () => {
    const methods = [qris(0), ...cryptoMethods(3), gateway(1)];
    const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods });
    expect((await verifyCheckoutQuoteToken(token))!.payment_methods).toEqual(methods);
  });

  it("tanpa kripto: tanpa blok; satu koin tetap round-trip", async () => {
    expect(await signedPayload([qris(0)])).not.toHaveProperty("crypto");
    const one = [qris(0), ...cryptoMethods(1)];
    const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: one });
    expect((await verifyCheckoutQuoteToken(token))!.payment_methods).toEqual(one);
  });

  it("metode tanpa sublabel/available/sender_gas_extra round-trip persis (tanpa field tambahan)", async () => {
    const methods = cryptoMethods(2).map((method) => {
      const rest: Record<string, unknown> = { ...method };
      for (const key of ["sublabel", "available", "sender_gas_extra"]) delete rest[key];
      return rest;
    });
    const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods as never });
    const verified = (await verifyCheckoutQuoteToken(token))!;
    expect(verified.payment_methods).toEqual(methods);
    for (const method of verified.payment_methods) for (const key of ["sublabel", "available", "sender_gas_extra"]) expect(method).not.toHaveProperty(key);
  });

  it("create menolak kripto yang tidak identik selain ticker, tidak kontigu, atau duplikat (bug server)", async () => {
    const [a, b] = cryptoMethods(2);
    const bad = [
      [a, { ...b, account_number: "x" }],
      [a, { ...b, sublabel: "Lain" }],
      [a, { ...b, available: undefined }],
      [a, qris(0), b],
      [a, a],
    ];
    for (const methods of bad) {
      await expect(createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods as never })).rejects.toThrow();
    }
  });

  it("bentuk penuh lama (legacy) masih lolos verifikasi", async () => {
    const methods = [qris(0), ...cryptoMethods(3)];
    const token = await sign({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: methods, locale: "id" });
    expect((await verifyCheckoutQuoteToken(token))!.payment_methods).toEqual(methods);
  });

  it("tamper blok ditolak: ticker non-kurasi/duplikat/besar/kosong, total tidak cocok, kedua bentuk, jaringan palsu, field tambahan", async () => {
    const payload = await signedPayload([qris(0), ...cryptoMethods(3)]);
    const withBlock = (patch: Record<string, unknown>) => ({ ...payload, crypto: { ...payload.crypto, ...patch } });
    const t = payload.crypto.items;
    const full = cryptoMethods(3);
    expect(await verifyCheckoutQuoteToken(await sign(payload))).not.toBeNull();
    const bad: object[] = [
      withBlock({ items: [...t, { ticker: "doge", total_cents: 1587 }] }),
      withBlock({ items: [...t, { ticker: "USDTBSC", total_cents: 1587 }] }),
      withBlock({ items: [t[0], t[0]] }),
      withBlock({ items: [] }),
      withBlock({ items: Array.from({ length: 65 }, (_, i) => ({ ticker: `x${i}`, total_cents: 1587 })) }),
      withBlock({ items: [...t, { ticker: "a".repeat(33), total_cents: 1587 }] }),
      withBlock({ items: [...t, { ticker: "btc", total_cents: -1 }] }),
      withBlock({ items: [...t, { ticker: "btc", total_cents: 1587, extra: true }] }),
      withBlock({ items: "btc" }),
      withBlock({ items: [{ ...t[0], total_cents: t[0].total_cents + 1 }] }), // total != per-coin formula
      withBlock({ items: [{ ...t[0], total_cents: Number(payload.crypto.base_cents) - 1 }] }), // below base
      withBlock({ base_cents: Number(payload.crypto.base_cents) + 1 }),
      withBlock({ surcharge_bps: 200 }),
      withBlock({ usd: { ...payload.crypto.usd, cents: "1" } }),
      withBlock({ usd: { ...payload.crypto.usd, network: "trx" } }),
      withBlock({ usd: { ...payload.crypto.usd, pay_currency: "btc" } }),
      withBlock({ network: "trx" }),
      withBlock({ fee_payer: "buyer" }),
      withBlock({ at: 99 }),
      withBlock({ at: -1 }),
      withBlock({ extra: true }),
      { ...payload, crypto: "btc" },
      { ...payload, crypto: null },
      // kedua bentuk sekaligus
      { ...payload, payment_methods: [...payload.payment_methods, full[0]] },
      { ...payload, payment_methods: [...payload.payment_methods, { ...full[0], kind: "qris" }] },
    ];
    for (const value of bad) expect(await verifyCheckoutQuoteToken(await sign(value)), JSON.stringify(value).slice(0, 160)).toBeNull();
  });

  it("tamper tanda tangan pada token ringkas ditolak", async () => {
    const { token } = await createCheckoutQuoteToken({ items: ITEMS, subtotal: SUBTOTAL, payment_methods: [qris(0), ...cryptoMethods(3)] });
    expect(await verifyCheckoutQuoteToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Create end-to-end: quote route nyata (28 koin snapshot) -> POST /api/orders nyata.
// ---------------------------------------------------------------------------------------------------------------------
describe("create end-to-end dengan 28 koin", () => {
  let fixture: ReturnType<typeof createD1Fixture>;
  let postBodies: Record<string, unknown>[];

  beforeEach(async () => {
    fixture = createD1Fixture();
    stubFulfillmentKey();
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.exec("UPDATE product_variants SET price=250000");
    fixture.sql.exec("UPDATE products SET is_active=1; UPDATE payment_methods SET is_active=1 WHERE id='qris'");
    postBodies = [];
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
    seedCryptoMarket(fixture.sql, { rate: "16000.00", coins: CRYPTO_ASSETS.map((asset) => ({ ticker: asset.ticker, min_usd_text: "0.1" })) });
    const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
    clearRateLimitBucketsForTest();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const q = new URL(target).searchParams;
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "0.0002", currency_from: "usd", currency_to: q.get("currency_to") });
      if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.00001", currency_from: q.get("currency_from"), currency_to: "usdtbsc", fiat_equivalent: "0.1" });
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
  });
  afterEach(() => { fixture.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("quote 28 koin menghasilkan token < 8000 dan create koin terakhir sukses (201) lewat route orders", async () => {
    const { POST: quote } = await import("@/app/api/checkout/quote/route");
    const quoteRes = await quote(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: 250000 }] }),
    }));
    const body = await quoteRes.json();
    const catalogCrypto = (body.paymentMethods as { kind: string; available: boolean }[]).filter((m) => m.kind === "crypto");
    expect(catalogCrypto).toHaveLength(28);
    expect(catalogCrypto.every((m) => m.available)).toBe(true);
    expect(body.quoteToken.length).toBeLessThan(MAX_QUOTE_TOKEN);
    const verified = (await verifyCheckoutQuoteToken(body.quoteToken))!;
    expect(verified.payment_methods.filter((m) => m.kind === "crypto")).toHaveLength(28);

    const last = CRYPTO_ASSETS[CRYPTO_ASSETS.length - 1];
    const { POST: orders } = await import("@/app/api/orders/route");
    const res = await orders(new NextRequest("http://localhost/api/orders", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: `nowpayments:${last.ticker}`, quote_token: body.quoteToken }),
    }));
    expect(res.status).toBe(201);
    expect(postBodies[0]).toMatchObject({ pay_currency: last.ticker, price_currency: "usd" });
    const order = await res.json();
    expect(fixture.sql.prepare("SELECT pay_currency,pay_network FROM payment_transactions WHERE order_code=?").get(order.code)).toEqual({ pay_currency: last.ticker, pay_network: last.network });
  });
});
