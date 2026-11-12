// Display-currency discoverability: /currency + main-menu picker reuse the
// existing IDR/USD preference store. Language stays independent, opening or
// saving the picker never clears pending work, and catalog rendering reads
// the saved currency both ways.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handleShowCatalog } from "@/lib/telegram/handlers/catalog";
import { homeKeyboard } from "@/lib/telegram/keyboards";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn(), photo: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  safeEditOrSend: api.edit,
  sendPhoto: api.photo,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  answerCallbackQuery: api.answer,
  withLoadingIndicator: vi.fn(async (_chat: number, _label: string, work: (b: () => Promise<void>) => Promise<void>) => work(async () => {})),
}));

let fx: ReturnType<typeof createD1Fixture>;
const userA = { id: 551001, first_name: "A" };
const userB = { id: 662002, first_name: "B" };
const row = (id: number) =>
  fx.sql.prepare("SELECT locale, display_currency, pending_action FROM telegram_users WHERE user_id=?").get(String(id)) as Record<string, unknown> | undefined;
const sentTexts = () => api.send.mock.calls.map((c) => String(c[0]?.text ?? ""));
const editedTexts = () => api.edit.mock.calls.map((c) => String(c[0]?.text ?? ""));
const lastMarkup = (calls: typeof api.send.mock.calls | typeof api.edit.mock.calls) =>
  JSON.stringify(calls.at(-1)?.[0]?.reply_markup ?? {});
const orderCount = () => Number(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n ?? 0);

beforeEach(() => {
  vi.clearAllMocks();
  resetCryptoMarketMemo();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  api.answer.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  fx = createD1Fixture();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES(?,?,?)").run(String(userA.id), String(userA.id), "A");
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES(?,?,?)").run(String(userB.id), String(userB.id), "B");
});
afterEach(() => { fx.close(); resetCryptoMarketMemo(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Telegram currency menu", () => {
  it("native menu lists /currency and the main menu offers a localized currency button", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:fixture");
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true, result: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const actual = await vi.importActual<typeof import("@/lib/telegram/api")>("@/lib/telegram/api");
    await actual.setMyCommands();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { commands: { command: string; description: string }[] };
    expect(body.commands.map((c) => c.command)).toContain("currency");
    expect(body.commands.find((c) => c.command === "currency")?.description).toMatch(/Mata uang|Currency/);

    const id = JSON.stringify(homeKeyboard("id"));
    const en = JSON.stringify(homeKeyboard("en"));
    expect(id).toContain("💱 Mata Uang");
    expect(en).toContain("💱 Currency");
    expect(id).toContain('"curmenu"');
    expect(en).toContain('"curmenu"');
    expect(id).toContain("https://axvara.tech");
    expect(id).toContain('"langmenu"');
  });

  it("/currency opens the picker without inventing a default: saved USD vs unset", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency=NULL WHERE user_id=?").run(String(userA.id));
    await handleCommand("/currency", userA.id, "private", userA);
    expect(sentTexts().at(-1)).toMatch(/Not set/);
    expect(sentTexts().at(-1)).not.toMatch(/Current: USD/);
    expect(lastMarkup(api.send.mock.calls)).toContain("cur:IDR");
    expect(lastMarkup(api.send.mock.calls)).toContain("cur:USD");
    expect(lastMarkup(api.send.mock.calls)).toMatch(/Menu Utama|Main Menu/);

    vi.clearAllMocks();
    fx.sql.prepare("UPDATE telegram_users SET display_currency='USD' WHERE user_id=?").run(String(userA.id));
    await handleCommand("/currency", userA.id, "private", userA);
    expect(sentTexts().at(-1)).toMatch(/Current: USD/);
    expect(lastMarkup(api.send.mock.calls)).toContain("✅ $ USD");
  });

  it("curmenu opens the picker with the saved value and preserves pending state + locale", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='IDR', pending_action='search:' WHERE user_id=?").run(String(userA.id));
    await handleCallback("curmenu", userA.id, 7, userA, "cb-cur");
    expect(editedTexts().at(-1)).toMatch(/Saat ini: IDR/);
    expect(lastMarkup(api.edit.mock.calls)).toContain("✅ Rp IDR");
    expect(row(userA.id)).toMatchObject({ locale: "id", display_currency: "IDR", pending_action: "search:" });
    expect(orderCount()).toBe(0);
  });

  it("cur:USD saves, confirms explicitly, re-renders selection, and leaves locale/pending intact", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='IDR', pending_action='qty_for:1:1' WHERE user_id=?").run(String(userA.id));
    await handleCallback("cur:USD", userA.id, 7, userA, "cb-usd");
    expect(row(userA.id)).toMatchObject({ locale: "en", display_currency: "USD", pending_action: "qty_for:1:1" });
    expect(editedTexts().at(-1)).toMatch(/Current: USD/);
    expect(lastMarkup(api.edit.mock.calls)).toContain("✅ $ USD");
    expect(sentTexts().at(-1)).toMatch(/Display currency saved/);
    expect(api.answer).toHaveBeenCalledWith("cb-usd", undefined, false);
    expect(orderCount()).toBe(0);
  });

  it("invalid currency never writes; no-locale picker uses the language gate", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='IDR' WHERE user_id=?").run(String(userA.id));
    const before = row(userA.id);
    await handleCallback("cur:EUR", userA.id, 7, userA, "cb-bad");
    expect(row(userA.id)).toEqual(before);
    expect(api.answer).toHaveBeenCalledWith("cb-bad", expect.stringMatching(/tidak valid|Invalid/), true);

    await handleCallback("curmenu", userB.id, 7, userB, "cb-gate");
    expect(editedTexts().at(-1)).toMatch(/Pilih bahasa/);
    expect(row(userB.id)).toMatchObject({ locale: null, display_currency: null });
  });

  it("currency and language stay independent in both directions", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='USD' WHERE user_id=?").run(String(userA.id));
    await handleCallback("cur:IDR", userA.id, 7, userA, "cb-cur");
    expect(row(userA.id)).toMatchObject({ locale: "en", display_currency: "IDR" });
    await handleCallback("lang:id", userA.id, 7, userA, "cb-lang");
    expect(row(userA.id)).toMatchObject({ locale: "id", display_currency: "IDR" });
    await handleCallback("lang:en", userA.id, 7, userA, "cb-lang2");
    expect(row(userA.id)).toMatchObject({ locale: "en", display_currency: "IDR" });
  });

  it("catalog navigation reads the saved display currency both ways", async () => {
    vi.stubEnv("USD_IDR_RATE", "16000");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
    fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(1,'Alpha','alpha',16000,0,1,1)").run();
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(1,1,'SKU-1','Varian 1',16000,5,'manual',1)").run();
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='USD' WHERE user_id=?").run(String(userA.id));
    resetCryptoMarketMemo();
    await handleShowCatalog(userA.id, userA);
    const usdButtons = (api.send.mock.calls.at(-1)![0].reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text).join(" | ");
    expect(usdButtons).toMatch(/US\$|\$/);

    vi.clearAllMocks();
    fx.sql.prepare("UPDATE telegram_users SET display_currency='IDR' WHERE user_id=?").run(String(userA.id));
    await handleShowCatalog(userA.id, userA);
    const idrButtons = (api.send.mock.calls.at(-1)![0].reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text).join(" | ");
    expect(idrButtons).toContain("Rp");
    expect(idrButtons).not.toMatch(/US\$/);
  });
});
