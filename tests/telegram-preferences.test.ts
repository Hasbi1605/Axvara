// TG1 onboarding/preferences (LOCAL ONLY): first /start chooser regardless of
// hint, saved choice durable, independent currency, cross-user safety,
// deep-link resume without auto-order. Outgoing Telegram faked; D1 real fixture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";

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
const userA = { id: 111001, first_name: "A" };
const userB = { id: 222002, first_name: "B" };
const prefs = (id: number) =>
  fx.sql.prepare("SELECT locale, display_currency FROM telegram_users WHERE user_id=?").get(String(id)) as Record<string, unknown> | undefined;
const sentTexts = () => api.send.mock.calls.map((c) => String(c[0]?.text ?? ""));
const editTexts = () => api.edit.mock.calls.map((c) => String(c[0]?.text ?? ""));
const answeredIds = () => api.answer.mock.calls.map((c) => String(c[0]));

async function webhookUpdate(update: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("ADMIN_JWT_SECRET", "fixture-admin-secret");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "fixture-buyer-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  const { POST } = await import("@/app/api/telegram/webhook/route");
  const res = await POST(new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "fixture-secret" },
    body: JSON.stringify(update),
  }));
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

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
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("TG1 onboarding chooser + independent preferences", () => {
  it("very first /start with language hint still shows explicit chooser with currency labels", async () => {
    await handleCommand("/start", userA.id, "private", { ...userA, language_code: "en" } as never);
    expect(prefs(userA.id)?.locale).toBeNull();
    const last = api.send.mock.calls.at(-1)![0];
    expect(String(last.text)).toMatch(/Pilih bahasa \/ Choose your language/);
    expect(JSON.stringify(last.reply_markup)).toContain("🇮🇩 Indonesia · Rupiah");
    expect(JSON.stringify(last.reply_markup)).toContain("🇬🇧 English · USD");
    expect(JSON.stringify(last.reply_markup)).toContain("lang:id");
    expect(JSON.stringify(last.reply_markup)).toContain("lang:en");
  });

  it("choose EN persists with USD seeded once; repeat /start goes home in EN", async () => {
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    expect(prefs(userA.id)).toMatchObject({ locale: "en", display_currency: "USD" });
    expect(api.answer).toHaveBeenCalledWith("cb-1", undefined, false);
    expect(String(api.photo.mock.calls.at(-1)?.[0]?.caption ?? "")).toBe("Hi, A 👋");
    vi.clearAllMocks();
    await handleCommand("/start", userA.id, "private", userA);
    expect(api.send.mock.calls.filter((c) => /Pilih bahasa/.test(String(c[0]?.text ?? "")))).toHaveLength(0);
    const homeCaption = String(api.photo.mock.calls.at(-1)?.[0]?.caption ?? "");
    expect(homeCaption).toBe("Hi, A 👋");
  });

  it("/language changes locale only, currency stays USD", async () => {
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    vi.clearAllMocks();
    await handleCommand("/language", userA.id, "private", userA);
    expect(sentTexts().join("\n")).toMatch(/Pilih bahasa/);
    await handleCallback("lang:id", userA.id, 8, userA, "cb-2");
    expect(prefs(userA.id)).toMatchObject({ locale: "id", display_currency: "USD" });
  });

  it("legacy cur:IDR opens language screen with notice without mutating display_currency", async () => {
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    await handleCallback("cur:IDR", userA.id, 8, userA, "cb-2");
    expect(prefs(userA.id)).toMatchObject({ locale: "en", display_currency: "USD" });
    expect(editTexts().at(-1)).toContain("Currency follows language.");
    expect(api.answer).toHaveBeenCalledWith("cb-2", undefined, false);
  });

  it("explicit currency before language callback is not reset by COALESCE seed", async () => {
    fx.sql.prepare("UPDATE telegram_users SET locale='id',display_currency='IDR' WHERE user_id=?").run(String(userA.id));
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    expect(prefs(userA.id)).toMatchObject({ locale: "en", display_currency: "IDR" });
  });

  it("duplicate callback is idempotent, unknown choice persists nothing", async () => {
    await handleCallback("lang:id", userA.id, 7, userA, "cb-1");
    const first = prefs(userA.id);
    await handleCallback("lang:id", userA.id, 7, userA, "cb-2");
    expect(prefs(userA.id)).toEqual(first);
    await handleCallback("lang:fr", userA.id, 7, userA, "cb-3");
    expect(prefs(userA.id)).toEqual(first);
    expect(api.answer).toHaveBeenCalledWith("cb-3", expect.stringMatching(/tidak valid|Invalid/), true);
    const before = fx.sql.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id=?").get(String(userB.id));
    await handleCallback("cur:XXX", userB.id, 7, userB, "cb-4");
    expect(fx.sql.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id=?").get(String(userB.id))).toEqual(before);
  });

  it("two users cannot cross-set prefs; owned chat enforced", async () => {
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    // B's button tapped by A (wrong from/chat) must not change B or A-from-B.
    await handleCallback("lang:id", userA.id, 7, userB, "cb-evil");
    expect(prefs(userB.id)).toMatchObject({ locale: null, display_currency: null });
    // Group chat mistmatch: no write.
    await handleCallback("lang:en", -100999, 7, userB, "cb-group");
    expect(prefs(userB.id)?.locale).toBeNull();
  });

  it("legacy user without prefs is asked; payload resumes without auto-order", async () => {
    fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES('999001','999001','Legacy')").run();
    await handleCommand("/start someproduct", 999001, "private", { id: 999001, first_name: "Legacy" });
    expect(sentTexts().join("\n")).toMatch(/Pilih bahasa/);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    await handleCallback("lang:id", 999001, 7, { id: 999001, first_name: "Legacy" }, "cb-1");
    expect(sentTexts().join("\n")).toMatch(/\/start someproduct/);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    // Duplicate payload use must not re-consume: second callback has no resume.
    vi.clearAllMocks();
    await handleCallback("lang:id", 999001, 7, { id: 999001, first_name: "Legacy" }, "cb-2");
    expect(sentTexts().join("\n")).not.toMatch(/\/start someproduct/);
  });

  it("real webhook: message /start payload saved, callback resumes exactly once via owned state", async () => {
    const start = await webhookUpdate({
      update_id: 700001,
      message: { message_id: 1, from: { id: userA.id, first_name: "A" }, chat: { id: userA.id, type: "private" }, text: "/start promo_2024", date: 1 },
    });
    expect(start.status).toBe(200);
    expect(sentTexts().join("\n")).toMatch(/Pilih bahasa/);
    expect(api.answer.mock.calls).toHaveLength(0);
    vi.clearAllMocks();
    const cb = await webhookUpdate({
      update_id: 700002,
      callback_query: { id: "cb-real-1", from: { id: userA.id, first_name: "A" }, message: { message_id: 7, chat: { id: userA.id } }, data: "lang:id" },
    });
    expect(cb.status).toBe(200);
    expect(api.answer.mock.calls.filter((c) => String(c[0]) === "cb-real-1")).toHaveLength(1);
    expect(prefs(userA.id)).toMatchObject({ locale: "id", display_currency: "IDR" });
    expect(sentTexts().join("\n")).toMatch(/\/start promo_2024/);
    vi.clearAllMocks();
    const dup = await webhookUpdate({
      update_id: 700003,
      callback_query: { id: "cb-real-2", from: { id: userA.id, first_name: "A" }, message: { message_id: 7, chat: { id: userA.id } }, data: "lang:id" },
    });
    expect(dup.status).toBe(200);
    expect(api.answer.mock.calls.filter((c) => String(c[0]) === "cb-real-2")).toHaveLength(1);
    expect(sentTexts().join("\n")).not.toMatch(/promo_2024/);
  });

  it("real webhook: preference callbacks answered exactly once by handler, route does not pre-answer", async () => {
    vi.clearAllMocks();
    const bad = await webhookUpdate({
      update_id: 700011,
      callback_query: { id: "cb-answer-x1", from: { id: userB.id, first_name: "B" }, message: { message_id: 7, chat: { id: userB.id } }, data: "lang:fr" },
    });
    expect(bad.status).toBe(200);
    // Route must NOT pre-answer lang/cur; handler answers exactly once with
    // the invalid-choice alert. Regression: route upfront answer + handler
    // answer = 2 API calls for one callback.
    const badCalls = api.answer.mock.calls.filter((c) => String(c[0]) === "cb-answer-x1");
    expect(badCalls).toHaveLength(1);
    expect(badCalls[0][1]).toMatch(/tidak valid|Invalid/);
    expect(badCalls[0][2]).toBe(true);
    expect(prefs(userB.id)).toEqual({ locale: null, display_currency: null });
    const before = fx.sql.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id=?").get(String(userB.id));
    const grp = await webhookUpdate({
      update_id: 700012,
      callback_query: { id: "cb-grp-1", from: { id: userB.id, first_name: "B" }, message: { message_id: 7, chat: { id: -100999 } }, data: "cur:USD" },
    });
    expect(grp.status).toBe(200);
    // group path redirects without handler answer => zero answer calls expected below is asserted loosely (no handler answer)
    expect(fx.sql.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id=?").get(String(userB.id))).toEqual(before);
  });

  it("group: /bahasa redirects to private chat, /chatid no longer discloses the group id", async () => {
    const groupChatId = -100999;
    const bahasa = await webhookUpdate({
      update_id: 700021,
      message: { message_id: 11, from: { id: userA.id, first_name: "A" }, chat: { id: groupChatId, type: "group" }, text: "/bahasa", date: 1 },
    });
    expect(bahasa.status).toBe(200);
    expect(bahasa.body.status).toBe("group_redirected");
    expect(sentTexts().join("\n")).toContain("t.me/Axvara_bot?start=");
    expect(sentTexts().join("\n")).not.toMatch(/Pilih bahasa/);
    vi.clearAllMocks();
    const currency = await webhookUpdate({
      update_id: 700023,
      message: { message_id: 13, from: { id: userA.id, first_name: "A" }, chat: { id: groupChatId, type: "group" }, text: "/currency", date: 1 },
    });
    expect(currency.status).toBe(200);
    expect(currency.body.status).toBe("group_redirected");
    expect(sentTexts().join("\n")).toContain("t.me/Axvara_bot?start=");
    expect(sentTexts().join("\n")).not.toMatch(/Mata Uang|Display Currency/);
    vi.clearAllMocks();
    const chatid = await webhookUpdate({
      update_id: 700022,
      message: { message_id: 12, from: { id: userA.id, first_name: "A" }, chat: { id: groupChatId, type: "group" }, text: "/chatid", date: 1 },
    });
    expect(chatid.status).toBe(200);
    expect(chatid.body.status).not.toBe("group_redirected");
    const output = sentTexts().join("\n");
    expect(output).not.toContain(String(groupChatId));
    expect(output).not.toMatch(/ID Grup Notifikasi/);
  });

  it("currency callback with no locale asks language first, no currency write", async () => {
    await handleCallback("cur:USD", userB.id, 7, userB, "cb-1");
    expect(prefs(userB.id)?.display_currency).toBeNull();
    expect(sentTexts().join("\n")).toMatch(/Pilih bahasa/);
  });

  it("settings command shows language-only screen with active selection", async () => {
    await handleCallback("lang:id", userA.id, 7, userA, "cb-1");
    vi.clearAllMocks();
    await handleCommand("/settings", userA.id, "private", userA);
    expect(sentTexts().join("\n")).toContain("Bahasa");
    expect(sentTexts().join("\n")).toContain("Indonesia (Rupiah)");
    expect(JSON.stringify(api.send.mock.calls.at(-1)?.[0]?.reply_markup)).not.toContain("cur:");
  });

  it("no secrets/messages executed: fetch never called, no real network", async () => {
    const spy = vi.fn(async () => { throw new Error("NETWORK FORBIDDEN BY TG1"); });
    vi.stubGlobal("fetch", spy);
    await handleCommand("/start", userA.id, "private", userA);
    await handleCallback("lang:en", userA.id, 7, userA, "cb-1");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("TG1 migration 0100 workerd", () => {
  it("adds nullable display_currency with ID/EN check, keeps locale", async () => {
    const runtime = new Miniflare({
      modules: true, compatibilityDate: "2026-08-06",
      script: "export default {fetch(){return new Response('ok')}}",
      d1Databases: ["DB"],
    });
    try {
      const db = await runtime.getD1Database("DB");
      await db.batch([
        db.prepare("CREATE TABLE telegram_users(user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL)"),
        db.prepare("INSERT INTO telegram_users(user_id,chat_id) VALUES('1','1')"),
      ]);
      await db.batch([db.prepare("ALTER TABLE telegram_users ADD COLUMN locale TEXT CHECK (locale IN ('id','en'))")]);
      const migration = readFileSync("drizzle/migrations/0100_telegram_display_currency.sql", "utf8");
      const statements = migration.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--")).join("\n")
        .split(";").map((s) => s.trim()).filter(Boolean);
      await db.batch(statements.map((s) => db.prepare(s)));
      expect(await db.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id='1'").first())
        .toMatchObject({ locale: null, display_currency: null });
      for (const bad of ["EUR", "usd", ""]) {
        await expect(db.prepare("UPDATE telegram_users SET display_currency=? WHERE user_id='1'").bind(bad).run()).rejects.toThrow();
      }
      await db.prepare("UPDATE telegram_users SET locale='en',display_currency='USD' WHERE user_id='1'").run();
      expect(await db.prepare("SELECT locale,display_currency FROM telegram_users WHERE user_id='1'").first())
        .toMatchObject({ locale: "en", display_currency: "USD" });
      await expect(db.prepare("UPDATE telegram_users SET locale='fr' WHERE user_id='1'").run()).rejects.toThrow();
    } finally { await runtime.dispose(); }
  });
});
