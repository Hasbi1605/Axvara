// tests/telegram-create-failure-switch.test.ts — TG: kegagalan create crypto
// DEFINITIF (kontrak sama dengan web/Pedia) membatalkan order + restock sekali,
// menandai TX terminal, melepas anchor, dan menawarkan metode lain. Semua klik
// memakai callback_data yang BENAR-BENAR ada di keyboard terakhir yang dirender
// (assert dulu). AMBIGU tetap terikat pada order yang sama (tanpa order kedua).
// Locally only: D1 fixture, Telegram mocked, provider dimock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import { sendMessage, safeEditOrSend, sendPhoto } from "@/lib/telegram/api";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(), sendPhoto: vi.fn(), sendChatAction: vi.fn(),
  safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));
const nowMock = vi.hoisted(() => ({ create: vi.fn(), real: null as null | ((...args: never[]) => Promise<unknown>) }));
vi.mock("@/lib/payments/nowpayments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/nowpayments")>();
  nowMock.real = actual.createNowpaymentsInvoice as never;
  return { ...actual, createNowpaymentsInvoice: (...args: never[]) => nowMock.create(...args) };
});
const qrisMock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/dana-qris")>();
  return {
    ...actual,
    isActiveQrisConfigured: () => true,
    createActiveQrisInvoice: (...args: never[]) => qrisMock.create(...args),
  };
});

const buyer = { id: 777004, first_name: "Singularity" };
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

let callbackSeq = 0;
const click = (data: string) => handleCallback(data, buyer.id, 21, buyer, `cb-${++callbackSeq}`);
const userRaw = () => String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id))?.pending_action ?? "");
const count = (table: string) => Number(fx.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n ?? 0);
const stock = () => Number(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock ?? 0);
const orderRow = () => fx.sql.prepare("SELECT code,status,payment_status,payment_method FROM orders ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
const allTexts = (): string[] => [
  ...send.mock.calls.map(([m]) => String((m as { text?: string }).text ?? "")),
  ...edit.mock.calls.map(([m]) => String((m as { text?: string }).text ?? "")),
];
type Markup = { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } };
const orderedMessages = () => [
  ...send.mock.calls.map(([m], i) => ({ order: send.mock.invocationCallOrder[i], msg: m as Markup & { text?: string } })),
  ...edit.mock.calls.map(([m], i) => ({ order: edit.mock.invocationCallOrder[i], msg: m as Markup & { text?: string } })),
].sort((a, b) => a.order - b.order);
/** Keyboard dari pesan TERAKHIR yang dirender (send/edit), urutan panggilan nyata. */
const lastKeyboard = (): string[] => {
  const markup = orderedMessages().at(-1)?.msg?.reply_markup;
  return (markup?.inline_keyboard ?? []).flat().flatMap((button) => (button.callback_data ? [button.callback_data] : []));
};
const lastText = (): string => String(orderedMessages().at(-1)?.msg?.text ?? "");
/** Klik HANYA callback yang ada di keyboard terakhir — seperti pembeli nyata. */
async function clickVisible(data: string) {
  expect(lastKeyboard(), `callback ${data} tidak ada di keyboard terakhir: ${JSON.stringify(lastKeyboard())}`).toContain(data);
  await click(data);
}

function seedCartUser() {
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), "en", "buyer@example.test");
  fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
}

/** Provider crypto: min-amount/estimate OK; POST/GET diatur per test. */
function cryptoFetch(opts: { post?: () => Response } = {}) {
  const posts = { count: 0 };
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const q = new URL(target).searchParams;
    if (target.includes("/estimate?")) return Response.json({ estimated_amount: "2.61", currency_from: "usd", currency_to: q.get("currency_to") });
    if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.00001", currency_from: q.get("currency_from"), currency_to: "usdtbsc" });
    if (target.endsWith("/payment") && init?.method === "POST") {
      posts.count++;
      if (opts.post) return opts.post();
      throw new Error("network lost");
    }
    if (target.includes("/payment/")) {
      return Response.json({ payment_id: "NP-switch-1", pay_address: "0xBEEF", pay_amount: "2.61", price_amount: "2.49", price_currency: "usd", pay_currency: "usdtbsc", network: "bsc", order_id: target.split("/").at(-1), payment_status: "waiting", actually_paid: "0", is_fixed_rate: false, is_fee_paid_by_user: false });
    }
    throw new Error(`unexpected ${target}`);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, posts };
}

/** Layar checkout keranjang yang nyata (ringkasan persetujuan berisi pmentry). */
async function openCheckoutScreen() {
  const { handleCartCheckout } = await import("@/lib/telegram/handlers/cart");
  await handleCartCheckout(buyer.id, 21, buyer);
  await clickVisible("pmentry");
}

