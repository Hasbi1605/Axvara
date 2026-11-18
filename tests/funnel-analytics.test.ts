import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { trackFunnelEvent, trackPaidOrder, type FunnelEventInput } from "@/lib/analytics/funnel";
import { transitionPendingOrder, transitionPendingPaymentToPaid } from "@/lib/db/orders-transition";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16 } from "@/lib/payments/dana-qris";

const write = vi.fn();
beforeEach(() => {
  write.mockReset();
  vi.stubGlobal("FUNNEL_ANALYTICS", { writeDataPoint: write });
  vi.stubEnv("CRON_SECRET", "fixture-cron");
  clearRateLimitBucketsForTest();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearRateLimitBucketsForTest(); });

describe("fixed private funnel schema", () => {
  it.each(["view", "quote", "order", "paid"] as const)("%s writes exactly the declared dimensions", stage => {
    trackFunnelEvent({ stage, orderKind: "games", channel: "web", method: "qris:gopay", productId: 12,
      variantId: 34, productSlug: "mobile-legends", locale: "en", subtotal: 58_123, quantity: 2,
      email: "buyer@example.com", name: "Secret Name", orderCode: "AXV-20261118-PIISECRT",
      ip: "192.0.2.1", userAgent: "Private user agent" } as FunnelEventInput);
    expect(write).toHaveBeenCalledExactlyOnceWith({ indexes: [`games:${stage}`],
      blobs: [stage, "games", "web", "qris", "qris:gopay", "12", "en", "ok", "34", "mobile-legends"], doubles: [1, 50_000, 2] });
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/buyer@|Secret Name|AXV-|192\.0\.2|Private user/);
  });
  it.each([
    ["nowpayments:usdtbsc", "crypto", "nowpayments:usdtbsc"],
    ["sekalipay_gateway:BNIVA", "gateway_va", "sekalipay_gateway:BNIVA"],
    ["sekalipay_gateway:DANA_REALTIME", "gateway_ewallet", "sekalipay_gateway:DANA_REALTIME"],
    ["buyer@example.com", "none", "none"], ["AXV-20261118-PRIVATE1", "none", "none"],
  ])("normalizes %s without arbitrary method strings", (method, family, code) => {
    trackFunnelEvent({ stage: "order", method, productSlug: "private@example.com", productId: NaN, variantId: -1 });
    expect(write.mock.calls[0][0].blobs).toEqual(["order", "apps", "web", family, code, "none", "id", "ok", "none", "none"]);
  });
  it.each(["view", "quote", "order", "paid"] as const)("authenticated synthetic %s emits nothing", stage => {
    trackFunnelEvent({ stage }, new Request("http://localhost", { headers: { "x-axvara-synthetic": "1", authorization: "Bearer fixture-cron" } }));
    expect(write).not.toHaveBeenCalled();
  });
  it("derives view locale from the buyer cookie inside the helper (catalog route stays locale-neutral)", () => {
    trackFunnelEvent({ stage: "view", productId: 7 }, new Request("http://localhost", { headers: { cookie: "axv_locale=en" } }));
    trackFunnelEvent({ stage: "view", productId: 7 }, new Request("http://localhost"));
    expect(write.mock.calls.map((c) => c[0].blobs[6])).toEqual(["en", "id"]);
  });
  it("probe UA suppresses views but an unauthenticated synthetic header alone does not", () => {
    trackFunnelEvent({ stage: "view" }, new Request("http://localhost", { headers: { "user-agent": "axvara-synth/1.0" } }));
    expect(write).not.toHaveBeenCalled();
    trackFunnelEvent({ stage: "view" }, new Request("http://localhost", { headers: { "x-axvara-synthetic": "1" } }));
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("absent binding is a no-op, including no paid metadata read", () => {
    vi.stubGlobal("FUNNEL_ANALYTICS", undefined);
    const prepare = vi.fn(() => { throw new Error("must not query"); });
    expect(() => trackFunnelEvent({ stage: "view" })).not.toThrow();
    trackPaidOrder("private-order-code", { prepare, batch: vi.fn() });
    expect(prepare).not.toHaveBeenCalled();
  });
  it("Pages context binding works; rejected async writes are caught and attached to waitUntil", async () => {
    vi.stubGlobal("FUNNEL_ANALYTICS", undefined);
    const tasks: Promise<unknown>[] = [];
    const key = Symbol.for("__cloudflare-request-context__");
    const global = globalThis as unknown as Record<symbol, unknown>;
    global[key] = { env: { FUNNEL_ANALYTICS: { writeDataPoint: write } }, ctx: { waitUntil: (p: Promise<unknown>) => tasks.push(p) } };
    try {
      write.mockRejectedValue(new Error("analytics unavailable"));
      expect(trackFunnelEvent({ stage: "quote" })).toBeUndefined();
      await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
      expect(write).toHaveBeenCalledOnce();
    } finally { delete global[key]; }
  });
});

describe("canonical paid winner", () => {
  it.each(["apps", "pedia", "games"])("concurrent/repeated %s payments emit once, with no buyer/code data", async kind => {
    const f = createD1Fixture();
    try {
      stubFulfillmentKey();
      await insertTestProduct(f.sql);
      const code = "AXV-20261118-PAID0001";
      insertTestOrder(f.sql, code);
      f.sql.prepare("UPDATE orders SET order_kind=?, locale='en' WHERE code=?").run(kind, code);
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,merchant_id,provider_order_id,requested_amount,currency,status,expires_at)
        VALUES (?,'gopay','static_qris','fixture',?,10000,'IDR','pending',datetime('now','+15 minutes'))`).run(code, code);
      const results = await Promise.all(Array.from({ length: 4 }, () => transitionPendingPaymentToPaid(code, null, null, undefined, undefined, f.db)));
      await Promise.resolve();
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await transitionPendingPaymentToPaid(code, null, null, undefined, undefined, f.db)).toBe(false);
      expect(write).toHaveBeenCalledOnce();
      expect(write.mock.calls[0][0]).toEqual({ indexes: [`${kind}:paid`],
        blobs: ["paid", kind, "telegram", "qris", "qris:gopay", "1", "en", "ok", "1", "none"], doubles: [1, 10_000, 1] });
      expect(JSON.stringify(write.mock.calls)).not.toMatch(/AXV-|Test buyer|628000|12345/);
    } finally { f.close(); }
  });
  it("manual admin confirmation shares the same event helper and CAS guard", async () => {
    const f = createD1Fixture();
    try {
      stubFulfillmentKey(); await insertTestProduct(f.sql);
      const code = "AXV-20261118-MANUAL01";
      insertTestOrder(f.sql, code, { channel: "whatsapp" });
      const outcomes = await Promise.allSettled([1, 2].map(() => transitionPendingOrder(code, "lunas", "private admin note", [], f.db)));
      await Promise.resolve();
      expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
      expect(write).toHaveBeenCalledOnce();
      expect(write.mock.calls[0][0].blobs.slice(0, 3)).toEqual(["paid", "apps", "whatsapp"]);
      expect(JSON.stringify(write.mock.calls)).not.toContain("private admin note");
    } finally { f.close(); }
  });
  it.each(["metadata", "write"])("admin/callback race has one winner even when analytics %s fails", async failure => {
    const f = createD1Fixture();
    try {
      stubFulfillmentKey(); await insertTestProduct(f.sql);
      const code = "AXV-20261118-RACING01";
      insertTestOrder(f.sql, code);
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,merchant_id,provider_order_id,requested_amount,status)
        VALUES (?,'dana','static_qris','fixture',?,10000,'pending')`).run(code, code);
      if (failure === "metadata") f.control.fail = sql => sql.includes("SELECT o.order_kind,o.sales_channel");
      else write.mockImplementation(() => { throw new Error("analytics down"); });
      const result = await Promise.allSettled([
        transitionPendingPaymentToPaid(code, null, null, undefined, undefined, f.db),
        transitionPendingOrder(code, "lunas", null, [], f.db),
      ]);
      expect(result.filter(item => item.status === "fulfilled" && item.value !== false)).toHaveLength(1);
      await Promise.resolve();
      expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("lunas");
      expect(write).toHaveBeenCalledTimes(failure === "metadata" ? 0 : 1);
    } finally { f.close(); }
  });
});

