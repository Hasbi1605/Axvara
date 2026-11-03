import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { handleOrderCancel, handleOrderRefresh, handleOrderStatus } from "@/lib/telegram/handlers/orders";
import { resendTelegramCredentials } from "@/lib/telegram/credential-delivery";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn(), photo: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send, safeEditOrSend: api.edit, sendPhoto: api.photo,
}));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: vi.fn() }));

const code = "AXV-20261029-ABCDEF12";
const buyer = 12345;
let fx: ReturnType<typeof createD1Fixture>;
const order = () => fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
const ledger = () => fx.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(code)!;
const lastText = () => String(api.send.mock.calls.at(-1)?.[0].text ?? "");

beforeEach(async () => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  stubFulfillmentKey();
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 2);
  insertTestOrder(fx.sql, code, { items: [
    { product_id: 1, variant_id: 1, qty: 2, name: "Canva Pro", price: 10000 },
    { product_id: 1, qty: 1, name: "Gemini", price: 10000 },
  ] });
  fx.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
    VALUES(?,'klikqris','inhouse',?,'123456789',10000,10089,'pending',?)`)
    .run(code, code, new Date(Date.now() + 600_000).toISOString());
  fx.sql.prepare(`INSERT INTO fulfillment_inventory
    (product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code,reserved_at)
    VALUES(1,1,'cipher','iv','fixture','reserved',?,datetime('now'))`).run(code);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request"); }));
});
afterEach(() => { fx.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function snapshot() {
  return {
    order: order(), ledger: ledger(),
    product: fx.sql.prepare("SELECT stock FROM products WHERE id=1").get(),
    variant: fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get(),
    inventory: fx.sql.prepare("SELECT * FROM fulfillment_inventory").all(),
  };
}

describe("Telegram atomic cancellation", () => {
  it("commits stock, inventory, order and ledger once, including initializing invoices", async () => {
    fx.sql.exec("UPDATE payment_transactions SET status='initializing'");
    await handleOrderCancel(buyer, 1, code.toLowerCase(), { id: buyer });
    expect(order()).toMatchObject({ status: "dibatalkan", payment_status: "failed", fulfillment_status: "not_required" });
    expect(ledger().status).toBe("cancelled");
    expect(fx.sql.prepare("SELECT stock FROM products WHERE id=1").get()?.stock).toBe(101);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(102);
    expect(fx.sql.prepare("SELECT status,order_code FROM fulfillment_inventory").get())
      .toMatchObject({ status: "available", order_code: null });
    const saved = snapshot();
    await handleOrderCancel(buyer, 1, code, { id: buyer });
    expect(snapshot()).toEqual(saved);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
  });

  it.each(["UPDATE products", "UPDATE product_variants", "UPDATE fulfillment_inventory", "UPDATE orders", "UPDATE payment_transactions", "DELETE FROM operation_guards"])(
    "rolls everything back when %s fails", async failing => {
      const saved = snapshot();
      fx.control.fail = query => query.trimStart().startsWith(failing);
      await handleOrderCancel(buyer, 1, code, { id: buyer });
      expect(snapshot()).toEqual(saved);
      expect(lastText()).toContain("Pembatalan gagal");
      expect(api.edit).not.toHaveBeenCalled();
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
    },
  );

  it("loses the paid race before batch admission without releasing stock", async () => {
    const batch = fx.db.batch;
    fx.db.batch = async statements => {
      fx.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'; UPDATE payment_transactions SET status='paid'");
      return batch(statements);
    };
    await handleOrderCancel(buyer, 1, code, { id: buyer });
    expect(order()).toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(ledger().status).toBe("paid");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    expect(fx.sql.prepare("SELECT status FROM fulfillment_inventory").get()?.status).toBe("reserved");
    expect(lastText()).toContain("statusnya sudah berubah");
  });

  it.each(["owner", "channel", "paid-ledger", "corrupt-snapshot"])("rejects invalid %s without mutation", async kind => {
    if (kind === "owner") fx.sql.exec("UPDATE orders SET telegram_user_id='999'");
    if (kind === "channel") fx.sql.exec("UPDATE orders SET sales_channel='web'");
    if (kind === "paid-ledger") fx.sql.exec("UPDATE payment_transactions SET status='paid'");
    if (kind === "corrupt-snapshot") fx.sql.exec("UPDATE orders SET items='null'");
    const saved = snapshot();
    await handleOrderCancel(buyer, 1, code, { id: buyer });
    expect(snapshot()).toEqual(saved);
    expect(api.edit).not.toHaveBeenCalled();
  });

  it("rechecks ownership in the committing batch", async () => {
    const batch = fx.db.batch;
    fx.db.batch = async statements => {
      fx.sql.exec("UPDATE orders SET telegram_user_id='999'");
      return batch(statements);
    };
    await handleOrderCancel(buyer, 1, code, { id: buyer });
    expect(order().status).toBe("pending");
    expect(ledger().status).toBe("pending");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });
});

describe("Telegram owned status and refresh", () => {
  it("lists all quantities from a historical group order in its buyer's private chat", async () => {
    fx.sql.exec("UPDATE orders SET telegram_chat_id='-555',payment_status='paid',fulfillment_status='delivered'");
    await handleOrderStatus(buyer, code.toLowerCase(), buyer);
    expect(lastText()).toContain("Canva Pro x2");
    expect(lastText()).toContain("Gemini x1");
    expect(lastText()).toContain("Terkirim");
    expect(JSON.stringify(api.send.mock.calls)).not.toMatch(/buyer_access|c1\./);
    api.send.mockClear();
    await handleOrderStatus(buyer, code, 999);
    await handleOrderRefresh(-555, 1, code, buyer);
    expect(api.send).not.toHaveBeenCalled();
  });

  it("refreshes a paid order with credential recovery keyboard", async () => {
    fx.sql.exec("UPDATE orders SET payment_status='paid',fulfillment_status='manual_required'; UPDATE payment_transactions SET status='paid'");
    await handleOrderRefresh(buyer, 1, code);
    const result = api.edit.mock.calls.at(-1)?.[0];
    expect(result.text).toContain("Pengiriman: Diproses admin");
    expect(JSON.stringify(result.reply_markup)).toContain(`cred:${code}`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders paid status and recovery keyboard after GET reconciliation wins", async () => {
    vi.stubEnv("KLIKQRIS_ENABLED", "true");
    vi.stubEnv("KLIKQRIS_API_KEY", "fixture-key");
    vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123456789");
    fx.sql.exec("UPDATE orders SET expires_at=datetime('now','+10 minutes'); UPDATE payment_transactions SET provider_signature='fixture-signature-long-enough'");
    const get = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return Response.json({ status: true, data: {
        order_id: code, amount: 10000, total_amount: 10089, status: "SUCCESS",
        signature: "fixture-signature-long-enough", paid_at: new Date().toISOString(),
      } });
    });
    vi.stubGlobal("fetch", get);
    await handleOrderRefresh(buyer, 1, code);
    expect(order().payment_status).toBe("paid");
    expect(ledger().status).toBe("paid");
    expect(api.edit.mock.calls.at(-1)?.[0].text).toContain("Lunas");
    expect(JSON.stringify(api.edit.mock.calls.at(-1)?.[0].reply_markup)).toContain(`cred:${code}`);
    expect(api.photo).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reports lookup and storage errors instead of silently ignoring refresh", async () => {
    await handleOrderRefresh(999, 1, code);
    expect(lastText()).toContain("tidak ditemukan");
    fx.control.fail = query => query.includes("FROM orders o LEFT JOIN");
    await handleOrderStatus(buyer, code);
    expect(lastText()).toContain("gagal dibaca");
    await handleOrderRefresh(buyer, 1, code);
    expect(lastText()).toContain("gagal dibaca");
  });

  it("recovers initializing KlikQRIS by GET only and retries the same QR after photo failure", async () => {
    vi.stubEnv("KLIKQRIS_ENABLED", "true");
    vi.stubEnv("KLIKQRIS_API_KEY", "fixture-key");
    vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123456789");
    fx.sql.exec("UPDATE payment_transactions SET status='initializing',payable_amount=NULL");
    const get = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      return Response.json({ status: true, data: {
        order_id: code, amount: "10000.00", total_amount: "10089.00", status: "PENDING",
        signature: "fixture-signature-long-enough", qris_url: "https://klikqris.com/storage/qris_api/fixture.png",
        expired_at: new Date(Date.now() + 600_000).toISOString(),
      } });
    });
    vi.stubGlobal("fetch", get);
    api.photo.mockResolvedValueOnce({ ok: false, error_code: 400, description: "Bad Request: failed to get HTTP URL content" });
    await handleOrderRefresh(buyer, 1, code);
    expect(ledger().status).toBe("pending");
    expect(order().telegram_invoice_sent_at).toBeNull();
    expect(api.edit.mock.calls.at(-1)?.[0].text).toContain("QR pembayaran gagal dikirim");
    await handleOrderRefresh(buyer, 1, code);
    expect(get.mock.calls.every(([url]) => String(url).includes("/status/"))).toBe(true);
    expect(api.photo.mock.calls[0][0].photo).toBe(api.photo.mock.calls[1][0].photo);
    expect(order().telegram_invoice_sent_at).toBeTruthy();
    await handleOrderRefresh(buyer, 1, code);
    expect(api.photo).toHaveBeenCalledTimes(2);
  });
});

async function delivered(index: number, plaintext = `secret-${index}`) {
  const secret = await encryptSecret(plaintext);
  fx.sql.prepare(`INSERT INTO fulfillment_items
    (order_code,item_index,product_id,variant_id,status,delivered_ciphertext,delivered_iv)
    VALUES(?,?,1,1,'delivered',?,?)`).run(code, index, secret.ciphertext, secret.iv);
}

describe("Telegram explicit credential resend outcomes", () => {
  beforeEach(() => { fx.sql.exec("UPDATE orders SET status='lunas',payment_status='paid',fulfillment_status='queued'"); });
  const resend = () => resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db));

  it("distinguishes not-ready from database and decryption failures", async () => {
    expect(await resend()).toBe(0);
    expect(lastText()).toContain("belum siap");
    fx.control.fail = query => query.includes("FROM fulfillment_items");
    expect(await resend()).toBe(0);
    expect(lastText()).toContain("gagal dibaca");
    expect(lastText()).not.toContain("disiapkan");
    fx.control.fail = null;
    await delivered(0);
    fx.sql.exec("UPDATE fulfillment_items SET delivered_ciphertext='corrupt'");
    expect(await resend()).toBe(0);
    expect(lastText()).toContain("gagal dibaca atau dikirim");
    expect(lastText()).not.toContain("belum siap");
  });

  it("reports delivery failure and partial success while continuing with other items", async () => {
    await delivered(0);
    await delivered(1);
    api.send.mockImplementation(async ({ text }: { text: string }) => ({ ok: !text.includes("secret-0") }));
    expect(await resend()).toBe(1);
    expect(lastText()).toContain("1 detail produk berhasil dikirim");
    expect(lastText()).toContain("gagal dibaca atau dikirim");
    expect(api.send.mock.calls.some(([params]) => params.text.includes("secret-1"))).toBe(true);
  });

  it("counts a multi-part item only when every part succeeds", async () => {
    await delivered(0, "a".repeat(8000));
    await delivered(1);
    api.send.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    expect(await resend()).toBe(1);
    expect(lastText()).toContain("1 detail produk berhasil dikirim");
    expect(lastText()).not.toContain("belum siap");
    expect(api.send.mock.calls.some(([params]) => params.text.includes("secret-1"))).toBe(true);
  });

  it("labels unique units and other items without losing their original indexes", async () => {
    fx.sql.prepare("UPDATE orders SET items=?").run(JSON.stringify([
      { name: "Canva", qty: 2, fulfillment_mode: "unique", unique_units: true },
      { name: "Gemini", qty: 3 },
    ]));
    await delivered(0); await delivered(1); await delivered(2);
    expect(await resend()).toBe(3);
    const messages = api.send.mock.calls.map(([params]) => String(params.text));
    expect(messages.find(text => text.includes("secret-0"))).toContain("Akun 1 dari 2");
    expect(messages.find(text => text.includes("secret-1"))).toContain("Gemini");
    expect(messages.find(text => text.includes("secret-2"))).toContain("Akun 2 dari 2");
  });

  it("reports missing ready credentials as failure and pending units as partial", async () => {
    fx.sql.exec("UPDATE orders SET fulfillment_status='delivered'");
    expect(await resend()).toBe(0);
    expect(lastText()).toContain("gagal dibaca atau dikirim");
    fx.sql.exec("UPDATE orders SET fulfillment_status='queued'");
    await delivered(0);
    expect(await resend()).toBe(1);
    expect(lastText()).toContain("Detail lainnya belum siap");
  });

  it("resends only to the owner despite mismatched positive saved and order chats", async () => {
    await delivered(0);
    fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id) VALUES(?,?)").run(String(buyer), "555001");
    fx.sql.exec("UPDATE orders SET telegram_chat_id='666001'");
    expect(await resend()).toBe(1);
    expect(api.send.mock.calls.some(([params]) => params.text.includes("secret-0"))).toBe(true);
    expect(api.send.mock.calls.every(([params]) => String(params.chat_id) === String(buyer))).toBe(true);

    api.send.mockClear();
    for (const chatId of [555001, 666001, 999999]) {
      expect(await resendTelegramCredentials(code, chatId, createDatabaseAccess(fx.db))).toBe(0);
      expect(lastText()).toBe("Pesanan tidak ditemukan.");
    }
    expect(api.send).toHaveBeenCalledTimes(3);
    expect(api.send.mock.calls.some(([params]) => params.text.includes("secret-0"))).toBe(false);

    api.send.mockClear();
    api.send.mockImplementation(async ({ text }: { text: string }) => ({ ok: !text.includes("secret-0") }));
    expect(await resend()).toBe(0);
    expect(lastText()).toContain("gagal dibaca atau dikirim");
    expect(api.send.mock.calls.filter(([params]) => params.text.includes("secret-0"))).toHaveLength(1);
    expect(api.send.mock.calls.every(([params]) => String(params.chat_id) === String(buyer))).toBe(true);
  });

  it.each([null, "", "0", "-1", "012345", "12345.0", "9007199254740992"])(
    "does not recover credentials for an ownerless or invalid stored identity %s", async userId => {
      await delivered(0);
      fx.sql.prepare("UPDATE orders SET telegram_user_id=?").run(userId);
      expect(await resend()).toBe(0);
      expect(api.send).toHaveBeenCalledTimes(1);
      expect(lastText()).toBe("Pesanan tidak ditemukan.");
      expect(api.send.mock.calls.some(([params]) => params.text.includes("secret-0"))).toBe(false);
    },
  );

  it("never sends credentials to an invalid or group chat", async () => {
    await delivered(0);
    for (const chat of [-1, 0, NaN, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await resendTelegramCredentials(code, chat, createDatabaseAccess(fx.db))).toBe(0);
    }
    expect(api.send).not.toHaveBeenCalled();
  });
});
