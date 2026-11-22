import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCheckoutQuoteToken } from "@/lib/auth";
import { createOrderWithStock } from "@/lib/db/orders-create";
import { readTelegramCatalog } from "@/lib/telegram/catalog-snapshot";
import { addToCart, getCartSummary, setCartLineQty } from "@/lib/telegram/cart";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCartAdd } from "@/lib/telegram/handlers/cart";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { deleteMessage, safeEditOrSend, sendMessage } from "@/lib/telegram/api";
import { handleBuyerInput } from "@/lib/telegram/handlers/buyer-input";
import { resolveCurrentPayq1Lines } from "@/lib/telegram/handlers/payment-lines";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import type { Payq1State } from "@/lib/telegram/payment-quote";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";

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
  stubFulfillmentKey();
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
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,pixelverif_flow_type,pixelverif_validity,pixelverif_cost_usd,max_qty)
    VALUES(1,1,'PV-NORMAL-3','Pixel variant',21500,2,1,'normal',3,1,1);
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
  // The HS256 payload is only signed, not encrypted: prove no credential is
  // readable from the token itself, only a fingerprint + masked email.
  const payload = JSON.parse(Buffer.from(body.quoteToken!.split(".")[1], "base64url").toString("utf8")) as { items: Record<string, unknown>[] };
  const signedFields = JSON.stringify(payload.items[0].buyer_fields ?? {});
  expect(signedFields).not.toContain(pvFields.pv_password);
  expect(signedFields).not.toContain(pvFields.pv_totp_secret);
  expect(signedFields).not.toContain(pvFields.pv_email);
  expect(signedFields).toContain("pv_fingerprint");
  expect(JSON.stringify(body.items[0])).not.toContain("pv_password");
  expect(JSON.stringify(body.items[0])).not.toContain("pv_totp_secret");
});

it("accepts the quoted credential fingerprint at order validation and rejects drift", async () => {
  const { POST: quote } = await import("@/app/api/checkout/quote/route");
  const { validateCheckoutInput } = await import("@/lib/orders/checkout/validate");
  const quoted = await quote(request("/api/checkout/quote", {
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
  }));
  expect(quoted.status).toBe(200);
  const { quoteToken } = await quoted.json() as { quoteToken: string };
  const base = {
    customer_wa: "081234567890", customer_email: "buyer@example.test",
    payment_method: "qris", quote_token: quoteToken,
  };
  const ok = await validateCheckoutInput({
    ...base,
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
  });
  expect(ok.kind).toBe("valid");
  if (ok.kind === "valid") {
    // Only the atomic-create items carry the verified triple; the signed quote never does.
    expect(ok.value.orderItems[0].buyer_fields).toEqual(pvFields);
    expect(JSON.stringify(ok.value.quote.items)).not.toContain(pvFields.pv_password);
  }
  // Drifted credential against the same token must fail closed (Sol-1 regression).
  const drifted = await validateCheckoutInput({
    ...base,
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: { ...pvFields, pv_password: "fixture-password-other" } }],
  });
  expect(drifted.kind).toBe("responded");
  if (drifted.kind === "responded") expect(drifted.response.status).toBe(409);
  const missing = await validateCheckoutInput({
    ...base,
    items: [{ product_id: 1, variant_id: 1, qty: 1 }],
  });
  expect(missing.kind).toBe("responded");
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
  expect(await addToCart(String(user.id), 1, 1, 1)).toEqual({ ok: false, reason: "pixelverif_unavailable" });
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    text: expect.stringContaining("Data akun Google untuk aktivasi"),
  }));
  // Cart persistence must hold ONLY the sealed blob, never the plaintext triple.
  const { sealPixelverifCartFields } = await import("@/lib/buyer-fields");
  const sealed = await sealPixelverifCartFields({ ...pvFields });
  const storedJson = JSON.stringify(sealed);
  expect(storedJson).not.toContain(pvFields.pv_password);
  expect(storedJson).not.toContain(pvFields.pv_totp_secret);
  fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty,buyer_fields) VALUES('800',1,1,1,?)").run(storedJson);
  const rawRow = fx.sql.prepare("SELECT buyer_fields FROM telegram_carts WHERE user_id='800'").get() as { buyer_fields: string };
  expect(rawRow.buyer_fields).not.toContain(pvFields.pv_password);
  expect(rawRow.buyer_fields).not.toContain(pvFields.pv_totp_secret);
  expect(await setCartLineQty(String(user.id), 1, 1)).toBe(true);
  const summary = await getCartSummary(String(user.id));
  expect(summary.lines).toHaveLength(1);
  expect(summary.lines[0]).toMatchObject({ productId: 1, variantId: 1, pixelverifInput: true });
  // In-memory line carries the unsealed triple for checkout sealing only.
  expect(summary.lines[0].buyerFields).toEqual(pvFields);
  expect(summary.issues).toEqual([]);
});

const payq1 = (source: Payq1State["source"], idrSubtotal: number, tag: string) =>
  ({ v: 1, nonce: "n", exp: Date.now() + 60_000, tag, locale: "id", idrSubtotal, source, methods: [], sel: null, contact: { email: null, phone: null }, st: "quoted" }) as Payq1State;

