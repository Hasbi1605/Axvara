import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateGatewayFee, gatewayDisplayName, gatewayHmac, gatewayParams, listSekalipayCatalog, listSekalipayMethods, parseGatewayFee, signGatewayRequest, verifyGatewayWebhook, createSekalipayGatewayInvoice, confirmGatewayFee, confirmGatewayInvoiceAbsent, markGatewayInvoiceCreateRejected } from "@/lib/payments/sekalipay-gateway";
import type { DatabaseAccess } from "@/lib/db-access";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";
const queue = vi.hoisted(() => ({ enabled: false, send: vi.fn(async () => undefined) }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => {
  if (!queue.enabled) throw new Error("No fixture Pages context");
  return { env: { ORDER_FULFILLMENT_QUEUE: { send: queue.send } }, ctx: { waitUntil: vi.fn() } };
} }));

afterEach(() => { queue.enabled = false; queue.send.mockClear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Sekalipay merchant contract fixtures", () => {
  it("matches all published HMAC vectors and rejects changed raw body", async () => {
    const secret = "sk_test_contoh_saja";
    const body = '{"merchant_ref_id":"ORDER-001","amount":50000,"payment_code":"QRIS"}';
    expect(await gatewayHmac(secret, body)).toBe("f8fbd182f2c14ae0b8a231f0687e4070f095fe1881374f09f6a4634cf021fbfa");
    expect(await signGatewayRequest(secret, "POST", "api/v1/gateway/payment", { merchant_ref_id: "ORDER-001", amount: 50000, payment_code: "QRIS" }, 1791446400)).toBe("46e51144b78aefcf73342111a465ddd6aede25abdcfbfdbb4c6cf1b792116402");
    const webhook = '{"merchant_ref_id":"ORDER-2026-00184","invoice":"SPY1791446400K3QZ","amount":150000,"fee":1500,"total":151500,"status":"paid","paid_at":"2026-10-08 15:05:12"}';
    const signature = "2101dd6c3812f2bcc9908337098fbded3c573aa3943d89abca71527840af0d76";
    expect(await verifyGatewayWebhook(secret, webhook, signature)).toBe(true);
    expect(await verifyGatewayWebhook(secret, `${webhook} `, signature)).toBe(false);
    expect(gatewayParams({ z: " a b~ ", b: true, a: "", n: null })).toBe("b=1&z=a+b%7E");
  });

  it("parses only documented fee descriptions using integer estimates", () => {
    expect(estimateGatewayFee(150000, parseGatewayFee("flat", "Rp 4.700")!)).toBe(4700);
    expect(estimateGatewayFee(150000, parseGatewayFee("percent", "3,7%")!)).toBe(5550);
    expect(estimateGatewayFee(150000, parseGatewayFee("mixed", "Rp 200 + 0.7%")!)).toBe(1250);
    expect(estimateGatewayFee(150, parseGatewayFee("percent", "1%")!)).toBe(2);
    for (const invalid of ["Rp 4.70", "Rp 4.700,00", "mulai Rp 10", "-1%", "101%", "1.12345%"]) {
      expect(parseGatewayFee(invalid.includes("%") ? "percent" : "flat", invalid)).toBeNull();
    }
  });

  it("fetches signed enabled methods, excludes QRIS/unknown fees, caches and enforces range", async () => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "fixture-key");
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
    const method = { payment_code: "TESTVA", payment_name: "Fixture VA", payment_type: "va", min_amount: 1000, max_amount: 100000, fee_info: { type: "flat", description: "Rp 4.700" } };
    const fetchMock = vi.fn(async () => Response.json({ status: true, data: [method, { ...method, payment_code: "realtime_qris" }, { ...method, payment_code: "X", fee_info: { type: "flat", description: "unknown" } }, { ...method, payment_code: "Y", payment_type: "qris" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listSekalipayMethods(20000)).toMatchObject([{ code: "TESTVA", estimatedFee: 4700, estimatedTotal: 24700 }]);
    expect(await listSekalipayMethods(101000)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sekalipay.com/api/v1/gateway/payment-methods");
    expect(options.redirect).toBe("manual");
    const headers = options.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers["X-Signature"]).toBe(await signGatewayRequest("fixture-secret", "GET", "api/v1/gateway/payment-methods", {}, Number(headers["X-Timestamp"])));
  });
});

describe("curated catalog channels (FIXTURE)", () => {
  const wallet = (payment_code: string, payment_name: string, description = "3.5%") => ({
    payment_code, payment_name, payment_type: "ewallet", min_amount: 1_000, max_amount: 1_000_000, fee_info: { type: "percent", description },
  });
  const stubCatalog = (data: unknown[]) => {
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `curated-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data })));
  };

  it("offers the ordinary SHOPEEPAY channel labelled ShopeePay and DANA_REALTIME labelled DANA; never ShopeePay Realtime", async () => {
    stubCatalog([
      wallet("SHOPEEPAY", "ShopeePay"), wallet("SHOPEEPAY_REALTIME", "ShopeePay Realtime"),
      wallet("DANA_REALTIME", "DANA Realtime", "3.7%"), wallet("GOPAY", "GoPay", "2%"), wallet("OVO", "OVO", "1%"),
    ]);
    const catalog = await listSekalipayCatalog(58_000);
    expect(catalog.map((entry) => entry.code)).toEqual(["SHOPEEPAY", "DANA_REALTIME", "GOPAY", "OVO"]);
    expect(catalog.map((entry) => entry.name)).toEqual(["ShopeePay", "DANA", "GoPay", "OVO"]);
    expect(catalog.every((entry) => !/realtime/i.test(entry.name))).toBe(true);
    expect(catalog.some((entry) => /^SHOPEEPAY_REALTIME$/i.test(entry.code))).toBe(false);
    expect(catalog.find((entry) => entry.code === "SHOPEEPAY")).toMatchObject({ available: true, estimatedFee: 2_030, estimatedTotal: 60_030 });
    expect((await listSekalipayMethods(58_000)).map((entry) => entry.code)).toEqual(["SHOPEEPAY", "DANA_REALTIME", "GOPAY", "OVO"]);
  });

  it("never offers ShopeePay Realtime and never falls back either way", async () => {
    stubCatalog([wallet("SHOPEEPAY_REALTIME", "ShopeePay Realtime"), wallet("DANA_REALTIME", "DANA Realtime")]);
    // DANA_REALTIME tetap ditawarkan (keputusan owner 7 Nov 2026) meski create-nya bisa gagal;
    // SHOPEEPAY_REALTIME tidak pernah masuk katalog.
    expect((await listSekalipayCatalog(58_000)).map((entry) => entry.code)).toEqual(["DANA_REALTIME"]);
    expect((await listSekalipayMethods(58_000)).map((entry) => entry.code)).toEqual(["DANA_REALTIME"]);
    // Ordinary SHOPEEPAY tetap ditawarkan tanpa bergantung pada realtime.
    stubCatalog([wallet("SHOPEEPAY", "ShopeePay")]);
    expect((await listSekalipayCatalog(58_000)).map((entry) => entry.code)).toEqual(["SHOPEEPAY"]);
  });

  it("excludes only the exact SHOPEEPAY_REALTIME ID (case-insensitive) and never rewrites unknown labels or reads object prototypes", async () => {
    stubCatalog([
      wallet("CUSTOM_EW", "constructor"), wallet("PROTO_EW", "__proto__"), wallet("LEGACY_LOOKING", "ShopeePay Realtime"),
      wallet("SHOPEEPAY_REALTIME", "ShopeePay Realtime"), wallet("DANA_REALTIME", "DANA Realtime", "3.7%"),
      wallet("SHOPEEPAY_REALTIME_X", "ShopeePay Realtime X"), wallet("dana_realtime", "DANA Realtime"), wallet("SHOPEEPAY", "ShopeePay"),
    ]);
    const catalog = await listSekalipayCatalog(58_000);
    // Substring "SHOPEEPAY_REALTIME_X" BUKAN ID realtime eksak; lowercase juga dikecualikan (regex i).
    // DANA_REALTIME (dan lowercase-nya) DITAMPILKAN dengan label "DANA" sejak keputusan owner 7 Nov 2026.
    expect(catalog.map((entry) => `${entry.code}:${entry.name}`)).toEqual([
      "CUSTOM_EW:constructor", "PROTO_EW:__proto__", "LEGACY_LOOKING:ShopeePay Realtime",
      "DANA_REALTIME:DANA", "SHOPEEPAY_REALTIME_X:ShopeePay Realtime X", "dana_realtime:DANA", "SHOPEEPAY:ShopeePay",
    ]);
    expect(gatewayDisplayName("unknown-ew", "ShopeePay Realtime")).toBe("ShopeePay Realtime");
    expect(gatewayDisplayName("constructor", "__proto__")).toBe("__proto__");
    expect(gatewayDisplayName("__PROTO__", "constructor")).toBe("constructor");
    expect(gatewayDisplayName("dana_realtime", "DANA Realtime")).toBe("DANA");
  });
});

describe("merchant invoice and fee consent", () => {
  const code = "AXV-20261104-TEST0001";
  const customer = { name: "Fixture Buyer", email: "buyer@example.test", phone: "081234567890" };
  const make = async (scenario: string, fee = 4700, override: Record<string, unknown> = {}) => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    await insertTestProduct(fixture.sql);
    insertTestOrder(fixture.sql, code, { channel: "web" });
    fixture.sql.prepare("UPDATE orders SET expires_at=?,payment_method='sekalipay_gateway:TESTVA' WHERE code=?").run(new Date(Date.now() + 900000).toISOString(), code);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${scenario}-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
    const invoice: Record<string, unknown> = { merchant_ref_id: code, invoice: "SPYfixture", amount: 10000, fee, total: 10000 + fee, payment_code: "TESTVA", payment_link: "https://sekalipay.com/payment/SPYfixture", virtual_account: "1234567890", checkout_url: null, expired_at: new Date(Date.now() + 600000).toISOString(), status: "pending", is_sandbox: false, ...override };
    const statusInvoice = { ...invoice };
    let posts = 0;
    const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("payment-methods")) return Response.json({ status: true, data: [{ payment_code: "TESTVA", payment_name: "VA", payment_type: "va", min_amount: 1000, max_amount: 100000, fee_info: { type: "flat", description: "Rp 4.700" } }] });
      if (init?.method === "POST") {
        posts++;
        expect(JSON.parse(String(init.body))).toMatchObject({ merchant_ref_id: code, amount: 10000, payment_code: "TESTVA", customer_email: customer.email, callback_url: expect.stringContaining("/api/payments/sekalipay-gateway/callback"), return_url: expect.stringContaining("/lacak-pesanan") });
        expect(init.redirect).toBe("manual");
        if (scenario === "timeout") throw new Error("network");
        if (scenario === "adopt") return Response.json({ code: "PAYMENT_ALREADY_EXISTS", data: invoice }, { status: 409 });
        if (scenario === "duplicate") return Response.json({ code: "DUPLICATE_REF_ID" }, { status: 409 });
      }
      return Response.json({ status: true, data: init?.method === "POST" ? invoice : statusInvoice }, { status: init?.method === "POST" ? 201 : 200 });
    });
    vi.stubGlobal("fetch", mock);
    const create = () => createSekalipayGatewayInvoice(code, 10000, "TESTVA", customer, 4700);
    return { fixture, create, mock, invoice, statusInvoice, posts: () => posts };
  };

  const callback = async (invoice: Record<string, unknown>, badSignature = false) => {
    const raw = JSON.stringify({ merchant_ref_id: invoice.merchant_ref_id, invoice: invoice.invoice, amount: invoice.amount, fee: invoice.fee, total: invoice.total, status: invoice.status, paid_at: "2026-11-04 09:00:00" });
    const { POST } = await import("@/app/api/payments/sekalipay-gateway/callback/route");
    return POST(new NextRequest("https://axvara.test/api/payments/sekalipay-gateway/callback", { method: "POST", headers: { "content-type": "application/json", "x-signature": badSignature ? "0".repeat(64) : await gatewayHmac("fixture-secret", raw) }, body: raw }));
  };

  it("persists net, final fee and same-quote consent; retry never posts again", async () => {
    const f = await make("normal");
    try {
      const first = await f.create();
      expect(first).toMatchObject({ net: 10000, fee: 4700, total: 14700, invoice: "SPYfixture", feeConsentRequired: false, virtualAccount: "1234567890" });
      expect(f.fixture.sql.prepare("SELECT requested_amount,payable_amount,gateway_fee,gateway_estimated_fee FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ requested_amount: 10000, payable_amount: 14700, gateway_fee: 4700, gateway_estimated_fee: 4700 });
      vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      expect(await f.create()).toEqual(first);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it.each(["adopt", "duplicate"])("adopts 409 %s without another POST", async (scenario) => {
    const f = await make(scenario);
    try { expect((await f.create()).invoice).toBe("SPYfixture"); expect(f.posts()).toBe(1); } finally { f.fixture.close(); }
  });

  it("retains ambiguous initializing claim, retry uses GET only", async () => {
    const f = await make("timeout");
    try {
      await expect(f.create()).rejects.toThrow();
      expect(f.fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(code)?.status).toBe("initializing");
      const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
      expect(await buildSekalipayGatewayPaymentView(code)).toMatchObject({ state: "initializing", payment_link: null, virtual_account: null });
      vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      expect((await f.create()).invoice).toBe("SPYfixture");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("concurrent claims never issue a second POST", async () => {
    const f = await make("race");
    try {
      await Promise.allSettled([f.create(), f.create()]);
      expect(f.posts()).toBe(1);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE order_code=?").get(code)?.n).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("rejects a mismatched saved order binding before POST", async () => {
    const f = await make("wrong-binding");
    try {
      f.fixture.sql.prepare("UPDATE orders SET payment_method='qris' WHERE code=?").run(code);
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_order_conflict");
      expect(f.posts()).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("withholds changed fee details until exact live-order consent", async () => {
    const f = await make("changed", 5000);
    try {
      expect(await f.create()).toMatchObject({ feeConsentRequired: true, total: 15000, paymentLink: null, virtualAccount: null });
      expect(await confirmGatewayFee(code, 14999)).toBe(false);
      expect(await confirmGatewayFee(code, 15000)).toBe(true);
      expect(await f.create()).toMatchObject({ feeConsentRequired: false, total: 15000, virtualAccount: "1234567890" });
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it.each([{ merchant_ref_id: "FOREIGN" }, { payment_code: "OTHER" }, { amount: 9999 }, { total: 9999 }])("rejects mismatched response %j", async (override) => {
    const f = await make("mismatch", 4700, override);
    try { await expect(f.create()).rejects.toThrow("sekalipay_gateway_invalid_invoice"); expect(f.fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(code)?.status).toBe("initializing"); } finally { f.fixture.close(); }
  });

  it("retains known invoice when finalization fails", async () => {
    const f = await make("failure");
    try {
      f.fixture.control.fail = (sql) => sql.includes("UPDATE payment_transactions SET payable_amount=");
      await expect(f.create()).rejects.toThrow();
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", last_error: "sekalipay_gateway_finalize_probe" });
      f.fixture.control.fail = null;
      expect((await f.create()).invoice).toBe("SPYfixture");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("retains but hides an invoice if order expires before finalization", async () => {
    const f = await make("late");
    try {
      f.fixture.control.fail = (sql) => {
        if (sql.includes("UPDATE payment_transactions SET payable_amount=")) f.fixture.sql.prepare("UPDATE orders SET status='kadaluarsa',payment_status='expired' WHERE code=?").run(code);
        return false;
      };
      const result = await f.create();
      expect(result).toMatchObject({ invoice: "SPYfixture", paymentLink: null, virtualAccount: null });
      expect(f.fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(code)?.last_error).toBe("sekalipay_gateway_late_manual_review");
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
    } finally { f.fixture.close(); }
  });

  it("signed paid callback with flag off pays and enqueues once; replay is idempotent", async () => {
    const f = await make("paid");
    try {
      await f.create();
      f.invoice.status = "paid"; f.invoice.paid_at = new Date().toISOString(); Object.assign(f.statusInvoice, f.invoice);
      vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      expect((await callback(f.invoice, true)).status).toBe(401);
      expect((await callback(f.invoice)).status).toBe(200);
      expect((await callback(f.invoice)).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("lunas");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(code)?.n).toBe(1);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE order_code=? AND status='matched'").get(code)?.n).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("enforces shared atomic twenty-status-GET limit with concurrent reconciles", async () => {
    const f = await make("status-budget");
    try {
      await f.create();
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      const results = await Promise.allSettled(Array.from({ length: 25 }, () => reconcileSekalipayGatewayPayment(code)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
      expect(f.mock.mock.calls.filter(([url, init]) => String(url).includes(`/payment/${code}`) && init?.method === "GET")).toHaveLength(20);
    } finally { f.fixture.close(); }
  });

  it("budget exhaustion before atomic paid batch leaves event retryable and no partial paid/outbox", async () => {
    const f = await make("budgeted-paid");
    try {
      await f.create(); Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      const { createBudgetedDatabase, QueryBudgetExceeded } = await import("@/lib/db-access");
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      const budget = createBudgetedDatabase(6, 0, f.fixture.db);
      const before = f.fixture.control.queries;
      await expect(reconcileSekalipayGatewayPayment(code, budget.access)).rejects.toBeInstanceOf(QueryBudgetExceeded);
      expect(f.fixture.control.queries - before).toBeLessThanOrEqual(6);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(f.fixture.sql.prepare("SELECT status FROM dana_webhook_events WHERE order_code=?").get(code)?.status).toBe("received");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("paid");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(1);
    } finally { f.fixture.close(); }
  });
  it.each(["apps", "pedia", "games"])("active gateway %s winner enqueues once, callback/poller replay never schedules", async kind => {
    const f = await make(`queue-${kind}`);
    try {
      await f.create(); f.fixture.sql.prepare("UPDATE orders SET order_kind=? WHERE code=?").run(kind, code);
      f.fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')").run();
      queue.enabled = true;
      Object.assign(f.invoice, { status: "paid", paid_at: new Date().toISOString() }); Object.assign(f.statusInvoice, f.invoice);
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("paid");
      expect((await callback(f.invoice)).status).toBe(200);
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("already_paid");
      expect(queue.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "order_paid", orderKind: kind, orderCode: code, source: "sekalipay_gateway" }));
    } finally { f.fixture.close(); }
  });

  it("actual payments cron respects 300-statement Paid budget and settles multiple paid orders atomically in one tick", async () => {
    const f = await make("cron-paid-budget");
    try {
      await f.create(); vi.stubEnv("CRON_SECRET", "fixture-cron"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      for (let i = 0; i < 4; i++) {
        const id = `AXV-20261104-BUDGET0${i}`;
        insertTestOrder(f.fixture.sql, id, { channel: "web" });
        f.fixture.sql.prepare("UPDATE orders SET payment_method='sekalipay_gateway:TESTVA',expires_at=? WHERE code=?").run(new Date(Date.now() + 600000).toISOString(), id);
        f.fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_fee_consented_at,gateway_channel,gateway_is_sandbox)
          VALUES(?,'sekalipay_gateway','merchant',?,'fixture',10000,14700,?,'pending',?,4700,4700,0,datetime('now'),'TESTVA',0)`).run(id, id, `SPY${id}`, new Date(Date.now() + 600000).toISOString());
      }
      for (const row of f.fixture.sql.prepare("SELECT order_code,provider_payment_id,payable_amount FROM payment_transactions WHERE provider='sekalipay_gateway'").all()) {
        f.fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code) VALUES(?,?,?,'{}','sekalipay_gateway','received',?)")
          .run(`sekalipaygw:${row.provider_payment_id}:paid`, "fixture", row.payable_amount, row.order_code);
      }
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("GET");
        const ref = String(url).split("/").at(-1)!;
        return Response.json({ status: true, data: { merchant_ref_id: ref, invoice: ref === code ? "SPYfixture" : `SPY${ref}`, amount: 10000, fee: 4700, total: 14700, payment_code: "TESTVA", status: "paid", paid_at: new Date().toISOString(), is_sandbox: false } });
      }));
      const { POST } = await import("@/app/api/cron/lite/route");
      const cron = () => POST(new NextRequest("http://localhost/api/cron/lite?job=payments", { method: "POST", headers: { authorization: "Bearer fixture-cron" } }));
      const before = f.fixture.control.queries;
      const first = await cron(); const body = await first.json();
      expect(body.ok).toBe(true);
      expect(body.budget_exhausted).toBeUndefined();
      expect(f.fixture.control.queries - before).toBeLessThanOrEqual(300);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE payment_status='paid'").get()!.n).toBe(5);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()!.n).toBe(5);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE provider='sekalipay_gateway' AND status='received'").get()!.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("selects at most 12 live and 4 late references (within 20/min admission) and observes 20s cooldown with flag off", async () => {
    const f = await make("bounded-pass");
    try {
      for (let i = 0; i < 18; i++) {
        const id = `AXV-20261104-PASS${String(i).padStart(4, "0")}`;
        const isLive = i < 13;
        insertTestOrder(f.fixture.sql, id, { channel: "web" });
        f.fixture.sql.prepare("UPDATE orders SET payment_method='sekalipay_gateway:TESTVA',expires_at=?,status=?,payment_status=? WHERE code=?")
          .run(isLive ? new Date(Date.now() + 600000).toISOString() : new Date(Date.now() - 60000).toISOString(), isLive ? "pending" : "kadaluarsa", isLive ? "pending" : "expired", id);
        f.fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,gateway_channel,gateway_estimated_fee,expires_at)
          VALUES(?,'sekalipay_gateway','merchant',?,'fixture',10000,'initializing','TESTVA',500,?)`).run(id, id, new Date(Date.now() + 600000).toISOString());
      }
      vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        const id = String(url).split("/").at(-1)!;
        return Response.json({ status: true, data: { merchant_ref_id: id, invoice: `SPY${id}`, amount: 10000, fee: 500, total: 10500, payment_code: "TESTVA", status: "pending", is_sandbox: false } });
      }));
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileDueSekalipayGatewayPayments } = await import("@/lib/payments/payment-view");
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(300, 0, f.fixture.db).access)).toEqual({ gateway_checked: 12, gateway_late_checked: 4 });
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(300, 0, f.fixture.db).access)).toEqual({ gateway_checked: 1, gateway_late_checked: 1 });
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(300, 0, f.fixture.db).access)).toEqual({ gateway_checked: 0, gateway_late_checked: 0 });
      expect(f.posts()).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("buyer status polling requires proof and returns freshly paid state", async () => {
    const f = await make("buyer-poll");
    try {
      await f.create();
      f.fixture.sql.prepare("UPDATE orders SET customer_email='buyer@example.test',buyer_access_version=1,buyer_access_format='pin6' WHERE code=?").run(code);
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      f.mock.mockClear();
      const { GET } = await import("@/app/api/orders/route");
      const request = (contact?: string) => new NextRequest(`http://localhost/api/orders?code=${code}`, { headers: contact ? { "x-order-contact": contact } : {} });
      expect((await GET(request())).status).toBe(404);
      expect(f.mock).not.toHaveBeenCalled();
      const result = await GET(request("buyer@example.test")); expect(result.status).toBe(200);
      expect((await result.json()).order).toMatchObject({ status: "lunas", payment: { state: "paid", payment_link: null } });
      expect(f.mock).toHaveBeenCalledTimes(1);
    } finally { f.fixture.close(); }
  });

  it("buyer cancellation blocks review appearing before atomic CAS but allows ordinary unpaid", async () => {
    const f = await make("cancel-race");
    try {
      await f.create();
      f.fixture.sql.prepare("UPDATE orders SET customer_email='buyer@example.test',buyer_access_version=0 WHERE code=?").run(code);
      const batch = f.fixture.db.batch;
      f.fixture.db.batch = async (statements) => {
        f.fixture.sql.prepare("UPDATE payment_transactions SET last_error='sekalipay_gateway_callback_mismatch_manual_review' WHERE order_code=?").run(code);
        return batch(statements);
      };
      const { POST } = await import("@/app/api/orders/[code]/cancel/route");
      const request = () => new NextRequest("http://localhost/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: "buyer@example.test" }) });
      expect((await POST(request(), { params: Promise.resolve({ code }) })).status).toBe(409);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      f.fixture.db.batch = batch;
      f.fixture.sql.prepare("UPDATE payment_transactions SET last_error=NULL WHERE order_code=?").run(code);
      expect((await POST(request(), { params: Promise.resolve({ code }) })).status).toBe(200);
    } finally { f.fixture.close(); }
  });

  it("expiry skips old initializing until local deadline then late paid remains review", async () => {
    const f = await make("lifecycle");
    try {
      await f.create();
      vi.stubEnv("CRON_SECRET", "fixture-cron"); vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      f.fixture.sql.prepare("UPDATE payment_transactions SET status='initializing',created_at=datetime('now','-10 minutes') WHERE order_code=?").run(code);
      const { POST } = await import("@/app/api/cron/lite/route");
      const cron = (job: string) => POST(new NextRequest(`http://localhost/api/cron/lite?job=${job}`, { method: "POST", headers: { authorization: "Bearer fixture-cron" } }));
      expect((await cron("expiry")).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      f.fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(code);
      expect((await cron("expiry")).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("kadaluarsa");
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      expect((await cron("payments")).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(code)?.last_error).toBe("sekalipay_gateway_late_manual_review");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it.each([
    ["channel", { payment_code: "FOREIGN" }], ["gross", { total: 1 }], ["sandbox", { is_sandbox: true }],
    ["production completed", { status: "completed" }], ["missing time", { paid_at: null }],
  ])("rejects inconsistent authoritative status: %s", async (_name, changes) => {
    const f = await make("bad-status");
    try {
      await f.create(); Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString(), ...changes });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it.each([
    ["invoice", { invoice: "SPYforeign" }], ["fee", { fee: 4800, total: 14800 }],
    ["total", { total: 14800 }], ["channel", { payment_code: "OTHER" }], ["net", { amount: 9999 }],
  ])("independent paid GET with changed %s stays in review", async (_name, change) => {
    const f = await make("get-drift");
    try {
      await f.create();
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString(), ...change });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,gateway_fee,payable_amount,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", gateway_fee: 4700, payable_amount: 14700, last_error: "sekalipay_gateway_status_mismatch_manual_review" });
      expect(await buildSekalipayGatewayPaymentView(code)).toMatchObject({ state: "manual_review", payment_link: null });
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
      expect((await f.create()).paymentLink).toBeNull();
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("sandbox completed is paid, but a fee-delta paid before consent is review", async () => {
    const f = await make("sandbox", 4700, { is_sandbox: true });
    try {
      await f.create(); Object.assign(f.statusInvoice, { status: "completed", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("paid");
    } finally { f.fixture.close(); }
    const g = await make("unconsented", 5000);
    try {
      await g.create(); Object.assign(g.invoice, { status: "paid", paid_at: new Date().toISOString() }); Object.assign(g.statusInvoice, g.invoice);
      expect((await callback(g.invoice)).status).toBe(200);
      expect(await confirmGatewayFee(code, 15000)).toBe(false);
      expect(g.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { g.fixture.close(); }
  });

  it("late paid never revives an expired order", async () => {
    const f = await make("late-paid");
    try {
      await f.create(); f.fixture.sql.prepare("UPDATE orders SET status='kadaluarsa',payment_status='expired' WHERE code=?").run(code);
      Object.assign(f.invoice, { status: "paid", paid_at: new Date().toISOString() }); Object.assign(f.statusInvoice, f.invoice);
      expect((await callback(f.invoice)).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("kadaluarsa");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("initializing paid callback recovers known charge into durable review with flag off", async () => {
    const f = await make("initializing");
    try {
      f.fixture.control.fail = (sql) => sql.includes("UPDATE payment_transactions SET payable_amount=");
      await expect(f.create()).rejects.toThrow();
      Object.assign(f.invoice, { status: "paid", paid_at: new Date().toISOString() }); Object.assign(f.statusInvoice, f.invoice);
      vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
      expect((await callback(f.invoice)).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT status FROM dana_webhook_events WHERE order_code=?").get(code)?.status).toBe("failed");
      f.fixture.control.fail = null;
      expect((await callback(f.invoice)).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,payable_amount,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", payable_amount: 14700, last_error: "sekalipay_gateway_initializing_paid_manual_review" });
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("callback before changed fee finalization remains manual review after finalization", async () => {
    const f = await make("init-delta", 5000);
    try {
      f.fixture.control.fail = (sql) => sql.includes("UPDATE payment_transactions SET payable_amount=");
      await expect(f.create()).rejects.toThrow();
      Object.assign(f.invoice, { status: "paid", paid_at: new Date().toISOString() }); Object.assign(f.statusInvoice, f.invoice);
      expect((await callback(f.invoice)).status).toBe(200);
      f.fixture.control.fail = null;
      expect((await callback(f.invoice)).status).toBe(200);
      expect(f.fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(code)?.last_error).toBe("sekalipay_gateway_preconsent_manual_review");
      expect(await confirmGatewayFee(code, 15000)).toBe(false);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("keeps a conflicting signed callback sticky while an in-flight create finalizes", async () => {
    const f = await make("interleaved");
    try {
      const original = f.mock.getMockImplementation()!;
      let release!: () => void;
      let posted!: () => void;
      const started = new Promise<void>((resolve) => { posted = resolve; });
      const pause = new Promise<void>((resolve) => { release = resolve; });
      f.mock.mockImplementation(async (url, init) => {
        if (init?.method === "POST") { posted(); await pause; }
        return original(url, init);
      });
      const creating = f.create();
      await started;
      expect((await callback({ ...f.invoice, status: "paid", amount: 9999, total: 14699 })).status).toBe(409);
      release();
      expect(await creating).toMatchObject({ paymentLink: null, virtualAccount: null, checkoutUrl: null });
      expect(f.fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(code)?.last_error).toBe("sekalipay_gateway_callback_mismatch_manual_review");
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
      expect((await f.create()).paymentLink).toBeNull();
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("initializing recovery never replaces a conflicting bound provider id", async () => {
    const f = await make("bound-id");
    try {
      f.fixture.control.fail = (sql) => sql.includes("UPDATE payment_transactions SET payable_amount=");
      await expect(f.create()).rejects.toThrow();
      f.fixture.control.fail = null;
      Object.assign(f.statusInvoice, { invoice: "SPYforeign", status: "paid", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT provider_payment_id FROM payment_transactions WHERE order_code=?").get(code)?.provider_payment_id).toBe("SPYfixture");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("retains foreign callback review arriving after the invoice claim before finalization", async () => {
    const f = await make("after-claim");
    try {
      let intercepted = 0;
      f.fixture.control.afterRun = async (sql) => {
        if (sql.includes("SET provider_payment_id=COALESCE") && intercepted++ === 0) {
          expect((await callback({ ...f.invoice, invoice: "SPYforeign", status: "paid" })).status).toBe(409);
        }
      };
      expect(await f.create()).toMatchObject({ paymentLink: null, virtualAccount: null, checkoutUrl: null });
      f.fixture.control.afterRun = null;
      expect(intercepted).toBe(1);
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", last_error: "sekalipay_gateway_callback_mismatch_manual_review" });
      expect((await f.create()).paymentLink).toBeNull();
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT last_error FROM payment_transactions WHERE order_code=?").get(code)?.last_error).toBe("sekalipay_gateway_callback_mismatch_manual_review");
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("status conflict replaces a technical probe before finalization", async () => {
    const f = await make("probe-status-conflict");
    try {
      let intercepted = 0;
      Object.assign(f.statusInvoice, { invoice: "SPYforeign", status: "paid", paid_at: new Date().toISOString() });
      f.fixture.control.afterRun = async (sql) => {
        if (sql.includes("SET provider_payment_id=COALESCE") && intercepted++ === 0) {
          const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
          expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
        }
      };
      expect((await f.create()).paymentLink).toBeNull();
      f.fixture.control.afterRun = null;
      expect(intercepted).toBe(1);
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", last_error: "sekalipay_gateway_status_mismatch_manual_review" });
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("finalization refuses an order binding changed after invoice claim", async () => {
    const f = await make("changed-order");
    try {
      f.fixture.control.afterRun = async (sql) => {
        if (sql.includes("SET provider_payment_id=COALESCE")) f.fixture.sql.prepare("UPDATE orders SET subtotal=10001 WHERE code=?").run(code);
      };
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_claim_conflict");
      f.fixture.control.afterRun = null;
      expect(f.fixture.sql.prepare("SELECT status,provider_payment_id,payable_amount FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ status: "initializing", provider_payment_id: "SPYfixture", payable_amount: null });
      expect(await confirmGatewayFee(code, 14700)).toBe(false);
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("atomic paid guard rejects wrong provider, order, invoice, amount, missing event and unconsented fee", async () => {
    const f = await make("guard");
    try {
      await f.create();
      const { transitionPendingPaymentToPaid } = await import("@/lib/db");
      const now = new Date().toISOString();
      const call = (id?: number) => transitionPendingPaymentToPaid(code, now, null, id ? { id } : undefined, { paymentMethod: "sekalipay_gateway", eventMode: "gateway" });
      expect(await call()).toBe(false);
      for (const [key, provider, order, amount] of [
        ["sekalipaygw:SPYfixture:paid", "nowpayments", code, 14700],
        ["sekalipaygw:WRONG:paid", "sekalipay_gateway", code, 14700],
        ["sekalipaygw:SPYfixture:paid", "sekalipay_gateway", code, 14701],
      ] as const) {
        f.fixture.sql.prepare("DELETE FROM dana_webhook_events").run();
        f.fixture.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code) VALUES(?,?,?,?,?,'received',?)").run(key, "fixture", amount, "{}", provider, order);
        const id = Number(f.fixture.sql.prepare("SELECT id FROM dana_webhook_events").get()!.id);
        expect(await call(id)).toBe(false);
      }
      f.fixture.sql.prepare("UPDATE dana_webhook_events SET amount=14700").run();
      f.fixture.sql.prepare("UPDATE payment_transactions SET gateway_fee_consented_at=NULL WHERE order_code=?").run(code);
      const id = Number(f.fixture.sql.prepare("SELECT id FROM dana_webhook_events").get()!.id);
      expect(await call(id)).toBe(false);
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
    } finally { f.fixture.close(); }
  });

  it("does not fulfill when cancellation wins between verified GET and atomic paid batch", async () => {
    const f = await make("paid-race");
    try {
      await f.create(); Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      let raced = false;
      f.fixture.control.beforeRun = async (sql) => {
        if (!raced && sql.includes("INSERT OR IGNORE INTO dana_webhook_events")) {
          raced = true;
          f.fixture.sql.prepare("UPDATE orders SET status='dibatalkan',payment_status='failed' WHERE code=?").run(code);
        }
      };
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("dibatalkan");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("rejects unknown callback ref and mismatched invoice without fulfillment", async () => {
    const f = await make("callback-conflict");
    try {
      await f.create();
      Object.assign(f.invoice, { status: "paid", paid_at: new Date().toISOString() });
      expect((await callback({ ...f.invoice, merchant_ref_id: "AXV-20261104-UNKNOWN1" })).status).toBe(404);
      expect((await callback({ ...f.invoice, invoice: "SPYforeign" })).status).toBe(409);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it.each([
    ["app e-wallet", "https://app.shopeepay.co.id/pay/abc?x=1"],
    ["unknown external", "https://evil.example/checkout"],
  ])("accepts and redacts optional non-canonical checkout_url (%s)", async (_name, url) => {
    const f = await make("checkout-url", 4700, { checkout_url: url });
    try {
      expect(await f.create()).toMatchObject({ invoice: "SPYfixture", paymentLink: "https://sekalipay.com/payment/SPYfixture", checkoutUrl: null });
      expect(f.fixture.sql.prepare("SELECT gateway_checkout_url,gateway_is_sandbox FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ gateway_checkout_url: null, gateway_is_sandbox: 0 });
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("uses the stored create-time sandbox mode when a paid GET omits is_sandbox", async () => {
    const f = await make("no-sandbox-paid");
    try {
      await f.create();
      delete (f.statusInvoice as Record<string, unknown>).is_sandbox;
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("paid");
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("still refuses completed as paid for a stored non-sandbox invoice when GET omits is_sandbox", async () => {
    const f = await make("no-sandbox-completed");
    try {
      await f.create();
      delete (f.statusInvoice as Record<string, unknown>).is_sandbox;
      Object.assign(f.statusInvoice, { status: "completed", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("recovers a failed finalization from a GET without is_sandbox using the probe-stored mode", async () => {
    const f = await make("probe-recovery");
    try {
      f.fixture.control.fail = (sql) => sql.includes("UPDATE payment_transactions SET payable_amount=");
      await expect(f.create()).rejects.toThrow();
      expect(f.fixture.sql.prepare("SELECT provider_payment_id,gateway_is_sandbox,payable_amount FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ provider_payment_id: "SPYfixture", gateway_is_sandbox: 0, payable_amount: null });
      f.fixture.control.fail = null;
      delete (f.statusInvoice as Record<string, unknown>).is_sandbox;
      expect((await f.create()).invoice).toBe("SPYfixture");
      expect(f.fixture.sql.prepare("SELECT payable_amount,gateway_is_sandbox FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ payable_amount: 14700, gateway_is_sandbox: 0 });
      expect(f.posts()).toBe(1);
    } finally { f.fixture.close(); }
  });

  it("keeps a legacy initializing row without a stored create-time sandbox fail-closed", async () => {
    const f = await make("legacy-no-sandbox");
    try {
      f.fixture.sql.prepare(`INSERT INTO payment_transactions
        (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,gateway_channel,gateway_label,gateway_estimated_fee,provider_payment_id,gateway_is_sandbox,expires_at,last_error)
        VALUES(?,'sekalipay_gateway','merchant',?,'fixture',10000,'initializing','TESTVA','VA',4700,'SPYfixture',NULL,?,'sekalipay_gateway_callback_mismatch_manual_review')`)
        .run(code, code, new Date(Date.now() + 600_000).toISOString());
      delete (f.statusInvoice as Record<string, unknown>).is_sandbox;
      Object.assign(f.statusInvoice, { status: "paid", paid_at: new Date().toISOString() });
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await reconcileSekalipayGatewayPayment(code)).toBe("manual_review");
      expect(f.fixture.sql.prepare("SELECT payable_amount,gateway_is_sandbox,last_error FROM payment_transactions WHERE order_code=?").get(code)).toMatchObject({ payable_amount: null, gateway_is_sandbox: null, last_error: "sekalipay_gateway_callback_mismatch_manual_review" });
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_invalid_invoice");
      expect(f.posts()).toBe(0);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
    } finally { f.fixture.close(); }
  });

  it("keeps historic ordinary/realtime saved invoices readable, consentable, retryable and reconcilable", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      const ordinary = "AXV-20261104-LEGACY01";
      const realtime = "AXV-20261104-LEGACY02";
      const future = new Date(Date.now() + 900_000).toISOString();
      const insertSaved = (orderCode: string, channel: string, label: string, fee: number, invoice: string) => {
        insertTestOrder(fixture.sql, orderCode, { channel: "web" });
        fixture.sql.prepare("UPDATE orders SET subtotal=58000,payment_method=?,expires_at=? WHERE code=?").run(`sekalipay_gateway:${channel}`, future, orderCode);
        fixture.sql.prepare(`INSERT INTO payment_transactions
          (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,provider_payment_id,status,expires_at,gateway_fee,gateway_estimated_fee,gateway_fee_consent_required,gateway_fee_consented_at,gateway_channel,gateway_label,gateway_is_sandbox,direct_url)
          VALUES(?,'sekalipay_gateway','merchant',?,'fixture',58000,?,?,'pending',?,?,?,1,NULL,?,?,0,?)`)
          .run(orderCode, orderCode, 58_000 + fee, invoice, future, fee, fee, channel, label, `https://sekalipay.com/payment/${invoice}`);
      };
      insertSaved(ordinary, "SHOPEEPAY", "ShopeePay", 2_030, "SPYLEGACY01");
      insertSaved(realtime, "DANA_REALTIME", "DANA Realtime", 2_146, "SPYLEGACY02");

      const { buildSekalipayGatewayPaymentView } = await import("@/lib/payments/payment-view");
      const { reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
      expect(await buildSekalipayGatewayPaymentView(ordinary)).toMatchObject({ channel: "SHOPEEPAY", label: "ShopeePay", state: "fee_consent_required", payment_link: null, total: 60_030 });
      expect(await confirmGatewayFee(ordinary, 60_030)).toBe(true);
      expect(await buildSekalipayGatewayPaymentView(ordinary)).toMatchObject({ state: "pending", label: "ShopeePay", payment_link: "https://sekalipay.com/payment/SPYLEGACY01" });

      const noCatalog = vi.fn();
      vi.stubGlobal("fetch", noCatalog);
      expect((await createSekalipayGatewayInvoice(ordinary, 58_000, "SHOPEEPAY", customer, 2_030)).invoice).toBe("SPYLEGACY01");
      expect(noCatalog).not.toHaveBeenCalled();

      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "fixture-legacy-key");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data: { merchant_ref_id: ordinary, invoice: "SPYLEGACY01", amount: 58_000, fee: 2_030, total: 60_030, payment_code: "SHOPEEPAY", status: "pending", is_sandbox: false } })));
      expect(await reconcileSekalipayGatewayPayment(ordinary)).toBe("pending");

      expect(await buildSekalipayGatewayPaymentView(realtime)).toMatchObject({ channel: "DANA_REALTIME", label: "DANA" });
      expect(fixture.sql.prepare("SELECT gateway_label FROM payment_transactions WHERE order_code=?").get(realtime)?.gateway_label).toBe("DANA Realtime");
    } finally { fixture.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Klasifikasi kegagalan create + probe read-only "invoice tidak ada" (dipakai Pedia untuk membatalkan HANYA saat definitif).
// ---------------------------------------------------------------------------------------------------------------------
describe("create rejection classification + invoice absence probe", () => {
  const CODE = "AXV-20261107-RJCT0001";
  const customer = { name: "Fixture Buyer", email: "buyer@example.test", phone: "081234567890" };
  const method = { payment_code: "TESTVA", payment_name: "VA", payment_type: "va", min_amount: 1000, max_amount: 100000, fee_info: { type: "flat", description: "Rp 4.700" } };
  const invoice = { merchant_ref_id: CODE, invoice: "SPYrjct", amount: 10000, fee: 4700, total: 14700, payment_code: "TESTVA", payment_link: "https://sekalipay.com/payment/SPYrjct", expired_at: new Date(Date.now() + 600000).toISOString(), status: "pending", is_sandbox: false };

  /** Order + klaim gateway dengan POST/GET yang bisa diatur. `posts`/`gets` merekam trafik. */
  const setup = async (handlers: { post?: () => Response; get?: () => Response } = {}) => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    await insertTestProduct(fixture.sql);
    insertTestOrder(fixture.sql, CODE, { channel: "web" });
    fixture.sql.prepare("UPDATE orders SET expires_at=?,payment_method='sekalipay_gateway:TESTVA' WHERE code=?").run(new Date(Date.now() + 900000).toISOString(), CODE);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `rjct-${crypto.randomUUID()}`);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
    const posts = { count: 0 };
    const gets: string[] = [];
    const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("payment-methods")) return Response.json({ status: true, data: [method] });
      if (init?.method === "POST") {
        posts.count++;
        return handlers.post ? handlers.post() : Response.json({ status: true, data: invoice }, { status: 201 });
      }
      gets.push(target);
      return handlers.get ? handlers.get() : Response.json({ status: true, data: invoice });
    });
    vi.stubGlobal("fetch", mock);
    const create = () => createSekalipayGatewayInvoice(CODE, 10000, "TESTVA", customer, 4700);
    return { fixture, create, mock, posts, gets };
  };
  const txRow = (fixture: ReturnType<typeof createD1Fixture>) =>
    fixture.sql.prepare("SELECT status,last_error,provider_payment_id FROM payment_transactions WHERE order_code=?").get(CODE) as Record<string, unknown>;

  it("rejeksi terbaca (500 JSON) => create_rejected, klaim initializing DIPERTAHANKAN, hanya satu POST", async () => {
    const f = await setup({ post: () => Response.json({ status: false, message: "internal error" }, { status: 500 }) });
    try {
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_create_rejected");
      expect(f.posts.count).toBe(1);
      expect(txRow(f.fixture)).toMatchObject({ status: "initializing", provider_payment_id: null });
      expect(f.fixture.sql.prepare("SELECT status FROM orders WHERE code=?").get(CODE)?.status).toBe("pending");
    } finally { f.fixture.close(); }
  });

  it("502/504 dari transport => create_ambiguous (bukan rejeksi definitif), klaim dipertahankan", async () => {
    for (const status of [502, 504]) {
      const f = await setup({ post: () => Response.json({ message: "gateway hiccup" }, { status }) });
      try {
        await expect(f.create()).rejects.toThrow("sekalipay_gateway_create_ambiguous");
        expect(txRow(f.fixture).status).toBe("initializing");
      } finally { f.fixture.close(); }
    }
  });

  it("timeout/jaringan => create_ambiguous tanpa GET probe yang tidak perlu", async () => {
    const f = await setup({ post: () => { throw new Error("network"); } });
    try {
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_create_ambiguous");
      expect(f.gets).toHaveLength(0);
      expect(txRow(f.fixture).status).toBe("initializing");
    } finally { f.fixture.close(); }
  });

  it("409 DUPLICATE_REF_ID + GET gagal tetap ambigu (jangan pernah dianggap 'invoice tidak ada')", async () => {
    const f = await setup({ post: () => Response.json({ code: "DUPLICATE_REF_ID" }, { status: 409 }), get: () => Response.json({ status: false, message: "not found" }, { status: 404 }) });
    try {
      await expect(f.create()).rejects.toThrow("sekalipay_gateway_create_ambiguous");
      expect(txRow(f.fixture).status).toBe("initializing");
    } finally { f.fixture.close(); }
  });

  it("409 PAYMENT_ALREADY_EXISTS tetap jalur adopsi (bukan rejeksi)", async () => {
    const f = await setup({ post: () => Response.json({ code: "PAYMENT_ALREADY_EXISTS", data: invoice }, { status: 409 }) });
    try {
      expect((await f.create()).invoice).toBe("SPYrjct");
      expect(f.posts.count).toBe(1);
      expect(txRow(f.fixture).status).toBe("pending");
    } finally { f.fixture.close(); }
  });

  it("confirmGatewayInvoiceAbsent: 404=absent, 200 pending=present, 5xx/429/redirect/invalid=unknown", async () => {
    const cases: { response: () => Response; expected: "absent" | "present" | "unknown" }[] = [
      { response: () => Response.json({ status: false, message: "not found" }, { status: 404 }), expected: "absent" },
      { response: () => Response.json({ status: true, data: { ...invoice, status: "pending" } }), expected: "present" },
      { response: () => Response.json({ status: false, message: "boom" }, { status: 500 }), expected: "unknown" },
      { response: () => Response.json({ message: "too many" }, { status: 429 }), expected: "unknown" },
      { response: () => new Response("not json", { status: 200 }), expected: "unknown" },
      { response: () => new Response(null, { status: 302, headers: { location: "https://elsewhere.test/x" } }), expected: "unknown" },
    ];
    for (const item of cases) {
      const f = await setup({ get: item.response });
      try {
        expect(await confirmGatewayInvoiceAbsent(CODE)).toBe(item.expected);
      } finally { f.fixture.close(); }
    }
  });

  it("confirmGatewayInvoiceAbsent: admission rate-limit/timeout => unknown (fail closed), tanpa keputusan batal", async () => {
    const f = await setup({ get: () => { throw new Error("network"); } });
    try {
      expect(await confirmGatewayInvoiceAbsent(CODE)).toBe("unknown");
      // Admission GET payment/* habis (changes=0) => unknown sebelum fetch apa pun.
      const rateLimited = { execRun: vi.fn(async () => ({ changes: 0 })) } as unknown as DatabaseAccess;
      const before = f.mock.mock.calls.length;
      expect(await confirmGatewayInvoiceAbsent(CODE, rateLimited)).toBe("unknown");
      expect(rateLimited.execRun).toHaveBeenCalledTimes(1);
      expect(f.mock.mock.calls.length).toBe(before);
      // Kode tidak valid juga fail closed.
      expect(await confirmGatewayInvoiceAbsent("bukan-kode")).toBe("unknown");
    } finally { f.fixture.close(); }
  });

  it("markGatewayInvoiceCreateRejected hanya menandai klaim murni pra-POST, sekali", async () => {
    const rejected = await setup({ post: () => Response.json({ status: false }, { status: 500 }) });
    try {
      await expect(rejected.create()).rejects.toThrow("sekalipay_gateway_create_rejected");
      expect(await markGatewayInvoiceCreateRejected(CODE)).toBe(true);
      expect(txRow(rejected.fixture)).toMatchObject({ status: "failed", last_error: "sekalipay_gateway_create_rejected", provider_payment_id: null });
      expect(await markGatewayInvoiceCreateRejected(CODE)).toBe(false); // terminal, tidak ditimpa
    } finally { rejected.fixture.close(); }
    const adopted = await setup();
    try {
      await adopted.create();
      // Baris pending + punya invoice id tidak boleh ditandai terminal.
      expect(await markGatewayInvoiceCreateRejected(CODE)).toBe(false);
      expect(txRow(adopted.fixture).status).toBe("pending");
    } finally { adopted.fixture.close(); }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Rekonsiliasi & expiry Sekalipay gateway basi (G2): initializing tanpa ref, pending unpaid/paid/error, throttle 30 mnt,
// batas per tick, dan penutupan atomik di cron expiry bila aman.
// ---------------------------------------------------------------------------------------------------------------------
describe("stale sekalipay_gateway reconciliation and root-cause expiry", () => {
  const seedGatewayOrder = async (
    fixture: ReturnType<typeof createD1Fixture>,
    orderCode: string,
    opts: {
      orderStatus?: string;
      paymentStatus?: string;
      txStatus?: "initializing" | "pending";
      providerOrderId?: string;
      providerPaymentId?: string | null;
      expiresAtOffsetSql?: string;
      lastCheckedOffsetSql?: string | null;
      lastError?: string | null;
      qty?: number;
    } = {},
  ) => {
    insertTestOrder(fixture.sql, orderCode, { channel: "web", qty: opts.qty ?? 1 });
    fixture.sql.prepare(
      `UPDATE orders SET payment_method='sekalipay_gateway:TESTVA', status=?, payment_status=?,
       expires_at=datetime('now', ?) WHERE code=?`,
    ).run(
      opts.orderStatus ?? "kadaluarsa",
      opts.paymentStatus ?? "expired",
      opts.expiresAtOffsetSql ?? "-60 minutes",
      orderCode,
    );
    fixture.sql.prepare(
      `INSERT INTO payment_transactions
       (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,
        provider_payment_id,status,gateway_channel,gateway_estimated_fee,gateway_fee,gateway_is_sandbox,
        expires_at,last_checked_at,last_error)
       VALUES (?,'sekalipay_gateway','merchant',?,'fixture',10000,?,?,?,'TESTVA',500,500,0,
        datetime('now', ?), ${opts.lastCheckedOffsetSql ? "datetime('now', ?)" : "NULL"}, ?)`,
    ).run(
      orderCode,
      opts.providerOrderId ?? orderCode,
      opts.txStatus === "initializing" ? null : 10500,
      opts.providerPaymentId === undefined ? (opts.txStatus === "initializing" ? null : `SPY${orderCode}`) : opts.providerPaymentId,
      opts.txStatus ?? "pending",
      opts.expiresAtOffsetSql ?? "-60 minutes",
      ...(opts.lastCheckedOffsetSql ? [opts.lastCheckedOffsetSql] : []),
      opts.lastError ?? null,
    );
  };

  it("initializing without provider_payment_id or ref closes to expired without calling provider", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      await seedGatewayOrder(fixture, "AXV-20991231-00F17029", {
        orderStatus: "kadaluarsa",
        paymentStatus: "expired",
        txStatus: "initializing",
        providerPaymentId: null,
      });
      await seedGatewayOrder(fixture, "AXV-20261107-EMPTYREF", {
        orderStatus: "pending",
        paymentStatus: "pending",
        txStatus: "initializing",
        providerOrderId: "",
        providerPaymentId: null,
        expiresAtOffsetSql: "-45 minutes",
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      const res = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(res).toEqual({ gateway_stale_checked: 0, gateway_stale_closed: 2, gateway_stale_manual_review: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
      for (const id of ["AXV-20991231-00F17029", "AXV-20261107-EMPTYREF"]) {
        expect(fixture.sql.prepare("SELECT status,last_checked_at FROM payment_transactions WHERE order_code=?").get(id))
          .toMatchObject({ status: "expired", last_checked_at: expect.any(String) });
      }
    } finally { fixture.close(); }
  });

  it("initializing without invoice id but with buyer payment instructions is NOT closed blindly", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      await seedGatewayOrder(fixture, "AXV-20261107-HASURL01", {
        orderStatus: "kadaluarsa",
        paymentStatus: "expired",
        txStatus: "initializing",
        providerPaymentId: null,
      });
      fixture.sql.prepare("UPDATE payment_transactions SET gateway_checkout_url='https://pay.example/x' WHERE order_code=?").run("AXV-20261107-HASURL01");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      const res = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(res.gateway_stale_closed).toBe(0);
      expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get("AXV-20261107-HASURL01"))
        .toMatchObject({ status: "initializing" });
    } finally { fixture.close(); }
  });

  it("pending with ref + provider unpaid/canceled/404 closes to expired or failed by order status", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      await seedGatewayOrder(fixture, "AXV-20261107-24858555", { orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" });
      await seedGatewayOrder(fixture, "AXV-20261107-BF6D630D", { orderStatus: "dibatalkan", paymentStatus: "failed", txStatus: "pending" });
      await seedGatewayOrder(fixture, "AXV-20261107-9634C6DE", { orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" });
      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "s");
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        const ref = String(url).split("/").at(-1)!;
        if (ref === "AXV-20261107-9634C6DE") return Response.json({ status: false, message: "not found" }, { status: 404 });
        return Response.json({
          status: true,
          data: {
            merchant_ref_id: ref,
            invoice: `SPY${ref}`,
            amount: 10000,
            fee: 500,
            total: 10500,
            payment_code: "TESTVA",
            status: ref === "AXV-20261107-BF6D630D" ? "canceled" : "pending",
          },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      const res = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(res).toEqual({ gateway_stale_checked: 3, gateway_stale_closed: 3, gateway_stale_manual_review: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fixture.sql.prepare("SELECT status,last_checked_at FROM payment_transactions WHERE order_code=?").get("AXV-20261107-24858555"))
        .toMatchObject({ status: "expired", last_checked_at: expect.any(String) });
      expect(fixture.sql.prepare("SELECT status,provider_status_text,last_checked_at FROM payment_transactions WHERE order_code=?").get("AXV-20261107-BF6D630D"))
        .toMatchObject({ status: "failed", provider_status_text: "canceled", last_checked_at: expect.any(String) });
      expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get("AXV-20261107-9634C6DE"))
        .toMatchObject({ status: "expired" });
    } finally { fixture.close(); }
  });

  it("pending with ref + provider paid keeps order unchanged, flags manual review, and alerts Telegram admin once", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      await seedGatewayOrder(fixture, "AXV-20261116-28FFDCC9", { orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" });
      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "s");
      vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "99999");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
      const telegramMessages: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.includes("api.telegram.org")) {
          telegramMessages.push(JSON.parse(String(init?.body ?? "{}")).text);
          return Response.json({ ok: true, result: { message_id: 1 } });
        }
        return Response.json({
          status: true,
          data: {
            merchant_ref_id: "AXV-20261116-28FFDCC9",
            invoice: "SPYAXV-20261116-28FFDCC9",
            amount: 10000,
            fee: 500,
            total: 10500,
            payment_code: "TESTVA",
            status: "paid",
            paid_at: new Date().toISOString(),
          },
        });
      }));
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      const first = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(first).toEqual({ gateway_stale_checked: 1, gateway_stale_closed: 0, gateway_stale_manual_review: 1 });
      expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get("AXV-20261116-28FFDCC9"))
        .toEqual({ status: "kadaluarsa", payment_status: "expired" });
      expect(fixture.sql.prepare("SELECT status,last_error,provider_status_text,last_admin_alert_at FROM payment_transactions WHERE order_code=?").get("AXV-20261116-28FFDCC9"))
        .toMatchObject({ status: "pending", last_error: "sekalipay_gateway_late_manual_review", provider_status_text: "paid", last_admin_alert_at: expect.any(String) });
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()?.n).toBe(0);
      expect(telegramMessages).toHaveLength(1);
      expect(telegramMessages[0]).toContain("AXV-20261116-28FFDCC9");

      // Re-running after >30m neither re-checks nor re-alerts.
      fixture.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-31 minutes') WHERE order_code=?").run("AXV-20261116-28FFDCC9");
      const second = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(second).toEqual({ gateway_stale_checked: 0, gateway_stale_closed: 0, gateway_stale_manual_review: 0 });
      expect(telegramMessages).toHaveLength(1);
    } finally { fixture.close(); }
  });

  it("provider error leaves row unchanged and enforces 30-minute throttle and per-tick limit", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql);
      const codes = Array.from({ length: 7 }, (_, i) => `AXV-20261107-STALE00${i}`);
      for (const id of codes) {
        await seedGatewayOrder(fixture, id, { orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" });
      }
      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "s");
      let mode: "error" | "expired" = "error";
      const calledRefs: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        const ref = String(url).split("/").at(-1)!;
        calledRefs.push(ref);
        if (mode === "error") return Response.json({ status: false }, { status: 500 });
        return Response.json({ status: true, data: { merchant_ref_id: ref, invoice: `SPY${ref}`, status: "expired" } });
      }));
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
      // Tick 1: limited to 5 rows; 500 error keeps all 5 pending and stamps last_checked_at
      const tick1 = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(tick1).toEqual({ gateway_stale_checked: 5, gateway_stale_closed: 0, gateway_stale_manual_review: 0 });
      expect(calledRefs).toHaveLength(5);
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='pending'").get()?.n).toBe(7);

      // Immediate tick 2: only the remaining 2 unchecked rows are tried (the first 5 are throttled for 30m)
      calledRefs.length = 0;
      const tick2 = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(tick2).toEqual({ gateway_stale_checked: 2, gateway_stale_closed: 0, gateway_stale_manual_review: 0 });
      expect(calledRefs).toHaveLength(2);

      // Immediate tick 3: all 7 are within 30 minutes -> 0 calls
      calledRefs.length = 0;
      const tick3 = await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access);
      expect(tick3).toEqual({ gateway_stale_checked: 0, gateway_stale_closed: 0, gateway_stale_manual_review: 0 });
      expect(calledRefs).toHaveLength(0);

      // After 31 minutes with provider recovered, 5 close on first tick and 2 on second tick
      mode = "expired";
      fixture.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-31 minutes')").run();
      expect(await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access))
        .toEqual({ gateway_stale_checked: 5, gateway_stale_closed: 5, gateway_stale_manual_review: 0 });
      expect(await reconcileStaleSekalipayGatewayPayments(createBudgetedDatabase(40, 0, fixture.db).access))
        .toEqual({ gateway_stale_checked: 2, gateway_stale_closed: 2, gateway_stale_manual_review: 0 });
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE status='expired'").get()?.n).toBe(7);
    } finally { fixture.close(); }
  });

  it("cron expiry atomically closes initializing without provider_payment_id and payments closes all 6 production-like rows", async () => {
    const fixture = createD1Fixture();
    stubFulfillmentKey();
    try {
      await insertTestProduct(fixture.sql, "manual", 1);
      // 1) Live expired order with initializing + NULL provider_payment_id -> closed atomically by job=expiry with stock restock
      await seedGatewayOrder(fixture, "AXV-20261118-EXP00001", {
        orderStatus: "pending",
        paymentStatus: "pending",
        txStatus: "initializing",
        providerPaymentId: null,
        expiresAtOffsetSql: "-5 minutes",
        qty: 2,
      });
      fixture.sql.prepare("UPDATE product_variants SET stock=98 WHERE id=1").run();

      vi.stubEnv("CRON_SECRET", "fixture-cron");
      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "s");
      const { POST } = await import("@/app/api/cron/lite/route");
      const cron = (job: string) => POST(new NextRequest(`http://localhost/api/cron/lite?job=${job}`, { method: "POST", headers: { authorization: "Bearer fixture-cron" } }));

      expect((await cron("expiry")).status).toBe(200);
      expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get("AXV-20261118-EXP00001"))
        .toEqual({ status: "kadaluarsa", payment_status: "expired" });
      expect(fixture.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get("AXV-20261118-EXP00001"))
        .toEqual({ status: "expired" });
      expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);

      // 2) Simulate the 6 stuck production rows -> closed in 2 ticks of job=payments without manual mutation
      const stuck = [
        { code: "AXV-20991231-00F17029", orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "initializing" as const, providerPaymentId: null },
        { code: "AXV-20261116-28FFDCC9", orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" as const, providerPaymentId: "SPY28" },
        { code: "AXV-20261107-BF6D630D", orderStatus: "dibatalkan", paymentStatus: "failed", txStatus: "pending" as const, providerPaymentId: "SPYBF" },
        { code: "AXV-20261107-24858555", orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" as const, providerPaymentId: "SPY24" },
        { code: "AXV-20261107-9634C6DE", orderStatus: "kadaluarsa", paymentStatus: "expired", txStatus: "pending" as const, providerPaymentId: "SPY96" },
        { code: "AXV-20261107-8D111A0D", orderStatus: "dibatalkan", paymentStatus: "failed", txStatus: "pending" as const, providerPaymentId: "SPY8D" },
      ];
      for (const s of stuck) {
        await seedGatewayOrder(fixture, s.code, { ...s, expiresAtOffsetSql: "-120 minutes" });
      }
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        const ref = String(url).split("/").at(-1)!;
        const found = stuck.find((s) => s.code === ref);
        return Response.json({ status: true, data: { merchant_ref_id: ref, invoice: found?.providerPaymentId ?? `SPY${ref}`, status: "expired" } });
      }));
      const p1 = await cron("payments");
      expect(p1.status).toBe(200);
      expect(await p1.json()).toMatchObject({ ok: true, gateway_stale_closed: 5 });
      const p2 = await cron("payments");
      expect(p2.status).toBe(200);
      expect(await p2.json()).toMatchObject({ ok: true, gateway_stale_closed: 1 });
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions WHERE provider='sekalipay_gateway' AND status IN ('initializing','pending')").get()?.n).toBe(0);
    } finally { fixture.close(); }
  });
});
