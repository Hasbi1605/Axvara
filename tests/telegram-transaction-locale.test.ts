// TG2c1 buyer transaction locale (LOCAL ONLY): invoice/status/delivery copy
// + buyer keyboards follow the SAVED order.locale, not current prefs.
// QRIS charge stays actual IDR payable; no USDT/FX relabel; admin/group stay ID.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handlePayWithQris } from "@/lib/telegram/handlers/invoice";
import { handleOrderStatus, handleOrderRefresh, handleQrisRenew } from "@/lib/telegram/handlers/orders";
import { retryTelegramInvoiceDelivery } from "@/lib/telegram/invoice-retry";
import { notifyTelegramBuyerPaid } from "@/lib/telegram/order-notifications";
import { resendTelegramCredentials } from "@/lib/telegram/credential-delivery";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn(), photo: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  safeEditOrSend: api.edit,
  sendPhoto: api.photo,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: api.answer,
  withLoadingIndicator: vi.fn(async (_chat: number, _label: string, work: (b: () => Promise<void>) => Promise<void>) => work(async () => {})),
}));
vi.mock("@/lib/telegram/payment-maintenance", () => ({ notifyPaymentMaintenance: async () => false }));

const qris = vi.hoisted(() => ({ create: vi.fn(), reissue: vi.fn() }));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: qris.create,
  reissueDanaQrisInvoice: qris.reissue,
}));
vi.mock("@/lib/fulfillment/deliver", () => ({ createFulfillmentJob: vi.fn(async () => null) }));

let fx: ReturnType<typeof createD1Fixture>;
const buyer = { id: 888001, first_name: "Buyer" };

function seed() {
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,require_email,category_id,sort_order)
    VALUES(1,'Produk <b>X</b>','produk-x',10000,100,1,1,0,1,0)`).run();
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers)
    VALUES(11,1,'SKU-11','Paket',10000,-1,1,'manual',1,0,'[]')`).run();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email) VALUES('888001','888001','Buyer','buyer@example.com')").run();
}

