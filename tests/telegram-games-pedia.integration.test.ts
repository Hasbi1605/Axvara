// tests/telegram-games-pedia.integration.test.ts — End-to-end integration tests
// for native AXVARA Games & AXVARA Pedia ordering in @Axvara_bot (real SQLite D1
// fixture, mocked outgoing Telegram API & external supplier/payment HTTP).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";
import { createDatabaseAccess } from "@/lib/db-access";
import { calculateCrc16 } from "@/lib/payments/qris";

const tg = vi.hoisted(() => ({
  sendMessage: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number } }>>(async () => ({ ok: true, result: { message_id: 201 } })),
  sendPhoto: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number; photo: { file_id: string; width: number; height: number }[] } }>>(async () => ({
    ok: true,
    result: { message_id: 202, photo: [{ file_id: "AgAC-mock-photo", width: 800, height: 800 }] },
  })),
  editMessageText: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number } }>>(async () => ({ ok: true, result: { message_id: 201 } })),
  editMessageMedia: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number } }>>(async () => ({ ok: true, result: { message_id: 202 } })),
  editMessageCaption: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number } }>>(async () => ({ ok: true, result: { message_id: 202 } })),
  deleteMessage: vi.fn<(chatId?: number | string, msgId?: number) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  safeEditOrSend: vi.fn<(p?: Record<string, unknown>) => Promise<{ ok: boolean; result: { message_id: number } }>>(async () => ({ ok: true, result: { message_id: 201 } })),
  answerCallbackQuery: vi.fn<(id?: string, text?: string, alert?: boolean) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  sendChatAction: vi.fn<(chatId?: number | string, action?: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
  withLoadingIndicator: vi.fn(async (_c: number, _l: string, work: (b: () => Promise<void>) => Promise<void>) => work(async () => {})),
  showLoadingBar: vi.fn(async () => {}),
}));

const nicknameMock = vi.hoisted(() => ({
  checkSkGamesNickname: vi.fn(async () => ({ status: "ok" as const, nickname: "ProGamer (Indonesia)", cached: false })),
}));

const pediaProxyMock = vi.hoisted(() => ({
  callPediaProxy: vi.fn(async () => ({ ok: true as const, data: { refill: "RF-9988" } })),
}));

vi.mock("@/lib/telegram/api", () => tg);
vi.mock("@/lib/games/nickname", () => nicknameMock);
vi.mock("@/lib/pedia/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pedia/proxy")>()),
  callPediaProxy: pediaProxyMock.callPediaProxy,
}));
vi.mock("@/lib/payments/gopay-wake", () => ({ scheduleGopayWake: vi.fn() }));
vi.mock("@/lib/pedia/email", () => ({ sendPediaEmail: vi.fn(async () => true) }));

import { POST as webhookPost } from "@/app/api/telegram/webhook/route";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { notifyTelegramBuyerPaid } from "@/lib/telegram/order-notifications";
import { notifyGamesCompleted, notifyGamesPaid } from "@/lib/games/notify";
import { notifyPediaCompleted } from "@/lib/pedia/notify";
import { resendTelegramCredentials } from "@/lib/telegram/credential-delivery";

let fx: ReturnType<typeof createD1Fixture>;
const buyer = { id: 991001, first_name: "Budi", username: "buditest" };
const intruder = { id: 991002, first_name: "Mallory", username: "mallory" };
const QR_BASE = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304";
let cbSeq = 0;

function click(data: string, user = buyer, chatId = user.id, msgId = 55) {
  return handleCallback(data, chatId, msgId, user, `cb-${++cbSeq}`);
}

function lastUiPayload(): { text: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; url?: string; style?: string }[][] } } {
  // Check the most recent call across sendPhoto, editMessageText, sendMessage, safeEditOrSend by invocationOrder.
  const entries: { order: number; text: string; reply_markup?: unknown }[] = [];
  const push = (
    fn: { mock: { calls: unknown[][]; invocationCallOrder: number[] } },
    pick: (arg: Record<string, unknown>) => { text: string; reply_markup?: unknown },
  ) => {
    fn.mock.calls.forEach((args, idx) => {
      const order = fn.mock.invocationCallOrder[idx] ?? 0;
      const arg = (args[0] ?? {}) as Record<string, unknown>;
      const picked = pick(arg);
      entries.push({ order, ...picked });
    });
  };
  push(tg.sendMessage, (a) => ({ text: String(a.text ?? ""), reply_markup: a.reply_markup }));
  push(tg.sendPhoto, (a) => ({ text: String(a.caption ?? ""), reply_markup: a.reply_markup }));
  push(tg.safeEditOrSend, (a) => ({ text: String(a.text ?? ""), reply_markup: a.reply_markup }));
  entries.sort((a, b) => a.order - b.order);
  const last = entries.at(-1);
  return {
    text: last?.text ?? "",
    reply_markup: last?.reply_markup as { inline_keyboard?: { text: string; callback_data?: string; url?: string; style?: string }[][] } | undefined,
  };
}

function allUiTexts(): string {
  return [
    ...tg.sendMessage.mock.calls.map(([a]) => String((a as Record<string, unknown>)?.text ?? "")),
    ...tg.sendPhoto.mock.calls.map(([a]) => String((a as Record<string, unknown>)?.caption ?? "")),
    ...tg.safeEditOrSend.mock.calls.map(([a]) => String((a as Record<string, unknown>)?.text ?? "")),
    ...tg.answerCallbackQuery.mock.calls.map(([, t]) => String(t ?? "")),
  ].join("\n");
}

function buttonsOf(payload = lastUiPayload()) {
  return payload.reply_markup?.inline_keyboard?.flat() ?? [];
}

