import { afterEach, describe, expect, it, vi } from "vitest";
import { createSekalipayGatewayInvoice, listSekalipayMethods, signGatewayRequest, reconcileSekalipayGatewayPayment } from "@/lib/payments/sekalipay-gateway";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const code = "AXV-20261106-PROXY001";
const customer = { name: "Fixture Buyer", email: "buyer@example.test", phone: "081234567890" };
const PROXY = "https://wr-proxy.axvara.test";
const catalog = { status: true, data: [{ payment_code: "TESTVA", payment_name: "VA", payment_type: "va", min_amount: 1000, max_amount: 100000, fee_info: { type: "flat", description: "Rp 4.700" } }] };

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

function setup(opts: { proxy?: boolean; handler?: Handler } = {}) {
  const fixture = createD1Fixture();
  stubFulfillmentKey();
  const calls: Call[] = [];
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-key-${crypto.randomUUID()}`);
  vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
  if (opts.proxy !== false) { vi.stubEnv("SEKALIPAY_PROXY_URL", PROXY); vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "fixture-proxy-token"); }
  const invoice = { merchant_ref_id: code, invoice: "SPYproxy", amount: 10000, fee: 4700, total: 14700, payment_code: "TESTVA", payment_link: "https://sekalipay.com/payment/SPYproxy",
    virtual_account: "1234567890", checkout_url: null, expired_at: new Date(Date.now() + 600000).toISOString(), status: "pending", is_sandbox: false };
  const handler: Handler = opts.handler ?? ((call) => {
    if (call.url.endsWith("payment-methods")) return Response.json(catalog);
    return Response.json({ status: true, data: invoice }, { status: call.init.method === "POST" ? 201 : 200 });
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }));
  return { fixture, calls, invoice, posts: () => calls.filter((c) => c.init.method === "POST").length };
}

async function seedOrder(f: ReturnType<typeof setup>) {
  await insertTestProduct(f.fixture.sql);
  insertTestOrder(f.fixture.sql, code, { channel: "web" });
  f.fixture.sql.prepare("UPDATE orders SET expires_at=?,payment_method='sekalipay_gateway:TESTVA' WHERE code=?").run(new Date(Date.now() + 900000).toISOString(), code);
}
const create = () => createSekalipayGatewayInvoice(code, 10000, "TESTVA", customer, 4700);
const txStatus = (f: ReturnType<typeof setup>) => f.fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(code)?.status;

describe("Sekalipay gateway transport selection", () => {
  it("uses the VPS proxy with x-proxy-token and canonical upstream signature path", async () => {
    const f = setup();
    try {
      await listSekalipayMethods(20000);
      expect(f.calls).toHaveLength(1);
      const [{ url, init }] = f.calls;
      expect(url).toBe(`${PROXY}/skg/v1/gateway/payment-methods`);
      expect(init.redirect).toBe("manual");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-proxy-token"]).toBe("fixture-proxy-token");
      expect(headers["X-API-Key"]).toMatch(/^fixture-key-/);
      expect(headers["X-Signature"]).toBe(await signGatewayRequest("fixture-secret", "GET", "api/v1/gateway/payment-methods", {}, Number(headers["X-Timestamp"])));
    } finally { f.fixture.close(); }
  });

  it("goes direct without x-proxy-token when proxy env is unset", async () => {
    const f = setup({ proxy: false });
    try {
      await listSekalipayMethods(20000);
      const [{ url, init }] = f.calls;
      expect(url).toBe("https://sekalipay.com/api/v1/gateway/payment-methods");
      expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain("x-proxy-token");
    } finally { f.fixture.close(); }
  });

  it.each([
    ["only url", { SEKALIPAY_PROXY_URL: PROXY, SEKALIPAY_PROXY_TOKEN: "" }],
    ["only token", { SEKALIPAY_PROXY_URL: "", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["http", { SEKALIPAY_PROXY_URL: "http://wr-proxy.axvara.test", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["credentials", { SEKALIPAY_PROXY_URL: "https://u:p@wr-proxy.axvara.test", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["port", { SEKALIPAY_PROXY_URL: "https://wr-proxy.axvara.test:8443", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["path", { SEKALIPAY_PROXY_URL: "https://wr-proxy.axvara.test/sk", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["query", { SEKALIPAY_PROXY_URL: "https://wr-proxy.axvara.test?x=1", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["fragment", { SEKALIPAY_PROXY_URL: "https://wr-proxy.axvara.test#x", SEKALIPAY_PROXY_TOKEN: "t" }],
    ["garbage", { SEKALIPAY_PROXY_URL: "not a url", SEKALIPAY_PROXY_TOKEN: "t" }],
  ])("rejects invalid proxy config without any request (%s)", async (_name, env) => {
    const f = setup({ proxy: false });
    try {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      await expect(listSekalipayMethods(20000)).rejects.toThrow("sekalipay_gateway_proxy_config_error");
      expect(f.calls).toHaveLength(0);
    } finally { f.fixture.close(); }
  });

  it("accepts a trailing-slash origin", async () => {
    const f = setup();
    try {
      vi.stubEnv("SEKALIPAY_PROXY_URL", `${PROXY}/`);
      await listSekalipayMethods(20000);
      expect(f.calls[0].url).toBe(`${PROXY}/skg/v1/gateway/payment-methods`);
    } finally { f.fixture.close(); }
  });
});

describe("Sekalipay gateway create/status via proxy", () => {
  it("sends the signed POST byte-identically to the proxy and the status GET via proxy", async () => {
    const f = setup();
    try {
      await seedOrder(f);
      expect((await create()).invoice).toBe("SPYproxy");
      const post = f.calls.find((c) => c.init.method === "POST")!;
      expect(post.url).toBe(`${PROXY}/skg/v1/gateway/payment`);
      const headers = post.init.headers as Record<string, string>;
      expect(headers["x-proxy-token"]).toBe("fixture-proxy-token");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(typeof post.init.body).toBe("string");
      const body = JSON.parse(post.init.body as string);
      expect(post.init.body).toBe(JSON.stringify(body));
      expect(body).toMatchObject({ merchant_ref_id: code, amount: 10000, payment_code: "TESTVA", customer_email: customer.email });
      expect(headers["X-Signature"]).toBe(await signGatewayRequest("fixture-secret", "POST", "api/v1/gateway/payment", body, Number(headers["X-Timestamp"])));
      expect(post.init.redirect).toBe("manual");

      f.fixture.sql.prepare("UPDATE payment_transactions SET status='initializing' WHERE order_code=?").run(code);
      await reconcileSekalipayGatewayPayment(code).catch(() => {});
      const get = f.calls.find((c) => c.url.includes(`/payment/${code}`))!;
      expect(get.url).toBe(`${PROXY}/skg/v1/gateway/payment/${code}`);
      expect((get.init.headers as Record<string, string>)["x-proxy-token"]).toBe("fixture-proxy-token");
      expect((get.init.headers as Record<string, string>)["X-Signature"]).toBe(await signGatewayRequest("fixture-secret", "GET", `api/v1/gateway/payment/${code}`, {}, Number((get.init.headers as Record<string, string>)["X-Timestamp"])));
    } finally { f.fixture.close(); }
  });

  it("keeps the same body bytes direct and via proxy", async () => {
    const bodies: string[] = [];
    for (const proxy of [true, false]) {
      const f = setup({ proxy });
      try {
        await seedOrder(f);
        await create();
        bodies.push(f.calls.find((c) => c.init.method === "POST")!.init.body as string);
      } finally { f.fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it.each([
    ["502 unreadable marker", () => Response.json({ message: "skg_proxy_unreadable_response: network_error" }, { status: 502 })],
    ["504 timeout", () => Response.json({ message: "skg_proxy_timeout" }, { status: 504 })],
    ["network error", () => { throw new Error("network"); }],
  ])("proxy %s on create is ambiguous: claim kept, no second POST, GET recovers", async (_name, failure) => {
    let failing = true;
    const f = setup({ handler: (call) => {
      if (call.url.endsWith("payment-methods")) return Response.json(catalog);
      if (call.init.method === "POST" && failing) return failure();
      return Response.json({ status: true, data: f.invoice });
    } });
    try {
      await seedOrder(f);
      await expect(create()).rejects.toThrow("sekalipay_gateway_create_ambiguous");
      expect(txStatus(f)).toBe("initializing");
      failing = false;
      expect((await create()).invoice).toBe("SPYproxy");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("proxy 401 unauthorized on create fails closed as configuration error without another POST", async () => {
    const f = setup({ handler: (call) => call.url.endsWith("payment-methods") ? Response.json(catalog) : Response.json({ status: false, reason: "unauthorized" }, { status: 401 }) });
    try {
      await seedOrder(f);
      await expect(create()).rejects.toThrow("sekalipay_gateway_proxy_config_error");
      await expect(create()).rejects.toThrow("sekalipay_gateway_proxy_config_error");
      expect(f.posts()).toBe(1);
      expect(txStatus(f)).toBe("initializing");
    } finally { f.fixture.close(); }
  });

  it("proxy 404 unknown_skg_path is a configuration error on reads and create", async () => {
    const f = setup({ handler: () => Response.json({ message: "unknown_skg_path" }, { status: 404 }) });
    try {
      await expect(listSekalipayMethods(20000)).rejects.toThrow("sekalipay_gateway_proxy_config_error");
      await seedOrder(f);
      await expect(create()).rejects.toThrow("sekalipay_gateway_proxy_config_error");
    } finally { f.fixture.close(); }
  });

  it("an upstream business 401 without the proxy marker stays a normal failure; proxy 502/504 reads keep read semantics", async () => {
    const f = setup({ handler: () => Response.json({ message: "bad key" }, { status: 401 }) });
    try {
      await expect(listSekalipayMethods(20000)).rejects.toThrow("sekalipay_gateway_methods_unavailable");
    } finally { f.fixture.close(); }
    const g = setup({ handler: () => Response.json({ message: "skg_proxy_timeout" }, { status: 504 }) });
    try {
      await expect(listSekalipayMethods(20000)).rejects.toThrow("sekalipay_gateway_methods_unavailable");
    } finally { g.fixture.close(); }
  });

  it("direct mode keeps timeout-on-create ambiguity", async () => {
    const f = setup({ proxy: false, handler: (call) => { if (call.url.endsWith("payment-methods")) return Response.json(catalog); throw new Error("network"); } });
    try {
      await seedOrder(f);
      await expect(create()).rejects.toThrow("sekalipay_gateway_create_ambiguous");
      expect(txStatus(f)).toBe("initializing");
    } finally { f.fixture.close(); }
  });

  it("still rejects an invoice payment_link outside sekalipay.com when routed through the proxy", async () => {
    const f = setup();
    try {
      await seedOrder(f);
      f.invoice.payment_link = "https://evil.example/payment/x";
      await expect(create()).rejects.toThrow("sekalipay_gateway_invalid_invoice");
    } finally { f.fixture.close(); }
  });
});
