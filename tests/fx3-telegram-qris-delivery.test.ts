// FX-3 — Telegram QRIS delivery regressions (LOCAL ONLY, no provider calls).
// AU-E2-2: every pending QRIS photo send takes ONE atomic pre-send claim, so a
//          cron retry and the Refresh callback cannot both send it.
// AU-E2-9: the `pm:` QRIS handoff keeps the frozen payq1 anchor until the
//          legacy checkout returns; a transient D1 failure stays resumable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

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

const qris = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: qris.create,
}));
vi.mock("@/lib/fulfillment/deliver", () => ({ createFulfillmentJob: vi.fn(async () => null) }));

const buyer = { id: 888002, first_name: "Buyer" };
let fx: ReturnType<typeof createD1Fixture>;

function seed() {
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,require_email)
    VALUES(1,'Produk X','produk-x',10000,100,1,1,0)`);
  fx.sql.exec(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers)
    VALUES(11,1,'SKU-11','Paket',10000,-1,1,'manual',1,0,'[]')`);
  fx.sql.exec(`INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email)
    VALUES('888002','888002','Buyer','buyer@example.com')`);
  fx.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)");
}

function seedPendingQrisOrder(code: string) {
  fx.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,variant_id,locale,created_at,updated_at)
    VALUES(?,'Buyer','6280',?,10000,'qris','pending','pending','telegram','888002','888002',11,'id',
      datetime('now','-6 minutes'),datetime('now','-5 minutes'))`)
    .run(code, JSON.stringify([{ product_id: 1, variant_id: 11, name: "Produk X", price: 10000, qty: 1 }]));
  fx.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at)
    VALUES(?,'dana','inhouse',?,'fixture',10000,10000,'pending','https://example.com/qr.png',?)`)
    .run(code, code, new Date(Date.now() + 600_000).toISOString());
}

beforeEach(() => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.answer.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "dummy");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fx3-fixture");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  fx = createD1Fixture();
  seed();
  qris.create.mockImplementation(async (code: string, amount: number) => {
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at)
      VALUES(?,'gopay','inhouse',?,'fixture',?,?,'pending','https://example.com/qr.png',?)`)
      .run(code, code, amount, amount, new Date(Date.now() + 900_000).toISOString());
    return {
      orderCode: code, qrisUrl: "https://example.com/qr.png", payableAmount: amount,
      qrisPayload: "fx", isExisting: false, requestedAmount: amount, uniqueCode: 0,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network disabled in fixture"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AU-E2-2 QRIS photo pre-send claim", () => {
  it("cron retry and Refresh send the pending photo exactly once", async () => {
    const code = "AXV-20261118-RACE0001";
    seedPendingQrisOrder(code);
    const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
    const { handleOrderRefresh } = await import("@/lib/telegram/handlers/orders");

    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enteredP = new Promise<void>((resolve) => { entered = resolve; });
    api.photo.mockImplementation(async () => {
      calls++;
      entered();
      await gate;
      return { ok: true, result: { message_id: 1 } };
    });

    // Hold the cron retry's send so Refresh reads the SAME unsent marker.
    const retry = retryTelegramInvoiceDelivery(code);
    await enteredP;
    const refresh = handleOrderRefresh(buyer.id, 5, code);
    release();
    await Promise.all([retry, refresh]);

    expect(calls).toBe(1);
    expect(fx.sql.prepare("SELECT telegram_invoice_sent_at FROM orders WHERE code=?").get(code)?.telegram_invoice_sent_at)
      .not.toBeNull();
    expect(Number(fx.sql.prepare("SELECT telegram_invoice_attempts FROM orders WHERE code=?").get(code)?.telegram_invoice_attempts))
      .toBe(1);
  });
});

describe("AU-E2-9 pm: QRIS handoff keeps the retry anchor", () => {
  it("transient failure after the handoff stays resumable and redelivery yields one order + invoice", async () => {
    const { showPaymentMethodOffer } = await import("@/lib/telegram/handlers/payment-methods");
    const { handleCallback } = await import("@/lib/telegram/handlers/callback");
    const { checkoutApprovalTag } = await import("@/lib/telegram/checkout-approval");
    const { parsePayq1State } = await import("@/lib/telegram/payment-quote");
    const pendingAction = () =>
      String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id))?.pending_action ?? "");

    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 11, qty: 1, price: 10000 }]);
    await showPaymentMethodOffer(buyer.id, 5, buyer, {
      mode: "single", productId: 1, variantId: 11, qty: 1, tag, productName: "Produk X",
      subtotal: 10000, identity: { kind: "single", productId: 1, variantId: 11, qty: 1 },
      contactEmail: "buyer@example.com",
    });
    const raw = pendingAction();
    expect(raw.startsWith("payq1:")).toBe(true);
    const state = parsePayq1State(raw)!;
    const qrisIndex = state.methods.findIndex((method) => method.id === "qris");
    expect(qrisIndex).toBeGreaterThanOrEqual(0);

    // Transient D1 failure on the FIRST read inside the legacy checkout.
    let injected = false;
    fx.control.fail = (sql) => {
      if (!injected && sql.includes("telegram_chat_id=? AND status='pending'")) {
        injected = true;
        return true;
      }
      return false;
    };
    await expect(handleCallback(`pm:${state.nonce}:${qrisIndex}`, buyer.id, 5, buyer, "cb-fx3-1")).rejects.toThrow();
    expect(injected).toBe(true);
    // The anchor survives: redelivery is NOT treated as "session expired".
    expect(pendingAction()).toBe(raw);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);

    // Redelivery of the identical pm: callback resumes and finishes once.
    fx.control.fail = null;
    await handleCallback(`pm:${state.nonce}:${qrisIndex}`, buyer.id, 5, buyer, "cb-fx3-1");
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(1);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM payment_transactions").get()?.n).toBe(1);
    expect(api.photo).toHaveBeenCalledTimes(1);
    expect(pendingAction()).toBe("");
  });
});