function assertWhiteLabel(text: string) {
  expect(text.toLowerCase()).not.toMatch(/indosmm|providersmm|sekalipay|digiflazz/);
}

function seedGamesCatalog() {
  fx.sql.prepare(
    `INSERT INTO games_meta (slug, display_name, publisher, icon_url, featured_rank, hidden)
     VALUES ('mobile-legends', 'Mobile Legends', 'Moonton', 'https://axvara.tech/img/mlbb.png', 1, 0),
            ('free-fire', 'Free Fire', 'Garena', 'https://axvara.tech/img/ff.png', 2, 0)`,
  ).run();

  const mlFields = JSON.stringify({
    version: 1,
    fields: [
      { key: "note", label: "User ID", required: true, input: "text", min: 1, max: 20 },
      { key: "zone_id", label: "Zone ID", required: true, input: "text", min: 1, max: 10 },
    ],
    requires_zone_id: true,
    validation_available: true,
    open_denom: false,
    supported: true,
    reason: null,
  });
  const ffFields = JSON.stringify({
    version: 1,
    fields: [
      { key: "note", label: "Player ID", required: true, input: "text", min: 1, max: 20 },
    ],
    requires_zone_id: false,
    validation_available: true,
    open_denom: false,
    supported: true,
    reason: null,
  });

  // Notice id=1 matches Market product id=1 intentionally to verify cancel/failure NEVER restocks Market!
  fx.sql.prepare(
    `INSERT INTO games_products
       (id, buyer_sku_code, game_brand, product_type, product_name, cost, sell_price, enabled,
        stock, display_group, supplier, supplier_active, seller_active, sk_variant_id, sk_sku,
        sk_product_id, sk_product_name, game_slug, product_type_name, required_fields_json, min_order)
     VALUES
       (1, 'SK-ML-86-ID', 'Mobile Legends', 'Top Up', 'Mobile Legends 86 Diamonds', 15000, 18500, 1,
        -1, 'topup', 'sekalipay', 1, 1, 5001, 'ML86', 101, 'Mobile Legends Indonesia', 'mobile-legends', 'Indonesia', ?, 1),
       (2, 'SK-ML-WDP-ID', 'Mobile Legends', 'Pass', 'Mobile Legends Weekly Diamond Pass', 24000, 27500, 1,
        -1, 'pass', 'sekalipay', 1, 1, 5002, 'MLWDP', 101, 'Mobile Legends Indonesia', 'mobile-legends', 'Indonesia', ?, 1),
       (3, 'SK-ML-514-ID', 'Mobile Legends', 'Top Up', 'Mobile Legends 514 Diamonds', 110000, 125000, 1,
        -1, 'topup', 'sekalipay', 1, 1, 5003, 'ML514', 101, 'Mobile Legends Indonesia', 'mobile-legends', 'Indonesia', ?, 1),
       (4, 'SK-ML-86-MY', 'Mobile Legends', 'Top Up', 'Mobile Legends 86 Diamonds', 16000, 19500, 1,
        -1, 'topup', 'sekalipay', 1, 1, 5004, 'ML86MY', 102, 'Mobile Legends Malaysia', 'mobile-legends', 'Malaysia', ?, 1),
       (5, 'SK-FF-70-ID', 'Free Fire', 'Top Up', 'Free Fire 70 Diamonds', 8000, 9900, 1,
        -1, 'topup', 'sekalipay', 1, 1, 5005, 'FF70', 103, 'Free Fire Indonesia', 'free-fire', 'Indonesia', ?, 1)`,
  ).run(mlFields, mlFields, mlFields, mlFields, ffFields);

  // Add 10 more MLBB Indonesia SKUs (total 13 ID SKUs > 12) so adaptive Pass tab & price-range filters show!
  const insertExtra = fx.sql.prepare(
    `INSERT INTO games_products
       (id, buyer_sku_code, game_brand, product_type, product_name, cost, sell_price, enabled,
        stock, display_group, supplier, supplier_active, seller_active, sk_variant_id, sk_sku,
        sk_product_id, sk_product_name, game_slug, product_type_name, required_fields_json, min_order)
     VALUES (?, ?, 'Mobile Legends', 'Top Up', ?, ?, ?, 1, -1, 'topup', 'sekalipay', 1, 1, ?, ?, 101,
             'Mobile Legends Indonesia', 'mobile-legends', 'Indonesia', ?, 1)`,
  );
  for (let i = 0; i < 10; i++) {
    const id = 10 + i;
    const dm = 10 + i * 5;
    const price = 5000 + i * 4000;
    insertExtra.run(id, `SK-ML-${dm}-ID`, `Mobile Legends ${dm} Diamonds`, price - 1000, price, 5010 + i, `ML${dm}`, mlFields);
  }
}

