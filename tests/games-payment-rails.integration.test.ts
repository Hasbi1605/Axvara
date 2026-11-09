import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import { canonicalStringify, reconcileNowpaymentsPayment } from "@/lib/payments/nowpayments";
import { gatewayHmac, reconcileSekalipayGatewayPayment } from "@/lib/payments/sekalipay-gateway";
import { createGamesQuoteToken, verifyGamesQuoteToken } from "@/lib/games/quote";
import { isValidBuyerOrderCode, isValidOrderCode } from "@/lib/security";
import { CRYPTO_ASSETS } from "@/lib/payments/crypto-assets";

const scheduled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: scheduled }));

let f: ReturnType<typeof createD1Fixture>;
let invoices: Map<string, Record<string, unknown>>;
let scenario: "normal" | "rejected" | "absent_unknown" | "timeout" | "crypto_rejected" | "crypto_timeout";
let providerMinutes: number;
let fetchMock: ReturnType<typeof vi.fn>;
const gatewayId = "sekalipay_gateway:TESTVA", cryptoId = "nowpayments:usdtbsc";
const iso = (minutes = 0) => new Date(Date.now() + minutes * 60_000).toISOString();
const request = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://axvara.test${url}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
}) as never;
const orderRow = (code: string) => f.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
const txRow = (code: string) => f.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(code)!;
const itemRow = (code: string) => f.sql.prepare("SELECT status FROM games_order_items WHERE order_code=?").get(code)!;
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

async function quote() {
  const { POST } = await import("@/app/api/games/quote/route");
  const response = await POST(request("/api/games/quote", { slug: "mobile-legends", buyer_sku_code: "ml86",
    fields: { userId: "12345", zoneId: "6789" } }));
  expect(response.status).toBe(200);
  return response.json();
}

async function create(token: string, method = "qris") {
  const { POST } = await import("@/app/api/games/orders/route");
  return POST(request("/api/games/orders", { quote_token: token, payment_method: method, whatsapp: "081234567890", email: "buyer@example.test" }));
}

async function placed(method: string) {
  const q = await quote();
  const response = await create(q.quote_token, method);
  const body = await response.json();
  return { q, response, body, code: body.code as string };
}

async function status(code: string, contact = "buyer@example.test") {
  const { GET } = await import("@/app/api/games/orders/[code]/route");
  return GET(new Request(`https://axvara.test/api/games/orders/${code}`, { headers: { "x-order-contact": contact } }) as never,
    { params: Promise.resolve({ code }) });
}

async function gatewayCallback(code: string, override: Record<string, unknown> = {}) {
  const invoice = invoices.get(code)!;
  const raw = JSON.stringify({ merchant_ref_id: code, invoice: invoice.invoice, amount: invoice.amount, fee: invoice.fee,
    total: invoice.total, status: "paid", paid_at: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " "), ...override });
  const { POST } = await import("@/app/api/payments/sekalipay-gateway/callback/route");
  return POST(new Request("https://axvara.test/api/payments/sekalipay-gateway/callback", {
    method: "POST", body: raw, headers: { "content-type": "application/json", "x-signature": await gatewayHmac("fixture-secret", raw) },
  }) as never);
}

async function cryptoIpn(code: string) {
  const data = invoices.get(code)!;
  const raw = JSON.stringify(data);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-ipn"), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalStringify(data)));
  const signature = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const { POST } = await import("@/app/api/payments/nowpayments/ipn/route");
  return POST(new Request("https://axvara.test/api/payments/nowpayments/ipn", {
    method: "POST", body: raw, headers: { "content-type": "application/json", "x-nowpayments-sig": signature },
  }) as never);
}

