// W-A verification: latency (D1 + Telegram call reduction on setQty, waitUntil,
// isolate ensure debounce, file_id photo cache), single active screen transitions,
// 3x2 persistent menu routing, button format/colors, qty presets, typo search,
// and CONTRACT.md extras/photo/deep-link wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import type { EditMessageMediaParams, SendMessageParams, SendPhotoParams } from "@/lib/telegram/types";

const tg = vi.hoisted(() => ({
  sendMessage: vi.fn(async (_p?: SendMessageParams) => ({ ok: true, result: { message_id: 101 } })),
  sendPhoto: vi.fn(async (_p?: SendPhotoParams) => ({
    ok: true,
    result: { message_id: 102, photo: [{ file_id: "AgAC-mock-file-id-1", width: 1280, height: 853 }] },
  })),
  editMessageText: vi.fn(async (_p?: Record<string, unknown>) => ({ ok: true, result: { message_id: 101 } })),
  editMessageMedia: vi.fn(async (_p?: EditMessageMediaParams) => ({
    ok: true,
    result: { message_id: 102, photo: [{ file_id: "AgAC-mock-edited-id", width: 1280, height: 853 }] },
  })),
  deleteMessage: vi.fn(async (_chatId?: number | string, _msgId?: number) => ({ ok: true })),
  safeEditOrSend: vi.fn(async (params: { message_id?: number; text: string }) => {
    if (!params.message_id) return tg.sendMessage();
    return tg.editMessageText();
  }),
  answerCallbackQuery: vi.fn(async (_id?: string, _text?: string, _alert?: boolean) => ({ ok: true })),
  sendChatAction: vi.fn(async (_chatId?: number | string, _action?: string) => ({ ok: true })),
  withLoadingIndicator: vi.fn(async (_c: number, _l: string, work: (b: () => Promise<void>) => Promise<void>) => work(async () => {})),
  showLoadingBar: vi.fn(async () => {}),
}));

vi.mock("@/lib/telegram/api", () => tg);

import { POST } from "@/app/api/telegram/webhook/route";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleShowProduct } from "@/lib/telegram/handlers/catalog";
import { replaceWithPhoto, replaceWithText, sendCachedPhoto } from "@/lib/telegram/handlers/shared";
import { scoreTelegramProduct, searchTelegramCatalog, type TelegramCatalogProduct } from "@/lib/telegram/catalog-snapshot";
import {
  buttonPrice, cartKeyboard, homeKeyboard, mainReplyMenu,
  qrisInvoiceKeyboard, qtyKeyboard, searchNoResultsKeyboard, variantsKeyboard,
} from "@/lib/telegram/keyboards";
import { paymentMethodOfferDetails } from "@/lib/telegram/messages/purchase";
import { helpMessage } from "@/lib/telegram/messages/help";

let fx: ReturnType<typeof createD1Fixture>;
const buyer = { id: 881001, first_name: "Tester" };
const CF_CTX_SYM = Symbol.for("__cloudflare-request-context__");

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "secret-wa",
    },
    body: JSON.stringify(body),
  });
}

async function flushWaitUntil(tasks: Promise<unknown>[]) {
  await Promise.allSettled(tasks);
}

