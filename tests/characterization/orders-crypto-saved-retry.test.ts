import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "../helpers/d1-fixture";

it("reuses a crypto quote saved after the first lookup without loading the market snapshot", async () => {
  const fixture = createD1Fixture();
  try {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    vi.stubEnv("ADMIN_JWT_SECRET", "fixture-checkout-secret");
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
    const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
    clearRateLimitBucketsForTest();
    const fetch = vi.fn().mockRejectedValue(new Error("unexpected network call"));
    vi.stubGlobal("fetch", fetch);
    const market = await import("@/lib/payments/market-snapshot");
    const snapshot = vi.spyOn(market, "getCryptoMarketSnapshot").mockRejectedValue(new Error("market snapshot unavailable"));

    await insertTestProduct(fixture.sql);
    const { createCheckoutQuoteToken } = await import("@/lib/auth");
    const { centsToUsdText, cryptoPricing } = await import("@/lib/payments/crypto-pricing");
    const ticker = "usdtbsc";
    const paymentMethod = `nowpayments:${ticker}`;
    const pricing = cryptoPricing(BigInt(63), ticker);
    const items = [{ product_id: 1, variant_id: 1, qty: 1, name: "Fixture", price: 10000 }];
    const { token, quoteId } = await createCheckoutQuoteToken({
      items, subtotal: 10000, locale: "en",
      payment_methods: [{
        id: paymentMethod, account_number: "-", kind: "crypto", currency: "USD",
        amount_text: centsToUsdText(pricing.totalCents), pay_currency: ticker, network: "bsc",
        fee_payer: "merchant", fixed_rate: false,
        base_cents: Number(pricing.baseCents), surcharge_cents: Number(pricing.surchargeCents),
        total_cents: Number(pricing.totalCents), surcharge_bps: pricing.surchargeBps,
        usd: {
          cents: pricing.baseCents.toString(), rate_num: "16000", rate_den: "1", rate_text: "16000",
          source: "operator-fixed", effective_at: new Date().toISOString(), idr_subtotal: 10000,
          pay_currency: ticker, network: "bsc",
        },
      }],
    });

    // The first quote_id lookup misses. A concurrent winner saves the order
    // during the next DB read, so this POST must reach the same-config check.
    const code = "AXV-20261122-CRYPTO01";
    let saved = false;
    const sameConfigReads: unknown[][] = [];
    fixture.control.fail = (query, params) => {
      if (query === "SELECT code FROM orders WHERE quote_id=?") sameConfigReads.push(params);
      if (!saved && query.includes("SELECT pv.id, wv.wr_type AS wr_type")) {
        insertTestOrder(fixture.sql, code, { items, status: "lunas", channel: "web" });
        fixture.sql.prepare("UPDATE orders SET quote_id=?,payment_method=?,payment_account='NOWPayments',locale='en' WHERE code=?")
          .run(quoteId, paymentMethod, code);
        saved = true;
      }
      return false;
    };

    const { POST } = await import("@/app/api/orders/route");
    const post = POST(new NextRequest("https://axvara.test/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_wa: "081234567890", customer_email: "buyer@example.test",
        items, payment_method: paymentMethod, quote_token: token,
      }),
    }));
    await expect.soft(post).resolves.toMatchObject({ status: 200 });
    expect.soft(snapshot).toHaveBeenCalledTimes(0);
    expect.soft(fetch).toHaveBeenCalledTimes(0);
    expect(sameConfigReads).toEqual([[quoteId]]);
    expect(await (await post).json()).toMatchObject({ code, status: "lunas", locale: "en", reused: true });
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  } finally {
    fixture.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
