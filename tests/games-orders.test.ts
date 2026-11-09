// tests/games-orders.test.ts — API pembeli AXVARA Games (katalog, quote,
// order QRIS, status, lacak, expiry, dispatch) dengan fixture D1 nyata.
// QRIS (invoice) di-mock; Digiflazz hanya dipanggil lewat fetch mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { txReply } from "./helpers/games-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";

const invoice = vi.hoisted(() => vi.fn(async (code: string, amount: number) => ({
  orderCode: code,
  requestedAmount: amount,
  payableAmount: amount + 101,
  uniqueCode: 101,
  qrisPayload: "payload",
  qrisUrl: `/api/payments/qris/${code}/image`,
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  isExisting: false,
})));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/dana-qris")>();
  return { ...actual, createActiveQrisInvoice: invoice };
});

let fx: ReturnType<typeof createD1Fixture>;

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as never;

const enableOrdering = () => {
  vi.stubEnv("DIGIFLAZZ_USERNAME", "demouser");
  vi.stubEnv("DIGIFLAZZ_API_KEY", "dev-key");
  vi.stubEnv("DIGIFLAZZ_TESTING", "");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-games-orders-secret-0123456789");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "tok");
};

function seedSku(over: Record<string, unknown> = {}): number {
  const row: Record<string, unknown> = {
    buyer_sku_code: "ml86", game_brand: "MOBILE LEGENDS", product_name: "86 Diamond", product_type: "Umum",
    cost: 10000, sell_price: 11000, seller_active: 1, enabled: 1, ...over,
  };
  const keys = Object.keys(row);
  const result = fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
  return Number(result.lastInsertRowid);
}

const Q = {
  slug: "mobile-legends", buyer_sku_code: "ml86",
  fields: { userId: "12345", zoneId: "6789" },
  whatsapp: "081234567890", email: "buyer@example.com",
};

async function makeQuote(over: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/games/quote/route");
  return POST(json("http://x/api/games/quote", { ...Q, ...over }));
}

async function quoteToken(over: Record<string, unknown> = {}): Promise<string> {
  const res = await makeQuote(over);
  expect(res.status).toBe(200);
  return (await res.json()).quote_token;
}

async function placeOrder(token: string, contact: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/games/orders/route");
  return POST(json("http://x/api/games/orders", { quote_token: token, payment_method: "qris", whatsapp: Q.whatsapp, email: Q.email, ...contact }));
}