describe("real commerce routes with a broken/working analytics binding", () => {
  it.each([false, true])("view/quote/order keep their responses (write failure=%s), replay/probes excluded", async broken => {
    const f = createD1Fixture();
    try {
      stubFulfillmentKey(); await insertTestProduct(f.sql);
      vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
      vi.stubEnv("DANA_QRIS_ENABLED", "true");
      vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-webhook");
      vi.stubEnv("QRIS_ACTIVE_PROVIDER", "dana");
      vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
      vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
      vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
      vi.stubEnv("ADMIN_JWT_SECRET", "fixture-admin-secret");
      const payload = "00020101021153033605802ID6304";
      vi.stubEnv("DANA_STATIC_QRIS", payload + calculateCrc16(payload));
      vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external network"); }));
      const { GET: catalog } = await import("@/app/api/catalog/route");
      expect((await catalog(new Request("http://localhost/api/catalog?slug=fixture", { headers: { "user-agent": "axvara-synth/1.0" } }))).status).toBe(200);
      expect(write).not.toHaveBeenCalled();
      write.mockImplementationOnce(() => { throw new Error("analytics down"); });
      expect((await catalog(new Request("http://localhost/api/catalog?slug=fixture"))).status).toBe(200);
      expect(write).toHaveBeenCalledOnce();
      write.mockClear();
      if (broken) write.mockImplementation(() => { throw new Error("analytics down"); });
      const { POST: quote } = await import("@/app/api/checkout/quote/route");
      const items = [{ product_id: 1, variant_id: 1, qty: 1 }];
      const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
      });
      const synthetic = await quote(request("/api/checkout/quote", { items }, { "x-axvara-synthetic": "1", authorization: "Bearer fixture-cron" }));
      expect(synthetic.status).toBe(200); expect(write).not.toHaveBeenCalled();
      const quoteResponse = await quote(request("/api/checkout/quote", { items }));
      expect(quoteResponse.status).toBe(200);
      const quoted = await quoteResponse.json();
      expect(write.mock.calls[0][0].blobs[0]).toBe("quote");
      const { POST: create } = await import("@/app/api/orders/route");
      const body = { items, payment_method: "qris", quote_token: quoted.quoteToken, customer_email: "private@example.com", customer_wa: "081234567890", customer_name: "Private Name" };
      const created = await create(request("/api/orders", body));
      expect(created.status, await created.clone().text()).toBe(201);
      expect(write.mock.calls[1][0].blobs.slice(0, 6)).toEqual(["order", "apps", "web", "qris", "qris:dana", "1"]);
      const retry = await create(request("/api/orders", body));
      expect(retry.status).toBe(200); expect(write).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(write.mock.calls)).not.toMatch(/private@example|081234|Private Name|AXV-/);
    } finally { f.close(); }
  });
});