it("runs the real 3-step Telegram flow into a sealed cart line whose approval tag survives re-resolution (Sol-3/4/5)", async () => {
  fx.sql.exec("UPDATE products SET telegram_enabled=1 WHERE id=1");
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  await handleBuyerInput(pvFields.pv_email, user.id, user, 11);
  await handleBuyerInput(pvFields.pv_password, user.id, user, 12);
  await handleBuyerInput("jbsw y3dp ehpk 3pxp", user.id, user, 13);
  // Password and TOTP messages are deleted after reading.
  expect(deleteMessage).toHaveBeenCalledWith(user.id, 12);
  expect(deleteMessage).toHaveBeenCalledWith(user.id, 13);

  const raw = fx.sql.prepare("SELECT buyer_fields FROM telegram_carts WHERE user_id='800'").get() as { buyer_fields: string } | undefined;
  expect(raw).toBeTruthy();
  for (const secret of Object.values(pvFields)) expect(raw!.buyer_fields).not.toContain(secret);
  expect(JSON.parse(raw!.buyer_fields)).toMatchObject({ pv_email_masked: "bu***@gmail.com", pv_sealed_ciphertext: expect.any(String), pv_sealed_iv: expect.any(String) });
  // The shared checkout-contact column is never overwritten with the target Gmail.
  const tgUser = fx.sql.prepare("SELECT buyer_email,pending_action FROM telegram_users WHERE user_id='800'").get() as Record<string, unknown>;
  expect(tgUser.buyer_email ?? null).toBeNull();
  expect(tgUser.pending_action ?? null).toBeNull();

  const summary = await getCartSummary(String(user.id));
  expect(summary.issues).toEqual([]);
  expect(summary.lines[0].buyerFields).toEqual(pvFields);
  // Tag as created by the cart approval UI (handlers/cart.ts) must match the payq1 re-resolution.
  const tag = await checkoutApprovalTag(summary.lines);
  await expect(resolveCurrentPayq1Lines(String(user.id), payq1({ kind: "cart" }, 21500, tag))).resolves.toMatchObject({ ok: true });
});

it("/batal drops the in-memory credential stash so a late TOTP never reaches the cart", async () => {
  fx.sql.exec("UPDATE products SET telegram_enabled=1 WHERE id=1");
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  await handleBuyerInput(pvFields.pv_email, user.id, user, 21);
  await handleBuyerInput(pvFields.pv_password, user.id, user, 22);
  await handleCommand("/batal", user.id, "private", user);
  fx.sql.exec("UPDATE telegram_users SET pending_action='pvinput:1:1:totp' WHERE user_id='800'");
  await handleBuyerInput(pvFields.pv_totp_secret, user.id, user, 23);
  expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining("Sesi input kedaluwarsa") }));
});