function addOrder(code: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    code, customer_name: "Buyer", customer_wa: "6281234567890", customer_email: "buyer@example.com",
    items: "[]", subtotal: 11000, payment_method: "qris", payment_account: "QRIS",
    status: "pending", payment_status: "pending", sales_channel: "web", order_kind: "games",
    expires_at: new Date(Date.now() + 900_000).toISOString(),
    buyer_access_version: 0, buyer_access_format: "code26", locale: "id", ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO orders(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

function addItem(code: string, productId: number, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    order_code: code, product_id: productId, buyer_sku_code: "ml86", customer_no: "123456789",
    quantity: 1, unit_price: 11000, total: 11000, cost_snapshot: 10000, max_price: 10500,
    status: "awaiting_payment", attempt_no: 1, ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_order_items(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

const orderRow = (code: string) => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code) as Record<string, unknown> | undefined;
const itemRow = (code: string) => fx.sql.prepare("SELECT * FROM games_order_items WHERE order_code=?").get(code) as Record<string, unknown> | undefined;

async function getStatus(code: string, contact: string) {
  const { GET } = await import("@/app/api/games/orders/[code]/route");
  return GET(
    new Request(`http://x/api/games/orders/${code}`, { headers: contact ? { "x-order-contact": contact } : {} }) as never,
    { params: Promise.resolve({ code }) },
  );
}

beforeEach(() => {
  fx = createD1Fixture();
  enableOrdering();
  clearRateLimitBucketsForTest();
  invoice.mockClear();
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("games catalog", () => {
  it("lists only registry games that have an enabled SKU", async () => {
    seedSku();
    seedSku({ buyer_sku_code: "ff140", game_brand: "FREE FIRE", cost: 20000, sell_price: 22000 });
    seedSku({ buyer_sku_code: "pubg60", game_brand: "PUBG MOBILE", sell_price: 15000, enabled: 0 });
    const { GET } = await import("@/app/api/games/catalog/route");
    const res = await GET({} as never);
    const data = await res.json();
    expect(data.ordering_open).toBe(true);
    expect(data.games).toEqual([
      { slug: "free-fire", name: "Free Fire", publisher: "Garena", currency: "diamond", icon: null, banner: null, min_price: 22000, sku_count: 1 },
      { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", currency: "diamond", icon: null, banner: null, min_price: 11000, sku_count: 1 },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/cost|margin|seller|ml86b/);
  });

  it("keeps seller-inactive SKUs visible but unavailable, without leaking cost", async () => {
    seedSku({ buyer_sku_code: "ml86", display_group: "bestseller", display_order: 2 });
    seedSku({ buyer_sku_code: "ml172", product_name: "172 Diamond", sell_price: 21000, seller_active: 0 });
    const { GET } = await import("@/app/api/games/catalog/[slug]/route");
    const res = await GET(new Request("http://x/") as never, { params: Promise.resolve({ slug: "mobile-legends" }) });
    const data = await res.json();
    expect(data.ordering_open).toBe(true);
    expect(data.game.slug).toBe("mobile-legends");
    expect(data.products).toEqual([
      { buyer_sku_code: "ml86", name: "86 Diamond", price: 11000, group: "bestseller", display_order: 2, available: true },
      { buyer_sku_code: "ml172", name: "172 Diamond", price: 21000, group: "all", display_order: null, available: false },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/"cost"|"margin"|"seller_active"|"backup_sku_code"/);
    // Game tidak dikenal tetap 404.
    expect((await GET(new Request("http://x/") as never, { params: Promise.resolve({ slug: "valorant" }) })).status).toBe(404);
  });

  it("stays readable while ordering is closed (P9)", async () => {
    seedSku();
    vi.stubEnv("DIGIFLAZZ_TESTING", "true");
    const { GET } = await import("@/app/api/games/catalog/route");
    expect((await (await GET({} as never)).json()).ordering_open).toBe(false);
  });
});

describe("games quote", () => {
  it("signs the shared payment catalog with the registry customer_no and sell price", async () => {
    seedSku();
    const res = await makeQuote();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      total: 11000, payable: 11000, currency: "IDR",
      sku: { buyer_sku_code: "ml86", name: "86 Diamond", price: 11000 },
      paymentMethods: expect.arrayContaining([{ id: "qris", kind: "qris", label: "QRIS", currency: "IDR", available: true,
        account_name: "QRIS", account_number: "qris", qris_url: null, sublabel: null }]),
    });
    const { verifyGamesQuoteToken } = await import("@/lib/games/quote");
    const payload = await verifyGamesQuoteToken(data.quote_token);
    expect(payload).toMatchObject({
      buyer_sku_code: "ml86", slug: "mobile-legends", customer_no: "123456789",
      total: 11000,
      methods: data.paymentMethods.filter((method: { available: boolean }) => method.available).map((method: { id: string }) => method.id),
    });
    expect(payload).not.toHaveProperty("customer_wa");
    expect(payload).not.toHaveProperty("customer_email");
  });

  it("closes quote and order with 503 games_preview while testing or without credentials", async () => {
    seedSku();
    for (const env of [{ DIGIFLAZZ_TESTING: "true" }, { DIGIFLAZZ_API_KEY: "" }]) {
      vi.stubEnv("DIGIFLAZZ_TESTING", "");
      vi.stubEnv("DIGIFLAZZ_API_KEY", "dev-key");
      vi.stubEnv("DIGIFLAZZ_USERNAME", "demouser");
      if (env.DIGIFLAZZ_TESTING) vi.stubEnv("DIGIFLAZZ_TESTING", env.DIGIFLAZZ_TESTING);
      if (env.DIGIFLAZZ_API_KEY !== undefined) vi.stubEnv("DIGIFLAZZ_API_KEY", env.DIGIFLAZZ_API_KEY);
      const res = await makeQuote();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error_code: "games_preview", error: "Pemesanan AXVARA Games segera dibuka." });
      const order = await placeOrder("x".repeat(40));
      expect(order.status).toBe(503);
      expect((await order.json()).error_code).toBe("games_preview");
    }
  });

  it("rejects invalid fields, a foreign brand, and an inactive seller", async () => {
    seedSku();
    expect((await makeQuote({ fields: { userId: "12", zoneId: "" } })).status).toBe(422);
    expect((await makeQuote({ slug: "free-fire", fields: { playerId: "123456" } })).status).toBe(409);
    seedSku({ buyer_sku_code: "mlinactive", sell_price: 12000, seller_active: 0 });
    const inactive = await makeQuote({ buyer_sku_code: "mlinactive" });
    expect(inactive.status).toBe(409);
    expect((await inactive.json()).error).toBe("sku_unavailable");
  });

  it("returns the English preview message when the username is blank", async () => {
    vi.stubEnv("DIGIFLAZZ_USERNAME", " ");
    const { POST } = await import("@/app/api/games/quote/route");
    const response = await POST(json("http://x/api/games/quote", Q, { cookie: "axv_locale=en" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error_code: "games_preview", error: "AXVARA Games ordering is opening soon." });
  });

  it("returns Indonesian/English errors from the axv_locale cookie", async () => {
    const { POST } = await import("@/app/api/games/quote/route");
    seedSku();
    const res = await POST(new Request("http://x/api/games/quote", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "axv_locale=en" },
      body: JSON.stringify({ ...Q, fields: { userId: "", zoneId: "1" } }),
    }) as never);
    expect((await res.json()).message).toBe("User ID is required.");
  });
});

describe("games orders", () => {
  it("quotes without contacts, then validates and normalizes contact at order admission", async () => {
    seedSku();
    const token = await quoteToken({ whatsapp: undefined, email: undefined });
    for (const contact of [{ whatsapp: "" }, { email: "invalid" }, { whatsapp: "1234" }, { email: `${"a".repeat(155)}@example.test` }]) {
      expect((await placeOrder(token, contact)).status).toBe(400);
    }
    const response = await placeOrder(token, { whatsapp: " +62 812-3456-7890 ", email: " buyer@example.com " });
    expect(response.status).toBe(201);
    expect(orderRow((await response.json()).code)).toMatchObject({ customer_wa: "6281234567890", customer_email: "buyer@example.com" });
  });

  it("creates one atomic QRIS order with P6 max_price and a 15-minute deadline", async () => {
    seedSku();
    const token = await quoteToken();
    const res = await placeOrder(token);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.code).toMatch(/^AXG-\d{8}-[A-Z0-9]{8}$/);
    expect(data.status_url).toBe(`/games/pesanan/${data.code}`);
    expect(data.qris).toMatchObject({ payable_amount: 11101, unique_code: 101 });
    expect(invoice).toHaveBeenCalledTimes(1);

    const order = orderRow(data.code)!;
    expect(order).toMatchObject({
      order_kind: "games", status: "pending", payment_status: "pending",
      subtotal: 11000, payment_method: "qris", payment_account: "QRIS", items: "[]",
      buyer_access_version: 0, locale: "id", customer_wa: "6281234567890",
    });
    const minutes = (Date.parse(`${String(order.expires_at).replace(" ", "T")}Z`) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(13);
    expect(minutes).toBeLessThan(16);

    expect(itemRow(data.code)).toMatchObject({
      buyer_sku_code: "ml86", customer_no: "123456789", quantity: 1,
      unit_price: 11000, total: 11000, cost_snapshot: 10000, max_price: 10500,
      status: "awaiting_payment", attempt_no: 1, customer_nickname: null,
    });
  });

  it("reuses the persisted order for a retried quote (no second row/invoice)", async () => {
    seedSku();
    const token = await quoteToken();
    const first = await (await placeOrder(token)).json();
    const second = await placeOrder(token);
    expect(second.status).toBe(200);
    const retry = await second.json();
    expect(retry).toMatchObject({ code: first.code, reused: true });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_order_items").get()).toEqual({ n: 1 });
  });

  it("returns 409 quote_stale when the price changed after quoting", async () => {
    seedSku();
    const token = await quoteToken();
    fx.sql.exec("UPDATE games_products SET sell_price=12000 WHERE buyer_sku_code='ml86'");
    const res = await placeOrder(token);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("quote_stale");
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
  });

  it.each(["sell_price=12000", "cost=12000", "enabled=0", "seller_active=0", "game_brand='FREE FIRE'"])("fences live SKU %s in the atomic claim", async mutation => {
    seedSku();
    const token = await quoteToken();
    fx.control.afterBatch = async queries => {
      if (queries.some(query => query.includes("INSERT INTO checkout_claims"))) {
        fx.sql.exec(`UPDATE games_products SET ${mutation} WHERE buyer_sku_code='ml86'`);
      }
    };
    const res = await placeOrder(token);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("quote_stale");
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_order_items").get()).toEqual({ n: 0 });
    expect(invoice).not.toHaveBeenCalled();
  });

  it("rejects tampered and expired quote tokens before creating an order", async () => {
    seedSku();
    const token = await quoteToken();
    const { createGamesQuoteToken, verifyGamesQuoteToken } = await import("@/lib/games/quote");
    const payload = await verifyGamesQuoteToken(token);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 31 * 60_000);
    const old = await createGamesQuoteToken(payload!);
    clock.mockRestore();
    for (const invalid of [token.slice(0, -4) + "AAAA", old.token]) {
      expect((await placeOrder(invalid)).status).toBe(409);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
    expect(invoice).not.toHaveBeenCalled();
  });

  it("parallel retries retain one order and consume one admission slot", async () => {
    seedSku();
    const token = await quoteToken();
    const responses = await Promise.all([placeOrder(token), placeOrder(token)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_order_items").get()).toEqual({ n: 1 });
    expect(fx.sql.prepare("SELECT MAX(orders_created) AS n FROM checkout_attempts").get()).toEqual({ n: 1 });
    expect(fx.sql.prepare("SELECT quote_id FROM checkout_claims").get()?.quote_id).toMatch(/^games:/);
  });

  it("retains the claimed order after invoice failure and recovers with the same quote", async () => {
    seedSku();
    const token = await quoteToken();
    invoice.mockRejectedValueOnce(new Error("invoice unavailable"));
    const failed = await placeOrder(token);
    expect(failed.status).toBe(503);
    const saved = await failed.json();
    const retry = await placeOrder(token);
    expect(retry.status).toBe(200);
    expect((await retry.json()).code).toBe(saved.code);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
  });

  it("allows one active order per customer_no + SKU", async () => {
    seedSku();
    await placeOrder(await quoteToken());
    const second = await placeOrder(await quoteToken());
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("duplicate_active_order");
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 1 });
  });

  it("is atomic: a mid-batch failure leaves neither the order nor the item", async () => {
    seedSku();
    const token = await quoteToken();
    fx.control.fail = (query) => query.includes("INSERT INTO games_order_items");
    const res = await placeOrder(token);
    expect(res.status).toBe(503);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_order_items").get()).toEqual({ n: 0 });
    fx.control.fail = null;
  });

  it("rate-limits the fourth new order from the same WhatsApp contact (429)", async () => {
    seedSku();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await placeOrder(await quoteToken())).status);
    expect(statuses).toEqual([201, 409, 409, 429]);
  });

  it("returns 503 (not fail-open) when admission storage errors", async () => {
    seedSku();
    const token = await quoteToken();
    fx.control.fail = (query) => query.includes("checkout_claims");
    const res = await placeOrder(token);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("checkout_unavailable");
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
    fx.control.fail = null;
  });

  it.each(["ip", "email"])("enforces the shared %s admission limit", async scope => {
    seedSku();
    const { POST } = await import("@/app/api/games/orders/route");
    const count = scope === "ip" ? 5 : 3;
    for (let i = 0; i <= count; i++) {
      const token = await quoteToken({ fields: { userId: String(100000 + i), zoneId: "1234" } });
      const res = await POST(json("http://x/api/games/orders", { quote_token: token, payment_method: "qris",
        whatsapp: `08123456789${i}`, email: scope === "email" ? Q.email : `buyer${i}@example.com` }, { "cf-connecting-ip": "203.0.113.1" }));
      expect(res.status).toBe(i === count ? 429 : 201);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: count });
  });
});

describe("games status", () => {
  const CODE = "AXG-20261109-ABCD1234";

  beforeEach(() => {
    const productId = seedSku();
    addOrder(CODE);
    addItem(CODE, productId);
  });

  it("requires full checkout contact", async () => {
    expect((await getStatus(CODE, "")).status).toBe(401);
    expect((await getStatus(CODE, "081200000000")).status).toBe(404);
    expect((await getStatus(CODE, "buyer@example.com")).status).toBe(200);
  });

  it.each([
    ["awaiting_payment", "awaiting_payment"],
    ["queued", "processing"],
    ["submitting", "processing"],
    ["pending", "processing"],
    ["needs_check", "needs_admin"],
    ["expired", "expired"],
  ])("maps item %s to %s", async (itemStatus, expected) => {
    fx.sql.prepare("UPDATE games_order_items SET status=? WHERE order_code=?").run(itemStatus, CODE);
    const data = await (await getStatus(CODE, "081234567890")).json();
    expect(data.order.games_status).toBe(expected);
    expect(data.order.games_status_raw).toBe(itemStatus);
  });

  it("never reports success unless the item succeeded", async () => {
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(CODE);
    const processing = await (await getStatus(CODE, "081234567890")).json();
     expect(processing.order.games_status).toBe("processing");

    fx.sql.prepare("UPDATE games_order_items SET status='pending' WHERE order_code=?").run(CODE);
    expect((await (await getStatus(CODE, "081234567890")).json()).order.games_status).toBe("processing");

    fx.sql.prepare("UPDATE games_order_items SET status='success', sn='SN-1', supplier_message='ok' WHERE order_code=?").run(CODE);
    const success = await (await getStatus(CODE, "081234567890")).json();
    expect(success.order).toMatchObject({ games_status: "success", sn: "SN-1", supplier_message: "ok" });
  });

  it("maps a cancelled/expired order to expired and exposes the QRIS view", async () => {
    fx.sql.prepare("UPDATE orders SET status='kadaluarsa', payment_status='expired' WHERE code=?").run(CODE);
    fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,unique_code,status,qris_payload,qris_url,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(CODE, "dana", "static", CODE, "m", 11000, 11101, 101, "pending", "p", `/api/payments/qris/${CODE}/image`, new Date().toISOString());
    const data = await (await getStatus(CODE, "081234567890")).json();
    expect(data.order.games_status).toBe("expired");
    expect(data.order.qris).toMatchObject({ payable_amount: 11101, unique_code: 101, status: "pending" });
    expect(JSON.stringify(data)).not.toMatch(/cost_snapshot|max_price|backup|ml86b/);
  });
});

describe("games lookup", () => {
  const CODE = "AXG-20261109-LOOKUP01";

  it("rejects a wrong contact and returns a buyer-safe summary for the right one", async () => {
    const productId = seedSku();
    addOrder(CODE);
    addItem(CODE, productId);
    fx.sql.prepare("UPDATE games_order_items SET status='success', sn='SN-9', supplier_message='ok' WHERE order_code=?").run(CODE);
    const { POST } = await import("@/app/api/games/lookup/route");
    const wrong = await POST(json("http://x/api/games/lookup", { code: CODE, contact: "081200000000" }));
    expect(wrong.status).toBe(404);
    const right = await POST(json("http://x/api/games/lookup", { code: CODE, contact: "081234567890" }));
    expect(right.status).toBe(200);
    const data = await right.json();
    expect(data.order).toMatchObject({ code: CODE, order_kind: "games", games_status: "success", sn: "SN-9" });
    expect(data.order.customer_no).toBe("123456789");
    expect(JSON.stringify(data)).not.toMatch(/cost_snapshot|max_price|backup_sku|ml86b/);
  });

  it("validates the AXG code format", async () => {
    const { POST } = await import("@/app/api/games/lookup/route");
    expect((await POST(json("http://x/api/games/lookup", { code: "AXV-20261109-ABCD1234", contact: "081234567890" }))).status).toBe(400);
  });
});

describe("games expiry and paid dispatch", () => {
  it.each([null, "dana", "klikqris"])("cron expiry closes Games with %s ledger and its item", async provider => {
    const productId = seedSku();
    const code = "AXG-20261109-CRON0001";
    addOrder(code, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    addItem(code, productId);
    if (provider) fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,expires_at)
      VALUES(?,?,'fixture',?,'fixture',11000,'pending',datetime('now','-1 minute'))`).run(code, provider, code);
    vi.stubEnv("CRON_SECRET", "fixture-cron");
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const response = await POST(new NextRequest("http://x/api/cron/lite?job=expiry", {
      method: "POST", headers: { authorization: "Bearer fixture-cron" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, games_items_expired: 1 });
    expect(orderRow(code)).toMatchObject({ status: "kadaluarsa", payment_status: "expired" });
    expect(itemRow(code)?.status).toBe("expired");
  });

  it("never expires an item if its order expiry transition fails", async () => {
    const productId = seedSku();
    const code = "AXG-20261109-EXPIRE02";
    addOrder(code, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    addItem(code, productId);
    fx.control.fail = query => query.includes("INSERT INTO operation_guards");
    const { expireGamesCheckouts } = await import("@/lib/games/expire");
    expect(await expireGamesCheckouts(createDatabaseAccess(fx.db))).toBe(0);
    expect(orderRow(code)?.status).toBe("pending");
    expect(itemRow(code)?.status).toBe("awaiting_payment");
  });

  it("sweeps past historical expired rows and preserves paid items", async () => {
    const productId = seedSku();
    for (let i = 0; i < 22; i++) {
      const code = `AXG-20261109-${String(i).padStart(8, "0")}`;
      addOrder(code, { status: "kadaluarsa", payment_status: "expired" });
      addItem(code, productId, { status: i < 21 ? "expired" : "awaiting_payment" });
    }
    const paid = "AXG-20261109-PAID0002";
    addOrder(paid, { status: "lunas", payment_status: "paid", paid_at: new Date().toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() });
    addItem(paid, productId);
    const { expireGamesCheckouts } = await import("@/lib/games/expire");
    expect(await expireGamesCheckouts(createDatabaseAccess(fx.db))).toBe(1);
    expect(itemRow("AXG-20261109-00000021")?.status).toBe("expired");
    expect(itemRow(paid)?.status).toBe("awaiting_payment");
  });

  it("expires unpaid orders past the deadline without touching Market stock", async () => {
    const productId = seedSku({ id: 1 });
    fx.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,50)");
    const CODE = "AXG-20261109-EXPIRED1";
    addOrder(CODE, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    addItem(CODE, productId);
    const { expireGamesCheckouts } = await import("@/lib/games/expire");
    const expired = await expireGamesCheckouts(createDatabaseAccess(fx.db));
    expect(expired).toBe(1);
    expect(orderRow(CODE)).toMatchObject({ status: "kadaluarsa", payment_status: "expired" });
    expect(itemRow(CODE)?.status).toBe("expired");

    // Guard bersama: cancel Games dengan daftar restock berisi product Market
    // id 1 tidak boleh menambah stok Market.
    const PENDING = "AXG-20261109-PENDING01";
    addOrder(PENDING);
    addItem(PENDING, productId);
    const { transitionPendingOrder } = await import("@/lib/db");
    await transitionPendingOrder(PENDING, "dibatalkan", "buyer_cancel", [{ product_id: 1, qty: 1 }]);
    expect(fx.sql.prepare("SELECT stock FROM products WHERE id=1").get()).toEqual({ stock: 50 });
    expect(orderRow(PENDING)).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
  });

  it("promotes a paid order and dispatches it to Digiflazz", async () => {
    seedSku();
    const CODE = "AXG-20261109-PAID0001";
    addOrder(CODE, { status: "lunas", payment_status: "paid" });
    addItem(CODE, 1);
    const fetchMock = vi.fn(async () => txReply(`${CODE}-1`, "Sukses"));
    vi.stubGlobal("fetch", fetchMock);
    const { processGamesPaidOrders } = await import("@/lib/games/dispatch");
    const result = await processGamesPaidOrders(undefined, createDatabaseAccess(fx.db));
    expect(result).toMatchObject({ promoted: 1, dispatched: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ buyer_sku_code: "ml86", customer_no: "123456789", ref_id: `${CODE}-1`, max_price: 10500 });
    expect(itemRow(CODE)).toMatchObject({ status: "success", sn: "SN-123" });
  });
});
