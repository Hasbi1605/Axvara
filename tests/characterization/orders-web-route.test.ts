// tests/characterization/orders-web-route.test.ts — T5 characterization for 3B/F1.
//
// Locks CURRENT behavior of src/app/api/orders/route.ts BEFORE the split into
// src/lib/orders/checkout/* + status-flags.ts + detail-view.ts (roadmap §6 Fase 1
// T5; MAP-1 (d)§5). Test-only: never touches src/, drizzle/, scripts/, docs/.
// Asserts observable behavior (status, JSON, DB rows), never SQL text.
// Reference baseline: 2026-11-21-refactor-roadmap.md §3.11, §6 Fase 1 T5.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "../helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
let originalFetch: typeof fetch | undefined;

const WA = "081234567890";
const EMAIL = "buyer@example.test";

async function signedToken(items: { product_id: number; variant_id?: number; qty: number }[], price = 10000, subtotal?: number) {
  const { createCheckoutQuoteToken } = await import("@/lib/auth");
  const qtyTotal = items.reduce((n, i) => n + i.qty, 0);
  const sum = subtotal ?? qtyTotal * price;
  const { token } = await createCheckoutQuoteToken({
    items: items.map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, name: "Fixture", price, qty: i.qty })),
    subtotal: sum,
    payment_methods: [{ id: "qris", account_number: "-" }],
  });
  return token;
}

async function postCheckout(token: string, overrides: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/orders/route");
  return POST(new NextRequest("https://axvara.test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customer_wa: WA,
      customer_email: EMAIL,
      items: [{ product_id: 1, variant_id: 1, qty: 1 }],
      payment_method: "qris",
      quote_token: token,
      ...overrides,
    }),
  }));
}

async function readUniqueUnitProgressFor(code: string) {
  const { GET } = await import("@/app/api/orders/route");
  const response = await GET(new NextRequest(`https://axvara.test/api/orders?code=${code}`, {
    // Pin orders (buyer_access_version=1) authorize status reads by contact
    // proof (email/WA), not by the PIN itself — same as buyer-pin.test.ts.
    headers: { "x-order-contact": EMAIL },
  }));
  return { response, body: await response.json() as { order: Record<string, unknown> } };
}

