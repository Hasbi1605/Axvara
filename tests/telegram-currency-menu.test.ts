// Currency follows language (TG-CURLANG): no currency buttons in any keyboard;
// legacy /currency, curmenu, and cur:* open the language screen with one line
// explaining currency follows language; display currency ignores stored DB column.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handleShowCatalog } from "@/lib/telegram/handlers/catalog";
import {
  homeKeyboard,
  languageChooserKeyboard,
  settingsKeyboard,
  currencyKeyboard,
  mainReplyMenu,
} from "@/lib/telegram/keyboards";
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

describe("Telegram currency follows language", () => {
  it("native menu lists /bahasa and home/reply menus use 🌐 Bahasa / 🌐 Language without currency buttons", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:fixture");
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true, result: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const actual = await vi.importActual<typeof import("@/lib/telegram/api")>("@/lib/telegram/api");
    await actual.setMyCommands();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { commands: { command: string; description: string }[] };
    expect(body.commands.map((c) => c.command)).toContain("bahasa");
    expect(body.commands.map((c) => c.command)).not.toContain("settings");
    expect(body.commands.find((c) => c.command === "bahasa")?.description).toBe("🌐 Bahasa / Language");

    const id = JSON.stringify(homeKeyboard("id"));
    const en = JSON.stringify(homeKeyboard("en"));
    expect(id).toContain("🌐 Bahasa");
    expect(en).toContain("🌐 Language");
    expect(id).toContain('"settings"');
    expect(en).toContain('"settings"');
    expect(id).toContain("https://axvara.tech");

    // No keyboard contains a cur:* currency button.
    for (const kb of [
      homeKeyboard("id"),
      homeKeyboard("en"),
      languageChooserKeyboard(),
      settingsKeyboard("id"),
      settingsKeyboard("en"),
      currencyKeyboard("id", "IDR"),
      currencyKeyboard("en", "USD"),
      mainReplyMenu("id"),
      mainReplyMenu("en"),
    ]) {
      const json = JSON.stringify(kb);
      expect(json).not.toContain("cur:IDR");
      expect(json).not.toContain("cur:USD");
      expect(json).not.toContain("curmenu");
    }
  });

  it("/currency opens the language screen with one line explaining currency follows language", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='IDR' WHERE user_id=?").run(String(userA.id));
    await handleCommand("/currency", userA.id, "private", userA);
    expect(sentTexts().at(-1)).toContain("Currency follows language.");
    expect(lastMarkup(api.send.mock.calls)).toContain("lang:id");
    expect(lastMarkup(api.send.mock.calls)).toContain("lang:en");
    expect(lastMarkup(api.send.mock.calls)).not.toContain("cur:IDR");
    expect(lastMarkup(api.send.mock.calls)).not.toContain("cur:USD");
    expect(lastMarkup(api.send.mock.calls)).toContain("✅ 🇬🇧 English (USD)");

    vi.clearAllMocks();
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='USD' WHERE user_id=?").run(String(userA.id));
    await handleCommand("/currency", userA.id, "private", userA);
    expect(sentTexts().at(-1)).toContain("Mata uang mengikuti bahasa.");
    expect(lastMarkup(api.send.mock.calls)).toContain("✅ 🇮🇩 Indonesia (Rupiah)");
    expect(lastMarkup(api.send.mock.calls)).not.toContain("cur:");
  });

  it("legacy curmenu and cur:* callbacks open language screen without mutating DB or pending_action", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='IDR', pending_action='search:' WHERE user_id=?").run(String(userA.id));
    await handleCallback("curmenu", userA.id, 7, userA, "cb-cur");
    expect(editedTexts().at(-1)).toContain("Mata uang mengikuti bahasa.");
    expect(lastMarkup(api.edit.mock.calls)).toContain("✅ 🇮🇩 Indonesia (Rupiah)");
    expect(lastMarkup(api.edit.mock.calls)).not.toContain("cur:");
    expect(row(userA.id)).toMatchObject({ locale: "id", display_currency: "IDR", pending_action: "search:" });
    expect(orderCount()).toBe(0);

    await handleCallback("cur:USD", userA.id, 7, userA, "cb-usd");
    expect(row(userA.id)).toMatchObject({ locale: "id", display_currency: "IDR", pending_action: "search:" });
    expect(editedTexts().at(-1)).toContain("Mata uang mengikuti bahasa.");
    expect(api.answer).toHaveBeenCalledWith("cb-usd", undefined, false);
    expect(orderCount()).toBe(0);

    // No-locale user still gets language onboarding chooser.
    await handleCallback("curmenu", userB.id, 7, userB, "cb-gate");
    expect(editedTexts().at(-1)).toMatch(/Pilih bahasa/);
    expect(row(userB.id)).toMatchObject({ locale: null, display_currency: null });
  });

  it("catalog navigation derives USD for EN and Rupiah for ID, ignoring stored display_currency", async () => {
    vi.stubEnv("USD_IDR_RATE", "16000");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
    fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(1,'Alpha','alpha',19500,0,1,1)").run();
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(1,1,'SKU-1','Varian 1',19500,5,'manual',1)").run();

    // ID user with stale display_currency='USD' STILL gets Rupiah buttons and skips FX.
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='USD' WHERE user_id=?").run(String(userA.id));
    resetCryptoMarketMemo();
    await handleShowCatalog(userA.id, userA);
    const idButtons = (api.send.mock.calls.at(-1)![0].reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text).join(" | ");
    expect(idButtons).toContain("Rp19.500");
    expect(idButtons).not.toMatch(/\$|USD/);

    // EN user with stale display_currency='IDR' STILL gets "$1.22" buttons (no "USD" suffix).
    vi.clearAllMocks();
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='IDR' WHERE user_id=?").run(String(userA.id));
    await handleShowCatalog(userA.id, userA);
    const enButtons = (api.send.mock.calls.at(-1)![0].reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text).join(" | ");
    expect(enButtons).toContain("$1.22");
    expect(enButtons).not.toMatch(/USD|Rp/);
  });
});
