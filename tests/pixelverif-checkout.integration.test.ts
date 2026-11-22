import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCheckoutQuoteToken } from "@/lib/auth";
import { createOrderWithStock } from "@/lib/db/orders-create";
import { readTelegramCatalog } from "@/lib/telegram/catalog-snapshot";
import { addToCart, getCartSummary, setCartLineQty } from "@/lib/telegram/cart";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCartAdd } from "@/lib/telegram/handlers/cart";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { safeEditOrSend, sendMessage } from "@/lib/telegram/api";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
}));

const user = { id: 800, first_name: "Fixture" };
const item = { product_id: 1, variant_id: 1, name: "Pixel fixture", price: 21500, qty: 1 };
const pvFields = {
  pv_email: "buyer.fixture@gmail.com",
  pv_password: "fixture-password-marker",
  pv_totp_secret: "JBSWY3DPEHPK3PXP",
};
let fx: ReturnType<typeof createD1Fixture>;
const request = (path: string, body: unknown) => new NextRequest(`https://axvara.test${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  fx = createD1Fixture();
  vi.clearAllMocks();
  clearRateLimitBucketsForTest();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in local fixture"); }));
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false", PRODUCT_VARIANTS_READ: "true", ADMIN_JWT_SECRET: "fixture-signing-only",
    BUYER_ORDER_ACCESS_SECRET: "fixture-buyer-only", SEKALIPAY_GATEWAY_ENABLED: "false", NOWPAYMENTS_ENABLED: "false",
  })) vi.stubEnv(key, value);
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,pixelverif_family)
    VALUES(1,'Pixel fixture','pixel-fixture',21500,2,1,0,'google_ai_pro_3m');
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,pixelverif_fx_idr_per_usd,max_qty)
    VALUES(1,1,'PV-NORMAL-3','Pixel variant',21500,2,1,'normal',3,1,16000,1);
    INSERT INTO telegram_users(user_id,chat_id,locale) VALUES('800','800','id');`);
});
afterEach(() => { fx.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("issues a quote only with complete Pixel credentials and never reflects them", async () => {
  const { POST } = await import("@/app/api/checkout/quote/route");
  const missing = await POST(request("/api/checkout/quote", { items: [{ product_id: 1, variant_id: 1, qty: 1 }] }));
  expect(missing.status).toBe(409);
  const missingBody = await missing.json();
  expect(missingBody).toMatchObject({ ok: false, items: [] });
  expect(missingBody).not.toHaveProperty("quoteToken");

  const complete = await POST(request("/api/checkout/quote", {
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
  }));
  expect(complete.status).toBe(200);
  const text = await complete.text();
  expect(text).not.toContain(pvFields.pv_password);
  expect(text).not.toContain(pvFields.pv_totp_secret);
  const body = JSON.parse(text) as { quoteToken?: string; items: Record<string, unknown>[] };
  expect(body.quoteToken).toBeTruthy();
  expect(body.items[0]).not.toHaveProperty("buyer_fields");
});

it("rejects incomplete reserved secret fields at quote and order intake, without reflecting values", async () => {
  const { POST: quote } = await import("@/app/api/checkout/quote/route");
  const { POST: order } = await import("@/app/api/orders/route");
  const { token } = await createCheckoutQuoteToken({ items: [item], subtotal: item.price, payment_methods: [{ id: "qris", account_number: "-" }] });
  const items = [{ ...item, buyer_fields: { pv_password: "not-a-real-password-marker", pv_totp_secret: "not-a-real-2fa-marker" } }];
  const responses = [
    await quote(request("/api/checkout/quote", { items })),
    await order(request("/api/orders", { items, quote_token: token, payment_method: "qris", customer_wa: "081234567890", customer_email: "buyer@example.test" })),
  ];
  for (const response of responses) {
    expect([400, 409]).toContain(response.status);
    expect(await response.text()).not.toContain("not-a-real-");
  }
  expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
  expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM pixelverif_buyer_inputs").get()?.n).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("seals credentials atomically and keeps orders.items credential-free", async () => {
  await createOrderWithStock({
    code: "AXV-20261122-PVSEAL01", quoteId: "fixture-seal", customerName: "Fixture", customerWa: "081234567890", customerEmail: "buyer@example.test",
    items: [{ ...item, max_qty: 1, buyer_fields: pvFields }], subtotal: item.price, paymentMethod: "qris", paymentAccount: "-", proofUrl: null,
  });
  const order = fx.sql.prepare("SELECT items FROM orders WHERE code=?").get("AXV-20261122-PVSEAL01") as { items: string };
  expect(order.items).not.toContain(pvFields.pv_password);
  expect(order.items).not.toContain(pvFields.pv_totp_secret);
  expect(order.items).not.toContain(pvFields.pv_email);
  expect(JSON.parse(order.items)[0]).toMatchObject({ pixelverif_eligibility: { flow_type: "normal", sku: "PV-NORMAL-3" } });
  const sealed = fx.sql.prepare("SELECT input_ciphertext, input_iv, email_masked FROM pixelverif_buyer_inputs WHERE order_code=?").get("AXV-20261122-PVSEAL01") as {
    input_ciphertext: string; input_iv: string; email_masked: string;
  };
  expect(sealed.email_masked).toBe("bu***@gmail.com");
  await expect(decryptSecret(sealed.input_ciphertext, sealed.input_iv)).resolves.toBe(JSON.stringify({
    pv_email: pvFields.pv_email,
    pv_password: pvFields.pv_password,
    pv_totp_secret: pvFields.pv_totp_secret,
  }));
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(1);
});

it("rejects direct order creation atomically when Pixel credentials are absent, even if the family marker is absent", async () => {
  fx.sql.exec("UPDATE products SET pixelverif_family=NULL WHERE id=1");
  await expect(createOrderWithStock({
    code: "AXV-20261122-GUARD001", quoteId: "fixture-guard", customerName: "Fixture", customerWa: "081234567890", customerEmail: "buyer@example.test",
    items: [{ ...item, max_qty: 1 }], subtotal: item.price, paymentMethod: "qris", paymentAccount: "-", proofUrl: null,
  })).rejects.toThrow();
  expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
  expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM pixelverif_buyer_inputs").get()?.n).toBe(0);
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(2);
});

it("offers Pixel in Telegram catalog and requires the private credential flow before cart add", async () => {
  fx.sql.exec("UPDATE products SET telegram_enabled=1 WHERE id=1");
  expect(await readTelegramCatalog()).toHaveLength(1);
  await handleCommand("/start prd_1", user.id, "private", user);
  expect(safeEditOrSend).toHaveBeenCalled();
  expect(await addToCart(String(user.id), 1, 1, 1)).toEqual({ ok: false, reason: "invalid_quantity" });
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    text: expect.stringContaining("Data akun Google untuk aktivasi"),
  }));
  fx.sql.exec(`INSERT INTO telegram_carts(user_id,product_id,variant_id,qty,buyer_fields)
    VALUES('800',1,1,1,'${JSON.stringify(pvFields)}')`);
  expect(await setCartLineQty(String(user.id), 1, 1)).toBe(true);
  const summary = await getCartSummary(String(user.id));
  expect(summary.lines).toHaveLength(1);
  expect(summary.lines[0]).toMatchObject({ productId: 1, variantId: 1, pixelverifInput: true });
  expect(summary.issues).toEqual([]);
});
