import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { SITE } from "@/lib/site";
import {
  ALERT_COOLDOWN_MS,
  guardTelegramWebhook,
  KICK_COOLDOWN_MS,
  TG_WEBHOOK_GUARD_STATE_KEY,
} from "@/lib/telegram/webhook-guard";
import { CRON_STEPS, stepLabel } from "../mcp-worker/src/cron";

const BOT_TOKEN = "123456:fixture-telegram-bot-token-xyz";
const WEBHOOK_SECRET = "fixture-webhook-secret-token-abc";
const ADMIN_CHAT_ID = "-100999888";
const CRON_SECRET = "fixture-cron-secret";
const CANONICAL_URL = `${SITE.webUrl}/api/telegram/webhook`;

type TelegramCall = { method: string; body: Record<string, unknown> | undefined };

function mockTelegramFetch(
  handler: (method: string, body: Record<string, unknown> | undefined, callIndex: number) => unknown,
) {
  const calls: TelegramCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = url.match(/\/bot[^/]+\/([^/?]+)$/);
    const method = match ? match[1] : url;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, body });
    const out = await handler(method, body, calls.length - 1);
    if (out instanceof Response) return out;
    return Response.json(out);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", ADMIN_CHAT_ID);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SITE_URL", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Telegram webhook guard (tg_webhook)", () => {
  it("healthy webhook: calls only getWebhookInfo, performs no set/delete/sendMessage, writes no DB", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: { url: CANONICAL_URL, has_custom_certificate: false, pending_update_count: 0 },
          };
        }
        throw new Error(`unexpected call: ${method}`);
      });

      const res = await guardTelegramWebhook(db, { nowMs: 1_763_617_200_000 });
      expect(res).toEqual({
        status: "healthy",
        url: CANONICAL_URL,
        pending_update_count: 0,
        kicked: false,
      });
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
      expect(
        fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(TG_WEBHOOK_GUARD_STATE_KEY),
      ).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("ignores pending < 3 or stale last_error_date (> 180s)", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const nowMs = Date.UTC(2026, 10, 20, 5, 45, 0); // 12:45 WIB
      const nowSec = Math.floor(nowMs / 1000);
      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: 2,
              last_error_date: nowSec - 10,
              last_error_message: "500",
            },
          };
        }
        throw new Error(`unexpected: ${method}`);
      });

      expect((await guardTelegramWebhook(db, { nowMs })).status).toBe("healthy");

      mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: 5,
              last_error_date: nowSec - 181,
              last_error_message: "old error",
            },
          };
        }
        throw new Error(`unexpected: ${method}`);
      });
      expect((await guardTelegramWebhook(db, { nowMs })).status).toBe("healthy");
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
    } finally {
      fx.close();
    }
  });

  it("stuck webhook: calls deleteWebhook(drop_pending_updates:false) + setWebhook with canonical params, sends exact WIB alert", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      // 2026-11-20T05:45:00Z = 12:45 WIB; error at 12:44 WIB (60s ago)
      const nowMs = Date.UTC(2026, 10, 20, 5, 45, 0);
      const errSec = Math.floor(Date.UTC(2026, 10, 20, 5, 44, 0) / 1000);
      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: 7,
              last_error_date: errSec,
              last_error_message: "Wrong response from the webhook: 500 Internal Server Error",
            },
          };
        }
        return { ok: true, result: method === "sendMessage" ? { message_id: 1 } : true };
      });

      const res = await guardTelegramWebhook(db, { nowMs });
      expect(res).toMatchObject({
        status: "stuck_kicked",
        pending_update_count: 7,
        is_stuck: true,
        is_wrong_url: false,
        kicked: true,
        kick_ok: true,
        alerted: true,
      });

      expect(calls.map((c) => c.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
        "setWebhook",
        "sendMessage",
      ]);
      expect(calls[1].body).toEqual({ drop_pending_updates: false });
      expect(calls[2].body).toEqual({
        url: CANONICAL_URL,
        secret_token: WEBHOOK_SECRET,
        max_connections: 40,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
      expect(calls[3].body).toEqual({
        chat_id: ADMIN_CHAT_ID,
        text: "⚠️ Bot Telegram tertahan: 7 update antre · error terakhir 12:44 WIB: Wrong response from the webhook: 500 Internal Server Error · webhook dipasang ulang otomatis",
        disable_web_page_preview: true,
      });
    } finally {
      fx.close();
    }
  });

  it("rate limits kick (5 min) and alert (30 min), and sends recovery message once when pending returns to 0", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 20, 5, 40, 0);
      let pending = 5;
      let errSec = Math.floor(t0 / 1000) - 20;
      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: pending,
              ...(pending > 0
                ? { last_error_date: errSec, last_error_message: "502 Bad Gateway" }
                : {}),
            },
          };
        }
        return { ok: true, result: method === "sendMessage" ? { message_id: 1 } : true };
      });

      // t0: first kick + alert
      await guardTelegramWebhook(db, { nowMs: t0 });
      expect(calls.map((c) => c.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
        "setWebhook",
        "sendMessage",
      ]);

      // t0 + 2 min: within 5 min kick cooldown -> no delete/set/alert
      calls.length = 0;
      errSec = Math.floor((t0 + 2 * 60_000) / 1000) - 10;
      const r2 = await guardTelegramWebhook(db, { nowMs: t0 + 2 * 60_000 });
      expect(r2.kicked).toBe(false);
      expect(r2.alerted).toBe(false);
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);

      // t0 + 5 min: kick runs again (<= 3 Telegram calls), alert suppressed (< 30 min)
      calls.length = 0;
      errSec = Math.floor((t0 + KICK_COOLDOWN_MS) / 1000) - 10;
      const r5 = await guardTelegramWebhook(db, { nowMs: t0 + KICK_COOLDOWN_MS });
      expect(r5.kicked).toBe(true);
      expect(r5.alerted).toBe(false);
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo", "deleteWebhook", "setWebhook"]);

      // t0 + 30 min: kick + alert both fire
      calls.length = 0;
      errSec = Math.floor((t0 + ALERT_COOLDOWN_MS) / 1000) - 10;
      const r30 = await guardTelegramWebhook(db, { nowMs: t0 + ALERT_COOLDOWN_MS });
      expect(r30.kicked).toBe(true);
      expect(r30.alerted).toBe(true);
      expect(calls.map((c) => c.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
        "setWebhook",
        "sendMessage",
      ]);

      // t0 + 31 min: pending returns to 0 -> recovery message sent ONCE
      calls.length = 0;
      pending = 0;
      const rRec = await guardTelegramWebhook(db, { nowMs: t0 + 31 * 60_000 });
      expect(rRec).toMatchObject({ status: "recovered", pending_update_count: 0, recovery_alerted: true });
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo", "sendMessage"]);
      expect(calls[1].body?.text).toBe("✅ Bot Telegram pulih (antrean kosong)");

      // t0 + 32 min: subsequent healthy tick does NOT resend recovery
      calls.length = 0;
      const rHealthy = await guardTelegramWebhook(db, { nowMs: t0 + 32 * 60_000 });
      expect(rHealthy.status).toBe("healthy");
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
    } finally {
      fx.close();
    }
  });

  it.each([
    ["timeout", () => { throw new DOMException("aborted", "AbortError"); }],
    ["network loss", () => { throw new Error("Network connection lost"); }],
    ["unreadable JSON", () => new Response("upstream failure", { status: 502 })],
    ["Bot API 500", () => ({ ok: false, error_code: 500 })],
    ["missing message id", () => ({ ok: true, result: {} })],
  ])("%s counts as delivered: stuck/recovery alerts are not resent every minute", async (_kind, sendOutcome) => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 20, 14, 10, 0);
      let pending = 5;
      const { calls } = mockTelegramFetch((method) => {
        if (method === "sendMessage") return sendOutcome();
        if (method === "getWebhookInfo") {
          return { ok: true, result: { url: CANONICAL_URL, has_custom_certificate: false, pending_update_count: pending,
            ...(pending > 0 ? { last_error_date: Math.floor(t0 / 1000) - 10, last_error_message: "Timeout" } : {}) } };
        }
        return { ok: true, result: true };
      });
      const r1 = await guardTelegramWebhook(db, { nowMs: t0 });
      expect(r1.alerted).toBe(true);
      expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
      calls.length = 0;
      const r2 = await guardTelegramWebhook(db, { nowMs: t0 + 60_000 });
      expect(r2.alerted).toBe(false);
      expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);

      pending = 0;
      calls.length = 0;
      const rRec = await guardTelegramWebhook(db, { nowMs: t0 + 2 * 60_000 });
      expect(rRec).toMatchObject({ status: "recovered", recovery_alerted: true });
      expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
      calls.length = 0;
      const rNext = await guardTelegramWebhook(db, { nowMs: t0 + 3 * 60_000 });
      expect(rNext.status).toBe("healthy");
      expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("definitely rejected stuck and recovery alerts both stay due", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 20, 14, 10, 0);
      let pending = 5;
      let rejected = true;
      const { calls } = mockTelegramFetch((method) => {
        if (method === "sendMessage") return rejected ? { ok: false, error_code: 403 } : { ok: true, result: { message_id: 1 } };
        if (method === "getWebhookInfo") return { ok: true, result: { url: CANONICAL_URL, pending_update_count: pending, last_error_date: t0 / 1000 } };
        return { ok: true, result: true };
      });
      expect((await guardTelegramWebhook(db, { nowMs: t0 })).alerted).toBe(false);
      rejected = false;
      expect((await guardTelegramWebhook(db, { nowMs: t0 + 60_000 })).alerted).toBe(true);
      pending = 0;
      rejected = true;
      expect((await guardTelegramWebhook(db, { nowMs: t0 + 120_000 })).recovery_alerted).toBe(false);
      rejected = false;
      expect((await guardTelegramWebhook(db, { nowMs: t0 + 180_000 })).recovery_alerted).toBe(true);
      expect(calls.filter((c) => c.method === "sendMessage")).toHaveLength(4);
    } finally {
      fx.close();
    }
  });

  it("wrong url triggers reset with canonical params and drop_pending_updates:false", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const nowMs = Date.UTC(2026, 10, 20, 6, 0, 0);
      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: "https://wrong.example.com/hook",
              has_custom_certificate: false,
              pending_update_count: 0,
            },
          };
        }
        return { ok: true, result: true };
      });

      const res = await guardTelegramWebhook(db, { nowMs });
      expect(res).toMatchObject({
        status: "wrong_url_kicked",
        is_wrong_url: true,
        is_stuck: false,
        kicked: true,
        kick_ok: true,
      });
      expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo", "deleteWebhook", "setWebhook"]);
      expect(calls[1].body).toEqual({ drop_pending_updates: false });
      expect(calls[2].body).toEqual({
        url: CANONICAL_URL,
        secret_token: WEBHOOK_SECRET,
        max_connections: 40,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
    } finally {
      fx.close();
    }
  });

  it("setWebhook failure: retries once immediately; if both fail, sends loud alert and never leaves silent failure", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const nowMs = Date.UTC(2026, 10, 20, 6, 0, 0);

      // Case A: first setWebhook fails, immediate retry succeeds -> recovered cleanly
      let setAttempts = 0;
      const callsA = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: { url: "", has_custom_certificate: false, pending_update_count: 0 },
          };
        }
        if (method === "setWebhook") {
          setAttempts++;
          return setAttempts === 1 ? { ok: false, description: "502 bad gateway" } : { ok: true };
        }
        return { ok: true };
      }).calls;

      const resA = await guardTelegramWebhook(db, { nowMs });
      expect(resA).toMatchObject({ status: "wrong_url_kicked", kicked: true, kick_ok: true });
      expect(callsA.map((c) => c.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
        "setWebhook",
        "setWebhook",
      ]);

      // Case B: both setWebhook calls fail -> loud alert sent immediately
      fx.sql.exec("DELETE FROM store_settings");
      const nowMsB = nowMs + 10 * 60_000;
      const callsB = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: 4,
              last_error_date: Math.floor(nowMsB / 1000) - 10,
              last_error_message: "timeout",
            },
          };
        }
        if (method === "setWebhook") {
          return { ok: false, description: `token=${BOT_TOKEN} secret=${WEBHOOK_SECRET} failed` };
        }
        return { ok: true };
      }).calls;

      const resB = await guardTelegramWebhook(db, { nowMs: nowMsB });
      expect(resB).toMatchObject({ status: "kick_failed", kicked: true, kick_ok: false });
      expect(resB.error).not.toContain(BOT_TOKEN);
      expect(resB.error).not.toContain(WEBHOOK_SECRET);
      expect(callsB.map((c) => c.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
        "setWebhook",
        "setWebhook",
        "sendMessage",
      ]);
      const loudMsg = String(callsB[4].body?.text ?? "");
      expect(loudMsg).toContain("KRITIS");
      expect(loudMsg).not.toContain(BOT_TOKEN);
      expect(loudMsg).not.toContain(WEBHOOK_SECRET);
    } finally {
      fx.close();
    }
  });

  it("never logs bot token or webhook secret and never throws on network failure", async () => {
    const fx = createD1Fixture();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error(`request to https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo failed secret=${WEBHOOK_SECRET}`);
        }),
      );

      const res = await guardTelegramWebhook(createDatabaseAccess(fx.db));
      expect(res.status).toBe("info_failed");
      expect(res.error).not.toContain(BOT_TOKEN);
      expect(res.error).not.toContain(WEBHOOK_SECRET);

      const allLogs = JSON.stringify([logSpy.mock.calls, warnSpy.mock.calls, errSpy.mock.calls]);
      expect(allLogs).not.toContain(BOT_TOKEN);
      expect(allLogs).not.toContain(WEBHOOK_SECRET);
    } finally {
      fx.close();
    }
  });

  it("/api/cron/lite?job=tg_webhook dispatches cleanly and mcp-worker includes tg_webhook as soft every-minute job", async () => {
    const step = CRON_STEPS.find((s) => stepLabel(s) === "lite:tg_webhook");
    expect(step).toEqual({ phase: "lite", lite: "tg_webhook", alarm: "soft", group: "notify" });

    const fx = createD1Fixture();
    try {
      mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return { ok: true, result: { url: CANONICAL_URL, has_custom_certificate: false, pending_update_count: 1 } };
        }
        throw new Error(`unexpected: ${method}`);
      });

      const { POST } = await import("@/app/api/cron/lite/route");
      const res = await POST(
        new NextRequest("http://localhost/api/cron/lite?job=tg_webhook", {
          method: "POST",
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, job: "tg_webhook", status: "healthy", pending_update_count: 1 });
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_tg_webhook_ok_at'").get()).toBeTruthy();
    } finally {
      fx.close();
    }
  });

  it("admin setup route and guard share canonical setWebhook params; admin bot/health reports pending_update_count, last_error_date/message and last_auto_kick_at", async () => {
    const fx = createD1Fixture();
    try {
      const kickMs = Date.UTC(2026, 10, 20, 5, 45, 0);
      const errSec = Math.floor(Date.UTC(2026, 10, 20, 5, 44, 0) / 1000);
      fx.sql
        .prepare("INSERT INTO store_settings(key, value) VALUES (?, ?)")
        .run(TG_WEBHOOK_GUARD_STATE_KEY, JSON.stringify({ last_kick_at: kickMs, stuck_alert_active: true }));

      const { calls } = mockTelegramFetch((method) => {
        if (method === "getWebhookInfo") {
          return {
            ok: true,
            result: {
              url: CANONICAL_URL,
              has_custom_certificate: false,
              pending_update_count: 4,
              last_error_date: errSec,
              last_error_message: "500 Internal Server Error",
            },
          };
        }
        return { ok: true };
      });

      vi.doMock("@/lib/auth", async () => {
        const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
        return { ...actual, requireAdmin: vi.fn(async () => ({ email: "admin@axvara.tech", role: "admin" })) };
      });

      const { POST: setupPost } = await import("@/app/api/admin/telegram/setup/route");
      const setupRes = await setupPost(
        new NextRequest("http://localhost/api/admin/telegram/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "set" }),
        }),
      );
      expect(setupRes.status).toBe(200);
      const setCall = calls.find((c) => c.method === "setWebhook");
      expect(setCall?.body).toEqual({
        url: CANONICAL_URL,
        secret_token: WEBHOOK_SECRET,
        max_connections: 40,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });

      const { GET: healthGet } = await import("@/app/api/admin/bot/health/route");
      const healthRes = await healthGet(new NextRequest("http://localhost/api/admin/bot/health"));
      expect(healthRes.status).toBe(200);
      const healthBody = (await healthRes.json()) as { webhook?: Record<string, unknown> };
      expect(healthBody.webhook).toMatchObject({
        url: CANONICAL_URL,
        pending_updates: 4,
        pending_update_count: 4,
        last_error: "500 Internal Server Error",
        last_error_message: "500 Internal Server Error",
        last_error_date: new Date(errSec * 1000).toISOString(),
        last_auto_kick_at: new Date(kickMs).toISOString(),
      });
    } finally {
      vi.doUnmock("@/lib/auth");
      fx.close();
    }
  });
});
