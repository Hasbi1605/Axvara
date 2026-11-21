import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { createOrderWithStock, StockReservationError } from "@/lib/db";
import { createAdminToken, createIdleToken, createCheckoutQuoteToken } from "@/lib/auth";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fx = createD1Fixture();
  vi.stubEnv("ADMIN_JWT_SECRET", "owasp-local-fixture-secret");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "b".repeat(64));
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external requests in security fixtures"); }));
  clearRateLimitBucketsForTest();
  await insertTestProduct(fx.sql, "manual", 2);
  fx.sql.exec("UPDATE products SET description='PRIVATE-SUPPLIER-DRAFT',admin_description_override='Public copy'; UPDATE product_variants SET manual_cost=4321; UPDATE product_variants SET is_active=0,label='PRIVATE-INACTIVE-VARIANT' WHERE id=2");
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("OWASP A01 product editor boundary", () => {
  it("anonymous requests cannot read costs or unpublished product/variant data", async () => {
    const { GET } = await import("@/app/api/products/[id]/route");
    const response = await GET(new NextRequest("https://axvara.test/api/products/1"), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain("4321");
    expect(text).not.toContain("PRIVATE-");
  });

  it("an admin with a valid bound session can still edit inactive variants privately", async () => {
    const session = await createAdminToken("admin@example.test");
    const idle = await createIdleToken(session.sid);
    const { GET } = await import("@/app/api/products/[id]/route");
    const response = await GET(new NextRequest("https://axvara.test/api/products/1", {
      headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
    }), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect((await response.json()).product.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2, is_active: 0, manual_cost: 4321 }),
    ]));
  });
});

const orderInput = (): Parameters<typeof createOrderWithStock>[0] => ({
  code: "AXV-20261027-SEC00001", quoteId: "security-quote", customerName: "Fixture",
  customerWa: "6281234567890", customerEmail: "buyer@example.test",
  items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }],
  subtotal: 10000, paymentMethod: "qris", paymentAccount: "Fixture", proofUrl: null,
});

describe("OWASP A06/A10 atomic checkout integrity", () => {
  it.each(["price", "parent-inactive", "variant-reparented", "legacy-price"])("rejects %s changes before any order or stock mutation", async (scenario) => {
    const input = orderInput();
    if (scenario === "price") fx.sql.exec("UPDATE product_variants SET price=15000 WHERE id=1");
    if (scenario === "parent-inactive") fx.sql.exec("UPDATE products SET is_active=0 WHERE id=1");
    if (scenario === "variant-reparented") {
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(2,'Other','other',10000,100); UPDATE product_variants SET product_id=2 WHERE id=1");
    }
    if (scenario === "legacy-price") {
      fx.sql.exec("UPDATE products SET price=15000 WHERE id=1");
      input.items = [{ product_id: 1, price: 10000, qty: 1, name: "Fixture" }];
    }
    await expect(createOrderWithStock(input)).rejects.toBeInstanceOf(StockReservationError);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    expect(fx.sql.prepare("SELECT stock FROM products WHERE id=1").get()?.stock).toBe(100);
  });

  it.each(["price-read-error", "price-change-after-admission"])("%s cannot create an underpriced invoice", async (scenario) => {
    const qris = await import("@/lib/payments/qris");
    const invoice = vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({
      orderCode: code, requestedAmount: amount, payableAmount: amount + 1, uniqueCode: 1,
      qrisPayload: "fixture", qrisUrl: "/fixture.webp", expiresAt: "2099-01-01", isExisting: false,
    }));
    const { token } = await createCheckoutQuoteToken({ items: orderInput().items, subtotal: 10000,
      payment_methods: [{ id: "qris", account_number: "Fixture" }] });
    if (scenario === "price-read-error") {
      fx.sql.exec("UPDATE product_variants SET price=15000 WHERE id=1");
      fx.control.fail = (sql) => /SELECT id, price FROM product_variants/.test(sql);
    } else {
      fx.control.afterBatch = async (queries) => {
        if (queries.some((sql) => sql.includes("INSERT INTO checkout_claims"))) {
          fx.sql.exec("UPDATE product_variants SET price=15000 WHERE id=1");
        }
      };
    }
    const { POST } = await import("@/app/api/orders/route");
    const response = await POST(new NextRequest("https://axvara.test/api/orders", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.100" },
      body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test",
        items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "qris", quote_token: token }),
    }));
    expect([409, 503]).toContain(response.status);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    expect(invoice).not.toHaveBeenCalled();
  });
});
