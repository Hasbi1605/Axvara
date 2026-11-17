import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest, isSyntheticRequest, RATE_LIMITS } from "@/lib/rateLimit";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import { POST } from "@/app/api/checkout/quote/route";

let fx: ReturnType<typeof createD1Fixture>;
const secret = "fixture-cron-secret";
const request = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/checkout/quote", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8", ...headers },
  body: JSON.stringify({ items: [{ product_id: 7, variant_id: 19, qty: 1 }] }),
});
beforeEach(() => {
  fx = createD1Fixture(); clearRateLimitBucketsForTest(); resetCryptoMarketMemo();
  vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris"); vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture"); vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(7,'Fixture','fixture',10000,9);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(19,7,'fixture','One',10000,9,'manual');
    INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1);
    UPDATE payment_methods SET is_active=1 WHERE id='qris'`);
});
afterEach(() => { fx.close(); clearRateLimitBucketsForTest(); resetCryptoMarketMemo(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated synthetic quote", () => {
  it.each<Record<string, string>>([{}, { "x-axvara-synthetic": "1" }, { authorization: `Bearer ${secret}` }, { "x-axvara-synthetic": "1", authorization: "Bearer wrong" }])("requires both headers: %j", headers => {
    expect(isSyntheticRequest(request(headers))).toBe(false);
  });
  it("missing CRON_SECRET never authorizes even an empty bearer", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isSyntheticRequest(request({ "x-axvara-synthetic": "1", authorization: "Bearer " }))).toBe(false);
  });
  it("does not consume or use buyer quota, and performs only SELECTs (no quote/admission/order/stock writes)", async () => {
    const before = fx.sql.prepare("SELECT total_changes() AS n").get()?.n;
    const queries: string[] = [];
    fx.control.fail = query => { queries.push(query); return false; };
    const synthHeaders = { "x-axvara-synthetic": "1", authorization: `Bearer ${secret}` };
    for (let i = 0; i < RATE_LIMITS["checkout:quote"] + 1; i++) {
      const res = await POST(request(synthHeaders));
      expect(res.status).toBe(200);
      expect((await res.json()).quoteToken.length).toBeGreaterThan(20);
    }
    for (let i = 0; i < RATE_LIMITS["checkout:quote"]; i++) expect((await POST(request())).status).toBe(200);
    expect((await POST(request({ "x-axvara-synthetic": "1" }))).status).toBe(429);
    expect((await POST(request({ "x-axvara-synthetic": "1", authorization: "Bearer wrong" }))).status).toBe(429);
    expect((await POST(request(synthHeaders))).status).toBe(200);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(query => /^\s*SELECT\b/i.test(query))).toBe(true);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=19").get()?.stock).toBe(9);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT total_changes() AS n").get()?.n).toBe(before);
  });
  it("does not fetch any provider even when all public rails are configured; buyer assembly remains unchanged", async () => {
    for (const key of ["SEKALIPAY_GATEWAY_ENABLED", "NOWPAYMENTS_ENABLED"]) vi.stubEnv(key, "true");
    for (const key of ["SEKALIPAY_GATEWAY_API_KEY", "SEKALIPAY_GATEWAY_SECRET_KEY", "NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"]) vi.stubEnv(key, "fixture-only");
    const providerFetch = vi.fn(async () => { throw new Error("provider must not be called"); });
    vi.stubGlobal("fetch", providerFetch);
    const res = await POST(request({ "x-axvara-synthetic": "1", authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(200);
    expect((await res.json()).paymentMethods).toEqual(expect.arrayContaining([expect.objectContaining({ id: "qris", available: true })]));
    expect(providerFetch).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });
  it("sold-out variant returns the normal structured 409 without writes", async () => {
    fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=19");
    fx.control.beforeRun = async () => { throw new Error("unexpected write"); };
    const res = await POST(request({ "x-axvara-synthetic": "1", authorization: `Bearer ${secret}` }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, issues: [{ type: "out_of_stock" }] });
  });
});