it("keeps the single-path payq1 tag identical to its creator for a max_qty variant (no tag_changed regression)", async () => {
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(2,'Plain fixture','plain-fixture',10000,5,1,1);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,max_qty) VALUES(2,2,'PLAIN-1','Plain variant',10000,5,1,5);`);
  // Creator: handlers/callback.ts qty approval hashes product/variant/qty/price only.
  const tag = await checkoutApprovalTag([{ productId: 2, variantId: 2, qty: 1, price: 10000 }]);
  await expect(resolveCurrentPayq1Lines("800", payq1({ kind: "single", productId: 2, variantId: 2, qty: 1 }, 10000, tag))).resolves.toMatchObject({ ok: true });
});

it("creates a web Pixel order end-to-end through POST /api/orders with the fingerprint-only token (Sol re-review #1)", async () => {
  const { POST: quote } = await import("@/app/api/checkout/quote/route");
  const { POST: order } = await import("@/app/api/orders/route");
  const quoted = await quote(request("/api/checkout/quote", { items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }] }));
  expect(quoted.status).toBe(200);
  const { quoteToken } = await quoted.json() as { quoteToken: string };
  // Re-sign the same signed items with the QRIS rail (the fixture quote has no active QRIS provider).
  const signedItems = (JSON.parse(Buffer.from(quoteToken.split(".")[1], "base64url").toString("utf8")) as { items: Parameters<typeof createCheckoutQuoteToken>[0]["items"] }).items;
  expect(JSON.stringify(signedItems)).not.toContain(pvFields.pv_password);
  const { token } = await createCheckoutQuoteToken({ items: signedItems, subtotal: item.price, payment_methods: [{ id: "qris", account_number: "-" }] });
  const response = await order(request("/api/orders", {
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
    quote_token: token, payment_method: "qris", customer_wa: "081234567890", customer_email: "buyer@example.test",
  }));
  const text = await response.text();
  for (const secret of [pvFields.pv_password, pvFields.pv_totp_secret]) expect(text).not.toContain(secret);
  const row = fx.sql.prepare("SELECT code,items FROM orders").get() as { code: string; items: string } | undefined;
  expect(row, `order not created (HTTP ${response.status})`).toBeTruthy();
  for (const secret of Object.values(pvFields)) expect(row!.items).not.toContain(secret);
  const sealed = fx.sql.prepare("SELECT input_ciphertext,input_iv FROM pixelverif_buyer_inputs WHERE order_code=?").get(row!.code) as { input_ciphertext: string; input_iv: string };
  await expect(decryptSecret(sealed.input_ciphertext, sealed.input_iv)).resolves.toBe(JSON.stringify(pvFields));
});

it("marks Pixel variants on the product detail and public catalog payload so the credential form renders (Sol re-review #2)", async () => {
  const { getProductDetail } = await import("@/lib/catalog");
  expect((await getProductDetail("pixel-fixture"))?.variants[0]).toMatchObject({ pixelverif_input: true });
  const { GET } = await import("@/app/api/catalog/route");
  const body = await (await GET(new Request("https://axvara.test/api/catalog?slug=pixel-fixture"))).json() as { product: { variants: Record<string, unknown>[] } };
  expect(body.product.variants[0].pixelverif_input).toBe(true);
  // Server-only flow identity never reaches the public payload.
  expect(body.product.variants[0]).not.toHaveProperty("pixelverif_flow_type");
});

it("warns the buyer to delete a secret message manually when Telegram deletion is not confirmed (Sol re-review #3)", async () => {
  fx.sql.exec("UPDATE products SET telegram_enabled=1 WHERE id=1");
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  await handleBuyerInput(pvFields.pv_email, user.id, user, 31);
  vi.mocked(deleteMessage).mockResolvedValue({ ok: false, description: "Too Many Requests" } as never);
  await handleBuyerInput(pvFields.pv_password, user.id, user, 32);
  expect(vi.mocked(deleteMessage).mock.calls.filter(([, id]) => id === 32)).toHaveLength(2);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("hapus pesan tersebut secara manual") }));
  vi.mocked(deleteMessage).mockResolvedValue({ ok: true } as never);
});

it("rejects a Gmail blacklisted by ACTIVATION_ITEM_NOT_AVAILABLE at quote, order intake and Telegram (README)", async () => {
  const { recordPixelverifEmailBlock, isPixelverifEmailBlocked, PIXELVERIF_BLOCKED_EMAIL_MESSAGE } = await import("@/lib/pixelverif/blocklist");
  const { createDatabaseAccess } = await import("@/lib/db-access");
  const { POST: quote } = await import("@/app/api/checkout/quote/route");
  const { validateCheckoutInput } = await import("@/lib/orders/checkout/validate");
  // Token issued before the block lands: order intake must still refuse.
  const quoted = await quote(request("/api/checkout/quote", { items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }] }));
  const { quoteToken } = await quoted.json() as { quoteToken: string };

  await recordPixelverifEmailBlock(createDatabaseAccess(fx.db), pvFields.pv_email, 3, "ACTIVATION_ITEM_NOT_AVAILABLE", "AXV-OLD");
  const stored = fx.sql.prepare("SELECT * FROM pixelverif_blocked_emails").get() as Record<string, unknown>;
  expect(JSON.stringify(stored)).not.toContain(pvFields.pv_email);
  // Gmail ignores dots and +tags: the same account cannot slip through.
  await expect(isPixelverifEmailBlocked("Buyer.Fix.ture+x@gmail.com", 3)).resolves.toBe(true);
  await expect(isPixelverifEmailBlocked("other.buyer@gmail.com", 3)).resolves.toBe(false);
  await expect(isPixelverifEmailBlocked(pvFields.pv_email, 12)).resolves.toBe(false);

  const blockedQuote = await quote(request("/api/checkout/quote", { items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }] }));
  expect(blockedQuote.status).toBe(409);
  const blockedBody = await blockedQuote.json() as { issues: { message: string }[]; quoteToken?: string };
  expect(blockedBody.quoteToken).toBeUndefined();
  expect(blockedBody.issues[0].message).toBe(PIXELVERIF_BLOCKED_EMAIL_MESSAGE);

  const intake = await validateCheckoutInput({
    customer_wa: "081234567890", customer_email: "buyer@example.test", payment_method: "qris", quote_token: quoteToken,
    items: [{ product_id: 1, variant_id: 1, qty: 1, buyer_fields: pvFields }],
  });
  expect(intake.kind).toBe("responded");
  if (intake.kind === "responded") {
    expect(intake.response.status).toBe(409);
    await expect(intake.response.json()).resolves.toEqual({ error: PIXELVERIF_BLOCKED_EMAIL_MESSAGE });
  }

  fx.sql.exec("UPDATE products SET telegram_enabled=1 WHERE id=1");
  await handleCartAdd(user.id, 0, 1, 1, 1, user);
  await handleBuyerInput(pvFields.pv_email, user.id, user, 31);
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining(PIXELVERIF_BLOCKED_EMAIL_MESSAGE) }));
  const pending = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='800'").get() as Record<string, unknown>;
  expect(pending.pending_action).toBe("pvinput:1:1:email");
});