async function seededOffer(ticker = "usdtbsc") {
  await seedCartUser();
  await openCheckoutScreen();
  const frozen = parsePayq1State(userRaw())!;
  const index = frozen.methods.findIndex((m) => m.id === `nowpayments:${ticker}`);
  expect(index).toBeGreaterThanOrEqual(0);
  // Crypto entry opens the coin picker; multi-network coins open one more level.
  await clickVisible(`pmc:${frozen.nonce}`);
  const leaf = `pm:${frozen.nonce}:${index}`;
  if (!lastKeyboard().includes(leaf)) await clickVisible(`pmc:${frozen.nonce}:USDT`);
  await clickVisible(leaf);
  return parsePayq1State(userRaw())!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_JWT_SECRET", "tg-switch-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-switch-fixture-secret-0123456789");
  vi.stubEnv("USD_IDR_RATE", "8000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  nowMock.create.mockReset();
  nowMock.create.mockImplementation((...args: unknown[]) => (nowMock.real as (...a: unknown[]) => Promise<unknown>)(...args)); // default: adapter asli
  qrisMock.create.mockReset();
  qrisMock.create.mockImplementation(async (code: string, amount: number) => ({
    orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 0,
    qrisPayload: "fixture", qrisUrl: "/qr.png", expires_at: new Date(Date.now() + 900_000).toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(), isExisting: false,
  }));
  fx = createD1Fixture();
  seedCryptoMarket(fx.sql, { fx: false });
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.exec("UPDATE products SET name='Fixture',require_email=0,is_active=1,telegram_enabled=1 WHERE id=1; UPDATE product_variants SET price=10000,stock=100,is_active=1,bulk_pricing_enabled=1,bulk_pricing_tiers='[{\"min_qty\":2,\"unit_price\":9500}]' WHERE id=1; INSERT OR IGNORE INTO categories(id,name,slug) VALUES(1,'Fixture','fixture'); UPDATE products SET category_id=1 WHERE id=1");
  fx.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)");
  send.mockResolvedValue({ ok: true } as never);
  edit.mockResolvedValue({ ok: true } as never);
  vi.mocked(sendPhoto).mockResolvedValue({ ok: true } as never);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("TG crypto create failure: definitive vs ambiguous", () => {
  it("definitive: order batal + stok kembali sekali + anchor lepas + copy gangguan + pmentry; baris QRIS di offer baru membuat order QRIS", async () => {
    const provider = cryptoFetch();
    const frozen = await seededOffer();
    // Rejeksi terbaca sebelum klaim TX: tidak ada charge yang bisa direkonsiliasi.
    nowMock.create.mockRejectedValueOnce(new Error("nowpayments_price_currency_unsupported"));
    await clickVisible(`pgo:${frozen.nonce}`);

    expect(count("orders")).toBe(1);
    expect(orderRow()).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
    expect(stock()).toBe(100); // 100 -> 98 saat order, kembali 100 SEKALI
    expect(count("payment_transactions")).toBe(0);
    expect(lastText()).toContain("Payment method error. Try another method.");
    expect(lastKeyboard()).toContain("pmentry");
    expect(userRaw()).toBe(""); // anchor dilepas: quote/nonce baru boleh

    // pmentry (tombol nyata) → offer BARU (nonce baru) berisi QRIS + koin lain.
    await clickVisible("pmentry");
    const fresh = parsePayq1State(userRaw())!;
    expect(fresh.nonce).not.toBe(frozen.nonce);
    expect(fresh.methods.some((m) => m.id === "qris")).toBe(true);
    expect(fresh.methods.some((m) => m.id === "nowpayments:btc")).toBe(true);

    // Tekan BARIS QRIS di keyboard offer (pm:), tanpa pgo: — langsung masuk alur
    // QRIS legacy: ringkasan persetujuan → cconfirm → order QRIS baru.
    const qrisIndex = fresh.methods.findIndex((m) => m.id === "qris");
    await clickVisible(`pm:${fresh.nonce}:${qrisIndex}`);
    expect(userRaw()).toBe(""); // draft payq1 dilepas oleh tap QRIS
    const confirm = lastKeyboard().find((data) => data.startsWith("cconfirm:"));
    expect(confirm).toBeTruthy();
    await clickVisible(confirm!);
    expect(count("orders")).toBe(2);
    expect(orderRow()).toMatchObject({ payment_method: "qris", status: "pending" });
    expect(stock()).toBe(98); // order QRIS baru mereservasi stok lagi (bukan 96)
    expect(qrisMock.create).toHaveBeenCalledTimes(1);
    expect(provider.posts.count).toBe(0); // tidak ada POST provider setelah definitif

    // Callback pm: dari keyboard LAMA (bukan tombol yang terlihat sekarang) tidak
    // boleh mengubah apa pun: state sudah dilepas, jadi hanya notis expired.
    await click(`pm:${frozen.nonce}:0`);
    expect(userRaw()).toBe("");
    expect(count("orders")).toBe(2);
    expect(stock()).toBe(98);
  });

  it("definitive dengan TX 'failed' tersimpan: TX tetap terminal, order batal, tidak ada resurrect", async () => {
    cryptoFetch();
    const frozen = await seededOffer();
    nowMock.create.mockImplementationOnce(async (code: string) => {
      fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,status,last_error,expires_at)
        VALUES(?,'nowpayments','hosted',?,'nowpayments',19000,'IDR','failed','nowpayments_http_400',datetime('now','+15 minutes'))`)
        .run(code, code);
      throw new Error("nowpayments_http_400");
    });
    await clickVisible(`pgo:${frozen.nonce}`);
    expect(orderRow()).toMatchObject({ status: "dibatalkan" });
    expect(fx.sql.prepare("SELECT status,last_error FROM payment_transactions").get()).toMatchObject({ status: "failed" });
    expect(stock()).toBe(100);
    expect(lastKeyboard()).toContain("pmentry");
    expect(userRaw()).toBe("");
  });

  it("ambiguous (POST timeout, klaim TX initializing): tetap terikat order SAMA, tanpa order baru; tombol metode lain TIDAK ditawarkan", async () => {
    const provider = cryptoFetch(); // POST selalu throw => network ambiguous
    const frozen = await seededOffer();
    await clickVisible(`pgo:${frozen.nonce}`);

    expect(count("orders")).toBe(1);
    expect(orderRow()).toMatchObject({ status: "pending", payment_status: "pending" });
    expect(fx.sql.prepare("SELECT status FROM payment_transactions").get()).toMatchObject({ status: "initializing" });
    expect(stock()).toBe(98); // stok TETAP dipegang
    expect(provider.posts.count).toBe(1); // satu POST, tanpa re-POST
    const anchored = parsePayq1State(userRaw())!;
    expect(anchored.st).toBe("creating");
    expect(anchored.orderCode).toBe(orderRow()!.code);
    // Switching TIDAK diiklankan: keyboard status tidak memuat pmentry.
    expect(lastKeyboard()).not.toContain("pmentry");

    // Status/refresh order yang sama tetap bekerja (GET-only, tanpa order/POST baru).
    await clickVisible(`refresh:${orderRow()!.code}`);
    expect(count("orders")).toBe(1);
    expect(provider.posts.count).toBe(1);

    // Simulasi tombol pmentry BASI (keyboard lama): tetap busy, tanpa quote/order kedua.
    await click("pmentry");
    expect(allTexts().some((text) => /Finish the current step first|Selesaikan langkah saat ini/i.test(text))).toBe(true);
    expect(count("orders")).toBe(1);
    expect(userRaw()).not.toBe("");
    expect(provider.posts.count).toBe(1);
  });

  it("double pmentry setelah definitif: hanya satu quote hidup, tanpa order tambahan", async () => {
    cryptoFetch();
    const frozen = await seededOffer();
    nowMock.create.mockRejectedValueOnce(new Error("nowpayments_price_currency_unsupported"));
    await clickVisible(`pgo:${frozen.nonce}`);
    expect(userRaw()).toBe("");

    expect(lastKeyboard()).toContain("pmentry");
    await Promise.all([click("pmentry"), click("pmentry")]);
    const states = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").all(String(buyer.id)) as { pending_action: string }[];
    expect(states.filter((row) => String(row.pending_action).startsWith("payq1:"))).toHaveLength(1);
    expect(parsePayq1State(userRaw())?.st).toBe("quoted");
    expect(count("orders")).toBe(1);
    expect(stock()).toBe(100);
  });

  it("double tap baris QRIS pada offer baru: hanya satu order QRIS (CAS draft + guard legacy)", async () => {
    cryptoFetch();
    const frozen = await seededOffer();
    nowMock.create.mockRejectedValueOnce(new Error("nowpayments_price_currency_unsupported"));
    await clickVisible(`pgo:${frozen.nonce}`);

    await clickVisible("pmentry");
    const fresh = parsePayq1State(userRaw())!;
    const qrisIndex = fresh.methods.findIndex((m) => m.id === "qris");
    const qrisCallback = `pm:${fresh.nonce}:${qrisIndex}`;
    expect(lastKeyboard()).toContain(qrisCallback);
    await Promise.all([click(qrisCallback), click(qrisCallback)]);

    // Hanya satu layar persetujuan QRIS yang dirender (tap kedua kalah CAS draft).
    const confirms = lastKeyboard().filter((data) => data.startsWith("cconfirm:"));
    expect(confirms).toHaveLength(1);
    await clickVisible(confirms[0]);
    expect(count("orders")).toBe(2); // order crypto yang dibatalkan + SATU order QRIS
    expect(qrisMock.create).toHaveBeenCalledTimes(1);
    expect(stock()).toBe(98);
    expect(userRaw()).toBe("");
  });
});
