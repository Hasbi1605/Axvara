import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import {
  canonicalStringify,
  claimNowpaymentsPollReconcile,
  createNowpaymentsInvoice,
  reconcileNowpaymentsPayment,
  verifyNowpaymentsSignature,
} from "@/lib/payments/nowpayments";
import { isStrictDecimalText, isSufficientDecimal, parseDecimalParts } from "@/lib/payments/decimal";
import { isNowpaymentsEnabled } from "@/lib/payments/rails";
import { POST as ipn } from "@/app/api/payments/nowpayments/ipn/route";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
  send: vi.fn(async () => ({ ok: true })),
  pedia: vi.fn(async () => ({})),
  wrCreate: vi.fn(async () => 0),
  wrProcess: vi.fn(async () => ({})),
  skCreate: vi.fn(async () => 0),
  skProcess: vi.fn(async () => ({})),
  pages: false,
  tasks: [] as Promise<unknown>[],
}));
vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: () => {
    if (!mocks.pages) throw new Error("No Pages context in this fixture");
    return { ctx: { waitUntil: (task: Promise<unknown>) => { mocks.tasks.push(task); } } };
  },
}));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: mocks.ensure }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: mocks.send,
  sendPhoto: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(async () => {}),
  safeEditOrSend: vi.fn(),
}));
vi.mock("@/lib/warung-rebahan/order", () => ({ createWrOrderLinksForOrder: mocks.wrCreate, processWrPendingOrders: mocks.wrProcess }));
vi.mock("@/lib/warung-rebahan/client", () => ({ isWrAutoOrderEnabled: () => true }));
vi.mock("@/lib/sekalipay/order", () => ({ createSkOrderLinksForOrder: mocks.skCreate, processSkPendingOrders: mocks.skProcess }));
vi.mock("@/lib/sekalipay/client", () => ({ isSkAutoOrderEnabled: () => true }));
vi.mock("@/lib/pedia/dispatch", () => ({ processPediaPaidOrders: mocks.pedia }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<object>()), requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const A = "AXV-20261103-AAAAAAA1";
let fixture: ReturnType<typeof createD1Fixture>;
let remote: Map<string, Record<string, unknown>>;
let posts: number;
let failCreateAfterSave: boolean;
let failNetwork: boolean;

const estimate = {
  estimated_amount: "0.011",
  currency_from: "idr",
  currency_to: "usdtbsc",
};
const minAmount = {
  min_amount: "0.0005",
  currency_from: "usdtbsc",
  currency_to: "usdtbsc",
};
const A_PAYMENT_ID = `np-${A.slice(-8)}`;
const invoice = (code: string, paymentId = A_PAYMENT_ID, overrides: Record<string, unknown> = {}) => ({
  payment_id: paymentId,
  pay_address: "TXYZfixtureAddress",
  pay_amount: "0.011",
  pay_currency: "usdtbsc",
  price_amount: "89000",
  price_currency: "idr",
  order_id: code,
  created_at: new Date().toISOString(),
  expiration_estimate_date: new Date(Date.now() + 15 * 60_000).toISOString(),
  ...overrides,
});
const statusRow = (code: string, paymentId = A_PAYMENT_ID, overrides: Record<string, unknown> = {}) => ({
  payment_id: paymentId,
  order_id: code,
  price_amount: "89000",
  price_currency: "idr",
  pay_currency: "usdtbsc",
  network: "bsc",
  payment_status: "finished",
  pay_amount: "0.011",
  actually_paid: "0.011",
  outcome_amount: "0.0108",
  outcome_currency: "usdtbsc",
  updated_at: new Date().toISOString(),
  ...overrides,
});

async function signBody(body: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("fixture-ipn-secret"), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalStringify(body)));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.exec("UPDATE product_variants SET price=89000");
  remote = new Map();
  posts = 0;
  failCreateAfterSave = false;
  failNetwork = false;
  mocks.ensure.mockClear();
  mocks.send.mockClear();
  mocks.pedia.mockClear();
  mocks.wrCreate.mockClear();
  mocks.wrProcess.mockClear();
  mocks.skCreate.mockClear();
  mocks.skProcess.mockClear();
  mocks.wrCreate.mockResolvedValue(0);
  mocks.skCreate.mockResolvedValue(0);
  mocks.pages = false;
  mocks.tasks = [];
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-api-key");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture-ipn-secret");
  vi.stubEnv("NOWPAYMENTS_API_BASE_URL", "https://api.nowpayments.io/v1");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "999");
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
  clearRateLimitBucketsForTest();
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (failNetwork) throw new Error("network down");
    if (target.includes("/estimate?")) {
      if ((init?.method ?? "GET") !== "GET") throw new Error(`estimate wrong method ${target}`);
      const expectedFrom = String((globalThis as Record<string, unknown>).__np_estimate_from ?? "idr");
      if (!target.includes(`currency_from=${expectedFrom}`)) throw new Error(`estimate pair mismatch ${target}`);
      return Response.json(
        expectedFrom === "usd"
          ? { estimated_amount: "15.63", currency_from: "usd", currency_to: "usdtbsc" }
          : estimate,
      );
    }
    if (target.includes("/min-amount?")) {
      if ((init?.method ?? "GET") !== "GET") throw new Error(`min-amount wrong method ${target}`);
      return Response.json(minAmount);
    }
    if (target.endsWith("/v1/payment") && (init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body));
      posts++;
      const expectedCurrency = String((globalThis as Record<string, unknown>).__np_price_currency ?? "idr");
      const expectedAmount = (globalThis as Record<string, unknown>).__np_price_amount ?? 89000;
      if (expectedCurrency === "usd") {
        expect(body.price_currency).toBe("usd");
        expect(body.price_amount).toBe("15.63");
      } else {
        expect(String(body.price_amount)).toBe(String(expectedAmount));
        expect(body.price_currency).toBe("idr");
      }
      if (failCreateAfterSave) throw new Error("Network timeout after provider accepted create");
      const legacyId = `np-${String(body.order_id).slice(-8)}`;
      const payAmount = expectedCurrency === "usd" ? "0.011" : "0.011";
      const row = {
        ...invoice(body.order_id, legacyId, {
          pay_amount: payAmount,
          price_amount: expectedCurrency === "usd" ? "15.63" : String(expectedAmount),
          price_currency: expectedCurrency,
        }),
        order_id: body.order_id,
      };
      remote.set(body.order_id, { ...row, price_amount: body.price_amount, price_currency: body.price_currency });
      return Response.json(row, { status: 201 });
    }
    if (target.includes("/v1/payment/")) {
      const id = decodeURIComponent(target.split("/").at(-1)!);
      const row = [...remote.values()].find((entry) => String(entry.payment_id) === id);
      return row
        ? Response.json(statusRow(String(row.order_id), id, { actually_paid: "0.011" }))
        : Response.json({ message: "not found" }, { status: 404 });
    }
    throw new Error(`Unexpected network request ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fixture.close();
  delete (globalThis as Record<string, unknown>).__np_estimate_from;
  delete (globalThis as Record<string, unknown>).__np_price_currency;
  delete (globalThis as Record<string, unknown>).__np_price_amount;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seed(code = A, amount = 89000) {
  await createChannelOrderAtomic({
    orderCode: code,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: amount, name: "Fixture" }],
    variantSnapshot: "{}",
    subtotal: amount,
    primaryVariantId: 1,
    customerName: "Fixture",
    salesChannel: "telegram",
    paymentMethod: "crypto",
    paymentAccount: "NOWPayments",
    fulfillmentStatus: "not_required",
  });
  fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?")
    .run(new Date(Date.now() + 15 * 60_000).toISOString(), code);
}

const txOf = (code = A) => fixture.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(code)!;
const orderOf = (code = A) => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;

describe("NOWPayments rail (W1 local, flags default-off semantics)", () => {
  it("preserves numeric JSON wire tokens and enforces explicit outcome with the floating-form minimum", async () => {
    const { parseNowpaymentsWire, checkNowpaymentsMinimum } = await import("@/lib/payments/nowpayments");
    expect(parseNowpaymentsWire('{"id":9007199254740993,"amount":0.000000000000000001,"nested":[true,null,{"text":"escaped \\\"12\\\" and \\\\34"}]}')).toEqual({ id: "9007199254740993", amount: "0.000000000000000001", nested: [true, null, { text: 'escaped "12" and \\34' }] });
    expect(() => parseNowpaymentsWire('{"amount":1e-8}')).toThrow();
    expect(() => parseNowpaymentsWire('{"amount":01}')).toThrow();
    expect(() => parseNowpaymentsWire('{12:34}')).toThrow();
    expect(() => parseNowpaymentsWire('{"nested":[{12:34}]}')).toThrow();
    expect(() => parseNowpaymentsWire('{"amount":1.}')).toThrow();
    expect(() => parseNowpaymentsWire('{"amount":--1}')).toThrow();
    expect(parseNowpaymentsWire('{"text":"{123}: \\\"45\\\" \\\\ 67","array":[0,false,null]}')).toEqual({ text: '{123}: "45" \\ 67', array: ["0", false, null] });
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "btc");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/estimate?")) return new Response('{"currency_from":"usd","currency_to":"usdtbsc","estimated_amount":15.63}');
      return new Response('{"currency_from":"usdtbsc","currency_to":"btc","min_amount":0.000000000000000001,"fiat_equivalent":0.01}');
    }));
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).resolves.toBeUndefined();
    expect(calls[1]).toContain("currency_from=usdtbsc&currency_to=btc&fiat_equivalent=usd");
    // Bentuk MENGAMBANG: tanpa is_fixed_rate / is_fee_paid_by_user (minimum rendah, fee merchant).
    expect(calls[1]).not.toMatch(/is_fixed_rate|is_fee_paid_by_user/);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => String(url).includes("/estimate?")
      ? new Response('{"currency_from":"usd","currency_to":"usdtbsc","estimated_amount":15.63}')
      : new Response('{"currency_from":"usdtbsc","currency_to":"btc","min_amount":1,"fiat_equivalent":20}')));
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).rejects.toThrow("nowpayments_preflight_invalid");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => String(url).includes("/estimate?")
      ? new Response('{"currency_from":"usd","currency_to":"usdtbsc","estimated_amount":15.63}')
      : new Response('{"currency_from":"usdtbsc","currency_to":"eth","min_amount":1}')));
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).rejects.toThrow("nowpayments_preflight_invalid");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"currency_from":"usd","currency_to":"usdtbsc","estimated_amount":1e-8}')));
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).rejects.toThrow("nowpayments_invalid_response");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`{"padding":"${"x".repeat(64001)}"}`)));
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).rejects.toThrow("nowpayments_invalid_response");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    await expect(checkNowpaymentsMinimum("15.63", "usd", "usdtbsc")).rejects.toThrow("nowpayments_outcome_unconfigured");
    expect(calls).toHaveLength(2);
  });

  it("missing outcome refuses a new provider POST", async () => {
    await seed();
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_outcome_unconfigured");
    expect(posts).toBe(0);
  });
  it("creation gate is fail-closed without env", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    expect(isNowpaymentsEnabled()).toBe(false);
    await seed();
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_not_configured");
  });

  it("decimal helper never uses float math for crypto amounts", () => {
    expect(parseDecimalParts("0.011")).toMatchObject({ scale: 3 });
    expect(parseDecimalParts("0.01000000")).toMatchObject({ scale: 2 });
    expect(parseDecimalParts("12.34.56")).toBeNull();
    expect(parseDecimalParts("0.1234567890123456789")).toBeNull();
    expect(isSufficientDecimal("0.011", "0.011")).toBe(true);
    expect(isSufficientDecimal("0.01099999", "0.011")).toBe(false);
    expect(isStrictDecimalText("0.011")).toBe(true);
    expect(isStrictDecimalText("abc")).toBe(false);
  });

  it("creates exactly one POST, persists provider id + pay details, keeps integer IDR", async () => {
    await seed();
    const first = await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    expect(posts).toBe(1);
    expect(first).toMatchObject({ payCurrency: "usdtbsc", payAmountText: "0.011", isExisting: false });
    expect(JSON.stringify(first)).not.toContain("fixture-api-key");
    const tx = txOf();
    expect(tx.provider).toBe("nowpayments");
    expect(tx.requested_amount).toBe(89000);
    expect(tx.currency).toBe("IDR");
    expect(tx.provider_payment_id).toBe(A_PAYMENT_ID);
    expect(tx.pay_amount_text).toBe("0.011");
    expect(tx.pay_address).toBe("TXYZfixtureAddress");
    const second = await createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" });
    expect(second.isExisting).toBe(true);
    expect(posts).toBe(1);
  });

  it("rejects redirect and non-2xx without logging secrets", async () => {
    await seed();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/estimate?")) return Response.json(estimate);
      if (target.includes("/min-amount?")) return Response.json(minAmount);
      return new Response(null, { status: 302, headers: { location: "https://untrusted.example/steal" } });
    }));
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_redirect_rejected");
    expect(posts).toBe(0);
  });

  it("rejects usd priceCurrency without a caller FX snapshot instead of interpreting IDR as USD", async () => {
    await seed();
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "usd" }))
      .rejects.toThrow("nowpayments_usd_snapshot_required");
    expect(posts).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()!.n).toBe(0);
  });

  it.each([
    ["zero estimate", { estimated_amount: "0", currency_from: "idr", currency_to: "usdtbsc" }, minAmount],
    ["missing pair contract", { estimated_amount: "0.011" }, { min_amount: "0.0005" }],
    ["estimate below minimum", { estimated_amount: "0.0001", currency_from: "idr", currency_to: "usdtbsc" }, minAmount],
    ["minimum above estimate", { estimated_amount: "0.0004", currency_from: "idr", currency_to: "usdtbsc" },
      { min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" }],
  ])("preflight fails closed (%s): zero POST, stays initializing", async (_label, est, minRow) => {
    await seed();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/estimate?")) return Response.json(est);
      if (target.includes("/min-amount?")) return Response.json(minRow);
      throw new Error(`Unexpected POST ${target}`);
    }));
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_preflight_invalid");
    expect(posts).toBe(0);
    expect(txOf().status).toBe("initializing");
    expect(txOf().last_error).toBe("nowpayments_preflight_invalid");
  });

  it("ambiguous create without payment id stays initializing, never blind-retries POST", async () => {
    await seed();
    failCreateAfterSave = true;
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_network_ambiguous");
    expect(posts).toBe(1);
    const tx = txOf();
    expect(tx.status).toBe("initializing");
    expect(tx.provider_payment_id).toBeNull();
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_invoice_initializing");
    expect(posts).toBe(1);
  });

  it.each([
    ["wrong create identity", { order_id: "AXV-20261103-FOREIGN01" }],
    ["wrong create currency", { pay_currency: "btc" }],
    ["wrong create price amount", { price_amount: "90000" }],
    ["wrong create price currency", { price_currency: "usd" }],
  ])("creation validates provider identity (%s): zero invoice payable", async (_label, override) => {
    await seed();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/estimate?")) return Response.json(estimate);
      if (target.includes("/min-amount?")) return Response.json(minAmount);
      if (target.endsWith("/v1/payment")) {
        posts++;
        return Response.json(invoice(A, "np-bad", override), { status: 201 });
      }
      throw new Error(`Unexpected ${target}`);
    }));
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_finalize_failed_manual_review");
    expect(txOf().provider_payment_id).toBe("np-bad");
    expect(txOf().last_error).toBe("nowpayments_invalid_invoice_manual_review");
    expect(txOf().status).not.toBe("pending");
  });

  it.each([
    ["wrong price amount", { price_amount: "90000" }, "nowpayments_price_mismatch"],
    ["wrong price currency", { price_currency: "usd" }, "nowpayments_price_mismatch"],
    ["altered pay_amount", { pay_amount: "0.099" }, "nowpayments_pay_amount_mismatch"],
    ["foreign order", { order_id: "AXV-20261103-FOREIGN01" }, "nowpayments_payment_mismatch"],
    ["foreign currency", { pay_currency: "btc", network: "btc" }, "nowpayments_currency_mismatch"],
  ])("reconcile rejects %s without paying", async (_label, override, error) => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) return Response.json(statusRow(A, A_PAYMENT_ID, override));
      throw new Error(`Unexpected ${target}`);
    }));
    await expect(reconcileNowpaymentsPayment(A)).rejects.toThrow(error);
    expect(orderOf().status).toBe("pending");
    expect(txOf().status).not.toBe("paid");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(0);
  });

  it("reconcile rejects nonpositive amounts and outcome-net is never the gross price", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    for (const override of [{ actually_paid: "0" }, { actually_paid: "-0.1" }]) {
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A, A_PAYMENT_ID, override));
        throw new Error(`Unexpected ${url}`);
      }));
      expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
      expect(orderOf().status).toBe("pending");
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) {
        return Response.json(statusRow(A, A_PAYMENT_ID, { actually_paid: "0.011", outcome_amount: "0.005", outcome_currency: "usdtbsc" }));
      }
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(orderOf().status).toBe("pending");
    const other = "AXV-20261103-BBBBBBB2";
    await seed(other);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/estimate?")) return Response.json(estimate);
      if (String(url).includes("/min-amount?")) return Response.json(minAmount);
      if (init?.method === "POST") return Response.json(invoice(other, `np-${other.slice(-8)}`));
      return Response.json(statusRow(other, `np-${other.slice(-8)}`, { actually_paid: "0.011", outcome_amount: "0.005" }));
    }));
    await createNowpaymentsInvoice(other, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    expect(await reconcileNowpaymentsPayment(other)).toBe("paid");
  });

  it("IPN failure stays durable without acking paid; later reconcile recovers", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    const body = { payment_id: A_PAYMENT_ID, order_id: A, payment_status: "finished", pay_currency: "usdtbsc", pay_amount: "0.011" };
    const sig = await signBody(body);
    let getCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) {
        getCalls++;
        if (getCalls === 1) throw new Error("network down");
        return Response.json(statusRow(A));
      }
      throw new Error(`Unexpected ${url}`);
    }));
    mocks.pages = true;
    const first = await ipn(new NextRequest("https://axvara.tech/api/payments/nowpayments/ipn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: JSON.stringify(body),
    }));
    expect(first.status).toBe(200);
    await Promise.allSettled(mocks.tasks);
    const evt = fixture.sql.prepare("SELECT status,last_error FROM dana_webhook_events WHERE event_key=?")
      .get(`nowpayments:${A_PAYMENT_ID}:finished`)!;
    expect(evt.status).toBe("failed");
    expect(String(evt.last_error)).toContain("ipn_reconcile");
    expect(orderOf().status).toBe("pending");
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    expect(orderOf().status).toBe("lunas");
  });

  it("reconcile never downgrades already-paid under concurrency", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) {
        return Response.json(statusRow(A, A_PAYMENT_ID, { payment_status: "confirming", actually_paid: "0" }));
      }
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("already_paid");
    expect(orderOf().status).toBe("lunas");
    expect(txOf().status).toBe("paid");
  });

  it("reconcile validates identity: foreign order/currency/amount rejected, finished+sufficient pays once", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    remote.set(A, { ...invoice(A), order_id: "AXV-20261103-FOREIGN01" });
    await expect(reconcileNowpaymentsPayment(A)).rejects.toThrow("nowpayments_payment_mismatch");
    remote.set(A, { ...invoice(A), order_id: A });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) {
        return Response.json(statusRow(A, A_PAYMENT_ID, { pay_currency: "btc", network: "btc" }));
      }
      throw new Error(`Unexpected ${target}`);
    }));
    await expect(reconcileNowpaymentsPayment(A)).rejects.toThrow("nowpayments_currency_mismatch");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${target}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    expect(orderOf().status).toBe("lunas");
    expect(orderOf().payment_method).toBe("crypto");
    expect(txOf().status).toBe("paid");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(1);
    expect(await reconcileNowpaymentsPayment(A)).toBe("already_paid");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(1);
  });

  it("expired provider state is durable with a reason for W3", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A, A_PAYMENT_ID, { payment_status: "expired" }));
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("expired");
    expect(txOf().status).toBe("failed");
    expect(txOf().last_error).toBe("nowpayments_provider_expired_manual_review");
    expect(orderOf().status).toBe("pending");
  });

  it("overpayment is numeric (0.0110 is exact, 0.0111 is overpaid) not string comparison", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A, A_PAYMENT_ID, { actually_paid: "0.0110" }));
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    const note = fixture.sql.prepare("SELECT review_note FROM dana_webhook_events WHERE event_key=?")
      .get(`nowpayments:${A_PAYMENT_ID}:finished`)!.review_note;
    expect(note).toBeNull();
  });

  it("foreign/another-order events cannot mark crypto paid (strict event binding)", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${url}`);
    }));
    const { transitionPendingPaymentToPaid } = await import("@/lib/db/orders-transition");
    fixture.sql.prepare(
      `INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
       VALUES('nowpayments:other:finished','h',89000,'{}','gopay','received',?)`,
    ).run(A);
    const foreignId = fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key='nowpayments:other:finished'").get()!.id;
    expect(await transitionPendingPaymentToPaid(A, new Date().toISOString(), null,
      { id: Number(foreignId) }, { paymentMethod: "crypto", eventMode: "received_text" })).toBe(false);
    await seed("AXV-20261103-OTHER001");
    await createNowpaymentsInvoice("AXV-20261103-OTHER001", 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" }).catch(() => {});
    const txOther = fixture.sql.prepare("SELECT provider_payment_id FROM payment_transactions WHERE order_code='AXV-20261103-OTHER001'").get();
    expect(String(txOther?.provider_payment_id || "")).not.toBe(A_PAYMENT_ID);
    fixture.sql.prepare(
      `INSERT INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
       VALUES('np-1-other-order','h',89000,'{}','nowpayments','received','AXV-20261103-OTHER001')`,
    ).run();
    const otherId = fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key='np-1-other-order'").get()!.id;
    expect(await transitionPendingPaymentToPaid(A, new Date().toISOString(), null,
      { id: Number(otherId) }, { paymentMethod: "crypto", eventMode: "received_text" })).toBe(false);
    expect(orderOf().status).toBe("pending");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(0);
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
  });

  it("concurrent reconcile claims share exactly one winner", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    const wins = await Promise.all([claimNowpaymentsPollReconcile(A), claimNowpaymentsPollReconcile(A)]);
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it("known remote charge survives finalization failure: durable, reconcilable, no repeat POST", async () => {
    await seed();
    const globalDb = (globalThis as unknown as { DB: { batch: (...a: never[]) => Promise<never[]> } }).DB;
    const realBatch = globalDb.batch.bind(globalDb);
    // Force the finalization batch (2nd batch: claim is 1st) to fail AFTER
    // provider POST — the catch path persists the known id/details, so
    // recovery needs no repeat POST.
    let finalizeCalls = 0;
    globalDb.batch = (async (...args: never[]) => {
      finalizeCalls++;
      if (finalizeCalls > 1) throw new Error("local expiry during provider flight");
      return realBatch(...(args as []));
    }) as never;
    // Finalization threw mid-flight; adapter surfaces the durable review reason.
    await expect(createNowpaymentsInvoice(A, 89000, "usdtbsc", { priceCurrency: "idr" })).rejects.toThrow("nowpayments_finalize_failed_manual_review");
    expect(finalizeCalls).toBeGreaterThan(1);
    globalDb.batch = realBatch;
    failCreateAfterSave = false;
    expect(posts).toBe(1);
    const tx = txOf();
    expect(tx.provider_payment_id).toBe(A_PAYMENT_ID);
    expect(tx.pay_amount_text).toBe("0.011");
    expect(tx.pay_address).toBe("TXYZfixtureAddress");
    expect(tx.last_error).toBe("nowpayments_finalize_failed_manual_review");
    remote.set(A, { ...invoice(A), order_id: A });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/v1/payment/")) return Response.json(statusRow(A, String(tx.provider_payment_id)));
      throw new Error(`Unexpected ${url}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    expect(orderOf().status).toBe("lunas");
    expect(posts).toBe(1);
  });

  it("partial/expired/late never pay; late keeps order for manual review without revive", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    const modes: Array<[string, Record<string, unknown>, string]> = [
      ["confirming", { payment_status: "confirming" }, "pending"],
      ["partially_paid", { payment_status: "partially_paid", actually_paid: "0.005" }, "manual_review"],
      ["underpaid finished", { payment_status: "finished", actually_paid: "0.010" }, "manual_review"],
      ["foreign network", { network: "ethereum" }, "nowpayments_network_mismatch"],
    ];
    for (const [label, override, expected] of modes) {
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        if (target.includes("/v1/payment/")) return Response.json(statusRow(A, A_PAYMENT_ID, override));
        throw new Error(`Unexpected ${target} ${label}`);
      }));
      if (expected === "nowpayments_network_mismatch") {
        await expect(reconcileNowpaymentsPayment(A)).rejects.toThrow(expected);
      } else {
        expect(await reconcileNowpaymentsPayment(A), label).toBe(expected);
      }
      expect(orderOf().status, label).toBe("pending");
      expect(txOf().status, label).not.toBe("paid");
    }
    fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(A);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${target}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("manual_review");
    expect(orderOf().status).toBe("pending");
    expect(txOf().status).not.toBe("paid");
  });

  it("IPN verifies HMAC canonical vectors: tampered/missing signature rejected, replay deduped", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    const body = { payment_id: A_PAYMENT_ID, order_id: A, payment_status: "finished", pay_currency: "usdtbsc", pay_amount: "0.011" };
    const sig = await signBody(body);
    expect(await verifyNowpaymentsSignature(canonicalStringify({ b: 1, a: 2 }), "x")).toBe(false);
    expect(canonicalStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
    const good = new NextRequest("https://axvara.tech/api/payments/nowpayments/ipn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: JSON.stringify(body),
    });
    mocks.pages = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${target}`);
    }));
    expect((await ipn(good)).status).toBe(200);
    await Promise.allSettled(mocks.tasks);
    expect(orderOf().status).toBe("lunas");
    const tampered = new NextRequest("https://axvara.tech/api/payments/nowpayments/ipn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: JSON.stringify({ ...body, pay_amount: "99" }),
    });
    expect((await ipn(tampered)).status).toBe(401);
    const missing = new NextRequest("https://axvara.tech/api/payments/nowpayments/ipn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await ipn(missing)).status).toBe(401);
    const replay = new NextRequest("https://axvara.tech/api/payments/nowpayments/ipn", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
      body: JSON.stringify(body),
    });
    mocks.tasks = [];
    expect((await ipn(replay)).status).toBe(200);
    await Promise.allSettled(mocks.tasks);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(1);
  });

  it("flag-off still reconciles a saved invoice (creation gated, recovery open)", async () => {
    await seed();
    await createNowpaymentsInvoice(A, 89000, "usdtbsc", { payNetwork: "bsc", priceCurrency: "idr" });
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/v1/payment/")) return Response.json(statusRow(A));
      throw new Error(`Unexpected ${target}`);
    }));
    expect(await reconcileNowpaymentsPayment(A)).toBe("paid");
    expect(orderOf().status).toBe("lunas");
    // Paid rows keluar dari klaim reconcile (hanya pending yang boleh diklaim).
    expect(await claimNowpaymentsPollReconcile(A)).toBe(false);
  });

  it("sekalipay gateway stays unconfigured and never invents endpoints", async () => {
    const { isSekalipayGatewayConfigured } = await import("@/lib/payments/rails");
    expect(isSekalipayGatewayConfigured()).toBe(false);
    const { createSekalipayGatewayInvoice, reconcileSekalipayGatewayPayment } = await import("@/lib/payments/sekalipay-gateway");
    expect(() => createSekalipayGatewayInvoice()).toThrow("sekalipay_gateway_not_configured");
    expect(() => reconcileSekalipayGatewayPayment()).toThrow("sekalipay_gateway_not_configured");
  });

  it("migration preserves old QRIS rows and adds provider-payment lookup", () => {
    insertTestOrder(fixture.sql, "AXV-20200101-OLD00001", { status: "kadaluarsa", channel: "web" });
    fixture.sql.exec(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status)
      VALUES('AXV-20200101-OLD00001','dana','dynamic-qris','OLD-1','m',1000,'expired')`);
    const ddl = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE name='payment_transactions'").get()!.sql as string;
    for (const column of ["currency", "pay_currency", "pay_network", "price_amount_text", "pay_amount_text", "actually_paid_text", "outcome_amount_text", "fee_paid_by_user", "provider_payment_id", "pay_address", "last_reconciled_at"]) {
      expect(ddl).toContain(column);
    }
    const legacy = fixture.sql.prepare("SELECT currency,provider_payment_id FROM payment_transactions WHERE order_code='AXV-20200101-OLD00001'").get()!;
    expect(legacy.currency).toBe("IDR");
    expect(legacy.provider_payment_id).toBeNull();
    expect(fixture.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(fixture.sql.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
  });
});