async function readLookupFor(code: string, contact = EMAIL) {
  const { POST } = await import("@/app/api/orders/lookup/route");
  const row = fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  const { deriveOrderAccessCode } = await import("@/lib/order-access");
  const pin = await deriveOrderAccessCode(row);
  const response = await POST(new NextRequest("https://axvara.test/api/orders/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, contact, access_code: pin }),
  }));
  return { response, body: await response.json() as { order: Record<string, unknown>; buyer_access_session?: unknown } };
}

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.exec("UPDATE product_variants SET price=10000,stock=100,bulk_pricing_enabled=0; UPDATE products SET is_active=1");
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "t5-web-route-fixture-secret");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "t5-web-route-buyer-secret");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
  clearRateLimitBucketsForTest();
  const qris = await import("@/lib/payments/qris");
  vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({
    orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 0,
    qrisPayload: "fixture", qrisUrl: "/fixture.png", expiresAt: "2099-01-01", isExisting: false,
  }));
  originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No real network: T5 blocks external traffic"); }));
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("T5 — guard precedence before createOrderWithStock", () => {
  it("cart item-set mismatch beats a stale price: cart check wins and no row is written", async () => {
    // Route order: quote verify → slug canonical → cart equality (:216-222)
    // → buyer-field (:223-229) → email → min/max → price (:345-385). When
    // the item set AND the price are both stale, the cart message wins.
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }], 10000);
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    const response = await postCheckout(token, { items: [{ product_id: 999, variant_id: 999, qty: 5 }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("Isi keranjang berubah setelah harga dikunci. Muat ulang checkout.");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("stale price alone is price_changed with no row written", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }], 10000);
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    const response = await postCheckout(token, { items: [{ product_id: 1, variant_id: 1, qty: 1 }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(body.error).toBe("price_changed");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("minimum-qty guard fires when several guards fail at once and writes nothing", async () => {
    // GSuite-style min 50 (route.ts:278-343). Even though the signed price is
    // also stale afterwards, min-qty is evaluated first and wins.
    fixture.sql.prepare("UPDATE product_variants SET min_qty=50 WHERE id=1").run();
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 2 }], 10000, 20000);
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    const response = await postCheckout(token, { items: [{ product_id: 1, variant_id: 1, qty: 2 }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(String(body.error ?? "")).toMatch(/minimal pembelian 50/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("Jaspay cap guard fails closed and beats the price guard, writing nothing", async () => {
    // WR3 Jaspay: mirror cap present at 2, request qty 3. Route pre-check
    // (route.ts:328-337) rejects before price_changed could be reached.
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('jaspay:T5','T5',1)").run();
    fixture.sql.prepare("UPDATE product_variants SET wr_variant_id='jaspay:T5:PKG' WHERE id=1").run();
    fixture.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_delivery_mode,wr_max_quantity) VALUES('jaspay:T5:PKG','jaspay:T5','PKG',5000,-1,1,10000,'made_by_order','api','manual',2)").run();
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 3 }], 10000, 30000);
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    const response = await postCheckout(token, { items: [{ product_id: 1, variant_id: 1, qty: 3 }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(String(body.error ?? "")).toMatch(/maksimal pembelian 2/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("buyer-field (muse_invite_code) mismatch beats a stale price and writes nothing", async () => {
    // Quote carries invite code ABC123; route.ts:223-229 re-checks equality
    // before the price guard, so the buyer message wins even with a stale price.
    fixture.sql.prepare("UPDATE product_variants SET buyer_field_key='muse_invite_code' WHERE id=1").run();
    const { createCheckoutQuoteToken } = await import("@/lib/auth");
    const { token } = await createCheckoutQuoteToken({
      items: [{ product_id: 1, variant_id: 1, name: "Fixture", price: 10000, qty: 1, buyer_field_key: "muse_invite_code", buyer_fields: { muse_invite_code: "ABC123" } }],
      subtotal: 10000,
      payment_methods: [{ id: "qris", account_number: "-" }],
    });
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    const response = await postCheckout(token, { items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: { muse_invite_code: "ZZZ999" } }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(String(body.error ?? "")).toMatch(/Input pembeli berubah/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("invite-type WR variant with a valid email passes the email guard (no 422)", async () => {
    // Route email guard (route.ts:234-276) only rejects invite/require_email
    // rows with an invalid email — but zod already requires a valid email,
    // so the reachable pin is pass-through: invite + valid email creates.
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-invite','Invite',1)").run();
    fixture.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_type) VALUES('var-invite','prod-invite','Invite',5000,10,1,10000,'made_by_order','api','Invite')").run();
    fixture.sql.prepare("UPDATE product_variants SET wr_variant_id='var-invite' WHERE id=1").run();
    const { createCheckoutQuoteToken } = await import("@/lib/auth");
    const { token } = await createCheckoutQuoteToken({
      items: [{ product_id: 1, variant_id: 1, name: "Fixture", price: 10000, qty: 1 }],
      subtotal: 10000,
      payment_methods: [{ id: "qris", account_number: "-" }],
    });
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("https://axvara.test/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_wa: WA,
        customer_email: "buyer@example.test",
        items: [{ product_id: 1, variant_id: 1, qty: 1 }],
        payment_method: "qris",
        quote_token: token,
      }),
    }));
    // Baseline pin: current code treats invite + valid email as pass-through.
    expect(response.status).toBe(201);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
  });

  it("invalid email shape is rejected by zod (400) before any DB guard runs", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const response = await postCheckout(token, { customer_email: "not-an-email" });
    expect(response.status).toBe(400);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it("cart-set mismatch after a valid quote is 409 with no writes", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const response = await postCheckout(token, { items: [{ product_id: 1, variant_id: 1, qty: 2 }] });
    expect(response.status).toBe(409);
    const body = await response.json() as { error?: string };
    expect(String(body.error ?? "")).toMatch(/Isi keranjang berubah/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });
});

describe("T5 — last-unit race (both runners overlap before either writes)", () => {
  it("two checkouts for the last unit overlap, exactly one creates an order", async () => {
    fixture.sql.prepare("UPDATE product_variants SET stock=1 WHERE id=1").run();
    const tokenA = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const tokenB = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    // Both-arrive barrier on the atomic order batch (same pattern as the T7
    // races): the first runner's batch waits until the second runner has
    // finished its guard/stock reads, so the test proves the atomic guard —
    // not lucky serialization — picks a single winner.
    const realBatch = fixture.db.batch.bind(fixture.db);
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    fixture.db.batch = (async (statements: never[]) => {
      const isOrderBatch = (statements as { query?: string }[]).some((s) => typeof s?.query === "string" && s.query.includes("INSERT INTO orders"));
      if (isOrderBatch) {
        arrivals++;
        if (arrivals >= 2) release();
        else await bothArrived;
      }
      return realBatch(statements);
    }) as typeof fixture.db.batch;
    const results = await Promise.allSettled([postCheckout(tokenA), postCheckout(tokenB)]);
    expect(arrivals).toBe(2);
    const statuses = results.map((r) => r.status === "fulfilled" ? r.value.status : "threw").sort();
    expect(statuses).toEqual([201, 409]);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
  });
});

describe("T5 — response shapes (exact JSON key order)", () => {
  it("created 201 response has exact keys in order", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const response = await postCheckout(token);
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["code", "buyer_access_session", "checkout_credential_grant", "subtotal", "status", "locale", "qris"]);
    expect(body).toMatchObject({ subtotal: 10000, status: "pending", locale: "id" });
    expect(Object.keys(body.qris as Record<string, unknown>)).toEqual(["payable_amount", "unique_code", "image_url", "expires_at"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("reused 200 response has exact keys in order including reused:true", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const first = await postCheckout(token);
    expect(first.status).toBe(201);
    const { code } = await first.json() as { code: string };
    const retry = await postCheckout(token);
    expect(retry.status).toBe(200);
    const body = await retry.json() as Record<string, unknown>;
    // No saved provider tx exists (mocked invoice writes none), so the
    // generic reuse branch answers without a qris block — pin that shape.
    expect(Object.keys(body)).toEqual(["code", "subtotal", "status", "buyer_access_session", "checkout_credential_grant", "reused", "locale"]);
    expect(body).toMatchObject({ code, reused: true, subtotal: 10000 });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
  });

  it("closed order retry returns 409 checkout_order_closed", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const first = await postCheckout(token);
    expect(first.status).toBe(201);
    const { code } = await first.json() as { code: string };
    fixture.sql.prepare("UPDATE orders SET status='dibatalkan' WHERE code=?").run(code);
    const retry = await postCheckout(token);
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ error_code: "checkout_order_closed" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
  });
});

describe("T5 — GET post-refresh credentials_ready", () => {
  it("lunas order with a completed WR link reports credentials_ready:true on GET", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const created = await postCheckout(token);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    fixture.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-t5','T5',1)").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,wr_account_details) VALUES(?,'WR-T5','var-1',1,5000,'completed','EMAIL:u@x.id PASS:s3cret')").run(code);
    const { response, body } = await readUniqueUnitProgressFor(code);
    expect(response.status).toBe(200);
    expect(body.order.credentials_ready).toBe(true);
    expect(body.order).toMatchObject({ code, status: "lunas" });
  });

  it("lunas order with no supplier links reports credentials_ready:false", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const created = await postCheckout(token);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    fixture.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
    const { response, body } = await readUniqueUnitProgressFor(code);
    expect(response.status).toBe(200);
    expect(body.order.credentials_ready).toBe(false);
  });
});

describe("T5 — parity of the 7 readiness fields with orders/lookup", () => {
  const FIELDS = ["credentials_ready", "supplier_owned", "supplier_running", "unique_units_progress", "qris_reissue_allowed", "automatic_progress", "fulfillment_status"] as const;

  async function bothViews(code: string) {
    const web = (await readUniqueUnitProgressFor(code)).body.order;
    const viaLookup = (await readLookupFor(code)).body.order;
    return { web, viaLookup };
  }

  it("pending manual order: all 7 fields match between GET and lookup", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const created = await postCheckout(token);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    const { web, viaLookup } = await bothViews(code);
    for (const field of FIELDS) {
      expect(web[field], `field ${field}`).toEqual(viaLookup[field]);
    }
  });

  it("lunas order with completed WR link: all 7 fields match between GET and lookup", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const created = await postCheckout(token);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    fixture.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid',fulfillment_status='delivered' WHERE code=?").run(code);
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,wr_account_details) VALUES(?,'WR-T5B','var-1',1,5000,'completed','EMAIL:u@x.id PASS:s3cret')").run(code);
    const { web, viaLookup } = await bothViews(code);
    for (const field of FIELDS) {
      expect(web[field], `field ${field}`).toEqual(viaLookup[field]);
    }
    expect(web.credentials_ready).toBe(true);
    expect(viaLookup.credentials_ready).toBe(true);
  });

  it("lunas order with a running WR link: all 7 fields match, running on both", async () => {
    const token = await signedToken([{ product_id: 1, variant_id: 1, qty: 1 }]);
    const created = await postCheckout(token);
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    fixture.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES(?,'WR-T5C','var-1',1,5000,'processing')").run(code);
    const { web, viaLookup } = await bothViews(code);
    for (const field of FIELDS) {
      expect(web[field], `field ${field}`).toEqual(viaLookup[field]);
    }
    expect(web.supplier_running).toBe(true);
    expect(viaLookup.supplier_running).toBe(true);
  });
});
