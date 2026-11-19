import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { checkoutEmailFingerprint } from "@/lib/telegram/checkout-email";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleOrderStatus } from "@/lib/telegram/handlers/orders";
import { resendTelegramCredentials } from "@/lib/telegram/credential-delivery";
import { MENU_LABEL_HELP, MENU_LABEL_EN } from "@/lib/telegram/keyboards";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  sendChatAction: vi.fn(),
  safeEditOrSend: vi.fn(),
  showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
}));
vi.mock("@/lib/payments/klikqris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/klikqris")>()),
  createKlikQrisPayment: vi.fn(async ({ orderCode, amount }: { orderCode: string; amount: number }) => ({
    providerOrderId: orderCode,
    merchantId: "123",
    payableAmount: amount + 50,
    qrisContent: "000201010212TEST",
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  })),
}));
vi.mock("@/lib/telegram/invoice-media", () => ({
  deliverTelegramQrisPhoto: vi.fn(async () => true),
}));

const buyer: { id: number; first_name: string; username?: string } = { id: 12345, first_name: "Buyer", username: "buyer_axv" };
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

type MarkupButton = { text: string; callback_data?: string; url?: string };
type SentMsg = { text?: string; reply_markup?: { inline_keyboard?: MarkupButton[][] } };
const chronological: SentMsg[] = [];

const allMessages = (): SentMsg[] => [...chronological];
const lastMsg = (): SentMsg => chronological.at(-1) ?? {};
const callbacksOf = (msg: SentMsg): string[] =>
  msg.reply_markup?.inline_keyboard?.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : [])) ?? [];
const urlsOf = (msg: SentMsg): string[] =>
  msg.reply_markup?.inline_keyboard?.flat().flatMap((b) => (b.url ? [b.url] : [])) ?? [];

const click = (data: string, chatId = buyer.id, from = buyer) =>
  handleCallback(data, chatId, 77, from, `cb-${Math.random()}`);

const resetLog = () => {
  vi.clearAllMocks();
  chronological.length = 0;
};

beforeEach(async () => {
  resetLog();
  stubFulfillmentKey();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_JWT_SECRET", "tg-p0-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-p0-fixture");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected network fetch in tg-p0 fixture");
  }));
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.exec("UPDATE products SET name='Canva Pro', require_email=0, telegram_enabled=1, is_active=1 WHERE id=1");
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,require_email) VALUES(2,'Netflix','netflix',25000,50,1,1,0)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(2,2,'SKU-2','Sharing 1 Bulan',25000,50,'manual',1)").run();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,?)").run(String(buyer.id), String(buyer.id), "id");
  fx.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)");
  send.mockImplementation(async (params) => {
    chronological.push(params as SentMsg);
    return { ok: true, result: { message_id: 91 } } as never;
  });
  edit.mockImplementation(async (params) => {
    chronological.push(params as SentMsg);
    return { ok: true, params } as never;
  });
});