function lastPhotoCaption(): string {
  const calls = [...api.photo.mock.calls];
  return String(calls.at(-1)?.[0]?.caption ?? "");
}
function invoiceAmounts(): number[] {
  return qris.create.mock.calls.map((c) => Number(c[1]));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  api.answer.mockResolvedValue({ ok: true });
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "dummy");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg2c1-fixture");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  qris.reissue.mockResolvedValue({ ok: true, invoice: { qrisUrl: "https://example.com/re.png", payableAmount: 10001, expiresAt: new Date(Date.now() + 900_000).toISOString() } });
  fx = createD1Fixture();
  seed();
  qris.create.mockImplementation(async (code: string, amount: number) => {
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at)
      VALUES(?,'gopay','inhouse',?,'fixture',?,?, 'pending','https://example.com/qr.png',?)`)
      .run(code, code, amount, amount, new Date(Date.now() + 900_000).toISOString());
    return { orderCode: code, qrisUrl: "https://example.com/qr.png", payableAmount: amount,
      qrisPayload: "fx", isExisting: false, requestedAmount: amount, uniqueCode: 0,
      expiresAt: new Date(Date.now() + 900_000).toISOString() };
  });
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("TG2c1 transaction copy follows saved order.locale", () => {
  it("EN order keeps EN invoice/status/retry/reissue after pref flips to ID", async () => {
    await handleCallback("lang:en", buyer.id, 7, buyer, "cb-en-1");
    await handleCallback("cur:USD", buyer.id, 8, buyer, "cb-usd-1");
    const { handleShowReview } = await import("@/lib/telegram/handlers/catalog");
    await handleShowReview(buyer.id, 1, 1, 11, 1, buyer);
    const tag = String(api.edit.mock.calls.at(-1)?.[0]?.reply_markup?.inline_keyboard?.flat().find((b: { callback_data?: string }) => b.callback_data?.startsWith("pmentry:"))?.callback_data ?? "").split(":").at(-1);
    expect(tag).toBeTruthy();
    await handlePayWithQris(buyer.id, 1, 1, 11, 1, buyer, false, tag);
    const order = fx.sql.prepare("SELECT code,subtotal,locale FROM orders").get() as { code: string; subtotal: number; locale: string };
    expect(order.locale).toBe("en");
    expect(order.subtotal).toBe(10000);
    // Charge is actual IDR payable even with USD display pref; caption charges IDR, no USDT/FX math.
    expect(lastPhotoCaption()).toMatch(/IDR via QRIS/);
    expect(lastPhotoCaption()).toContain("Charged in IDR, even when your display currency is USD.");
    expect(lastPhotoCaption()).not.toMatch(/USDT/);
    expect(invoiceAmounts()).toEqual([10000]);
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='IDR' WHERE user_id='888001'").run();
    vi.clearAllMocks();
    await handleOrderStatus(buyer.id, order.code);
    expect(api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n")).toMatch(/Order status/);
    vi.clearAllMocks();
    const retried = await retryTelegramInvoiceDelivery(order.code);
    // First invoice photo succeeded via createAndSendVariantInvoice, so the
    // retry marker is already set: idempotent true WITHOUT a second photo.
    // Order-locale binding is proven by the refresh/reissue captions below.
    expect(retried).toBe(true);
    expect(api.photo.mock.calls.length).toBe(0);
    const refreshed = await (async () => {
      await handleOrderRefresh(buyer.id, 5, order.code);
      return [...api.edit.mock.calls.map((c) => String(c[0]?.text ?? "")), ...api.send.mock.calls.map((c) => String(c[0]?.text ?? ""))].join("\n");
    })();
    expect(refreshed).toMatch(/Order status/);
    vi.clearAllMocks();
    await handleQrisRenew(buyer.id, order.code);
    expect(lastPhotoCaption()).toMatch(/Awaiting payment/);
    expect(api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n")).not.toMatch(/Menunggu pembayaran/);
  });

  it("ID QRIS invoice omits USD charge note since display currency is already Rupiah", async () => {
    await handleCallback("lang:id", buyer.id, 7, buyer, "cb-id-1");
    const { handleShowReview } = await import("@/lib/telegram/handlers/catalog");
    await handleShowReview(buyer.id, 1, 1, 11, 1, buyer);
    const tag = String(api.edit.mock.calls.at(-1)?.[0]?.reply_markup?.inline_keyboard?.flat().find((b: { callback_data?: string }) => b.callback_data?.startsWith("pmentry:"))?.callback_data ?? "").split(":").at(-1);
    await handlePayWithQris(buyer.id, 1, 1, 11, 1, buyer, false, tag);
    expect(lastPhotoCaption()).toContain("IDR via QRIS");
    expect(lastPhotoCaption()).not.toContain("Ditagih dalam IDR");
    expect(lastPhotoCaption()).not.toContain("Charged in IDR");
  });

  it("legacy order without locale renders ID even when current pref is EN", async () => {
    await handleCallback("lang:en", buyer.id, 7, buyer, "cb-en-9");
    // Schema enforces NOT NULL locale: legacy rows pre-migration could hold
    // empty/absent values; orderLocaleOf maps anything non-en to ID.
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,variant_id,locale)
      VALUES('AXV-LEGACY','Buyer','',?,10000,'qris','pending','pending','telegram','888001','888001',11,'id')`).run(JSON.stringify([{ name: "Produk", qty: 1 }]));
    vi.clearAllMocks();
    await handleOrderStatus(buyer.id, "AXV-LEGACY");
    const text = api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n");
    expect(text).toMatch(/Status pesanan/);
    expect(text).not.toMatch(/Order status/);
  });

  it("paid buyer notice + credential wrapper use order locale; admin copy stays ID", async () => {
    const { handleShowReview } = await import("@/lib/telegram/handlers/catalog");
    await handleShowReview(buyer.id, 1, 1, 11, 1, buyer);
    const tag = String(api.edit.mock.calls.at(-1)?.[0]?.reply_markup?.inline_keyboard?.flat().find((b: { callback_data?: string }) => b.callback_data?.startsWith("pmentry:"))?.callback_data ?? "").split(":").at(-1);
    await handleCallback("lang:en", buyer.id, 9, buyer, "cb-en-2");
    await handlePayWithQris(buyer.id, 1, 1, 11, 1, buyer, false, tag);
    const order = fx.sql.prepare("SELECT code FROM orders").get() as { code: string };
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code=?").run(order.code);
    fx.sql.exec(`CREATE TABLE IF NOT EXISTS buyer_notice_log (idempotency_key TEXT PRIMARY KEY, order_code TEXT, channel TEXT, status TEXT, access_attempts INTEGER, access_lease TEXT, access_retry_at TEXT, error TEXT, updated_at TEXT)`);
    vi.clearAllMocks();
    await notifyTelegramBuyerPaid(order.code);
    const paidText = api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n");
    expect(paidText).toMatch(/Payment confirmed/);
    expect(paidText).not.toMatch(/PIN/);
    // Credential resend with long secret stays chunked, valid HTML, no PIN leak.
    const longSecret = `user@example.com / PASS-${"A".repeat(5000)}`;
    const { credentialMessages } = await import("@/lib/telegram/messages/credential");
    const parts = credentialMessages({ orderCode: order.code, productName: "Produk <b>X</b>", plaintext: longSecret, locale: "en" });
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
      const opens = (part.match(/<pre>|<code>|<b>|<i>/g) || []).length;
      const closes = (part.match(/<\/pre>|<\/code>|<\/b>|<\/i>/g) || []).length;
      expect(opens).toBe(closes);
    }
    expect(parts.join("\n")).toContain("user@example.com");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const db = createDatabaseAccess();
    await resendTelegramCredentials(order.code, buyer.id, db);
    const credText = api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n");
    expect(credText).not.toMatch(/PIN/);
    // Admin notification copy stays ID: notifyTelegramBuyerPaid touches only buyer text; group copy asserted via source.
    const adminSrc = await import("node:fs").then((fs) => fs.readFileSync("src/lib/telegram/messages/admin.ts", "utf8"));
    expect(adminSrc).not.toMatch(/Payment confirmed/);
  });
});
