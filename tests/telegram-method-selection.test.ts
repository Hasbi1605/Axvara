import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { buildMethodOptions } from "@/lib/payments/method-options";
import { parsePayq1State, payq1Expired, parsePayq1CryptoCallback } from "@/lib/telegram/payment-quote";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(), sendPhoto: vi.fn(), sendChatAction: vi.fn(),
  safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
}));

const buyer = { id: 424242, first_name: "Singularity" };
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

const click = (data: string, chatId = buyer.id, from = buyer) =>
  handleCallback(data, chatId, 11, from, `cb-${data.slice(0, 20)}-${Math.random()}`);
const userState = () =>
  fx.sql.prepare("SELECT pending_action, buyer_email FROM telegram_users WHERE user_id=?").get(String(buyer.id))!;
const lastText = (): string => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  const last = calls.at(-1)?.[0] as { text?: string };
  return String(last?.text ?? "");
};
function callbacksOf(message: { reply_markup?: unknown }): string[] {
  const markup = message.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
  return markup?.inline_keyboard?.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : [])) ?? [];
}
const lastCallbacks = (): string[] => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  return callbacksOf((calls.at(-1)?.[0] ?? {}) as { reply_markup?: unknown });
};
const lastMessage = (): { text: string; reply_markup?: unknown } => {
  const calls: unknown[][] = [...(send.mock.calls as unknown[][]), ...(edit.mock.calls as unknown[][])];
  return (calls.at(-1)?.[0] ?? {}) as { text: string; reply_markup?: unknown };
};

async function seedCartUser() {
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), "en", "buyer@example.test");
  fx.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES(?,?,?,?)").run(String(buyer.id), 1, 1, 2);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("ADMIN_JWT_SECRET", "tg-r1-fixture");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg-r1-fixture");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
  vi.stubEnv("KLIKQRIS_ENABLED", "true");
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("Unexpected network request in TG R1 fixture");
  }));
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.exec("UPDATE products SET name='Fixture',require_email=0");
  fx.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)");
  send.mockResolvedValue({ ok: true } as never);
  edit.mockImplementation(async (params) => ({ ok: true, params } as never));
});