afterEach(() => {
  fx.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("P0-1: Single-product pmentry routing & backward compatibility", () => {
  it("qty screen emits parameterized pmentry within 64B and opens single offer with empty cart", async () => {
    await click("q:1:1:3");
    const qtyMsg = lastMsg();
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 3, price: 10000 }]);
    const expectedCb = `pmentry:1:1:3:${tag}`;
    expect(Buffer.byteLength(expectedCb, "utf8")).toBeLessThanOrEqual(64);
    expect(callbacksOf(qtyMsg)).toContain(expectedCb);
    expect(callbacksOf(qtyMsg)).not.toContain("pmentry");

    await click(expectedCb);
    const offerMsg = lastMsg();
    expect(String(offerMsg.text)).toContain("Pilih metode pembayaran");
    expect(callbacksOf(offerMsg)).toContain("q:1:1:3");
    expect(callbacksOf(offerMsg)).toContain("home");

    const row = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    const parsed = parsePayq1State(row.pending_action);
    expect(parsed?.source).toEqual({ kind: "single", productId: 1, variantId: 1, qty: 3 });
    expect(parsed?.idrSubtotal).toBe(30000);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM telegram_carts WHERE user_id=?").get(String(buyer.id))?.n).toBe(0);
  });

  it("single pmentry ignores unrelated items in cart and QRIS checkout leaves cart untouched", async () => {
    fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 2, 2, 5);
    await click("q:1:1:2");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 10000 }]);
    await click(`pmentry:1:1:2:${tag}`);

    const userBefore = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    const state = parsePayq1State(userBefore.pending_action)!;
    expect(state.source).toEqual({ kind: "single", productId: 1, variantId: 1, qty: 2 });
    expect(state.idrSubtotal).toBe(20000);

    // Selecting QRIS from single offer goes straight through dispatch and preserves cart rows.
    await click(`pm:${state.nonce}:0`);
    const cartRow = fx.sql.prepare("SELECT product_id, variant_id, qty FROM telegram_carts WHERE user_id=?").get(String(buyer.id));
    expect(cartRow).toEqual({ product_id: 2, variant_id: 2, qty: 5 });

    const created = fx.sql.prepare("SELECT subtotal, items FROM orders ORDER BY id DESC LIMIT 1").get() as { subtotal: number; items: string };
    expect(created.subtotal).toBe(20000);
    expect(created.items).toContain("Canva Pro");
    expect(created.items).not.toContain("Netflix");
  });

  it("enforces approvalTag, stock, min_qty, and maintenance guards on single pmentry", async () => {
    // Approval tag mismatch refreshes qty screen cleanly without opening offer.
    await click("q:1:1:2");
    resetLog();
    await click("pmentry:1:1:2:deadbeef");
    expect(String(lastMsg().text)).toContain("Canva Pro");
    expect(String(lastMsg().text)).not.toContain("Pilih metode pembayaran");

    // Below min_qty rejects and refreshes qty screen to min_qty.
    fx.sql.exec("UPDATE product_variants SET min_qty=3 WHERE id=1");
    const badTag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 10000 }]);
    resetLog();
    await click(`pmentry:1:1:2:${badTag}`);
    expect(allMessages().some((m) => String(m.text).includes("Minimal pembelian 3"))).toBe(true);
    expect(allMessages().some((m) => String(m.text).includes("Pilih metode pembayaran"))).toBe(false);
    fx.sql.exec("UPDATE product_variants SET min_qty=1 WHERE id=1");

    // Out of stock blocks offer and shows home button.
    fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=1");
    const oosTag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 1, price: 10000 }]);
    resetLog();
    await click(`pmentry:1:1:1:${oosTag}`);
    expect(callbacksOf(lastMsg())).toContain("home");
    expect(String(lastMsg().text)).not.toContain("Pilih metode pembayaran");
    fx.sql.exec("UPDATE product_variants SET stock=100 WHERE id=1");

    // Maintenance blocks single pmentry.
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "true");
    resetLog();
    await click(`pmentry:1:1:1:${oosTag}`);
    expect(String(lastMsg().text)).not.toContain("Pilih metode pembayaran");
  });

  it("routes require_email products through email confirmation before single offer", async () => {
    fx.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 10000 }]);

    // Without saved email: asks for email first.
    await click("q:1:1:2");
    resetLog();
    await click(`pmentry:1:1:2:${tag}`);
    expect(String(lastMsg().text)).toContain("Email dibutuhkan");
    const pending1 = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    expect(pending1.pending_action).toBe("email_for:1:1:2");

    // With saved email: renders emailConfirmationKeyboard with single pmentry callback, then opens offer when confirmed.
    fx.sql.prepare("UPDATE telegram_users SET buyer_email=?, pending_action=? WHERE user_id=?").run("buyer@example.com", "qty_for:1:1", String(buyer.id));
    await click(`pmentry:1:1:2:${tag}`);
    const confirmMsg = lastMsg();
    expect(callbacksOf(confirmMsg)).toContain(`pmentry:1:1:2:${tag}`);
    const pending2 = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    const fp = await checkoutEmailFingerprint("buyer@example.com");
    expect(pending2.pending_action).toMatch(new RegExp(`^email_confirm:1:1:2:[a-f0-9]{8}:${fp}$`));

    await click(`pmentry:1:1:2:${tag}`);
    const offerMsg = lastMsg();
    expect(String(offerMsg.text)).toContain("Pilih metode pembayaran");
    const pending3 = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    const parsed = parsePayq1State(pending3.pending_action);
    expect(parsed?.source).toEqual({ kind: "single", productId: 1, variantId: 1, qty: 2 });
    expect(parsed?.contact?.email).toBe("buyer@example.com");
  });

  it("rejects mismatched owner/group on single pmentry and keeps bare pmentry cart-bound", async () => {
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 1, price: 10000 }]);
    await click(`pmentry:1:1:1:${tag}`, -999999, buyer);
    expect(String(lastMsg().text)).toContain("Lanjut di chat pribadi");
    expect(callbacksOf(lastMsg())).toEqual([]);

    resetLog();
    await click(`pmentry:1:1:1:${tag}`, buyer.id, { id: 999999, first_name: "Other" });
    expect(String(lastMsg().text)).toContain("Lanjut di chat pribadi");
    expect(callbacksOf(lastMsg())).toEqual([]);

    // Legacy bare "pmentry" still behaves as cart checkout (empty cart -> Keranjang kosong).
    resetLog();
    await click("pmentry");
    expect(String(lastMsg().text)).toContain("Keranjang kosong");

    // Legacy bare "pmentry" with populated cart opens cart offer with Back -> ccheckout.
    fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 2, 2, 1);
    await click("pmentry");
    expect(callbacksOf(lastMsg())).toContain("ccheckout");
    expect(callbacksOf(lastMsg())).toContain("home");
    const row = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string };
    expect(parsePayq1State(row.pending_action)?.source).toEqual({ kind: "cart" });
  });
});