beforeEach(async () => {
  vi.clearAllMocks();
  fx = createD1Fixture();
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "secret-wa");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-admin-secret-123456");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret-123456");
  await insertTestProduct(fx.sql, "manual");
  fx.sql.prepare("UPDATE products SET name='Netflix Private', telegram_enabled=1, sold_count=25, image_url='https://axvara.tech/img/nf.jpg' WHERE id=1").run();
  fx.sql.prepare("UPDATE product_variants SET stock=40, price=25000, label='Private 1 Bulan' WHERE product_id=1").run();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name,locale,display_currency) VALUES(?,?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), buyer.first_name, "id", "IDR");
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CF_CTX_SYM];
  fx.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("W-A latency & waitUntil", () => {
  it("reduces D1 statements and awaits only 1 screen edit on setQty callback (measures before/after)", async () => {
    const waitUntilTasks: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[CF_CTX_SYM] = {
      ctx: { waitUntil: (p: Promise<unknown>) => waitUntilTasks.push(p) },
    };

    // First tap: seeds isolate 10-min ensurePrivateRecipient timestamp in background waitUntil.
    await POST(req({
      update_id: 9001,
      callback_query: { id: "cq-warmup", from: buyer, message: { message_id: 50, chat: { id: buyer.id } }, data: "q:1:1:2" },
    }));
    await flushWaitUntil(waitUntilTasks.splice(0));

    // Measured steady-state setQty tap within the same isolate (<10 min ensure debounce, IDR skips FX D1).
    const executedSql: string[] = [];
    const origPrepare = fx.db.prepare.bind(fx.db);
    vi.spyOn(fx.db, "prepare").mockImplementation((sql: string) => {
      executedSql.push(sql);
      return origPrepare(sql);
    });
    tg.answerCallbackQuery.mockClear();
    tg.safeEditOrSend.mockClear();
    tg.editMessageText.mockClear();
    tg.sendMessage.mockClear();

    const res = await POST(req({
      update_id: 9002,
      callback_query: { id: "cq-qty", from: buyer, message: { message_id: 50, chat: { id: buyer.id } }, data: "q:1:1:5" },
    }));
    expect(res.status).toBe(200);
    await flushWaitUntil(waitUntilTasks);

    const totalTgCalls = tg.answerCallbackQuery.mock.calls.length + tg.safeEditOrSend.mock.calls.length + tg.sendMessage.mock.calls.length;
    // Before overhaul: 15 D1 statements & 2 sequential Telegram calls (answerCallbackQuery awaited + safeEditOrSend).
    // After: 7 D1 statements (INSERT ON CONFLICT dedup, user upsert, readTgPrefs, getActiveVariant, merged product query, setPendingAction, markDone) + 1 awaited TG screen edit (answerCallbackQuery in waitUntil).
    expect(executedSql.length).toBeLessThanOrEqual(8);
    expect(executedSql.some((s) => /FROM store_settings.*fx|usd_idr/i.test(s))).toBe(false);
    expect(executedSql.some((s) => /fulfillment_items|wr_order_links|buyer_notice_log/i.test(s))).toBe(false);
    expect(tg.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(tg.safeEditOrSend).toHaveBeenCalledTimes(1);
    expect(totalTgCalls).toBe(2);
    expect(tg.withLoadingIndicator).not.toHaveBeenCalled();
  });

  it("/start always forces ensurePrivateRecipient in waitUntil even within 10-min debounce window", async () => {
    const waitUntilTasks: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[CF_CTX_SYM] = {
      ctx: { waitUntil: (p: Promise<unknown>) => waitUntilTasks.push(p) },
    };
    await POST(req({
      update_id: 9010,
      callback_query: { id: "cq-1", from: buyer, message: { message_id: 1, chat: { id: buyer.id } }, data: "home" },
    }));
    await flushWaitUntil(waitUntilTasks.splice(0));

    // Paid order with missing private chat_id should inherit chat_id once /start forces ensure.
    fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id) VALUES('AXV-20261119-ENSURE1','T','','[]',1000,'qris','lunas','paid','telegram',?,'-100999')")
      .run(String(buyer.id));

    await POST(req({
      update_id: 9011,
      message: { message_id: 2, from: buyer, chat: { id: buyer.id, type: "private" }, text: "/start", date: 1 },
    }));
    expect(waitUntilTasks.length).toBeGreaterThan(0);
    await flushWaitUntil(waitUntilTasks);
    const updated = fx.sql.prepare("SELECT telegram_chat_id FROM orders WHERE code='AXV-20261119-ENSURE1'").get() as { telegram_chat_id: string };
    expect(updated.telegram_chat_id).toBe(String(buyer.id));
  });

  it("caches Telegram file_id in isolate + store_settings, evicts on 400, and never retries URL 4xx", async () => {
    const waitUntilTasks: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[CF_CTX_SYM] = {
      ctx: { waitUntil: (p: Promise<unknown>) => waitUntilTasks.push(p) },
    };
    const url = "https://axvara.tech/banners/tg-welcome.jpg?v=1";

    // 1. Cold send uploads URL and stores file_id.
    await sendCachedPhoto({ chat_id: buyer.id, photo: url, caption: "Hi" });
    await flushWaitUntil(waitUntilTasks.splice(0));
    expect(tg.sendPhoto).toHaveBeenCalledTimes(1);
    expect(tg.sendPhoto.mock.calls[0]?.[0]?.photo).toBe(url);

    const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='tg_photo_file_ids'").get() as { value: string };
    expect(JSON.parse(row.value)[url]).toBe("AgAC-mock-file-id-1");

    // 2. Warm send reuses file_id directly.
    await sendCachedPhoto({ chat_id: buyer.id, photo: url, caption: "Hi2" });
    expect(tg.sendPhoto).toHaveBeenCalledTimes(2);
    expect(tg.sendPhoto.mock.calls[1]?.[0]?.photo).toBe("AgAC-mock-file-id-1");

    // 3. Stale file_id returning 400 evicts and retries ONCE with URL.
    tg.sendPhoto
      .mockResolvedValueOnce({ ok: false, error_code: 400, description: "wrong file identifier" } as never)
      .mockResolvedValueOnce({ ok: true, result: { message_id: 109, photo: [{ file_id: "AgAC-fresh-2" }] } } as never);
    await sendCachedPhoto({ chat_id: buyer.id, photo: url, caption: "Hi3" });
    await flushWaitUntil(waitUntilTasks.splice(0));
    expect(tg.sendPhoto).toHaveBeenCalledTimes(4);
    expect(tg.sendPhoto.mock.calls[3]?.[0]?.photo).toBe(url);

    // 4. Direct URL 404/400 is NEVER retried.
    tg.sendPhoto.mockResolvedValueOnce({ ok: false, error_code: 400, description: "failed to get HTTP URL" } as never);
    const badRes = await sendCachedPhoto({ chat_id: buyer.id, photo: "https://axvara.tech/missing.jpg", caption: "x" });
    expect(badRes.ok).toBe(false);
    expect(tg.sendPhoto).toHaveBeenCalledTimes(5);
  });
});

