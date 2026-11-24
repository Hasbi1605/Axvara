import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import {
  assertSameBuyerCode,
  buyerFieldLabel,
  buyerSnapshotMatches,
  resolveBuyerFieldKey,
  splitBuyerFieldKeyColumns,
  validateBuyerFields,
  withoutPrivateBuyerData,
} from "@/lib/buyer-fields";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { createOrderWithStock } from "@/lib/db/orders-create";
import { createChannelOrderAtomic, createPendingChannelOrder } from "@/lib/commerce";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { createDatabaseAccess } from "@/lib/db-access";

const auth = vi.hoisted(() => ({ admin: true }));
const telegram = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: telegram.send, safeEditOrSend: telegram.edit, getMe: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
}));
vi.mock("@/lib/payments/method-options", () => ({
  buildMethodCatalog: vi.fn(async () => [{ id: "qris", account_number: "-", kind: "qris", available: true, label: "QRIS" }]),
  buildMethodOptions: vi.fn(async () => [{ id: "qris", account_number: "-", kind: "qris", available: true, label: "QRIS" }]),
}));

let fx: ReturnType<typeof createD1Fixture>;
const req = (url: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const inviteConfig = { buyer_field_key: "invite_email" as const, max_qty: null };
const inviteFields = { invite_email: "buyer.invite@gmail.com" };

beforeEach(() => {
  vi.clearAllMocks();
  telegram.send.mockResolvedValue({ ok: true, result: { message_id: 101 } });
  telegram.edit.mockResolvedValue({ ok: true, result: { message_id: 102 } });
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-bot-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100999888777");
  fx = createD1Fixture();
  clearRateLimitBucketsForTest();
  auth.admin = true;
  fx.sql.exec(`
    INSERT INTO products(id, name, slug, price, stock, is_active, telegram_enabled)
    VALUES (60, 'Google AI Pro', 'google-ai-pro-antigravity', 18000, 10, 1, 1);
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, is_active, fulfillment_mode, buyer_field_key, custom_buyer_field, max_qty)
    VALUES
      (101, 60, 'GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M', 'Google AI Pro Invite - 12 Bulan', 18000, 10, 1, 'manual', NULL, 'invite_email', NULL),
      (102, 60, 'GOOGLE-AI-PRO-HEAD-1M', 'Google AI Pro Head - 1 Bulan', 45000, 5, 1, 'manual', NULL, NULL, NULL);
  `);
});

afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
});

const quote = async (items: unknown[]) => (await import("@/app/api/checkout/quote/route")).POST(req("/api/checkout/quote", { items }));
const inviteItem = (qty = 1, email = "buyer.invite@gmail.com") => ({
  product_id: 60,
  variant_id: 101,
  qty,
  buyer_fields: { invite_email: email },
});
const atomicInviteItem = (qty = 1, email = "buyer.invite@gmail.com") => ({
  product_id: 60,
  variant_id: 101,
  name: "Google AI Pro — Google AI Pro Invite - 12 Bulan",
  price: 18000,
  qty,
  buyer_field_key: "invite_email" as const,
  max_qty: null,
  buyer_fields: { invite_email: email },
});
const createAtomicInviteOrder = (
  items = [atomicInviteItem()],
  code = "AXV-20261124-INVITE01",
  quoteId = "invite-quote-1",
) =>
  createOrderWithStock({
    code,
    quoteId,
    customerName: "Pembeli Invite",
    customerWa: "6281234567890",
    customerEmail: "kontak@example.test",
    items,
    subtotal: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    paymentMethod: "qris",
    paymentAccount: "-",
    proofUrl: null,
  });

