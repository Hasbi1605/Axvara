import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateGatewayFee, gatewayHmac, gatewayParams, listSekalipayMethods, parseGatewayFee, signGatewayRequest, verifyGatewayWebhook, createSekalipayGatewayInvoice, confirmGatewayFee } from "@/lib/payments/sekalipay-gateway";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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

  it("actual payments cron respects 40 statements and resumes atomic paid work next tick", async () => {
    const f = await make("cron-forty");
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
      expect(body.budget_exhausted).toBe(true);
      expect(f.fixture.control.queries - before).toBeLessThanOrEqual(40);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE payment_status='paid'").get()!.n).toBe(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()!.n);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE provider='sekalipay_gateway' AND status='received'").get()!.n).toBeGreaterThan(0);
      const retryCode = f.fixture.sql.prepare("SELECT order_code FROM dana_webhook_events WHERE provider='sekalipay_gateway' AND status='received' AND order_code IN (SELECT order_code FROM payment_transactions WHERE last_checked_at IS NOT NULL)").get()?.order_code;
      expect(retryCode).toBeTruthy();
      f.fixture.sql.exec("UPDATE payment_transactions SET last_checked_at=datetime('now','-61 seconds') WHERE provider='sekalipay_gateway' AND status='pending'");
      const secondBefore = f.fixture.control.queries; await cron();
      expect(f.fixture.control.queries - secondBefore).toBeLessThanOrEqual(40);
      expect(f.fixture.sql.prepare("SELECT payment_status FROM orders WHERE code=?").get(retryCode)?.payment_status).toBe("paid");
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(retryCode)?.n).toBe(1);
      expect(f.fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE payment_status='paid'").get()!.n).toBe(f.fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()!.n);
    } finally { f.fixture.close(); }
  });

  it("selects at most four live and four late references and observes cooldown with flag off", async () => {
    const f = await make("bounded-pass");
    try {
      for (let i = 0; i < 10; i++) {
        const id = `AXV-20261104-PASS000${i}`;
        insertTestOrder(f.fixture.sql, id, { channel: "web" });
        f.fixture.sql.prepare("UPDATE orders SET payment_method='sekalipay_gateway:TESTVA',expires_at=?,status=?,payment_status=? WHERE code=?")
          .run(i < 5 ? new Date(Date.now() + 600000).toISOString() : new Date(Date.now() - 60000).toISOString(), i < 5 ? "pending" : "kadaluarsa", i < 5 ? "pending" : "expired", id);
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
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(100, 0, f.fixture.db).access)).toEqual({ gateway_checked: 4, gateway_late_checked: 4 });
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(100, 0, f.fixture.db).access)).toEqual({ gateway_checked: 1, gateway_late_checked: 1 });
      expect(await reconcileDueSekalipayGatewayPayments(createBudgetedDatabase(100, 0, f.fixture.db).access)).toEqual({ gateway_checked: 0, gateway_late_checked: 0 });
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
});