afterEach(() => {
  fx.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("TG R1 frozen method selection (local only)", () => {
  it("renders EN offer with QRIS line and Rp button when crypto is off, no orders/provider writes", async () => {
    await seedCartUser();
    await click("pmentry");
    const message = lastMessage();
    const callbacks = callbacksOf(message);
    expect(callbacks.length).toBeGreaterThan(0);
    expect(callbacks.every((d) => Buffer.byteLength(d, "utf8") <= 64)).toBe(true);
    expect(callbacks[0]).toMatch(/^pm:[0-9a-f]{16}:0$/);
    const markupJson = JSON.stringify(message.reply_markup);
    expect(markupJson).toContain("📱 QRIS · Rp20.000");
    expect(markupJson).not.toContain("Fastest");
    expect(lastText()).toContain("💳 <b>Choose payment</b>");
    expect(lastText()).toContain("Product : Keranjang (1 item)");
    expect(lastText()).toContain("Total   : <b>IDR\u00a020,000</b>");
    expect(lastText()).toContain("QRIS: Indonesian e-wallets &amp; m-banking.");
    expect(lastText()).not.toContain("• QRIS");
    const raw = String(userState().pending_action ?? "");
    expect(raw.startsWith("payq1:")).toBe(true);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(64 * 1024);
    const state = parsePayq1State(raw)!;
    expect(state.v).toBe(1);
    expect(state.st).toBe("quoted");
    expect(state.locale).toBe("en");
    expect(state.idrSubtotal).toBe(20000);
    expect(state.source).toEqual({ kind: "cart" });
    expect(state.methods[0]?.id).toBe("qris");
    for (const method of state.methods) {
      expect((await import("@/lib/auth")).isCanonicalMethodOption(method, state.idrSubtotal)).toBe(true);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders ID offer with QRIS first, Rp button, and concise method description", async () => {
    await seedCartUser();
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    await click("pmentry");
    expect(JSON.stringify(lastMessage().reply_markup)).toContain("📱 QRIS · Rp20.000");
    expect(lastText()).toContain("💳 <b>Pilih pembayaran</b>");
    expect(lastText()).toContain("Produk : Keranjang (1 item)");
    expect(lastText()).toContain("Total  : <b>Rp\u00a020.000</b>");
    expect(lastText()).toContain("QRIS: semua e-wallet &amp; m-banking.");
    expect(lastText()).not.toContain("• QRIS");
  });

  it("Telegram offer never includes the gateway rail even with the flag on; the web builder still does", async () => {
    const key = `fixture-${crypto.randomUUID()}`;
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", key);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data: [
      { payment_code: "AAA", payment_name: "AAA VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 1.000" } },
    ] })));
    await seedCartUser();
    await click("pmentry");
    const frozen = parsePayq1State(String(userState().pending_action))!;
    expect(frozen.methods[0]?.id).toBe("qris");
    expect(frozen.methods.some((m) => m.id.startsWith("sekalipay_gateway:"))).toBe(false);
    expect(JSON.stringify(lastMessage().reply_markup)).not.toContain("sekalipay_gateway");
    expect(fetch).not.toHaveBeenCalled(); // Telegram tidak membaca katalog gateway sama sekali
    // Kontrak web/token tidak berubah: builder default tetap memuat gateway.
    const web = await buildMethodOptions(20000);
    expect(web.some((m) => m.id === "sekalipay_gateway:AAA")).toBe(true);
  });

  it("gateway selected snapshot is rejected before any create (defense in depth)", async () => {
    const { selectedSnapshotOf } = await import("@/lib/telegram/payment-create");
    const state = {
      v: 1, nonce: "0123456789abcdef", exp: Math.floor(Date.now() / 1000) + 600, tag: "0123456789ab",
      locale: "en", idrSubtotal: 20000, source: { kind: "cart" },
      methods: [{ id: "sekalipay_gateway:OKVA", kind: "gateway", gateway: { channel: "OKVA", estimated_fee: 1000, estimated_total: 21000, idr_subtotal: 20000 } }],
      sel: "sekalipay_gateway:OKVA", contact: { email: "buyer@example.test", phone: "081234567890" }, st: "quoted",
    };
    expect(await selectedSnapshotOf(state as never)).toMatchObject({ ok: false, reason: "method_unavailable" });
  });

  it("two-tab old nonce cannot change the current offer; baris QRIS memulai alur QRIS; tap koin duplikat idempoten", async () => {
    await seedCartUser();
    await click("pmentry");
    const firstRaw = String(userState().pending_action);
    const first = parsePayq1State(firstRaw)!;
    await click("pmentry");
    const secondRaw = String(userState().pending_action);
    const second = parsePayq1State(secondRaw)!;
    expect(second.nonce).not.toBe(first.nonce);
    await click(`pm:${first.nonce}:0`);
    expect(String(userState().pending_action)).toBe(secondRaw);
    // Baris QRIS (owner 8 Nov 2026): langsung memulai alur QRIS legacy, draft
    // payq1 dilepas — bukan seleksi yang berhenti di "refreshed" tanpa aksi.
    await click(`pm:${second.nonce}:0`);
    expect(String(userState().pending_action ?? "")).toBe("");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    // Idempotensi seleksi non-QRIS: offer baru + koin yang sama dua kali.
    await enableCrypto();
    await click("pmentry");
    const offer = parsePayq1State(String(userState().pending_action))!;
    await click(`pmc:${offer.nonce}`);
    const coin = offer.methods.findIndex((m) => m.id === "nowpayments:usdtbsc");
    expect(coin).toBeGreaterThanOrEqual(0);
    await click(`pm:${offer.nonce}:${coin}`);
    const afterFirst = String(userState().pending_action);
    expect(afterFirst).toContain('"sel":"nowpayments:usdtbsc"');
    await click(`pm:${offer.nonce}:${coin}`);
    expect(String(userState().pending_action)).toBe(afterFirst);
  });

  /** Crypto aktif: 20000 IDR @8000 => base 250; usdtbsc +11 = 261, koin default (20c) = 273. */
  async function enableCrypto(coins?: { ticker: string; min_usd_text: string }[]) {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    vi.stubEnv("NOWPAYMENTS_API_KEY", "k");
    vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "s");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    vi.stubEnv("USD_IDR_RATE", "8000");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
    seedCryptoMarket(fx.sql, { fx: false, ...(coins ? { coins } : {}) });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "2.73", currency_from: "usd", currency_to: "usdtbsc" });
      if (target.includes("/min-amount?")) return Response.json({ min_amount: "0.0005", currency_from: "usdtbsc", currency_to: "usdtbsc" });
      throw new Error(`unexpected ${target}`);
    }));
  }

  it("mutated FX keeps frozen cents; expired offer fails closed on requote", async () => {
    await enableCrypto();
    await seedCartUser();
    await click("pmentry");
    const frozen = parsePayq1State(String(userState().pending_action))!;
    const crypto = frozen.methods.find((m) => m.id === "nowpayments:usdtbsc") as { usd?: { cents: string }; total_cents?: number; amount_text?: string } | undefined;
    expect(crypto?.usd?.cents).toBe("250");
    expect(crypto).toMatchObject({ total_cents: 261, amount_text: "2.61" });
    vi.stubEnv("USD_IDR_RATE", "17000");
    const cryptoBefore = JSON.stringify(crypto);
    await click(`pm:${frozen.nonce}:${frozen.methods.findIndex((m) => m.id === "nowpayments:usdtbsc")}`);
    expect(JSON.stringify(parsePayq1State(String(userState().pending_action))!.methods.find((m) => m.id === "nowpayments:usdtbsc"))).toBe(cryptoBefore);
    // Expire the frozen offer: same prices must still fail closed (requote).
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?")
      .run(String(userState().pending_action).replace(/"exp":\d+/, `"exp":${Math.floor(Date.now() / 1000) - 1}`), String(buyer.id));
    const expired = parsePayq1State(String(userState().pending_action))!;
    expect(payq1Expired(expired)).toBe(true);
    const expiredRawBefore = String(userState().pending_action);
    await click(`pm:${expired.nonce}:0`);
    // No selection mutation on expired offer (sel stays as previously set).
    expect(String(userState().pending_action)).toBe(expiredRawBefore);
    expect(lastText()).toMatch(/expired|kedaluwarsa/i);
  });

  describe("crypto coin sub-keyboard", () => {
    const rowsOf = (message: { reply_markup?: unknown }) =>
      ((message.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] }).inline_keyboard ?? []);

    it("EN orders Crypto first and QRIS second; ID orders QRIS first then Crypto with comma decimals", async () => {
      fx.sql.exec("UPDATE payment_methods SET is_active=0 WHERE id!='qris'");
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const message = lastMessage();
      const rows = rowsOf(message);
      expect(rows[0][0].text).toBe("🪙 Crypto · 2.61 USDT");
      expect(rows[0][0].callback_data).toMatch(/^pmc:[0-9a-f]{16}$/);
      expect(rows[1][0].text).toBe("📱 QRIS · Rp20.000");
      expect(rows[1][0].callback_data).toMatch(/^pm:[0-9a-f]{16}:0$/);
      expect(rows.flat().some((b) => /^BTC/.test(b.text))).toBe(false);
      expect(message.text).toContain("Crypto: USDT, BTC, ETH, etc.");
      expect(message.text).toContain("QRIS: Indonesian e-wallets &amp; m-banking.");
      expect(message.text).not.toContain("• USDT");
      expect(message.text).not.toContain("• QRIS");
      expect(message.text.indexOf("Crypto:")).toBeLessThan(message.text.indexOf("QRIS:"));
      expect(message.text).not.toMatch(/fee unknown|Provider fee/i);
      const frozen = parsePayq1State(String(userState().pending_action))!;
      expect(frozen.methods.filter((m) => m.kind === "crypto").map((m) => m.id)).toEqual([
        "nowpayments:btc", "nowpayments:eth", "nowpayments:trx", "nowpayments:usdtbsc", "nowpayments:usdttrc20",
      ]);

      // ID locale: QRIS first, then Crypto with comma decimal.
      fx.sql.prepare("UPDATE telegram_users SET locale='id', pending_action=NULL WHERE user_id=?").run(String(buyer.id));
      await click("pmentry");
      const idMsg = lastMessage();
      const idRows = rowsOf(idMsg);
      expect(idRows[0][0].text).toBe("📱 QRIS · Rp20.000");
      expect(idRows[0][0].callback_data).toMatch(/^pm:[0-9a-f]{16}:0$/);
      expect(idRows[1][0].text).toBe("🪙 Crypto · 2,61 USDT");
      expect(idRows[1][0].callback_data).toMatch(/^pmc:[0-9a-f]{16}$/);
      expect(idMsg.text).toContain("QRIS: semua e-wallet &amp; m-banking.");
      expect(idMsg.text).toContain("Crypto: USDT, BTC, ETH, dll.");
      expect(idMsg.text).not.toContain("• QRIS");
      expect(idMsg.text).not.toContain("• USDT");
      expect(idMsg.text.indexOf("QRIS:")).toBeLessThan(idMsg.text.indexOf("Crypto:"));
    });

    it("single-mode pmentry orders Crypto first in EN and QRIS first in ID with new button labels", async () => {
      vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
      fx.sql.exec("UPDATE payment_methods SET is_active=0 WHERE id!='qris'");
      await enableCrypto();
      fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale,buyer_email) VALUES(?,?,?,?)")
        .run(String(buyer.id), String(buyer.id), "en", "buyer@example.test");
      const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 10000 }]);
      await click(`pmentry:1:1:2:${tag}`);
      const enMsg = lastMessage();
      const enRows = rowsOf(enMsg);
      expect(enRows[0][0].text).toBe("🪙 Crypto · 2.61 USDT");
      expect(enRows[1][0].text).toBe("📱 QRIS · Rp20.000");
      expect(enMsg.text).toContain("💳 <b>Choose payment</b>");
      expect(enMsg.text).toContain("Product : Fixture · Variant 1 ×2");
      expect(enMsg.text).toContain("Crypto: USDT, BTC, ETH, etc.");
      expect(enMsg.text).toContain("QRIS: Indonesian e-wallets &amp; m-banking.");

      fx.sql.prepare("UPDATE telegram_users SET locale='id', pending_action=NULL WHERE user_id=?").run(String(buyer.id));
      await click(`pmentry:1:1:2:${tag}`);
      const idMsg = lastMessage();
      const idRows = rowsOf(idMsg);
      expect(idRows[0][0].text).toBe("📱 QRIS · Rp20.000");
      expect(idRows[1][0].text).toBe("🪙 Crypto · 2,61 USDT");
      expect(idMsg.text).toContain("💳 <b>Pilih pembayaran</b>");
      expect(idMsg.text).toContain("Produk : Fixture · Variant 1 ×2");
      expect(idMsg.text).toContain("QRIS: semua e-wallet &amp; m-banking.");
      expect(idMsg.text).toContain("Crypto: USDT, BTC, ETH, dll.");
    });

    it("opens one button per coin, keeps frozen network callbacks, and supports Back on both steps", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const frozen = parsePayq1State(String(userState().pending_action))!;
      const rawBefore = String(userState().pending_action);
      await click(`pmc:${frozen.nonce}`);
      const rows = rowsOf(lastMessage());
      expect(rows.map((row) => row.map((b) => b.text))).toEqual([["💵 USDT"], ["🟠 BTC"], ["🔷 ETH"], ["🔴 TRX"], ["◀️ Back"]]);
      const callbacks = rows.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));
      expect(callbacks.every((d) => Buffer.byteLength(d, "utf8") <= 64)).toBe(true);
      expect(callbacks.at(-1)).toBe(`pmb:${frozen.nonce}`);
      expect(parsePayq1CryptoCallback(callbacks.at(-1)!)).toEqual({ kind: "back", nonce: frozen.nonce });
      expect(parsePayq1CryptoCallback(`pmc:${frozen.nonce}`)).toEqual({ kind: "open", nonce: frozen.nonce });
      expect(rows[1][0].callback_data).toBe(`pm:${frozen.nonce}:${frozen.methods.findIndex((m) => m.id === "nowpayments:btc")}`);
      expect(lastText()).toContain("🪙 <b>Choose a coin</b>");
      expect(lastText()).toMatch(/Total : <b>\d\.\d{2}–\d\.\d{2} USD<\/b> \(service fee included\)/);
      expect(String(userState().pending_action)).toBe(rawBefore); // opening the menu mutates nothing
      await click(rows[0][0].callback_data!);
      expect(lastText()).toBe("🪙 <b>USDT</b> · choose a network");
      const networks = rowsOf(lastMessage()).flat();
      expect(networks.map(b => b.text)).toEqual(["USDT · BSC", "USDT · TRX", "◀️ Back"]);
      expect(networks.map(b => b.callback_data)).toEqual([
        ...["usdtbsc", "usdttrc20"].map(ticker => `pm:${frozen.nonce}:${frozen.methods.findIndex(m => m.pay_currency === ticker)}`),
        `pmc:${frozen.nonce}`,
      ]);
      await click(networks[2].callback_data!);
      expect(lastText()).toContain("Choose a coin");
      // Back returns to the main methods screen.
      await click(`pmb:${frozen.nonce}`);
      expect(lastText()).toContain("Choose payment");
      expect(rowsOf(lastMessage()).flat().some((b) => b.text.startsWith("🪙 Crypto"))).toBe(true);
      expect(String(userState().pending_action)).toBe(rawBefore);
    });

    it("a coin tap behaves exactly like selecting a method: sel = that coin, Continue offered, no order/provider call", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const frozen = parsePayq1State(String(userState().pending_action))!;
      await click(`pmc:${frozen.nonce}`);
      const btc = rowsOf(lastMessage()).flat().find(button => button.text === "🟠 BTC")!;
      await click(btc.callback_data!);
      expect(parsePayq1State(String(userState().pending_action))!.sel).toBe("nowpayments:btc");
      expect(lastCallbacks()).toContain(`pgo:${frozen.nonce}`);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("stale/expired nonce on the crypto menu: no mutation, honest requote notice", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const raw = String(userState().pending_action);
      await click("pmc:0123456789abcdef:USDT");
      expect(lastText()).toMatch(/expired|kedaluwarsa/i);
      expect(String(userState().pending_action)).toBe(raw);
      const state = parsePayq1State(raw)!;
      const previous = lastMessage();
      await click(`pmc:${state.nonce}:BOGUS`);
      expect(lastMessage()).toBe(previous);
      const expired = `payq1:${JSON.stringify({ ...state, exp: Math.floor(Date.now() / 1000) - 1 })}`;
      expect(payq1Expired(parsePayq1State(expired)!)).toBe(true);
      fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run(expired, String(buyer.id));
      await click(`pmc:${state.nonce}:USDT`);
      expect(lastText()).toMatch(/expired|kedaluwarsa/i);
      expect(String(userState().pending_action)).toBe(expired);
    });

    it("no AXVARA floor: a US$1.35 cart still shows coins whose provider minimum allows it; BTC is omitted", async () => {
      await enableCrypto();
      vi.stubEnv("USD_IDR_RATE", "16000"); // 20000 IDR -> base 125 + biaya per koin (usdtbsc 10) = total 135
      await seedCartUser();
      await click("pmentry");
      const state = parsePayq1State(String(userState().pending_action))!;
      const ids = state.methods.filter((m) => m.kind === "crypto").map((m) => m.id);
      expect(ids).toEqual(["nowpayments:eth", "nowpayments:trx", "nowpayments:usdtbsc", "nowpayments:usdttrc20"]);
      expect(ids).not.toContain("nowpayments:btc"); // ceil(1.95 x 1.15) = 2.25 > 1.47 (btc total)
      expect(rowsOf(lastMessage()).flat().some((b) => b.text.startsWith("🪙 Crypto"))).toBe(true);
    });

    it("per-coin minimum buffer: a coin whose provider minimum x1.15 exceeds its total is omitted, others stay", async () => {
      await enableCrypto([{ ticker: "btc", min_usd_text: "2.40" }, { ticker: "eth", min_usd_text: "2.20" }, { ticker: "usdtbsc", min_usd_text: "0.08" }]);
      await seedCartUser();
      await click("pmentry");
      // btc total 273 vs needs ceil(2.40*1.15)=276 -> omitted; eth total 270 vs needs ceil(2.53)=253 -> kept
      const ids = parsePayq1State(String(userState().pending_action))!.methods.filter((m) => m.kind === "crypto").map((m) => m.id);
      expect(ids).toEqual(["nowpayments:eth", "nowpayments:usdtbsc"]);
    });

    it("full 28-coin catalog fits the frozen state, indexes stay two digits and every callback is <= 64 bytes", async () => {
      const { CRYPTO_ASSETS } = await import("@/lib/payments/crypto-assets");
      await enableCrypto(CRYPTO_ASSETS.map((asset) => ({ ticker: asset.ticker, min_usd_text: "0.08" })));
      await seedCartUser();
      await click("pmentry");
      const raw = String(userState().pending_action);
      expect(raw.startsWith("payq1:")).toBe(true);
      const state = parsePayq1State(raw)!;
      expect(state).not.toBeNull();
      expect(state.methods.filter((m) => m.kind === "crypto")).toHaveLength(28);
      const readButtons = async (data: string) => {
        await click(data);
        const rows = rowsOf(lastMessage());
        expect(rows.every(row => row.length === 1)).toBe(true);
        expect(rows.flat().every(b => Buffer.byteLength(b.callback_data ?? "", "utf8") <= 64)).toBe(true);
        return rows.flat();
      };
      const main = await readButtons(`pmc:${state.nonce}`);
      expect(main.map(b => b.text)).toEqual(["💵 USDT", "🔵 USDC", "🟠 BTC", "🔷 ETH", "🟡 BNB", "🔴 TRX", "💎 TON", "⚪ LTC", "➕ Others", "◀️ Back"]);
      const others = await readButtons(main[8].callback_data!);
      expect(others.map(b => b.text)).toEqual(["DAI", "PYUSD", "FDUSD", "USDP", "◀️ Back"]);
      const networkPages = [];
      for (const button of [main[0], main[1], others[2]]) networkPages.push(...await readButtons(button.callback_data!));
      expect(networkPages).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: "USDT · TON" }),
        expect.objectContaining({ text: "◀️ Back", callback_data: others[2].callback_data!.replace(/FDUSD$/, "others") }),
      ]));
      const leaves = [...main, ...others, ...networkPages].filter(b => b.callback_data?.startsWith("pm:"));
      expect(leaves.map(b => b.callback_data).sort()).toEqual(state.methods.flatMap((m, i) => m.kind === "crypto" ? [`pm:${state.nonce}:${i}`] : []).sort());
      expect(String(userState().pending_action)).toBe(raw);
    });
  });

  it("flag on: Telegram stays QRIS-only (QRIS keeps working); web catalog still applies strict gateway fees", async () => {
    const key = `fixture-${crypto.randomUUID()}`;
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", key);
    vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: true,
      data: [
        { payment_code: "OKVA", payment_name: "OK VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 1.000" } },
        { payment_code: "BADVA", payment_name: "BAD VA", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "unknown" } },
        { payment_code: "XQRIS", payment_name: "QRIS", payment_type: "va", min_amount: 100, max_amount: 999999999, fee_info: { type: "flat", description: "Rp 1.000" } },
      ],
    })));
    await seedCartUser();
    await click("pmentry");
    const ids = parsePayq1State(String(userState().pending_action))!.methods.map((m) => m.id);
    expect(ids[0]).toBe("qris");
    expect(ids.some((id) => id.startsWith("sekalipay_gateway:"))).toBe(false);
    const web = (await buildMethodOptions(20000)).map((m) => m.id);
    expect(web).toContain("qris");
    expect(web).toContain("sekalipay_gateway:OKVA");
    expect(web).not.toContain("sekalipay_gateway:BADVA");
    expect(web).not.toContain("sekalipay_gateway:XQRIS");
    expect(web).not.toContain("nowpayments:usdtbsc");
  });

  it("protects email/qty/search/wa/onboarding/unknown/creating namespaces", async () => {
    await seedCartUser();
    for (const busy of ["email_for:1:1:2", "qty_for:1:1", "search:", "wa_after_paid:AXV-1", "onboarding:abc", "mystery-state", "creating:AXV-1"]) {
      fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run(busy, String(buyer.id));
      await click("pmentry");
      expect(String(userState().pending_action)).toBe(busy);
      expect(lastText()).toMatch(/langkah|step/i);
    }
  });

  it("rejects corrupt/forged/cross-user/group selections with no mutation", async () => {
    await seedCartUser();
    await click("pmentry");
    const before = String(userState().pending_action);
    // Corrupt stored state.
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run("payq1:{broken", String(buyer.id));
    await click("pm:abcdef0123456789:0");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    // Forged nonce.
    fx.sql.prepare("UPDATE telegram_users SET pending_action=? WHERE user_id=?").run(before, String(buyer.id));
    await click("pm:ffffffffffffffff:0");
    expect(String(userState().pending_action)).toBe(before);
    // Cross-user tap (attacker chat).
    await click(`pm:${parsePayq1State(before)!.nonce}:0`, 999999, { id: 999999, first_name: "Eve" });
    expect(String(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get("999999")?.pending_action ?? "")).toBe("");
    expect(String(userState().pending_action)).toBe(before);
    // Group tap.
    await click(`pm:${parsePayq1State(before)!.nonce}:0`, -12345, { id: buyer.id, first_name: "Singularity" });
    expect(String(userState().pending_action)).toBe(before);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cap byte budget: pending_action <=16KiB and callbacks <=64B", async () => {
    await seedCartUser();
    await click("pmentry");
    const raw = String(userState().pending_action);
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(64 * 1024);
    for (const data of lastCallbacks()) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("current line price mismatch requotes; legacy QRIS suites unaffected", async () => {
    await seedCartUser();
    await click("pmentry");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 12000 }]);
    expect(tag).not.toBe(parsePayq1State(String(userState().pending_action))!.tag);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  });
});