describe("invite_email buyer field — validation & helpers", () => {
  it("normalizes, trims, and lowercases valid invite_email and resolves unified column split", () => {
    expect(validateBuyerFields(inviteConfig, { invite_email: "  Buyer.Invite+Test@Gmail.COM  " }, 1)).toEqual({
      invite_email: "buyer.invite+test@gmail.com",
    });
    expect(validateBuyerFields({ custom_buyer_field: "invite_email" }, { invite_email: "user@domain.co.id" }, 2)).toEqual({
      invite_email: "user@domain.co.id",
    });
    expect(resolveBuyerFieldKey({ buyer_field_key: null, custom_buyer_field: "invite_email" })).toBe("invite_email");
    expect(resolveBuyerFieldKey({ buyer_field_key: "muse_invite_code", custom_buyer_field: null })).toBe("muse_invite_code");
    expect(splitBuyerFieldKeyColumns("invite_email")).toEqual({ buyer_field_key: null, custom_buyer_field: "invite_email", custom_buyer_fields_json: null });
    expect(splitBuyerFieldKeyColumns("muse_invite_code")).toEqual({ buyer_field_key: "muse_invite_code", custom_buyer_field: null, custom_buyer_fields_json: null });
    expect(splitBuyerFieldKeyColumns(null)).toEqual({ buyer_field_key: null, custom_buyer_field: null, custom_buyer_fields_json: null });
    expect(buyerFieldLabel("invite_email")).toBe("Email yang ingin di-invite");
  });

  it.each(["", "not-an-email", "a@b", "user@domain", "user name@gmail.com", "@gmail.com", "user@.com"])(
    "rejects invalid invite_email %s",
    (bad) => {
      expect(() => validateBuyerFields(inviteConfig, { invite_email: bad }, 1)).toThrow();
    },
  );

  it("rejects missing invite_email, foreign buyer fields, and conflicting invite emails", () => {
    expect(() => validateBuyerFields(inviteConfig, {}, 1)).toThrow();
    expect(() => validateBuyerFields(inviteConfig, { muse_invite_code: "Ab12cD" }, 1)).toThrow();
    expect(() => validateBuyerFields(inviteConfig, { invite_email: "a@b.com", muse_invite_code: "Ab12cD" }, 1)).toThrow();
    expect(() => validateBuyerFields({}, inviteFields, 1)).toThrow();
    expect(
      buyerSnapshotMatches(
        { ...inviteConfig, buyer_fields: inviteFields },
        { ...inviteConfig, buyer_fields: { invite_email: "other@gmail.com" } },
      ),
    ).toBe(false);
    expect(() => assertSameBuyerCode([inviteItem(1, "A@gmail.com"), inviteItem(1, "a@gmail.com")])).not.toThrow();
    expect(() => assertSameBuyerCode([inviteItem(1, "a@gmail.com"), inviteItem(1, "b@gmail.com")])).toThrow();
  });

  it("catalog exposes unified buyer_field_key while keeping delivery manual/queued", async () => {
    const { getProductDetail, getActiveVariant, buyerDeliveryKind } = await import("@/lib/catalog");
    const product = await getProductDetail("google-ai-pro-antigravity");
    const inviteVariant = product!.variants.find((v) => v.id === 101)!;
    const headVariant = product!.variants.find((v) => v.id === 102)!;
    expect(inviteVariant.buyer_field_key).toBe("invite_email");
    expect(inviteVariant.automatic_delivery).toBeUndefined();
    expect(buyerDeliveryKind(inviteVariant)).toBe("queued");
    expect(headVariant.buyer_field_key).toBeNull();
    expect((await getActiveVariant(101))?.buyer_field_key).toBe("invite_email");
  });
});