describe("W-A single active screen & protected messages", () => {
  it("handles text->photo, photo->photo, photo->text and NEVER edits/deletes protected invoice/paid messages", async () => {
    const waitUntilTasks: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[CF_CTX_SYM] = {
      ctx: { waitUntil: (p: Promise<unknown>) => waitUntilTasks.push(p) },
    };

    // text -> photo sends new photo then deletes old message in waitUntil
    await replaceWithPhoto({ chat_id: buyer.id, message_id: 20, photo: "https://axvara.tech/img/nf.jpg", caption: "Card" }, { isPhoto: false });
    await flushWaitUntil(waitUntilTasks.splice(0));
    expect(tg.sendPhoto).toHaveBeenCalledTimes(1);
    expect(tg.deleteMessage).toHaveBeenCalledWith(buyer.id, 20);

    // photo -> photo uses editMessageMedia in place (no delete)
    tg.deleteMessage.mockClear();
    await replaceWithPhoto({ chat_id: buyer.id, message_id: 21, photo: "https://axvara.tech/img/nf2.jpg", caption: "Card2" }, { isPhoto: true });
    expect(tg.editMessageMedia).toHaveBeenCalledTimes(1);
    expect(tg.deleteMessage).not.toHaveBeenCalled();

    // photo -> text sends new text message then deletes old photo in waitUntil
    await replaceWithText({ chat_id: buyer.id, message_id: 22, text: "Catalog" }, { isPhoto: true });
    await flushWaitUntil(waitUntilTasks.splice(0));
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(tg.deleteMessage).toHaveBeenCalledWith(buyer.id, 22);

    // Protected invoice message tapped via callback -> keeps invoice intact (sends new msg, never edits/deletes)
    tg.deleteMessage.mockClear();
    tg.editMessageText.mockClear();
    tg.safeEditOrSend.mockClear();
    tg.sendMessage.mockClear();
    const res = await POST(req({
      update_id: 9020,
      callback_query: {
        id: "cq-protected",
        from: buyer,
        message: {
          message_id: 99,
          chat: { id: buyer.id },
          photo: [{ file_id: "inv-photo" }],
          caption: "⏳ Menunggu pembayaran\nTotal bayar: Rp25.123",
        },
        data: "catalog:0",
      },
    }));
    expect(res.status).toBe(200);
    await flushWaitUntil(waitUntilTasks.splice(0));
    expect(tg.deleteMessage).not.toHaveBeenCalled();
    expect(tg.editMessageText).not.toHaveBeenCalled();
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("W-A UX: persistent 3x2 menu, typo search, qty presets, colors, copy, wiring", () => {
  it("installs 3x2 reply menu on /start banner photo and /batal, routes menu labels before pending state", async () => {
    const idMenu = mainReplyMenu("id");
    expect(idMenu.keyboard).toHaveLength(3);
    expect(idMenu.keyboard.map((r) => r.map((b) => b.text))).toEqual([
      ["🛍 Katalog", "🔎 Cari"],
      ["🛒 Keranjang", "📦 Pesanan"],
      ["🛡 Garansi", "💬 Bantuan"],
    ]);
    expect(idMenu.is_persistent).toBe(false);
    expect(idMenu.resize_keyboard).toBe(true);

    const enMenu = mainReplyMenu("en");
    expect(enMenu.keyboard.map((r) => r.map((b) => b.text))).toEqual([
      ["🛍 Catalog", "🔎 Search"],
      ["🛒 Cart", "📦 Orders"],
      ["🛡 Warranty", "💬 Help"],
    ]);

    await handleCommand("/start", buyer.id, "private", buyer);
    expect(tg.withLoadingIndicator).not.toHaveBeenCalled();
    expect(tg.sendPhoto).toHaveBeenCalledWith(expect.objectContaining({
      photo: expect.stringContaining("/banners/tg-welcome.jpg"),
      reply_markup: mainReplyMenu("id"),
    }));
    const welcomeKb = tg.sendMessage.mock.calls.at(-1)?.[0]?.reply_markup as { inline_keyboard: { text: string; style?: string }[][] };
    expect(welcomeKb.inline_keyboard[0][0].text).toContain("🔥 Netflix Private");
    expect(welcomeKb.inline_keyboard[0][0].style).toBe("primary");

    // Menu tap overrides non-creating pending_action
    fx.sql.prepare("UPDATE telegram_users SET pending_action='email_for:1:1:1' WHERE user_id=?").run(String(buyer.id));
    await handleCommand("🛡 Garansi", buyer.id, "private", buyer);
    const pendingRow = fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id)) as { pending_action: string | null };
    expect(pendingRow.pending_action).toBeNull();

    // /batal re-installs mainReplyMenu
    await handleCommand("/batal", buyer.id, "private", buyer);
    expect(tg.sendMessage.mock.calls.at(-1)?.[0]?.reply_markup).toEqual(mainReplyMenu("id"));
  });

  it("scores exact > prefix > substring > typo tolerance (netflik, chatgtp, canfa) across name/aliases", async () => {
    const catalog: TelegramCatalogProduct[] = [
      { id: 1, name: "Netflix Private", name_en: "Netflix Private", category_id: 1, sort_order: 1, sold_count: 30, whatsapp_alias: "nf", aliases: '["netflex"]', price: 25000, stock: 12 },
      { id: 2, name: "ChatGPT Plus", name_en: "ChatGPT Plus", category_id: 1, sort_order: 2, sold_count: 50, whatsapp_alias: "gpt", aliases: null, price: 89000, stock: -1 },
      { id: 3, name: "Canva Pro", name_en: "Canva Pro", category_id: 2, sort_order: 3, sold_count: 20, whatsapp_alias: null, aliases: "canva edu", price: 15000, stock: 5 },
      { id: 4, name: "Netflix Profile", name_en: null, category_id: 1, sort_order: 4, sold_count: 40, whatsapp_alias: null, aliases: null, price: 12000, stock: 8 },
    ];
    expect(scoreTelegramProduct(catalog[0], "netflix private")).toBeGreaterThan(scoreTelegramProduct(catalog[3], "netflix"));
    expect(scoreTelegramProduct(catalog[0], "netflik")).toBeGreaterThan(0);
    expect(searchTelegramCatalog(catalog, "netflik").map((p) => p.name)).toContain("Netflix Private");
    expect(searchTelegramCatalog(catalog, "chatgtp")[0]?.name).toBe("ChatGPT Plus");
    expect(searchTelegramCatalog(catalog, "canfa")[0]?.name).toBe("Canva Pro");

    // Free text search directly without pending state, and /cari with keyword directly
    await handleCommand("netflik", buyer.id, "private", buyer);
    expect(tg.sendMessage.mock.calls.at(-1)?.[0]?.text).toContain("Hasil untuk “netflik”");

    await handleCommand("/cari doesnotexistxyz", buyer.id, "private", buyer);
    expect(tg.sendMessage.mock.calls.at(-1)?.[0]?.reply_markup).toEqual(searchNoResultsKeyboard({ locale: "id" }));

    // /start prd_1 opens product card directly + extras callback/photo routing compile safely
    await handleCommand("/start prd_1", buyer.id, "private", buyer);
    expect(tg.sendPhoto.mock.calls.at(-1)?.[0]?.caption).toContain("Netflix Private");
    await handleCallback("rst:1", buyer.id, 1, buyer);
    await handleShowProduct(buyer.id, 0, 1, buyer);
    expect(helpMessage({ locale: "id" })).toContain("Ketik nama produk untuk mencari.");
  });

  it("renders dot-thousands prices, qty presets, styles, OOS collapse, and QRIS display copy", () => {
    expect(buttonPrice(19500)).toBe("Rp19.500");
    expect(buttonPrice(50000)).toBe("Rp50.000");

    const qk = qtyKeyboard({ productId: 1, variantId: 2, stock: 48, qty: 5, price: 19500, minQty: 1 });
    const presetRow = qk.inline_keyboard[1];
    expect(presetRow.map((b) => [b.text, b.callback_data])).toEqual([
      ["1", "q:1:2:1"],
      ["✅ 5", "noop"],
      ["10", "q:1:2:10"],
    ]); // 50 excluded because stock is 48
    const flatQty = qk.inline_keyboard.flat();
    expect(flatQty.find((b) => b.callback_data?.startsWith("pay:"))?.style).toBe("success");
    expect(flatQty.find((b) => b.callback_data?.startsWith("cadd:"))?.style).toBe("primary");

    const ck = cartKeyboard({ lines: [{ variantId: 1, qty: 1, stock: 5, fulfillmentMode: "manual", label: "Canva" }] });
    const flatCart = ck.inline_keyboard.flat();
    expect(flatCart.find((b) => b.callback_data === "ccheckout")).toMatchObject({ text: "💳 Checkout", style: "success" });
    expect(flatCart.find((b) => b.callback_data === "cclear")?.style).toBe("danger");
    expect(flatCart.find((b) => b.callback_data === "crm:1")?.style).toBe("danger");

    const ik = qrisInvoiceKeyboard("AXV-1");
    expect(ik.inline_keyboard.flat().find((b) => b.callback_data === "refresh:AXV-1")?.style).toBe("primary");
    expect(ik.inline_keyboard.flat().find((b) => b.callback_data === "cancel:AXV-1")?.style).toBe("danger");

    const hk = homeKeyboard("id", [{ productId: 1, name: "Netflix", price: 25000, stock: -1 }]);
    expect(hk.inline_keyboard[0][0]).toMatchObject({ text: "🔥 Netflix · Rp25.000 · stok ∞", style: "primary" });
    expect(hk.inline_keyboard[1][0]?.style).toBe("primary");

    const vk = variantsKeyboard(9, [
      { id: 1, label: "Head", price: 19500, stock: 48 },
      { id: 2, label: "Sol", price: 29500, stock: 0 },
    ]);
    expect(vk.inline_keyboard.flat().some((b) => b.callback_data === "rst:9")).toBe(true);
    expect(vk.inline_keyboard.flat().some((b) => b.callback_data === "soldout")).toBe(false);

    const methodDetails = paymentMethodOfferDetails([{ kind: "qris", label: "QRIS Dinamis" }]);
    expect(methodDetails).toEqual(["• QRIS (tercepat)"]);
  });
});
