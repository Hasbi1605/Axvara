import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  TELEGRAM_CHANNEL_LAST_DELIVERY_KEY,
  TELEGRAM_USERBOT_WATCH_KEY,
  USERBOT_WATCH_INTERVAL_MS,
  channelAlertKinds,
  channelAlertText,
  checkUserbotHealth,
  parseChannelLastDelivery,
  recordChannelPromoDelivery,
  resetUserbotWatchMemo,
  watchUserbotHealth,
} from "@/lib/telegram/channel-sender-status";
import { describeLastDelivery, senderStatusBadge } from "@/components/admin/channel-sender-format";
import { createD1Fixture } from "./helpers/d1-fixture";

function stubEnv(options: { userbot?: boolean } = {}) {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example.test/");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-token");
  if (options.userbot) vi.stubEnv("TELEGRAM_CHANNEL_USERBOT_ENABLED", "true");
}

type Fetched = { url: string; init?: RequestInit };
function stubFetch(healthResponse: () => Response | Promise<Response>) {
  const alerts: string[] = [];
  const calls: Fetched[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("api.telegram.org")) {
      alerts.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true, result: { message_id: alerts.length } });
    }
    return healthResponse();
  }));
  return { alerts, calls };
}

beforeEach(() => resetUserbotWatchMemo());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkUserbotHealth", () => {
  it("sends x-proxy-token to /tgu/health and reports ready", async () => {
    stubEnv();
    const { calls } = stubFetch(() => Response.json({ ok: true, ready: true }));
    expect(await checkUserbotHealth()).toEqual({ reachable: true, ready: true });
    expect(calls[0].url).toBe("https://proxy.example.test/tgu/health");
    expect((calls[0].init?.headers as Record<string, string>)["x-proxy-token"]).toBe("proxy-token");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("reachable but not ready; 404, other statuses, bad body and network errors are unreachable", async () => {
    stubEnv();
    stubFetch(() => Response.json({ ok: true, ready: false }));
    expect(await checkUserbotHealth()).toEqual({ reachable: true, ready: false });
    stubFetch(() => Response.json({ error: "x" }, { status: 404 }));
    expect(await checkUserbotHealth()).toEqual({ reachable: false, ready: false });
    stubFetch(() => Response.json({ ok: true, ready: true }, { status: 502 }));
    expect(await checkUserbotHealth()).toEqual({ reachable: false, ready: false });
    stubFetch(() => new Response("not json", { status: 200 }));
    expect(await checkUserbotHealth()).toEqual({ reachable: false, ready: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    expect(await checkUserbotHealth()).toEqual({ reachable: false, ready: false });
  });

  it("is unreachable without proxy credentials and makes no request", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await checkUserbotHealth()).toEqual({ reachable: false, ready: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("parseChannelLastDelivery / alert text", () => {
  it("parses a valid record and rejects garbage", () => {
    const raw = JSON.stringify({ at: "2026-11-28T10:00:00.000Z", slot: "evening", businessDate: "2026-11-28", via: "bot_fallback", state: "sent", buttons: "attached", reason: "userbot_not_ready" });
    expect(parseChannelLastDelivery(raw)).toMatchObject({ via: "bot_fallback", reason: "userbot_not_ready", buttons: "attached" });
    expect(parseChannelLastDelivery("")).toBeNull();
    expect(parseChannelLastDelivery("{oops")).toBeNull();
    expect(parseChannelLastDelivery(JSON.stringify({ at: "x", slot: "s", businessDate: "d", via: "nope", state: "sent" }))).toBeNull();
  });

  it("maps outcomes to alert kinds and Indonesian texts", () => {
    expect(channelAlertKinds("sent", { via: "userbot", buttons: "attached" })).toEqual([]);
    expect(channelAlertKinds("sent", { via: "bot", buttons: "attached" })).toEqual([]);
    expect(channelAlertKinds("sent", { via: "bot_fallback", buttons: "attached", reason: "r" })).toEqual(["fallback"]);
    expect(channelAlertKinds("sent", { via: "userbot", buttons: "failed" })).toEqual(["buttons"]);
    expect(channelAlertKinds("unknown", { via: "userbot", buttons: "n/a" })).toEqual(["unknown"]);
    expect(channelAlertKinds("failed", { via: "bot_fallback", buttons: "n/a" })).toEqual(["failed"]);
    expect(channelAlertText("fallback", "evening", { via: "bot_fallback", buttons: "attached", reason: "userbot_not_ready" }, "@axvaratech"))
      .toBe("⚠️ Promo channel Sore dikirim lewat bot cadangan (emoji tidak bergerak). Sebab: userbot_not_ready.");
    expect(channelAlertText("unknown", "evening", { via: "userbot", buttons: "n/a" }, "@axvaratech"))
      .toBe("⚠️ Promo channel Sore: hasil forward userbot tidak pasti — cek @axvaratech.");
    expect(channelAlertText("buttons", "morning", { via: "userbot", buttons: "failed" }, "@axvaratech"))
      .toBe("⚠️ Promo channel Pagi terkirim tanpa tombol (gagal pasang tombol).");
    expect(channelAlertText("failed", "morning", { via: "bot", buttons: "n/a", reason: "telegram_channel_not_admin" }, "@axvaratech"))
      .toContain("gagal terkirim");
  });
});

describe("recordChannelPromoDelivery", () => {
  it("persists the record, alerts once per slot and kind, and never alerts for a clean userbot send", async () => {
    stubEnv({ userbot: true });
    const { alerts } = stubFetch(() => Response.json({}));
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const base = { slot: "evening", businessDate: "2026-11-28", destination: "@axvaratech", now: Date.parse("2026-11-28T10:00:00Z") };
      const fallback = { via: "bot_fallback" as const, buttons: "attached" as const, reason: "userbot_not_ready" };

      expect(await recordChannelPromoDelivery(db, { ...base, state: "sent", meta: fallback })).toEqual({ recorded: true, alerts: ["fallback"] });
      expect(alerts).toEqual(["⚠️ Promo channel Sore dikirim lewat bot cadangan (emoji tidak bergerak). Sebab: userbot_not_ready."]);
      const stored = JSON.parse(String(fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(TELEGRAM_CHANNEL_LAST_DELIVERY_KEY)?.value));
      expect(stored).toEqual({
        at: "2026-11-28T10:00:00.000Z", slot: "evening", businessDate: "2026-11-28",
        via: "bot_fallback", state: "sent", buttons: "attached", reason: "userbot_not_ready", alerted: ["fallback"],
      });

      // Same slot + kind again: record refreshed, no second alert.
      expect((await recordChannelPromoDelivery(db, { ...base, state: "sent", meta: fallback })).alerts).toEqual([]);
      expect(alerts).toHaveLength(1);

      // Unknown in the same slot is a different kind: alerts once.
      expect((await recordChannelPromoDelivery(db, { ...base, state: "unknown", meta: { via: "userbot", buttons: "n/a", reason: "telegram_userbot_outcome_unknown" } })).alerts).toEqual(["unknown"]);
      expect(alerts).toHaveLength(2);
      expect(alerts[1]).toContain("hasil forward userbot tidak pasti — cek @axvaratech");

      // New slot resets dedupe; clean userbot send records without alert.
      expect(await recordChannelPromoDelivery(db, { ...base, slot: "morning", businessDate: "2026-11-29", state: "sent", meta: { via: "userbot", buttons: "attached" } })).toEqual({ recorded: true, alerts: [] });
      expect(alerts).toHaveLength(2);
      const last = parseChannelLastDelivery(fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(TELEGRAM_CHANNEL_LAST_DELIVERY_KEY)?.value);
      expect(last).toMatchObject({ slot: "morning", via: "userbot", buttons: "attached" });
      expect(last?.alerted).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("alerts for failed buttons and failed direct sends, skips non-final states and missing meta", async () => {
    stubEnv();
    const { alerts } = stubFetch(() => Response.json({}));
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const base = { slot: "morning", businessDate: "2026-11-28", destination: "@axvaratech" };
      expect((await recordChannelPromoDelivery(db, { ...base, state: "sent", meta: { via: "userbot", buttons: "failed", reason: "telegram_userbot_buttons_failed" } })).alerts).toEqual(["buttons"]);
      expect((await recordChannelPromoDelivery(db, { ...base, state: "failed", meta: { via: "bot", buttons: "n/a", reason: "telegram_channel_not_admin" } })).alerts).toEqual(["failed"]);
      expect(alerts).toEqual([
        "⚠️ Promo channel Pagi terkirim tanpa tombol (gagal pasang tombol).",
        "⚠️ Promo channel Pagi gagal terkirim. Sebab: telegram_channel_not_admin.",
      ]);
      expect(await recordChannelPromoDelivery(db, { ...base, state: "retry", meta: { via: "bot", buttons: "n/a" } })).toEqual({ recorded: false, alerts: [] });
      expect(await recordChannelPromoDelivery(db, { ...base, state: "sent", meta: undefined })).toEqual({ recorded: false, alerts: [] });
    } finally {
      fx.close();
    }
  });

  it("never throws when the database or the alert fails", async () => {
    stubEnv();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const meta = { via: "bot_fallback" as const, buttons: "attached" as const, reason: "staging_failed" };
      await expect(recordChannelPromoDelivery(db, { slot: "evening", businessDate: "2026-11-28", destination: "@axvaratech", state: "sent", meta }))
        .resolves.toMatchObject({ recorded: true });
      fx.control.fail = () => true;
      await expect(recordChannelPromoDelivery(db, { slot: "evening", businessDate: "2026-11-29", destination: "@axvaratech", state: "sent", meta }))
        .resolves.toEqual({ recorded: false, alerts: [] });
    } finally {
      fx.close();
    }
  });
});

describe("watchUserbotHealth", () => {
  const T0 = Date.parse("2026-11-28T03:00:00Z");

  it("is a no-op without userbot mode (no D1, no network)", async () => {
    stubEnv();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const fx = createD1Fixture();
    try {
      expect(await watchUserbotHealth(createDatabaseAccess(fx.db), T0)).toEqual({ checked: false });
      expect(fx.control.queries).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fx.close();
    }
  });

  it("alerts on ready -> down and down -> recovered, at most every 30 minutes, 1 read + 1 write per check", async () => {
    stubEnv({ userbot: true });
    let health: () => Response = () => Response.json({ ok: true, ready: true });
    const { alerts, calls } = stubFetch(() => health());
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const stored = () => JSON.parse(String(fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(TELEGRAM_USERBOT_WATCH_KEY)?.value));

      // First check, ready: stored, no alert, exactly 2 statements.
      const before = fx.control.queries;
      expect(await watchUserbotHealth(db, T0)).toEqual({ checked: true, state: "ready" });
      expect(fx.control.queries - before).toBe(2);
      expect(alerts).toHaveLength(0);
      expect(stored()).toMatchObject({ state: "ready", reason: null });

      // Within 30 minutes: zero statements, zero requests.
      const queries = fx.control.queries;
      const requests = calls.length;
      expect(await watchUserbotHealth(db, T0 + 10 * 60_000)).toEqual({ checked: false });
      expect(fx.control.queries).toBe(queries);
      expect(calls).toHaveLength(requests);

      // Userbot goes down: alert once.
      health = () => Response.json({ ok: true, ready: false });
      expect(await watchUserbotHealth(db, T0 + USERBOT_WATCH_INTERVAL_MS)).toEqual({ checked: true, state: "down", alerted: "down" });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain("⚠️ Userbot channel terkendala");
      expect(alerts[0]).toContain("belum siap");
      expect(stored()).toMatchObject({ state: "down", reason: "not_ready" });

      // Still down (now unreachable): no repeat alert.
      health = () => new Response("nope", { status: 404 });
      expect(await watchUserbotHealth(db, T0 + 2 * USERBOT_WATCH_INTERVAL_MS)).toEqual({ checked: true, state: "down" });
      expect(alerts).toHaveLength(1);
      expect(stored()).toMatchObject({ state: "down", reason: "unreachable", since: new Date(T0 + USERBOT_WATCH_INTERVAL_MS).toISOString() });

      // Recovery alert.
      health = () => Response.json({ ok: true, ready: true });
      expect(await watchUserbotHealth(db, T0 + 3 * USERBOT_WATCH_INTERVAL_MS)).toEqual({ checked: true, state: "ready", alerted: "recovered" });
      expect(alerts).toHaveLength(2);
      expect(alerts[1]).toContain("✅ Userbot channel pulih");
      expect(JSON.stringify(alerts)).not.toContain("proxy-token");
    } finally {
      fx.close();
    }
  });

  it("alerts when the very first check is down and retries the alert when sending fails", async () => {
    stubEnv({ userbot: true });
    let telegramOk = false;
    const alerts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        if (!telegramOk) return Response.json({ ok: false, error_code: 500 }, { status: 500 });
        alerts.push(JSON.parse(String(init?.body)).text);
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      return new Response("", { status: 404 });
    }));
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      expect(await watchUserbotHealth(db, T0)).toEqual({ checked: true, state: "down" });
      expect(alerts).toHaveLength(0);
      telegramOk = true;
      resetUserbotWatchMemo();
      expect(await watchUserbotHealth(db, T0 + USERBOT_WATCH_INTERVAL_MS)).toEqual({ checked: true, state: "down", alerted: "down" });
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain("tidak terjangkau");
    } finally {
      fx.close();
    }
  });

  it("a fresh isolate does not recheck when the stored check is recent", async () => {
    stubEnv({ userbot: true });
    const { calls } = stubFetch(() => Response.json({ ok: true, ready: true }));
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      await watchUserbotHealth(db, T0);
      resetUserbotWatchMemo();
      const requests = calls.length;
      expect(await watchUserbotHealth(db, T0 + 60_000)).toEqual({ checked: false });
      expect(calls).toHaveLength(requests);
    } finally {
      fx.close();
    }
  });
});