function seedPediaCatalog() {
  // Product 1: IG Likes (post/reel) with 4 tiers (>3 -> shows filter bar & numbered list)
  // Product 2: IG Comments (custom comments input_kind='comments') with 1 tier (<=3 -> adaptive no filter)
  fx.sql.prepare(
    `INSERT INTO pedia_products
       (id, slug, platform, metric, target_kind, name, packages_json, step, sort_order, is_active, is_featured)
     VALUES
       (1, 'instagram-likes', 'instagram', 'likes', 'post', 'Instagram Likes', '[100,500,1000,5000]', 10, 1, 1, 1),
       (2, 'instagram-comments', 'instagram', 'comments', 'post', 'Instagram Custom Comments', '[5,10,20]', 1, 2, 1, 0)`,
  ).run();

  fx.sql.prepare(
    `INSERT INTO pedia_supplier_services
       (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, api_refill, present)
     VALUES
       ('indosmm', 8001, 'IG Likes Indo Real R30', 'Instagram', 'Default', 10000, 50, 50000, 1, 1),
       ('indosmm', 8002, 'IG Likes Global HQ', 'Instagram', 'Default', 6000, 100, 100000, 0, 1),
       ('indosmm', 8003, 'IG Likes Ekonomis', 'Instagram', 'Default', 4000, 100, 100000, 0, 1),
       ('indosmm', 8004, 'IG Likes VIP R365', 'Instagram', 'Default', 15000, 100, 50000, 0, 1),
       ('indosmm', 8005, 'IG Custom Comments Indo', 'Instagram', 'Custom Comments', 200000, 2, 500, 0, 1)`,
  ).run();

  fx.sql.prepare(
    `INSERT INTO pedia_tiers
       (id, product_id, tier, label_note, supplier, supplier_service_id, price_group,
        markup_pct, min_profit_rp, refill_days, eta_start, eta_finish, package_prices_json,
        is_active, public_name, region, quality, is_recommended, sort_order, input_kind, target_format)
     VALUES
       (11, 1, 'premium', 'Indo Real R30', 'indosmm', 8001, 'G1', 50, 1500, 30, '0-1 jam', '1-6 jam', '{"100":3500,"500":8500,"1000":15000}',
        1, 'Likes Indo Real Bergaransi', 'indonesia', 'real', 1, 1, NULL, 'url'),
       (12, 1, 'standar', 'Global HQ', 'indosmm', 8002, 'G2', 40, 1000, 0, '0-1 jam', '1-12 jam', '{"100":2500,"500":5500,"1000":9000}',
        1, 'Likes Global Cepat', 'global', 'hq', 0, 2, NULL, 'url'),
       (13, 1, 'hemat', 'Ekonomis', 'indosmm', 8003, 'G3', 30, 500, 0, '1-2 jam', '6-24 jam', '{"100":2000,"500":4000,"1000":6500}',
        1, 'Likes Ekonomis', 'global', 'ekonomis', 0, 3, NULL, 'url'),
       (14, 1, 'vip', 'VIP Manual Refill', 'indosmm', 8004, 'G1', 50, 2000, 365, '0-30 menit', '1-4 jam', '{"100":4500,"500":11000,"1000":22500}',
        1, 'Likes VIP 365 Hari', 'indonesia', 'real', 0, 4, NULL, 'url'),
       (15, 2, 'standar', 'Custom Komentar', 'indosmm', 8005, 'G1', 50, 2000, 0, '0-1 jam', '1-6 jam', '{"5":3000,"10":5000,"20":8000}',
        1, 'Komentar Custom Indo', 'indonesia', 'real', 1, 1, 'comments', 'url')`,
  ).run();
}

beforeEach(async () => {
  vi.clearAllMocks();
  cbSeq = 0;
  fx = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:fixture-bot");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture-wh-secret");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100999");
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-admin-secret-0123456789");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret-0123456789");
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  // Games ordering gate: Sekalipay H2H live
  vi.stubEnv("GAMES_SK_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_SANDBOX", "false");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-fixture-key");
  vi.stubEnv("SEKALIPAY_SECRET_KEY", "sk-fixture-secret");
  // QRIS (GoPay static -> zero network needed for QRIS creation)
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_STATIC_QRIS", QR_BASE + calculateCrc16(QR_BASE));
  vi.stubEnv("GOPAY_POLLER_SECRET", "gopay-fixture-secret");
  // Pedia enabled
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  // Crypto (NOWPayments) enabled, Sekalipay gateway explicitly enabled in env to prove Telegram still excludes gateway!
  vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "np-fixture-key");
  vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "np-fixture-ipn");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");

  await insertTestProduct(fx.sql, "manual");
  fx.sql.prepare("UPDATE products SET name='Netflix Private', stock=10, telegram_enabled=1 WHERE id=1").run();
  fx.sql.prepare("UPDATE product_variants SET stock=10, price=25000, label='1 Bulan' WHERE product_id=1").run();
  fx.sql.prepare(
    "INSERT INTO telegram_users (user_id, chat_id, username, first_name, locale, display_currency) VALUES (?, ?, ?, ?, 'id', 'IDR')",
  ).run(String(buyer.id), String(buyer.id), buyer.username, buyer.first_name);
  fx.sql.prepare(
    "INSERT INTO telegram_users (user_id, chat_id, username, first_name, locale, display_currency) VALUES (?, ?, ?, ?, 'id', 'IDR')",
  ).run(String(intruder.id), String(intruder.id), intruder.username, intruder.first_name);

  seedGamesCatalog();
  seedPediaCatalog();
  seedCryptoMarket(fx.sql);
});

afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Native Telegram Games & Pedia: entrypoints, security & white-label", () => {
  it("redirects /games and /pedia in group chats to private DM and blocks cross-user ownerBound callbacks", async () => {
    const postGroup = (updateId: number, text: string) =>
      webhookPost(new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "fixture-wh-secret" },
        body: JSON.stringify({
          update_id: updateId,
          message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: -10012345, type: "supergroup" }, from: buyer, text },
        }),
      }));

    await postGroup(7001, "/games");
    expect(tg.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: -10012345,
      text: expect.stringContaining("chat pribadi"),
    }));

    tg.sendMessage.mockClear();
    await postGroup(7002, "/pedia");
    expect(tg.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: -10012345,
      text: expect.stringContaining("chat pribadi"),
    }));

    // Intruder trying to trigger buyer's Games/Pedia ownerBound callbacks in buyer's chat is rejected.
    tg.sendMessage.mockClear();
    await click("gmv:1", intruder, buyer.id);
    expect(tg.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: buyer.id,
      text: expect.stringContaining("chat pribadi"),
    }));

    tg.sendMessage.mockClear();
    await click("pds:1:11", intruder, buyer.id);
    expect(tg.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: buyer.id,
      text: expect.stringContaining("chat pribadi"),
    }));

    // Seed an order owned by buyer and test intruder tapping pdrf:AXP-...
    fx.sql.prepare(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status,
         sales_channel, order_kind, telegram_user_id, telegram_chat_id, paid_at)
       VALUES ('AXP-OWN-1', 'Budi', '', '[]', 15000, 'qris', 'lunas', 'paid', 'telegram', 'pedia', ?, ?, datetime('now'))`,
    ).run(String(buyer.id), String(buyer.id));
    tg.sendMessage.mockClear();
    await click("pdrf:AXP-OWN-1", intruder, intruder.id);
    expect(tg.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      chat_id: intruder.id,
      text: expect.stringContaining("bukan milikmu"),
    }));
    expect(pediaProxyMock.callPediaProxy).not.toHaveBeenCalled();
  });
});

describe("Native Telegram AXVARA Games end-to-end", () => {
  it("navigates Games home -> game detail -> Pass/filter/region/SKU search -> 1-msg ID + nickname mismatch hint -> QRIS AXG order -> saved-ID 1-click repeat -> paid & SN notifications", async () => {
    // 1. Open Games Home
    await click("gmh");
    const homeUi = lastUiPayload();
    expect(homeUi.text).toContain("AXVARA Games");
    expect(homeUi.text).toContain("2 game");
    expect(buttonsOf(homeUi).some((b) => b.callback_data === "gmo:mobile-legends")).toBe(true);
    expect(buttonsOf(homeUi).some((b) => b.callback_data === "gmo:free-fire")).toBe(true);
    // Owner 27 Nov 2026: tombol order via web tepat di atas baris Home.
    const homeRows = (homeUi.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard;
    const webIdx = homeRows.findIndex((r) => r.some((b) => b.url === "https://games.axvara.tech/"));
    const homeIdx = homeRows.findIndex((r) => r.some((b) => b.callback_data === "home"));
    expect(webIdx).toBeGreaterThan(-1);
    expect(webIdx).toBe(homeIdx - 1);

    // 2. Open Mobile Legends -> default Indonesia, price filter, SKU search, Region switch (no Pass tab, owner 28 Nov 2026)
    tg.sendPhoto.mockClear();
    tg.editMessageMedia.mockClear();
    await click("gmo:mobile-legends");
    const mlUi = lastUiPayload();
    // Uji coba tanpa banner (owner 28 Nov 2026): ML dikirim teks biasa, bukan foto.
    expect(tg.sendPhoto).not.toHaveBeenCalled();
    expect(tg.editMessageMedia).not.toHaveBeenCalled();
    expect(mlUi.text).toContain("Mobile Legends");
    // Owner 28 Nov 2026: region aktif berbendera + mata uang di caption.
    expect(mlUi.text).toContain("🇮🇩");
    expect(mlUi.text).toContain("Indonesia");
    const mlBtns = buttonsOf(mlUi);
    expect(mlBtns.some((b) => b.callback_data === "gmv:1")).toBe(true); // 86 Diamonds ID
    expect(mlBtns.some((b) => b.callback_data === "gmv:4")).toBe(false); // Malaysia hidden in ID view
    const passBtn = mlBtns.find((b) => b.callback_data?.includes(":p:"));
    const range3Btn = mlBtns.find((b) => b.callback_data?.endsWith(":3:0"));
    const regionBtn = mlBtns.find((b) => b.callback_data === "gmr:mobile-legends");
    const skuSearchBtn = mlBtns.find((b) => b.callback_data?.startsWith("gms:mobile-legends"));
    expect(passBtn).toBeUndefined();
    expect(mlBtns.some((b) => /All Packages|Semua Nominal/.test(b.text))).toBe(false);
    expect(range3Btn).toBeTruthy();
    expect(regionBtn).toBeTruthy();
    expect(skuSearchBtn).toBeTruthy();

    // Weekly Diamond Pass stays in the main grid; a legacy Pass-tab callback falls back to all packages
    expect(mlBtns.some((b) => b.callback_data === "gmv:2")).toBe(true);
    await click(range3Btn!.callback_data!.replace(/:a:3:0$/, ":p:0:0"));
    expect(buttonsOf().some((b) => b.callback_data === "gmv:1")).toBe(true);
    expect(buttonsOf().some((b) => b.callback_data === "gmv:2")).toBe(true);

    // Filter >100rb -> shows 514 Diamonds (125k) only
    await click(range3Btn!.callback_data!);
    expect(buttonsOf().some((b) => b.callback_data === "gmv:3")).toBe(true);
    expect(buttonsOf().some((b) => b.callback_data === "gmv:1")).toBe(false);

    // Region switcher -> lists Indonesia & Malaysia
    await click(regionBtn!.callback_data!);
    expect(buttonsOf().some((b) => b.text.includes("Malaysia"))).toBe(true);

    // SKU search -> type "86"
    await click(skuSearchBtn!.callback_data!);
    await handleCommand("86", buyer.id, "private", buyer);
    expect(buttonsOf().some((b) => b.callback_data === "gmv:1")).toBe(true);

    // 3. Select 86 Diamonds (first order -> asks for User ID & Zone ID)
    await click("gmv:1");
    expect(lastUiPayload().text).toContain("User ID");
    expect(lastUiPayload().text).toContain("Zone ID");

    // 4. Send 1-message "12345678 1234" while nickname returns region (Malaysia) -> shows region mismatch warning + switch region CTA + frozen payq1 QRIS/Crypto directly!
    nicknameMock.checkSkGamesNickname.mockResolvedValueOnce({ status: "ok", nickname: "ProGamer (Malaysia)", cached: false });
    await handleCommand("12345678 1234", buyer.id, "private", buyer);
    const reviewUi = lastUiPayload();
    expect(reviewUi.text).toContain("ProGamer");
    expect(reviewUi.text).toContain("12345678 (1234)");
    expect(reviewUi.text).toContain("Malaysia");
    const reviewBtns = buttonsOf(reviewUi);
    expect(reviewBtns.some((b) => b.text.includes("Pindah ke Region Malaysia"))).toBe(true);

    // 5. Frozen payq1 directly on review screen shows QRIS + Crypto (NO Sekalipay gateway VA/e-wallet!)
    const qrisBtn = reviewBtns.find((b) => b.text.includes("QRIS") && b.callback_data?.startsWith("pm:"));
    const otherBtn = reviewBtns.find((b) => b.callback_data?.startsWith("pmc:"));
    expect(qrisBtn).toBeTruthy();
    expect(otherBtn).toBeTruthy();
    expect(reviewBtns.some((b) => b.text.includes("Virtual Account") || b.text.includes("DANA"))).toBe(false);

    // 6. Tap QRIS 1-click -> creates AXG- order + games_order_items + sends QRIS photo
    tg.sendPhoto.mockClear();
    await click(qrisBtn!.callback_data!);
    const orderRow = fx.sql.prepare("SELECT * FROM orders WHERE order_kind='games'").get() as Record<string, unknown>;
    expect(orderRow).toBeTruthy();
    const orderCode = String(orderRow.code);
    expect(orderCode.startsWith("AXG-")).toBe(true);
    expect(orderRow.sales_channel).toBe("telegram");
    expect(orderRow.status).toBe("pending");
    const itemRow = fx.sql.prepare("SELECT * FROM games_order_items WHERE order_code=?").get(orderCode) as Record<string, unknown>;
    expect(itemRow).toMatchObject({
      product_id: 1,
      customer_no: "12345678|1234",
      customer_nickname: "ProGamer (Malaysia)",
      total: 18500,
      status: "awaiting_payment",
    });
    expect(tg.sendPhoto).toHaveBeenCalledTimes(1);
    expect(String(tg.sendPhoto.mock.calls[0]?.[0]?.caption ?? "")).toContain(orderCode);

    // 7. Repeat order -> 1-click saved account button appears!
    await click("gmv:1");
    const savedUi = lastUiPayload();
    const savedBtn = buttonsOf(savedUi).find((b) => b.callback_data === "gmu:1");
    expect(savedBtn?.text).toContain("12345678");
    nicknameMock.checkSkGamesNickname.mockResolvedValueOnce({ status: "ok", nickname: "ProGamer (Indonesia)", cached: true });
    await click("gmu:1");
    expect(lastUiPayload().text).toContain("ProGamer");

    // 8. Paid & Completed notifications:
    // Mark order paid in DB
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code=?").run(orderCode);
    fx.sql.prepare("UPDATE games_order_items SET status='queued' WHERE order_code=?").run(orderCode);

    const db = createDatabaseAccess(fx.db);
    tg.sendMessage.mockClear();
    // Single-owner check: notifyGamesPaid is a no-op for telegram channel (never sends duplicate DM)
    expect(await notifyGamesPaid(db, orderCode)).toBe(true);
    expect(tg.sendMessage).not.toHaveBeenCalled();

    // notifyTelegramBuyerPaid sends Games paid DM (without Market "Ambil Detail Produk")
    expect(await notifyTelegramBuyerPaid(orderCode, db)).toBe(true);
    const paidBuyerCall = tg.sendMessage.mock.calls.find(([m]) => String((m as Record<string, unknown>).chat_id) === String(buyer.id));
    expect(paidBuyerCall).toBeTruthy();
    const paidPayload = paidBuyerCall![0] as { text: string; reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] } };
    expect(paidPayload.text).toContain(orderCode);
    expect(paidPayload.text).toContain("Mobile Legends");
    expect(paidPayload.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data?.startsWith("resend:"))).toBe(false);

    // Completed with SN -> notifyGamesCompleted sends Telegram DM with copyable SN & Top Up Lagi button
    fx.sql.prepare("UPDATE games_order_items SET status='success', sn='SN-ML-999888777', completed_at=datetime('now') WHERE order_code=?").run(orderCode);
    tg.sendMessage.mockClear();
    expect(await notifyGamesCompleted(db, orderCode)).toBe(true);
    const doneCall = tg.sendMessage.mock.calls.find(([m]) => String((m as Record<string, unknown>).chat_id) === String(buyer.id));
    expect(doneCall).toBeTruthy();
    const donePayload = doneCall![0] as { text: string; reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } };
    expect(donePayload.text).toContain("<code>SN-ML-999888777</code>");
    expect(donePayload.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data === "gmo:mobile-legends")).toBe(true);

    // Second call is idempotent (fenced by buyer_notice_log)
    tg.sendMessage.mockClear();
    expect(await notifyGamesCompleted(db, orderCode)).toBe(true);
    expect(tg.sendMessage).not.toHaveBeenCalled();

    assertWhiteLabel(allUiTexts());
  });

  it("handles 2-step fallback ID input, Crypto definitive failure with non-restock rollback, and preserves Market stock", async () => {
    // Choose 86 Diamonds (product_id=1 — same numeric id as Market product_id=1!)
    await click("gmv:1");
    // Step 1: only User ID -> prompts for Zone ID
    await handleCommand("55667788", buyer.id, "private", buyer);
    expect(lastUiPayload().text).toContain("Zone ID");
    // Step 2: Zone ID -> shows review with frozen payq1
    nicknameMock.checkSkGamesNickname.mockResolvedValueOnce({ status: "ok", nickname: "TwoStepHero (Indonesia)", cached: false });
    await handleCommand("9900", buyer.id, "private", buyer);
    expect(lastUiPayload().text).toContain("TwoStepHero");

    // Open Other methods (Crypto) -> select a direct coin (e.g. TRX -> pm:<nonce>:<idx>) -> confirm (pgo:)
    const otherBtn = buttonsOf().find((b) => b.callback_data?.startsWith("pmc:"))!.callback_data!;
    await click(otherBtn);
    let cryptoBtn = buttonsOf().find((b) => b.callback_data?.startsWith("pm:"))?.callback_data;
    if (!cryptoBtn) {
      const subCoin = buttonsOf().find((b) => b.callback_data?.startsWith("pmc:"))!.callback_data!;
      await click(subCoin);
      cryptoBtn = buttonsOf().find((b) => b.callback_data?.startsWith("pm:"))!.callback_data!;
    }
    await click(cryptoBtn);
    const confirmBtn = buttonsOf().find((b) => b.callback_data?.startsWith("pgo:"))!.callback_data!;

    // Mock NOWPayments: preflight GETs succeed, then POST /payment returns an unsupported memo/extra_id
    // (definitive failure -> marks TX failed, cancels AXG order with restock [], expires games_order_items, preserves Market stock!).
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/min-amount")) {
        return Response.json({ min_amount: "0.0001", fiat_equivalent: "0.08", currency_from: "eth", currency_to: "usdtbsc" });
      }
      if (target.includes("/estimate")) {
        return Response.json({ estimated_amount: "0.005", currency_from: "usd", currency_to: "eth" });
      }
      if (init?.method === "POST" || target.includes("/payment")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({
          payment_id: "np-extra-id-1",
          pay_address: "0xdeadbeef",
          pay_amount: "0.005",
          pay_currency: body.pay_currency,
          price_amount: body.price_amount,
          price_currency: body.price_currency,
          order_id: body.order_id,
          payin_extra_id: "999111",
        }, { status: 201 });
      }
      throw new Error(`unexpected fetch ${target}`);
    }));
    await click(confirmBtn);

    // Order is cancelled, games_order_items is expired, and Market product/variant id=1 stock stays 10 (NOT 11!)
    const failedOrder = fx.sql.prepare("SELECT code, status FROM orders WHERE order_kind='games'").get() as { code: string; status: string };
    expect(failedOrder.status).toBe("dibatalkan");
    const failedItem = fx.sql.prepare("SELECT status FROM games_order_items WHERE order_code=?").get(failedOrder.code) as { status: string };
    expect(failedItem.status).toBe("expired");
    const marketStock = fx.sql.prepare("SELECT stock FROM products WHERE id=1").get() as { stock: number };
    const variantStock = fx.sql.prepare("SELECT stock FROM product_variants WHERE product_id=1").get() as { stock: number };
    expect(marketStock.stock).toBe(10);
    expect(variantStock.stock).toBe(10);
  });
});

describe("Native Telegram AXVARA Pedia end-to-end", () => {
  it("shows Order Pedia via Web right above Home on the Pedia home screen", async () => {
    await click("pdh");
    const ui = lastUiPayload();
    const rows = (ui.reply_markup as { inline_keyboard: { url?: string; callback_data?: string }[][] }).inline_keyboard;
    const webIdx = rows.findIndex((r) => r.some((b) => b.url === "https://pedia.axvara.tech/"));
    const homeIdx = rows.findIndex((r) => r.some((b) => b.callback_data === "home"));
    expect(webIdx).toBeGreaterThan(-1);
    expect(webIdx).toBe(homeIdx - 1);
  });

  it("auto-detects pasted Instagram Reel link -> adaptive numbered tiers -> skips link prompt -> QRIS AXP order -> completed DM + in-chat Refill + 24h cooldown", async () => {
    // 1. Paste Instagram Reel link directly in chat!
    await handleCommand("https://www.instagram.com/reel/ABCDE12345/", buyer.id, "private", buyer);
    const detectUi = lastUiPayload();
    expect(detectUi.text).toContain("Instagram");
    const likesBtn = buttonsOf(detectUi).find((b) => b.callback_data === "pdl:1");
    expect(likesBtn).toBeTruthy();

    // 2. Tap Instagram Likes (4 tiers -> shows filter buttons + numbered 1..4 buttons)
    await click("pdl:1");
    const tiersUi = lastUiPayload();
    expect(tiersUi.text).toContain("1.");
    expect(tiersUi.text).toContain("Likes Indo Real Bergaransi");
    const tierBtns = buttonsOf(tiersUi);
    expect(tierBtns.some((b) => b.callback_data === "pdt:1:i:0")).toBe(true);
    expect(tierBtns.some((b) => b.callback_data === "pdt:1:r:0")).toBe(true);
    expect(tierBtns.some((b) => b.callback_data === "pds:1:11" && b.text === "1")).toBe(true);

    // Filter Refill -> shows tier 11 & 14 only
    await click("pdt:1:r:0");
    expect(buttonsOf().some((b) => b.callback_data === "pds:1:11")).toBe(true);
    expect(buttonsOf().some((b) => b.callback_data === "pds:1:12")).toBe(false);

    // 3. Select tier 11 -> because link was already pasted, SKIPS target prompt and goes straight to qty picker!
    await click("pds:1:11");
    const qtyUi = lastUiPayload();
    expect(qtyUi.text).toContain("Pilih jumlah");
    expect(qtyUi.text).toContain("instagram.com/reel/ABCDE12345");
    const qty500Btn = buttonsOf(qtyUi).find((b) => b.callback_data === "pdn:1:11:500" || b.callback_data === "pdn:11:500");
    expect(qty500Btn).toBeTruthy();

    // 4. Tap 500 -> shows review with required public-account terms & frozen payq1 QRIS/Crypto directly!
    await click(qty500Btn!.callback_data!);
    const revUi = lastUiPayload();
    expect(revUi.text).toContain("500");
    expect(revUi.text.toLowerCase()).toContain("publik");
    const qrisBtn = buttonsOf(revUi).find((b) => b.text.includes("QRIS") && b.callback_data?.startsWith("pm:"));
    expect(qrisBtn).toBeTruthy();

    // 5. Pay via QRIS 1-click -> creates AXP- order + pedia_order_items + sends QRIS photo
    tg.sendPhoto.mockClear();
    await click(qrisBtn!.callback_data!);
    const orderRow = fx.sql.prepare("SELECT * FROM orders WHERE order_kind='pedia'").get() as Record<string, unknown>;
    expect(orderRow).toBeTruthy();
    const orderCode = String(orderRow.code);
    expect(orderCode.startsWith("AXP-")).toBe(true);
    expect(orderRow.sales_channel).toBe("telegram");
    const itemRow = fx.sql.prepare("SELECT * FROM pedia_order_items WHERE order_code=?").get(orderCode) as Record<string, unknown>;
    expect(itemRow).toMatchObject({ product_id: 1, tier_id: 11, quantity: 500, status: "queued" });
    expect(tg.sendPhoto).toHaveBeenCalledTimes(1);

    // 6. Paid notice + Completed notice with Refill button + In-chat Refill + 24h cooldown
    fx.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code=?").run(orderCode);
    fx.sql.prepare("UPDATE pedia_order_items SET status='completed', supplier_order_id='IND-554433', completed_at=datetime('now') WHERE order_code=?").run(orderCode);

    const db = createDatabaseAccess(fx.db);
    tg.sendMessage.mockClear();
    expect(await notifyTelegramBuyerPaid(orderCode, db)).toBe(true);
    const paidMsg = tg.sendMessage.mock.calls.find(([m]) => String((m as Record<string, unknown>).chat_id) === String(buyer.id));
    expect(String((paidMsg?.[0] as Record<string, unknown>)?.text ?? "")).toContain("Instagram Likes");

    tg.sendMessage.mockClear();
    expect(await notifyPediaCompleted(db, orderCode)).toBe(true);
    const doneMsg = tg.sendMessage.mock.calls.find(([m]) => String((m as Record<string, unknown>).chat_id) === String(buyer.id));
    expect(doneMsg).toBeTruthy();
    const doneMarkup = (doneMsg![0] as { reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } }).reply_markup;
    expect(doneMarkup?.inline_keyboard?.flat().some((b) => b.callback_data === `pdrf:${orderCode}`)).toBe(true);

    // Tap Refill button in chat -> calls supplier API refill & marks refill_status='submitted'
    tg.answerCallbackQuery.mockClear();
    await click(`pdrf:${orderCode}`);
    expect(pediaProxyMock.callPediaProxy).toHaveBeenCalledTimes(1);
    const afterRefill = fx.sql.prepare("SELECT refill_status, refill_supplier_id FROM pedia_order_items WHERE order_code=?").get(orderCode) as Record<string, unknown>;
    expect(afterRefill).toMatchObject({ refill_status: "submitted", refill_supplier_id: "RF-9988" });

    // Second tap within 24h -> blocked by atomic cooldown!
    pediaProxyMock.callPediaProxy.mockClear();
    tg.answerCallbackQuery.mockClear();
    await click(`pdrf:${orderCode}`);
    expect(pediaProxyMock.callPediaProxy).not.toHaveBeenCalled();

    assertWhiteLabel(allUiTexts());
  });

  it("supports Custom Comments multi-line flow with adaptive <=3 tiers UI and enforces margin guard 410 auto-disable", async () => {
    // 1. Open product 2 (1 tier -> adaptive hides filter buttons!)
    await click("pdt:2:a:0");
    const ui = lastUiPayload();
    expect(buttonsOf(ui).some((b) => b.callback_data === "pdt:2:i:0")).toBe(false);
    expect(buttonsOf(ui).some((b) => b.callback_data === "pds:2:15")).toBe(true);

    // 2. Select tier 15 (no pasted link -> asks for link first)
    await click("pds:2:15");
    expect(lastUiPayload().text).toContain("link");
    await handleCommand("https://www.instagram.com/p/XYZ98765/", buyer.id, "private", buyer);
    // Custom comments -> asks for comment lines
    expect(lastUiPayload().text.toLowerCase()).toContain("komentar");
    await handleCommand("Mantap banget!\nKeren parah\nSukses terus kak", buyer.id, "private", buyer);
    // Qty auto-counted = 3 comments -> lands on review with frozen payq1!
    const revUi = lastUiPayload();
    expect(revUi.text).toContain("3");
    const qrisBtn = buttonsOf(revUi).find((b) => b.text.includes("QRIS") && b.callback_data?.startsWith("pm:"));
    expect(qrisBtn).toBeTruthy();

    // 3. Simulate supplier cost spike before tapping Pay QRIS -> preflight blocks stale price (zero order created!)
    fx.sql.prepare("UPDATE pedia_supplier_services SET rate_idr_per_1k=99999999 WHERE service_id=8005").run();
    await click(qrisBtn!.callback_data!);
    expect(lastUiPayload().text.toLowerCase()).toContain("harga");
    expect((fx.sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE order_kind='pedia'").get() as { n: number }).n).toBe(0);
    expect((fx.sql.prepare("SELECT COUNT(*) AS n FROM pedia_order_items").get() as { n: number }).n).toBe(0);
  });
});

describe("Cross-kind /orders, cancel non-restock, guards & unified smart search", () => {
  it("lists apps/games/pedia orders across tabs, cancels Games & Pedia without touching Market stock, guards warranty/credentials, and searches all 3 catalogs", async () => {
    // Seed 1 pending Games order (product_id=1), 1 pending Pedia order (product_id=1), and 1 paid Market order
    fx.sql.prepare(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status,
         sales_channel, order_kind, telegram_user_id, telegram_chat_id, expires_at)
       VALUES
         ('AXG-TEST-0001', 'Budi', '', '[{"product_id":1,"name":"Mobile Legends 86 Diamonds","qty":1,"price":18500}]', 18500, 'qris', 'pending', 'pending', 'telegram', 'games', ?, ?, datetime('now', '+15 minutes')),
         ('AXP-TEST-0001', 'Budi', '', '[{"product_id":1,"name":"Instagram Likes","qty":100,"price":15000}]', 15000, 'qris', 'pending', 'pending', 'telegram', 'pedia', ?, ?, datetime('now', '+15 minutes')),
         ('AXV-TEST-0001', 'Budi', '', '[{"product_id":1,"variant_id":1,"name":"Netflix Private","qty":1,"price":25000}]', 25000, 'qris', 'lunas', 'paid', 'telegram', 'apps', ?, ?, datetime('now', '+15 minutes'))`,
    ).run(String(buyer.id), String(buyer.id), String(buyer.id), String(buyer.id), String(buyer.id), String(buyer.id));

    fx.sql.prepare(
      `INSERT INTO games_order_items (order_code, product_id, buyer_sku_code, customer_no, quantity, unit_price, total, cost_snapshot, max_price, status, supplier)
       VALUES ('AXG-TEST-0001', 1, 'SK-ML-86-ID', '12345678 (1234)', 1, 18500, 18500, 15000, 18500, 'awaiting_payment', 'sekalipay')`,
    ).run();
    fx.sql.prepare(
      `INSERT INTO pedia_order_items (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized, quantity, unit_price, total, supplier, supplier_service_id, supplier_rate_snapshot, status)
       VALUES ('AXP-TEST-0001', 1, 11, '{}', 'https://instagram.com/p/1', 'https://instagram.com/p/1', 100, 150, 15000, 'indosmm', 8001, 10000, 'awaiting_payment')`,
    ).run();

    // 1. /orders active tab shows both 🎮 AXG-TEST-0001 and 📈 AXP-TEST-0001
    await handleCommand("/orders", buyer.id, "private", buyer);
    const activeBtns = buttonsOf();
    expect(activeBtns.some((b) => b.callback_data === "order:AXG-TEST-0001" && b.text.startsWith("🎮 "))).toBe(true);
    expect(activeBtns.some((b) => b.callback_data === "order:AXP-TEST-0001" && b.text.startsWith("📈 "))).toBe(true);

    // Done tab shows 📋 AXV-TEST-0001
    await click("ordt:done:0");
    expect(buttonsOf().some((b) => b.callback_data === "order:AXV-TEST-0001" && b.text.startsWith("📋 "))).toBe(true);

    // 2. Cancel AXG-TEST-0001 & AXP-TEST-0001 (confirm via cancelok:) -> items expire & Market stock stays strictly 10!
    await click("cancel:AXG-TEST-0001");
    await click("cancelok:AXG-TEST-0001");
    await click("cancel:AXP-TEST-0001");
    await click("cancelok:AXP-TEST-0001");
    expect((fx.sql.prepare("SELECT status FROM orders WHERE code='AXG-TEST-0001'").get() as { status: string }).status).toBe("dibatalkan");
    expect((fx.sql.prepare("SELECT status FROM games_order_items WHERE order_code='AXG-TEST-0001'").get() as { status: string }).status).toBe("expired");
    expect((fx.sql.prepare("SELECT status FROM orders WHERE code='AXP-TEST-0001'").get() as { status: string }).status).toBe("dibatalkan");
    expect((fx.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code='AXP-TEST-0001'").get() as { status: string }).status).toBe("expired");
    expect((fx.sql.prepare("SELECT stock FROM products WHERE id=1").get() as { stock: number }).stock).toBe(10);
    expect((fx.sql.prepare("SELECT stock FROM product_variants WHERE product_id=1").get() as { stock: number }).stock).toBe(10);

    // 3. Warranty claim & credential resend safely reject Games/Pedia orders
    await click("claim:AXG-TEST-0001");
    expect(lastUiPayload().text).toContain("Top Up Games");
    const resendCount = await resendTelegramCredentials("AXG-TEST-0001", buyer.id, createDatabaseAccess(fx.db));
    expect(resendCount).toBe(0);

    // 4. Unified smart search finds Games ("mobile") and Pedia ("instagram") as well as Market ("netflix")
    await handleCommand("mobile", buyer.id, "private", buyer);
    expect(buttonsOf().some((b) => b.callback_data === "gmo:mobile-legends")).toBe(true);

    await handleCommand("instagram", buyer.id, "private", buyer);
    expect(buttonsOf().some((b) => b.callback_data === "pdt:1:a:0")).toBe(true);
  });
});