describe("invite_email buyer field — quote, checkout, atomic guard & stripping", () => {
  it("quotes and signs normalized lowercased invite_email, and rejects missing/invalid/conflicting email", async () => {
    const res = await quote([inviteItem(1, "  Buyer.Invite@Gmail.COM ")]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      variant_id: 101,
      price: 18000,
      qty: 1,
      queued_delivery: true,
      buyer_field_key: "invite_email",
      buyer_fields: { invite_email: "buyer.invite@gmail.com" },
    });
    const token = await verifyCheckoutQuoteToken(body.quoteToken);
    expect(token?.items[0]).toMatchObject({
      buyer_field_key: "invite_email",
      buyer_fields: { invite_email: "buyer.invite@gmail.com" },
    });

    expect((await quote([{ product_id: 60, variant_id: 101, qty: 1 }])).status).toBe(409);
    expect((await quote([inviteItem(1, "not-an-email")])).status).toBe(400);
    expect((await quote([inviteItem(1, "a@gmail.com"), inviteItem(1, "b@gmail.com")])).status).toBe(409);
  });

  it("POST /api/orders refuses invite_email substitution against signed quote", async () => {
    const quoted = await (await quote([inviteItem(1, "buyer.invite@gmail.com")])).json();
    const { POST } = await import("@/app/api/orders/route");
    const res = await POST(
      req("/api/orders", {
        customer_wa: "081234567890",
        customer_email: "kontak@example.test",
        items: [inviteItem(1, "attacker@gmail.com")],
        payment_method: "qris",
        quote_token: quoted.quoteToken,
      }),
    );
    expect(res.status).toBe(409);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 0 });
  });

  it("createOrderWithStock persists buyer_fields.invite_email, enforces config drift guard, and strips private data", async () => {
    await createAtomicInviteOrder();
    const row = fx.sql.prepare("SELECT items FROM orders WHERE code='AXV-20261124-INVITE01'").get() as { items: string };
    const stored = JSON.parse(row.items);
    expect(stored[0]).toMatchObject({
      variant_id: 101,
      buyer_field_key: "invite_email",
      buyer_fields: { invite_email: "buyer.invite@gmail.com" },
    });
    expect(withoutPrivateBuyerData(stored)[0]).not.toHaveProperty("buyer_fields");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=101").get()).toEqual({ stock: 9 });

    // Config drift before atomic reservation fails closed
    fx.sql.exec("UPDATE product_variants SET custom_buyer_field=NULL WHERE id=101");
    await expect(createAtomicInviteOrder([atomicInviteItem()], "AXV-20261124-INVITE02", "invite-quote-2")).rejects.toThrow();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 1 });
  });

  it("atomic guard in createOrderWithStock catches concurrent custom_buyer_field change during batch race", async () => {
    const origBatch = fx.db.batch;
    fx.db.batch = async (statements) => {
      fx.sql.exec("UPDATE product_variants SET custom_buyer_field=NULL WHERE id=101");
      return origBatch(statements);
    };
    await expect(createAtomicInviteOrder([atomicInviteItem()], "AXV-20261124-RACE", "invite-race")).rejects.toThrow();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 0 });
  });
});

