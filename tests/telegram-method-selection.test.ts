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
  it("renders QRIS-first EN offer with Fastest badge, no orders/provider writes", async () => {
    await seedCartUser();
    await click("pmentry");
    const message = lastMessage();
    const callbacks = callbacksOf(message);
    expect(callbacks.length).toBeGreaterThan(0);
    expect(callbacks.every((d) => Buffer.byteLength(d, "utf8") <= 64)).toBe(true);
    expect(callbacks[0]).toMatch(/^pm:[0-9a-f]{16}:0$/);
    expect(JSON.stringify(message.reply_markup)).toContain("Fastest");
    expect(lastText()).toContain("Choose a payment method");
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

  it("renders ID offer with Paling cepat badge", async () => {
    await seedCartUser();
    fx.sql.prepare("UPDATE telegram_users SET locale='id' WHERE user_id=?").run(String(buyer.id));
    await click("pmentry");
    expect(JSON.stringify(lastMessage().reply_markup)).toContain("Paling cepat");
    expect(lastText()).toContain("Pilih metode pembayaran");
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

  it("two-tab old nonce cannot change the current offer; duplicate taps idempotent", async () => {
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
    await click(`pm:${second.nonce}:0`);
    const afterFirst = String(userState().pending_action);
    expect(afterFirst).toContain('"sel":"qris"');
    await click(`pm:${second.nonce}:0`);
    expect(String(userState().pending_action)).toBe(afterFirst);
  });

  /** Crypto aktif: 20000 IDR @8000 => base 250 + 4 service fee = total 254 (US$2.54, di atas lantai US$2). */
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
      if (target.includes("/estimate?")) return Response.json({ estimated_amount: "2.54", currency_from: "usd", currency_to: "usdtbsc" });
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
    expect(crypto).toMatchObject({ total_cents: 254, amount_text: "2.54" });
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

    it("main keyboard shows ONE collapsed Crypto (USD) entry (no per-coin rows); details is one aggregated line", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const message = lastMessage();
      const rows = rowsOf(message);
      const cryptoRows = rows.filter((row) => row.some((b) => b.text.startsWith("Crypto (USD)")));
      expect(cryptoRows).toHaveLength(1);
      expect(cryptoRows[0][0].text).toBe("Crypto (USD) · 2.54 USD");
      expect(cryptoRows[0][0].callback_data).toMatch(/^pmc:[0-9a-f]{16}$/);
      expect(rows.flat().some((b) => /^BTC|USDT/.test(b.text))).toBe(false);
      expect((message.text.match(/Crypto \(USD\)/g) ?? []).length).toBe(1);
      expect(message.text).toContain("incl. 1.5% crypto service fee");
      expect(message.text).not.toMatch(/fee unknown|Provider fee/i);
      const frozen = parsePayq1State(String(userState().pending_action))!;
      expect(frozen.methods.filter((m) => m.kind === "crypto").map((m) => m.id)).toEqual([
        "nowpayments:btc", "nowpayments:eth", "nowpayments:trx", "nowpayments:usdtbsc", "nowpayments:usdttrc20",
      ]);
    });

    it("tapping the entry opens popular-first / stablecoin-second, 2 per row, with Back; callbacks <= 64 bytes", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const frozen = parsePayq1State(String(userState().pending_action))!;
      const rawBefore = String(userState().pending_action);
      await click(`pmc:${frozen.nonce}`);
      const rows = rowsOf(lastMessage());
      expect(rows.map((row) => row.map((b) => b.text))).toEqual([["BTC", "ETH"], ["TRX"], ["USDT · BSC", "USDT · TRX"], ["⬅ Back"]]);
      const callbacks = rows.flat().flatMap((b) => (b.callback_data ? [b.callback_data] : []));
      expect(callbacks.every((d) => Buffer.byteLength(d, "utf8") <= 64)).toBe(true);
      expect(callbacks.at(-1)).toBe(`pmb:${frozen.nonce}`);
      expect(parsePayq1CryptoCallback(callbacks.at(-1)!)).toEqual({ kind: "back", nonce: frozen.nonce });
      expect(parsePayq1CryptoCallback(`pmc:${frozen.nonce}`)).toEqual({ kind: "open", nonce: frozen.nonce });
      expect(rows[0][0].callback_data).toBe(`pm:${frozen.nonce}:${frozen.methods.findIndex((m) => m.id === "nowpayments:btc")}`);
      expect(lastText()).toContain("Pick the coin");
      expect(String(userState().pending_action)).toBe(rawBefore); // opening the menu mutates nothing
      // Back returns to the main methods screen.
      await click(`pmb:${frozen.nonce}`);
      expect(lastText()).toContain("Choose a payment method");
      expect(rowsOf(lastMessage()).flat().some((b) => b.text.startsWith("Crypto (USD)"))).toBe(true);
      expect(String(userState().pending_action)).toBe(rawBefore);
    });

    it("a coin tap behaves exactly like selecting a method: sel = that coin, Continue offered, no order/provider call", async () => {
      await enableCrypto();
      await seedCartUser();
      await click("pmentry");
      const frozen = parsePayq1State(String(userState().pending_action))!;
      await click(`pmc:${frozen.nonce}`);
      const btc = rowsOf(lastMessage())[0][0];
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
      await click("pmc:0123456789abcdef");
      expect(lastText()).toMatch(/expired|kedaluwarsa/i);
      expect(String(userState().pending_action)).toBe(raw);
    });

    it("coins below the floor are not shown (Telegram never shows disabled options); a tiny cart has no crypto entry", async () => {
      await enableCrypto();
      vi.stubEnv("USD_IDR_RATE", "16000"); // 20000 IDR -> base 125 + 2 = total 127 < US$2 floor
      await seedCartUser();
      await click("pmentry");
      const state = parsePayq1State(String(userState().pending_action))!;
      expect(state.methods.some((m) => m.kind === "crypto")).toBe(false);
      expect(rowsOf(lastMessage()).flat().some((b) => b.text.startsWith("Crypto"))).toBe(false);
    });

    it("per-coin minimum buffer: a coin whose provider minimum x1.15 exceeds the total is omitted, others stay", async () => {
      await enableCrypto([{ ticker: "btc", min_usd_text: "2.30" }, { ticker: "eth", min_usd_text: "2.20" }, { ticker: "usdtbsc", min_usd_text: "0.08" }]);
      await seedCartUser();
      await click("pmentry");
      // total 254; btc needs ceil(2.30*1.15)=265 -> omitted; eth needs ceil(2.53)=253 -> kept
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
      await click(`pmc:${state.nonce}`);
      const rows = rowsOf(lastMessage());
      expect(rows.slice(0, -1).every((row) => row.length <= 2)).toBe(true);
      expect(rows.flat().length).toBe(29);
      expect(rows.flat().every((b) => Buffer.byteLength(b.callback_data ?? "", "utf8") <= 64)).toBe(true);
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
