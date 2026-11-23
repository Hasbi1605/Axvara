// Language menu regression: /bahasa + main-menu language button reuse the
// existing picker/callbacks, /chatid is gone (no group id disclosure), and
// opening the picker never resets a pending session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { homeKeyboard } from "@/lib/telegram/keyboards";

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
const userA = { id: 331001, first_name: "A" };
const userB = { id: 442002, first_name: "B" };
const userRow = (id: number) =>
  fx.sql.prepare("SELECT locale, display_currency, pending_action FROM telegram_users WHERE user_id=?").get(String(id)) as Record<string, unknown> | undefined;
const sentTexts = () => api.send.mock.calls.map((c) => String(c[0]?.text ?? ""));

beforeEach(() => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  api.answer.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  fx = createD1Fixture();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES(?,?,?)").run(String(userA.id), String(userA.id), "A");
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES(?,?,?)").run(String(userB.id), String(userB.id), "B");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Telegram language menu", () => {
  it("native command menu lists /bahasa and no /chatid", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:fixture");
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true, result: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    const actual = await vi.importActual<typeof import("@/lib/telegram/api")>("@/lib/telegram/api");
    await actual.setMyCommands();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { commands: { command: string; description: string }[] };
    const commands = body.commands.map((c) => c.command);
    expect(commands).not.toContain("chatid");
    expect(commands).not.toContain("settings");
    expect(commands).toContain("bahasa");
    expect(body.commands.find((c) => c.command === "bahasa")?.description).toBe("🌐 Bahasa / Language");
  });

  it("main inline menu exposes a localized language button in both locales", () => {
    const id = JSON.stringify(homeKeyboard("id"));
    const en = JSON.stringify(homeKeyboard("en"));
    expect(id).toContain('"settings"');
    expect(id).toContain("🇮🇩 Bahasa");
    expect(en).toContain('"settings"');
    expect(en).toContain("🇬🇧 Language");
  });

  it("/bahasa opens the language-only screen with currency labels for a returning user without changing prefs", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='USD', pending_action='search:' WHERE user_id=?").run(String(userA.id));
    await handleCommand("/bahasa", userA.id, "private", userA);
    const last = api.send.mock.calls.at(-1)![0];
    expect(String(last.text)).toContain("Language");
    expect(JSON.stringify(last.reply_markup)).toContain("lang:id");
    expect(JSON.stringify(last.reply_markup)).toContain("lang:en");
    expect(JSON.stringify(last.reply_markup)).toContain("✅ 🇬🇧 English (USD)");
    expect(JSON.stringify(last.reply_markup)).not.toContain("cur:");
    expect(userRow(userA.id)).toMatchObject({ locale: "en", display_currency: "USD", pending_action: "search:" });
  });

  it("language button callback reopens the picker without resetting a pending session", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='USD', pending_action='search:' WHERE user_id=?").run(String(userA.id));
    await handleCallback("langmenu", userA.id, 7, userA, "cb-lang");
    const edited = api.edit.mock.calls.at(-1)![0];
    expect(String(edited.text)).toMatch(/Pilih bahasa \/ Choose your language/);
    expect(JSON.stringify(edited.reply_markup)).toContain("lang:id");
    expect(userRow(userA.id)).toMatchObject({ locale: "en", display_currency: "USD", pending_action: "search:" });
  });

  it("choosing from the reopened picker switches the existing locale and next menu follows it", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='en', display_currency='USD' WHERE user_id=?").run(String(userA.id));
    await handleCallback("langmenu", userA.id, 7, userA, "cb-lang");
    await handleCallback("lang:id", userA.id, 7, userA, "cb-pick");
    expect(userRow(userA.id)).toMatchObject({ locale: "id", display_currency: "USD" });
    const lastEdit = api.edit.mock.calls.at(-1)![0];
    expect(String(lastEdit.text)).toMatch(/Halo/);
    expect(JSON.stringify(lastEdit.reply_markup)).toContain("🇮🇩 Bahasa");
  });

  it("settings callback opens language-only picker without currency buttons and without clearing pending_action", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='USD', pending_action='search:' WHERE user_id=?").run(String(userA.id));
    await handleCallback("settings", userA.id, 7, userA, "cb-settings");
    const edited = api.edit.mock.calls.at(-1)![0];
    expect(String(edited.text)).toContain("Bahasa");
    const markup = JSON.stringify(edited.reply_markup);
    expect(markup).toContain("lang:id");
    expect(markup).toContain("lang:en");
    expect(markup).toContain("✅ 🇮🇩 Indonesia (Rupiah)");
    expect(markup).toContain("🇬🇧 English (USD)");
    expect(markup).not.toContain("cur:IDR");
    expect(markup).not.toContain("cur:USD");
    expect(userRow(userA.id)).toMatchObject({ locale: "id", display_currency: "USD", pending_action: "search:" });
  });

  it("invalid locale values remain rejected without a write", async () => {
    const before = userRow(userB.id);
    await handleCallback("lang:fr", userB.id, 7, userB, "cb-bad");
    expect(userRow(userB.id)).toEqual(before);
    expect(api.answer).toHaveBeenCalledWith("cb-bad", expect.stringMatching(/tidak valid|Invalid/), true);
  });

  it("/chatid no longer discloses a group id and falls back to ordinary unknown-command behavior", async () => {
    // Route-level group behavior is covered in telegram-preferences.test.ts
    // (real webhook fixture); this exercises the handler directly.
    const groupChatId = -1001234567890;
    await handleCommand("/chatid", groupChatId, "group", { id: userA.id, first_name: "A" });
    const groupOutput = sentTexts().join("\n");
    expect(groupOutput).not.toContain(String(groupChatId));
    expect(groupOutput).not.toMatch(/ID Grup Notifikasi/);
    expect(groupOutput).toMatch(/AXVARA.*Halo, A/);
    vi.clearAllMocks();
    await handleCommand("/chatid", userA.id, "private", userA);
    const privateOutput = sentTexts().join("\n");
    expect(privateOutput).not.toContain(String(userA.id));
    expect(privateOutput).not.toMatch(/ID Grup Notifikasi|@Axvara_bot ke grup/);
  });
});