describe("cron/lite promo hook", () => {
  async function callPromo() {
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest("http://localhost/api/cron/lite?job=promo", { method: "POST", headers: { authorization: "Bearer s" } }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("runs the userbot watch only in userbot mode, then stays quiet until 30 minutes pass", async () => {
    stubEnv({ userbot: true });
    vi.stubEnv("CRON_SECRET", "s");
    const { alerts, calls } = stubFetch(() => Response.json({ ok: true, ready: false }));
    const fx = createD1Fixture();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-28T00:05:00Z")); // 07:05 WIB: promo tidak jatuh tempo
      const first = await callPromo();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ userbot_watch: { state: "down", alerted: "down" } });
      expect(alerts.some((text) => text.includes("⚠️ Userbot channel terkendala"))).toBe(true);
      const healthCalls = () => calls.filter((call) => call.url.endsWith("/tgu/health")).length;
      expect(healthCalls()).toBe(1);

      vi.setSystemTime(new Date("2026-11-28T00:06:00Z"));
      const second = await callPromo();
      expect(second.body).not.toHaveProperty("userbot_watch");
      expect(healthCalls()).toBe(1);
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });

  it("does nothing without userbot mode", async () => {
    stubEnv();
    vi.stubEnv("CRON_SECRET", "s");
    const { calls } = stubFetch(() => Response.json({ ok: true, ready: true }));
    const fx = createD1Fixture();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-28T00:05:00Z"));
      const result = await callPromo();
      expect(result.body).not.toHaveProperty("userbot_watch");
      expect(calls.some((call) => call.url.endsWith("/tgu/health"))).toBe(false);
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });
});