describe("P0-2: Ambil Ulang permanent missing vs transient failures", () => {
  const code = "AXV-20261004-4CC0526E";

  it("sends permanent honest ID+EN copy without Retry button when delivered rows/ciphertext are absent", async () => {
    insertTestOrder(fx.sql, code, { status: "lunas" });
    fx.sql.exec("UPDATE orders SET fulfillment_status='delivered'");

    // Case A: zero fulfillment_items rows (legacy pre-0015 / legacy WR).
    expect(await resendTelegramCredentials(code, buyer.id, createDatabaseAccess(fx.db))).toBe(0);
    expect(String(lastMsg().text)).toContain("tidak tersimpan di bot");
    expect(String(lastMsg().text)).toContain(code);
    expect(callbacksOf(lastMsg())).not.toContain(`cred:${code}`);
    expect(callbacksOf(lastMsg())).toContain(`order:${code}`);
    expect(urlsOf(lastMsg()).some((u) => u.includes(`/wa?pesan=Pesanan%20${code}`))).toBe(true);

    // Case B: delivered row exists with NULL ciphertext/iv (pre-0043 WR settlement), EN order locale.
    fx.sql.prepare("UPDATE orders SET locale='en' WHERE code=?").run(code);
    fx.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,fulfillment_mode,status,delivered_ciphertext,delivered_iv,delivered_message_id)
      VALUES(?,0,1,1,'manual','delivered',NULL,NULL,'wr:old-123')`).run(code);
    resetLog();
    expect(await resendTelegramCredentials(code, buyer.id, createDatabaseAccess(fx.db))).toBe(0);
    expect(String(lastMsg().text)).toContain("not stored in the bot");
    expect(String(lastMsg().text)).toContain(code);
    expect(callbacksOf(lastMsg())).not.toContain(`cred:${code}`);
    expect(callbacksOf(lastMsg())).toContain(`order:${code}`);
    expect(urlsOf(lastMsg()).some((u) => u.includes(`/wa?pesan=Pesanan%20${code}`))).toBe(true);
  });

  it("keeps transient retry copy and includes Try Again + WhatsApp Admin + Detail Pesanan on decrypt/send failure", async () => {
    insertTestOrder(fx.sql, code, { status: "lunas" });
    const enc = await encryptSecret("topsecret@example.com:pass123");
    fx.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,fulfillment_mode,status,delivered_ciphertext,delivered_iv)
      VALUES(?,0,1,1,'manual','delivered',?,?)`).run(code, enc.ciphertext, enc.iv);

    // Simulate Telegram delivery failure without leaking secret in final summary.
    send.mockImplementation(async (params) => {
      chronological.push(params as SentMsg);
      return { ok: !String((params as SentMsg).text).includes("topsecret@example.com") } as never;
    });
    expect(await resendTelegramCredentials(code, buyer.id, createDatabaseAccess(fx.db))).toBe(0);
    expect(String(lastMsg().text)).toContain("gagal dibaca atau dikirim");
    expect(String(lastMsg().text)).not.toContain("topsecret@example.com");
    expect(callbacksOf(lastMsg())).toContain(`cred:${code}`);
    expect(callbacksOf(lastMsg())).toContain(`order:${code}`);
    expect(urlsOf(lastMsg()).some((u) => u.includes(`/wa?pesan=Pesanan%20${code}`))).toBe(true);
  });
});