beforeEach(() => {
  f = createD1Fixture();
  invoices = new Map();
  scenario = "normal";
  providerMinutes = 120;
  scheduled.mockReset();
  clearRateLimitBucketsForTest();
  resetCryptoMarketMemo();
  for (const [name, value] of Object.entries({ ADMIN_JWT_SECRET: "fixture-games-b2-secret", DIGIFLAZZ_USERNAME: "fixture",
    DIGIFLAZZ_API_KEY: "fixture", DIGIFLAZZ_TESTING: "", WARUNG_REBAHAN_PROXY_URL: "https://proxy.test", WARUNG_REBAHAN_PROXY_TOKEN: "fixture",
    SEKALIPAY_GATEWAY_ENABLED: "true", SEKALIPAY_GATEWAY_API_KEY: crypto.randomUUID(), SEKALIPAY_GATEWAY_SECRET_KEY: "fixture-secret",
    SEKALIPAY_PROXY_URL: "", SEKALIPAY_PROXY_TOKEN: "", NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_API_KEY: "fixture-key",
    NOWPAYMENTS_IPN_SECRET: "fixture-ipn", NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc", NOWPAYMENTS_API_BASE_URL: "https://api.nowpayments.io/v1" })) vi.stubEnv(name, value);
  f.sql.exec(`DELETE FROM payment_methods;
    INSERT INTO games_products(id,buyer_sku_code,game_brand,product_name,cost,sell_price,seller_active,enabled)
      VALUES(1,'ml86','MOBILE LEGENDS','86 Diamond',40000,46000,1,1);
    INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Market fixture','fixture',10000,7);`);
  f.sql.prepare(`INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at,coins_json,coins_refreshed_at)
    VALUES(1,'18000.00','nowpayments-estimate',?,?,?)`).run(iso(-1), JSON.stringify([{ ticker: "usdtbsc", min_usd_text: "1.00" }]), iso(-1));
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith("payment-methods")) return Response.json({ status: true, data: [
      ...["TESTVA", "SHOPEEPAY", "DANA_REALTIME", "SHOPEEPAY_REALTIME"].map((code) => ({ payment_code: code,
        payment_name: code === "DANA_REALTIME" ? "DANA Realtime" : code, payment_type: code === "TESTVA" ? "va" : "ewallet",
        min_amount: 1000, max_amount: 1_000_000, fee_info: { type: "flat", description: "Rp 500" } })),
      { payment_code: "HIGHMIN", payment_name: "Unavailable VA", payment_type: "va", min_amount: 1_000_000, max_amount: 2_000_000,
        fee_info: { type: "flat", description: "Rp 500" } },
    ] });
    if (href.includes("/estimate?")) return Response.json({ currency_from: "usd", currency_to: "usdtbsc", estimated_amount: "3.00" });
    if (href.includes("/min-amount?")) return Response.json({ currency_from: "usdtbsc", currency_to: "usdtbsc", min_amount: "1.00", fiat_equivalent: "1.00" });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.merchant_ref_id) {
        if (scenario === "timeout") throw new Error("network");
        if (scenario === "rejected" || scenario === "absent_unknown") return Response.json({ status: false, message: "rejected" }, { status: 500 });
        const invoice = { merchant_ref_id: body.merchant_ref_id, invoice: `INV-${body.merchant_ref_id}`, amount: body.amount,
          payment_code: body.payment_code, fee: 700, total: body.amount + 700, payment_link: "https://sekalipay.com/payment/fixture",
          virtual_account: "1234567890", expired_at: iso(providerMinutes), is_sandbox: false, status: "pending" };
        invoices.set(body.merchant_ref_id, invoice);
        return Response.json({ status: true, data: invoice }, { status: 201 });
      }
      if (body.order_id) {
        if (scenario === "crypto_timeout") throw new Error("network");
        const invoice = { payment_id: `NP-${body.order_id}`, order_id: body.order_id, price_amount: body.price_amount,
          price_currency: "usd", pay_currency: "usdtbsc", network: "bsc", pay_address: "0xfixture", pay_amount: "3.00",
          payment_status: "waiting", is_fixed_rate: false, is_fee_paid_by_user: false, valid_until: iso(providerMinutes),
          ...(scenario === "crypto_rejected" ? { payin_extra_id: "unsupported-memo" } : {}) };
        invoices.set(body.order_id, invoice);
        return Response.json(invoice, { status: 201 });
      }
    }
    if (href.includes("/gateway/payment/")) {
      const invoice = invoices.get(href.split("/").at(-1)!);
      if (!invoice) return Response.json({ status: false }, { status: scenario === "absent_unknown" ? 503 : 404 });
      return Response.json({ status: true, data: invoice });
    }
    if (href.includes("/v1/payment/NP-")) return Response.json(invoices.get(href.split("/NP-").at(-1)!));
    throw new Error(`Unexpected fixture request ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetCryptoMarketMemo(); });

describe("Games B2 shared payment rails", () => {
  it("signs the available shared catalog, current DANA/ShopeePay curation and canonical per-coin price", async () => {
    const q = await quote();
    const payload = (await verifyGamesQuoteToken(q.quote_token))!;
    const methods = q.paymentMethods as { id: string; label: string; available: boolean; total_cents?: number }[];
    expect(methods.map((m) => m.id)).toEqual(expect.arrayContaining(["qris", gatewayId, cryptoId, "sekalipay_gateway:DANA_REALTIME", "sekalipay_gateway:SHOPEEPAY"]));
    expect(methods.some((m) => m.id === "sekalipay_gateway:SHOPEEPAY_REALTIME")).toBe(false);
    expect(methods.find((m) => m.id === "sekalipay_gateway:DANA_REALTIME")?.label).toBe("DANA");
    expect(payload.payment_methods?.map((m) => m.id)).toEqual(methods.filter((m) => m.available).map((m) => m.id));
    expect(payload.payment_methods?.some((m) => m.id === "sekalipay_gateway:HIGHMIN")).toBe(false);
    const { cryptoPricing } = await import("@/lib/payments/crypto-pricing");
    expect(methods.find((m) => m.id === cryptoId)?.total_cents).toBe(Number(cryptoPricing(BigInt(256), "usdtbsc").totalCents));
  });

  it.each(["nowpayments:btc", "sekalipay_gateway:HIGHMIN", "sekalipay_gateway:SHOPEEPAY_REALTIME"])("rejects unsigned method %s without an order", async (method) => {
    const q = await quote();
    const response = await create(q.quote_token, method);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "quote_stale" });
    expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(posts()).toHaveLength(0);
  });

  it("keeps a full curated crypto catalog usable within the existing request limit", async () => {
    f.sql.prepare("UPDATE crypto_market_snapshot SET coins_json=? WHERE id=1")
      .run(JSON.stringify(CRYPTO_ASSETS.map((asset) => ({ ticker: asset.ticker, min_usd_text: "1.00" }))));
    resetCryptoMarketMemo();
    const q = await quote();
    expect(q.paymentMethods.filter((m: { kind: string }) => m.kind === "crypto")).toHaveLength(CRYPTO_ASSETS.length);
    expect(q.quote_token.length).toBeLessThanOrEqual(30000);
    expect((await create(q.quote_token, cryptoId)).status).toBe(201);
  });

  it.each(["missing", "malformed"])("requires fresh authenticated method data (%s)", async (kind) => {
    const q = await quote();
    const payload = (await verifyGamesQuoteToken(q.quote_token))!;
    const signed = await createGamesQuoteToken({ ...payload, payment_methods: kind === "missing" ? undefined : [{ id: gatewayId }] as never });
    const response = await create(signed.token, gatewayId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "quote_stale" });
    expect(posts()).toHaveLength(0);
  });

  it.each([[gatewayId, 120, 30], [gatewayId, 5, 5], [cryptoId, 120, 60], [cryptoId, 5, 5]])("%s provider %i minutes uses minimum %i and saved retry never POSTs again", async (method, minutes, expected) => {
    providerMinutes = minutes;
    const { q, response, body, code } = await placed(method);
    expect(response.status).toBe(201);
    expect(body.qris).toBeNull();
    expect(body.payment.kind).toBe(method === gatewayId ? "gateway" : "crypto");
    const row = orderRow(code);
    expect(row).toMatchObject({ payment_method: method, order_kind: "games", items: "[]", buyer_access_version: 0 });
    const deadline = Date.parse(String(row.expires_at).replace(" ", "T").replace(/^(.*\d\d:\d\d:\d\d)$/, "$1Z"));
    expect((deadline - Date.now()) / 60_000).toBeCloseTo(expected, 0);
    const before = posts().length;
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    const retry = await create(q.quote_token, method === gatewayId ? cryptoId : gatewayId);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ code, reused: true, payment: { kind: body.payment.kind } });
    expect(posts()).toHaveLength(before);
    expect(orderRow(code).expires_at).toBe(row.expires_at);
    expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(f.sql.prepare("SELECT stock FROM products WHERE id=1").get()?.stock).toBe(7);
  });

  it("degrades to native QRIS when the shared catalog is empty", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    const q = await quote();
    expect(q.paymentMethods.map((m: { id: string }) => m.id)).toEqual(["qris"]);
    expect((await verifyGamesQuoteToken(q.quote_token))?.methods).toEqual(["qris"]);
  });

  it.each([gatewayId, cryptoId])("disabled rail %s returns machine-readable unavailable", async (method) => {
    const q = await quote();
    vi.stubEnv(method === gatewayId ? "SEKALIPAY_GATEWAY_ENABLED" : "NOWPAYMENTS_ENABLED", "false");
    const response = await create(q.quote_token, method);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error_code: "payment_method_unavailable" });
    expect(posts()).toHaveLength(0);
  });

  it.each(["rejected", "absent_unknown", "timeout"] as const)("gateway %s: only confirmed absent cancels, retries keep one claim", async (failure) => {
    scenario = failure;
    const { q, response, body, code } = await placed(gatewayId);
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error_code: "payment_method_unavailable", code: expect.stringMatching(/^AXG-/) });
    expect(orderRow(code).status).toBe(failure === "rejected" ? "dibatalkan" : "pending");
    expect(txRow(code).status).toBe(failure === "rejected" ? "failed" : "initializing");
    expect(itemRow(code).status).toBe(failure === "rejected" ? "expired" : "awaiting_payment");
    const postCount = posts().length;
    await create(q.quote_token, gatewayId);
    expect(posts()).toHaveLength(postCount);
    const newQuote = await quote();
    const next = await create(newQuote.quote_token, gatewayId);
    expect(next.status).toBe(failure === "rejected" ? 503 : 409);
    if (failure !== "rejected") expect(await next.json()).toMatchObject({ error: "duplicate_active_order" });
    expect(f.sql.prepare("SELECT stock FROM products WHERE id=1").get()?.stock).toBe(7);
  });

  it.each(["crypto_rejected", "crypto_timeout"] as const)("crypto %s follows the same definitive/ambiguous contract", async (failure) => {
    scenario = failure;
    const { q, response, code } = await placed(cryptoId);
    expect(response.status).toBe(503);
    expect(orderRow(code).status).toBe(failure === "crypto_rejected" ? "dibatalkan" : "pending");
    expect(itemRow(code).status).toBe(failure === "crypto_rejected" ? "expired" : "awaiting_payment");
    const count = posts().length;
    await create(q.quote_token, cryptoId);
    expect(posts()).toHaveLength(count);
    expect(f.sql.prepare("SELECT stock FROM products WHERE id=1").get()?.stock).toBe(7);
  });

  it("serves consent and safe gateway status/lookup only after full buyer proof", async () => {
    const { code, body } = await placed(gatewayId);
    expect(body.payment).toMatchObject({ state: "fee_consent_required", payment_link: null, virtual_account: null });
    const { POST } = await import("@/app/api/orders/[code]/payment-consent/route");
    const consent = (contact: string, total: number) => POST(request(`/api/orders/${code}/payment-consent`, { contact, expected_final_total: total }), { params: Promise.resolve({ code }) });
    expect((await consent("wrong@example.test", 46700)).status).toBe(404);
    expect((await consent("buyer@example.test", 46500)).status).toBe(409);
    const response = await consent("buyer@example.test", 46700);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ payment: { state: "pending", payment_link: "https://sekalipay.com/payment/fixture", total: 46700 } });
    expect((await status(code, "wrong@example.test")).status).toBe(404);
    const view = await (await status(code)).json();
    expect(view.order).toMatchObject({ qris: null, payment: { kind: "gateway", state: "pending" } });
    const { POST: lookup } = await import("@/app/api/games/lookup/route");
    const lookupView = await (await lookup(request("/api/games/lookup", { code, contact: "buyer@example.test" }))).json();
    expect(lookupView.order.payment).toMatchObject({ kind: "gateway", state: "pending" });
    expect(JSON.stringify(lookupView)).not.toMatch(/provider_payment_id|cost_snapshot|max_price|fixture-secret/);
  });

  it.each([gatewayId, cryptoId])("%s verified callback dispatches Games once, replay never enters Market", async (method) => {
    const { code } = await placed(method);
    const invoice = invoices.get(code)!;
    if (method === gatewayId) {
      f.sql.prepare("UPDATE payment_transactions SET gateway_fee_consented_at=datetime('now') WHERE order_code=?").run(code);
      Object.assign(invoice, { status: "paid", paid_at: iso(-0.01) });
      expect((await gatewayCallback(code)).status).toBe(200);
      expect((await gatewayCallback(code)).status).toBe(200);
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("already_paid");
    } else {
      Object.assign(invoice, { payment_status: "finished", actually_paid: "3.00", updated_at: iso(-0.01) });
      expect((await cryptoIpn(code)).status).toBe(200);
      expect((await cryptoIpn(code)).status).toBe(200);
      expect(await reconcileNowpaymentsPayment(code)).toBe("already_paid");
    }
    expect(orderRow(code)).toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(scheduled).toHaveBeenCalledExactlyOnceWith(code, "games");
    expect(f.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
  });

  it.each([gatewayId, cryptoId])("%s buyer status polls its saved invoice and returns the canonical paid view", async (method) => {
    const { code } = await placed(method);
    if (method === gatewayId) {
      f.sql.prepare("UPDATE payment_transactions SET gateway_fee_consented_at=datetime('now') WHERE order_code=?").run(code);
      Object.assign(invoices.get(code)!, { status: "paid", paid_at: iso(-0.01) });
    } else Object.assign(invoices.get(code)!, { payment_status: "finished", actually_paid: "3.00", updated_at: iso(-0.01) });
    const view = await (await status(code)).json();
    expect(view.order).toMatchObject({ games_status: "processing", qris: null, payment_status: "paid", payment: { state: "paid" } });
    expect(scheduled).toHaveBeenCalledExactlyOnceWith(code, "games");
    expect(posts()).toHaveLength(1);
  });

  it("recovers a known gateway finalize probe through status GET without another provider POST", async () => {
    const { code } = await placed(gatewayId);
    f.sql.prepare(`UPDATE payment_transactions SET status='initializing',payable_amount=NULL,gateway_fee=NULL,
      last_error='sekalipay_gateway_finalize_probe' WHERE order_code=?`).run(code);
    const view = await (await status(code)).json();
    expect(view.order.payment).toMatchObject({ state: "fee_consent_required", total: 46700 });
    expect(posts()).toHaveLength(1);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it.each(["late", "mismatch", "underpaid"])("crypto %s stays manual review without dispatch", async (failure) => {
    const { code } = await placed(cryptoId);
    Object.assign(invoices.get(code)!, { payment_status: "finished", actually_paid: failure === "underpaid" ? "0.01" : "3.00",
      updated_at: iso(-0.01), ...(failure === "mismatch" ? { pay_currency: "btc" } : {}) });
    if (failure === "late") f.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
    expect(await reconcileNowpaymentsPayment(code)).toBe("manual_review");
    expect(orderRow(code).payment_status).toBe("pending");
    expect(txRow(code).last_error).toMatch(/manual_review/);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it.each(["late", "mismatch", "no_consent"])("gateway %s stays manual review without dispatch", async (failure) => {
    const { code } = await placed(gatewayId);
    Object.assign(invoices.get(code)!, { status: "paid", paid_at: iso(-0.01), ...(failure === "mismatch" ? { amount: 1 } : {}) });
    if (failure !== "no_consent") f.sql.prepare("UPDATE payment_transactions SET gateway_fee_consented_at=datetime('now') WHERE order_code=?").run(code);
    if (failure === "late") f.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
    expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
    expect(orderRow(code).payment_status).toBe("pending");
    expect(scheduled).not.toHaveBeenCalled();
  });

  it.each(["AXG", "AXP"])("shared guard accepts %s but Market status rejects it", async (prefix) => {
    const code = `${prefix}-20261109-TEST0001`;
    expect(isValidBuyerOrderCode(code)).toBe(true);
    expect(isValidOrderCode(code)).toBe(false);
    const { GET } = await import("@/app/api/orders/[code]/route");
    const response = await GET(new Request(`https://axvara.test/api/orders/${code}`, { headers: { "x-order-contact": "buyer@example.test" } }) as never,
      { params: Promise.resolve({ code }) });
    expect(response.status).toBe(400);
  });
});