describe("invite_email buyer field — Telegram checkout & private admin alert", () => {
  const buyer = { id: 456, first_name: "Pembeli" };
  beforeEach(() => {
    fx.sql.exec("INSERT INTO telegram_users(user_id, chat_id) VALUES('456', '456')");
  });

  it("collects invite_email privately, retries invalid input, freezes lowercase email into payq1, and binds approval tag", async () => {
    const { requestBuyerInput, handleBuyerInput } = await import("@/lib/telegram/handlers/buyer-input");
    const { parsePayq1State } = await import("@/lib/telegram/payment-quote");
    const { resolveCurrentPayq1Lines } = await import("@/lib/telegram/handlers/payment-lines");

    // Ignored in groups (chatId !== from.id)
    expect(await requestBuyerInput(-456, buyer, 60, 101, 1)).toBe(true);
    expect(telegram.send).not.toHaveBeenCalled();

    // Prompts in private DM
    expect(await requestBuyerInput(456, buyer, 60, 101, 1)).toBe(true);
    expect(String(telegram.send.mock.calls[0]?.[0]?.text ?? "")).toContain("email yang ingin di-invite");

    // Rejects bad format without clearing pending_action
    expect(await handleBuyerInput("bukan-email", 456, buyer)).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='456'").get()).toEqual({
      pending_action: "buyerinput:60:101:1",
    });

    // Accepts trimmed/lowercased email and moves to payq1 single-item offer
    expect(await handleBuyerInput("  User.TG@Gmail.COM  ", 456, buyer)).toBe(true);
    const offerRaw = String(
      (fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='456'").get() as { pending_action: string | null })
        ?.pending_action ?? "",
    );
    const offer = parsePayq1State(offerRaw);
    expect(offer?.source).toEqual({
      kind: "single",
      productId: 60,
      variantId: 101,
      qty: 1,
      inviteEmail: "user.tg@gmail.com",
    });

    const resolved = await resolveCurrentPayq1Lines("456", offer!);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.cartLines[0]).toMatchObject({
        productId: 60,
        variantId: 101,
        qty: 1,
        buyerFieldKey: "invite_email",
        buyerFields: { invite_email: "user.tg@gmail.com" },
      });
    }

    // Approval tag changes when invite_email changes
    const line = {
      productId: 60,
      variantId: 101,
      qty: 1,
      price: 18000,
      buyerFieldKey: "invite_email" as const,
      buyerFields: { invite_email: "user.tg@gmail.com" },
    };
    expect(await checkoutApprovalTag([line])).not.toBe(
      await checkoutApprovalTag([{ ...line, buyerFields: { invite_email: "other@gmail.com" } }]),
    );
  });

  it("createChannelOrderAtomic stores invite_email and createPendingChannelOrder refuses invite_email variants", async () => {
    await createChannelOrderAtomic({
      orderCode: "AXV-20261124-TGINV1",
      lines: [{ productId: 60, variantId: 101, qty: 1, fulfillmentMode: "manual", stock: 10 }],
      items: [atomicInviteItem(1, "user.tg@gmail.com")],
      variantSnapshot: "{}",
      subtotal: 18000,
      primaryVariantId: 101,
      customerName: "Pembeli",
      salesChannel: "telegram",
      telegramChatId: "456",
      telegramUserId: "456",
      paymentMethod: "qris",
      paymentAccount: "-",
      fulfillmentStatus: "manual_required",
    });
    const saved = JSON.parse(String((fx.sql.prepare("SELECT items FROM orders WHERE code='AXV-20261124-TGINV1'").get() as { items: string }).items));
    expect(saved[0]).toMatchObject({ buyer_field_key: "invite_email", buyer_fields: { invite_email: "user.tg@gmail.com" } });

    const { getActiveVariant } = await import("@/lib/catalog");
    const variant = await getActiveVariant(101);
    await expect(
      createPendingChannelOrder({
        salesChannel: "web",
        productId: 60,
        productName: "Google AI Pro",
        variantId: 101,
        variant: variant!,
        customerId: "456",
        customerName: "Pembeli",
        idempotencyKey: "wa-invite-refuse",
      }),
    ).rejects.toThrow("unsupported_buyer_input");
  });

  it("private admin Telegram paid alert includes plain escaped Email invite line without double-escaping", async () => {
    await createAtomicInviteOrder([atomicInviteItem(1, "buyer+invite@gmail.com")], "AXV-20261124-PAID01", "paid-q1");
    fx.sql.exec("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code='AXV-20261124-PAID01'");

    const { notifyWebPaidAdmin } = await import("@/lib/telegram/order-notifications");
    const ok = await notifyWebPaidAdmin("AXV-20261124-PAID01", createDatabaseAccess(fx.db));
    expect(ok).toBe(true);
    expect(telegram.send).toHaveBeenCalledOnce();
    const sentText = String(telegram.send.mock.calls[0]?.[0]?.text ?? "");
    expect(sentText).toContain("📩 Email invite: buyer+invite@gmail.com");
    expect(sentText).not.toContain("&lt;code&gt;");
  });
});