describe("admin sender formatting", () => {
  it("shows the last post line for each path", () => {
    const base = { slot: "evening", businessDate: "2026-11-28", state: "sent", buttons: "attached" as const };
    // 10:00Z = 17.00 WIB
    expect(describeLastDelivery({ ...base, at: "2026-11-28T10:00:00.000Z", via: "userbot" }))
      .toBe("Terakhir: Sore 28 Nov 17.00 · via userbot · tombol terpasang");
    expect(describeLastDelivery({ ...base, at: "2026-11-28T10:00:00.000Z", via: "bot_fallback", reason: "userbot_not_ready" }))
      .toBe("Terakhir: Sore 28 Nov 17.00 · via bot (cadangan: userbot_not_ready) · tombol terpasang");
    expect(describeLastDelivery({ ...base, slot: "morning", at: "2026-11-28T02:00:00.000Z", via: "bot", buttons: "n/a", state: "unknown", reason: "x" }))
      .toBe("Terakhir: Pagi 28 Nov 09.00 · via bot · hasil tidak pasti (x)");
    expect(describeLastDelivery(null)).toBe("Belum ada promo channel terkirim.");
  });

  it("maps live userbot status to a badge", () => {
    expect(senderStatusBadge({ mode: "bot", userbot: null })).toBeNull();
    expect(senderStatusBadge({ mode: "userbot", userbot: { reachable: true, ready: true } })).toEqual({ label: "Siap", variant: "success" });
    expect(senderStatusBadge({ mode: "userbot", userbot: { reachable: true, ready: false } })).toEqual({ label: "Terkendala", variant: "warning" });
    expect(senderStatusBadge({ mode: "userbot", userbot: { reachable: false, ready: false } })).toEqual({ label: "Tidak terjangkau", variant: "destructive" });
  });
});