describe("P0-3: Bantuan, payment offer, and order status keyboards", () => {
  it("renders Bantuan keyboard and updated payment copy for slash command, menu label, and callback (ID+EN)", async () => {
    for (const cmd of ["/bantuan", MENU_LABEL_HELP]) {
      resetLog();
      await handleCommand(cmd, buyer.id, "private", buyer);
      expect(String(lastMsg().text)).toContain("QRIS atau metode lain");
      expect(callbacksOf(lastMsg())).toEqual(expect.arrayContaining(["catalog:0", "myorders", "home"]));
      expect(urlsOf(lastMsg()).some((u) => u.includes("/wa"))).toBe(true);
      expect(urlsOf(lastMsg()).some((u) => u.includes("t.me/axvara_support"))).toBe(true);
    }

    fx.sql.prepare("UPDATE telegram_users SET locale='en' WHERE user_id=?").run(String(buyer.id));
    for (const trigger of ["/help", MENU_LABEL_EN.help]) {
      resetLog();
      await handleCommand(trigger, buyer.id, "private", buyer);
      expect(String(lastMsg().text)).toContain("QRIS or other methods (e.g. crypto)");
      expect(callbacksOf(lastMsg())).toEqual(expect.arrayContaining(["catalog:0", "myorders", "home"]));
    }

    resetLog();
    await click("help");
    expect(callbacksOf(lastMsg())).toEqual(expect.arrayContaining(["catalog:0", "myorders", "home"]));
  });

  it("includes Daftar Pesanan button on pending, paid, and terminal order status screens", async () => {
    insertTestOrder(fx.sql, "AXV-20261119-PEND0001", { status: "pending" });
    await handleOrderStatus(buyer.id, "AXV-20261119-PEND0001", buyer.id);
    expect(callbacksOf(lastMsg())).toContain("myorders");

    insertTestOrder(fx.sql, "AXV-20261119-PAID0002", { status: "lunas" });
    await handleOrderStatus(buyer.id, "AXV-20261119-PAID0002", buyer.id);
    expect(callbacksOf(lastMsg())).toContain("cred:AXV-20261119-PAID0002");
    expect(callbacksOf(lastMsg())).toContain("myorders");

    insertTestOrder(fx.sql, "AXV-20261119-EXPR0003", { status: "kedaluwarsa" });
    await handleOrderStatus(buyer.id, "AXV-20261119-EXPR0003", buyer.id);
    expect(callbacksOf(lastMsg())).toEqual(expect.arrayContaining(["myorders", "catalog:0", "home"]));
  });
});