describe("invite_email buyer field — Admin APIs & migration 0165", () => {
  it("Admin orders detail returns invite_email with auth gate while list endpoint never leaks it", async () => {
    await createAtomicInviteOrder([atomicInviteItem(1, "secret.invite@gmail.com")], "AXV-20261124-AABB1122", "adm-q1");
    const { GET: detailGet } = await import("@/app/api/admin/orders/[code]/route");
    const detailReq = new NextRequest("http://localhost/api/admin/orders/AXV-20261124-AABB1122");
    const params = { params: Promise.resolve({ code: "AXV-20261124-AABB1122" }) };

    auth.admin = false;
    expect((await detailGet(detailReq, params)).status).toBe(401);

    auth.admin = true;
    const detailRes = await detailGet(detailReq, params);
    expect(detailRes.status).toBe(200);
    expect(detailRes.headers.get("cache-control")).toContain("no-store");
    expect(await detailRes.json()).toMatchObject({
      buyerInputs: [{ item_index: 0, variant_id: 101, key: "invite_email", value: "secret.invite@gmail.com" }],
    });

    const { GET: listGet } = await import("@/app/api/admin/orders/route");
    const listText = await (await listGet(new NextRequest("http://localhost/api/admin/orders"))).text();
    expect(listText).not.toContain("secret.invite@gmail.com");
  });

  it("Admin variant & product APIs store invite_email in custom_buyer_field (keeping buyer_field_key NULL) and read unified key", async () => {
    const { POST, PUT, GET } = await import("@/app/api/admin/variants/route");
    const { GET: productGet, PUT: productPut } = await import("@/app/api/products/[id]/route");

    // Create variant with invite_email
    const created = await POST(
      req("/api/admin/variants", {
        product_id: 60,
        sku: "TEST-INVITE-NEW",
        label: "Invite 6 Bulan",
        price: 12000,
        buyer_field_key: "invite_email",
      }),
    );
    expect(created.status).toBe(201);
    expect(
      fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field FROM product_variants WHERE sku='TEST-INVITE-NEW'").get(),
    ).toEqual({ buyer_field_key: null, custom_buyer_field: "invite_email" });

    // Switch variant 102 via PUT /api/admin/variants: invite_email -> muse_invite_code -> null
    expect((await PUT(req("/api/admin/variants?id=102", { buyer_field_key: "invite_email" }, "PUT"))).status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field FROM product_variants WHERE id=102").get()).toEqual({
      buyer_field_key: null,
      custom_buyer_field: "invite_email",
    });

    expect((await PUT(req("/api/admin/variants?id=102", { buyer_field_key: "muse_invite_code" }, "PUT"))).status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field FROM product_variants WHERE id=102").get()).toEqual({
      buyer_field_key: "muse_invite_code",
      custom_buyer_field: null,
    });

    expect((await PUT(req("/api/admin/variants?id=102", { buyer_field_key: null }, "PUT"))).status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field FROM product_variants WHERE id=102").get()).toEqual({
      buyer_field_key: null,
      custom_buyer_field: null,
    });

    // Reject unknown field key
    expect((await PUT(req("/api/admin/variants?id=102", { buyer_field_key: "unknown_key" }, "PUT"))).status).toBe(400);

    // PUT /api/products/[id] updates custom_buyer_field via variants array
    const putRes = await productPut(
      req(
        "/api/products/60",
        {
          variants: [
            { id: 101, sku: "GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M", label: "Google AI Pro Invite - 12 Bulan", price: 18000, stock: 10, is_active: true, buyer_field_key: "invite_email" },
            { id: 102, sku: "GOOGLE-AI-PRO-HEAD-1M", label: "Google AI Pro Head - 1 Bulan", price: 45000, stock: 5, is_active: true, buyer_field_key: "invite_email" },
          ],
        },
        "PUT",
      ),
      { params: Promise.resolve({ id: "60" }) },
    );
    expect(putRes.status).toBe(200);
    expect(fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field FROM product_variants WHERE id=102").get()).toEqual({
      buyer_field_key: null,
      custom_buyer_field: "invite_email",
    });

    // Both GET endpoints expose unified buyer_field_key
    const listVariants = (await (await GET(new NextRequest("http://localhost/api/admin/variants?product_id=60"))).json()).variants;
    const prodVariants = (await (await productGet(new NextRequest("http://localhost/api/products/60"), { params: Promise.resolve({ id: "60" }) })).json()).product.variants;
    expect(listVariants.find((v: { id: number }) => v.id === 101)?.buyer_field_key).toBe("invite_email");
    expect(prodVariants.find((v: { id: number }) => v.id === 102)?.buyer_field_key).toBe("invite_email");
  });

  it("migration 0165 enforces CHECK constraint and backfills GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M cleanly", () => {
    const sql = fs.readFileSync("drizzle/migrations/0165_variant_custom_buyer_field.sql", "utf8");
    // Drop columns to simulate pre-0165 database, then apply 0165
    fx.sql.exec("ALTER TABLE product_variants DROP COLUMN custom_buyer_fields_json");
    fx.sql.exec("ALTER TABLE product_variants DROP COLUMN custom_buyer_field");
    fx.sql.exec(sql);
    expect(
      fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field, custom_buyer_fields_json FROM product_variants WHERE sku='GOOGLE-AI-PRO-ANTIGRAVITY-INVITE-12M'").get(),
    ).toEqual({ buyer_field_key: null, custom_buyer_field: "invite_email", custom_buyer_fields_json: null });
    // Invalid snake_case key & invalid JSON rejected by DB CHECK
    expect(() => fx.sql.exec("UPDATE product_variants SET custom_buyer_field='BAD-KEY!' WHERE id=102")).toThrow(/CHECK/i);
    expect(() => fx.sql.exec("UPDATE product_variants SET custom_buyer_fields_json='{not-json' WHERE id=102")).toThrow(/CHECK/i);
  });

  it("customizable buyer fields (mode='custom'): admin CRUD, quote fingerprint (never echoes password), order create, admin detail with secret flag, and masked Telegram alert", async () => {
    const { PUT: variantPut, GET: variantGet } = await import("@/app/api/admin/variants/route");
    const customConfig = {
      title: "Data Akun untuk Aktivasi",
      note: "Dipakai sekali oleh admin untuk aktivasi.",
      fields: [
        { key: "account_email", label: "Email akun", type: "email" as const, placeholder: "nama@gmail.com", required: true },
        { key: "account_password", label: "Password akun", type: "password" as const, required: true },
        { key: "backup_note", label: "Catatan opsional", type: "textarea" as const, required: false },
      ],
    };

    // Reject mode='custom' without fields
    expect((await variantPut(req("/api/admin/variants?id=102", { buyer_field_key: "custom", custom_buyer_fields: null }, "PUT"))).status).toBe(400);

    // Persist valid custom config via Admin API
    const saved = await variantPut(req("/api/admin/variants?id=102", { buyer_field_key: "custom", custom_buyer_fields: customConfig }, "PUT"));
    expect(saved.status).toBe(200);
    const dbRow = fx.sql.prepare("SELECT buyer_field_key, custom_buyer_field, custom_buyer_fields_json FROM product_variants WHERE id=102").get() as Record<string, unknown>;
    expect(dbRow.buyer_field_key).toBeNull();
    expect(dbRow.custom_buyer_field).toBe("custom");
    expect(JSON.parse(String(dbRow.custom_buyer_fields_json))).toMatchObject({ title: "Data Akun untuk Aktivasi" });

    // Admin GET & Storefront catalog both expose parsed custom_buyer_fields
    const listed = (await (await variantGet(new NextRequest("http://localhost/api/admin/variants?product_id=60"))).json()).variants;
    expect(listed.find((v: { id: number }) => v.id === 102)?.custom_buyer_fields?.fields).toHaveLength(3);
    const { getProductDetail } = await import("@/lib/catalog");
    const detail = await getProductDetail("google-ai-pro-antigravity");
    expect(detail?.variants.find((v) => v.id === 102)?.custom_buyer_fields?.fields).toHaveLength(3);

    // Quote validates custom_values and signs ONLY custom_fingerprint (password NEVER echoed in response or JWT)
    const rawCustom = { account_email: "  Buyer.Act@Gmail.COM ", account_password: "My$ecretPass!99" };
    const qRes = await quote([{ product_id: 60, variant_id: 102, qty: 1, buyer_fields: { custom_values: rawCustom } }]);
    expect(qRes.status).toBe(200);
    const qText = await qRes.text();
    expect(qText).not.toContain("My$ecretPass!99");
    const qBody = JSON.parse(qText);
    expect(qBody.items[0].buyer_fields?.custom_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const token = await verifyCheckoutQuoteToken(qBody.quoteToken);
    expect(JSON.stringify(token)).not.toContain("My$ecretPass!99");
    expect(token?.items[0].buyer_fields?.custom_fingerprint).toBe(qBody.items[0].buyer_fields.custom_fingerprint);

    // Missing required password fails quote with 409
    expect((await quote([{ product_id: 60, variant_id: 102, qty: 1, buyer_fields: { custom_values: { account_email: "a@gmail.com" } } }])).status).toBe(409);

    // POST /api/orders refuses tampered password against signed custom_fingerprint
    const { POST: ordersPost } = await import("@/app/api/orders/route");
    const tampered = await ordersPost(req("/api/orders", {
      customer_wa: "081234567890",
      customer_email: "kontak@example.test",
      items: [{ product_id: 60, variant_id: 102, qty: 1, buyer_fields: { custom_values: { account_email: "buyer.act@gmail.com", account_password: "WRONG" } } }],
      payment_method: "qris",
      quote_token: qBody.quoteToken,
    }));
    expect(tampered.status).toBe(409);

    // Create atomic order with custom_values + meta, check admin detail & masked Telegram admin alert
    await createOrderWithStock({
      code: "AXV-20261124-CUST0001",
      quoteId: "custom-q1",
      customerName: "Pembeli Custom",
      customerWa: "6281234567890",
      customerEmail: "kontak@example.test",
      items: [{
        product_id: 60,
        variant_id: 102,
        name: "Google AI Pro — Google AI Pro Head - 1 Bulan",
        price: 45000,
        qty: 1,
        buyer_field_key: "custom",
        max_qty: null,
        buyer_fields: { custom_values: { account_email: "buyer.act@gmail.com", account_password: "My$ecretPass!99" } },
        custom_buyer_fields_meta: [
          { key: "account_email", label: "Email akun", type: "email" },
          { key: "account_password", label: "Password akun", type: "password" },
        ],
      }],
      subtotal: 45000,
      paymentMethod: "qris",
      paymentAccount: "-",
      proofUrl: null,
    });

    // Admin detail exposes labeled entries with secret=true on password; list never leaks
    const { GET: orderDetailGet } = await import("@/app/api/admin/orders/[code]/route");
    const ordRes = await orderDetailGet(
      new NextRequest("http://localhost/api/admin/orders/AXV-20261124-CUST0001"),
      { params: Promise.resolve({ code: "AXV-20261124-CUST0001" }) },
    );
    expect(ordRes.status).toBe(200);
    expect(await ordRes.json()).toEqual({
      buyerInputs: [
        { item_index: 0, variant_id: 102, key: "custom:account_email", label: "Email akun", value: "buyer.act@gmail.com" },
        { item_index: 0, variant_id: 102, key: "custom:account_password", label: "Password akun", secret: true, value: "My$ecretPass!99" },
      ],
    });

    // Telegram admin alert shows non-secret email and MASKS password
    fx.sql.exec("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code='AXV-20261124-CUST0001'");
    const { notifyWebPaidAdmin } = await import("@/lib/telegram/order-notifications");
    expect(await notifyWebPaidAdmin("AXV-20261124-CUST0001", createDatabaseAccess(fx.db))).toBe(true);
    const tgText = String(telegram.send.mock.calls.at(-1)?.[0]?.text ?? "");
    expect(tgText).toContain("📝 Email akun: buyer.act@gmail.com");
    expect(tgText).toContain("🔒 Password akun: (lihat di Panel Admin → Detail Pesanan)");
    expect(tgText).not.toContain("My$ecretPass!99");
  });
});
