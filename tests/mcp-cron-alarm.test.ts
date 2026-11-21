import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../mcp-worker/src/index";
import { syntheticResponse } from "./helpers/synthetic-response";
import {
  ALARM_KV_KEY, ALARM_REMINDER_MS, runOperationsTick,
  type AlarmState, type CronEnv, type KvLike,
} from "../mcp-worker/src/cron";

const baseEnv = {
  AXVARA_API_ORIGIN: "https://origin.test",
  AXVARA_CRON_SECRET: "cron-fixture-secret",
  TELEGRAM_BOT_TOKEN: "123456:telegram-fixture-token",
  TELEGRAM_ADMIN_CHAT_ID: "-100",
};
const at = (minute: number) => Date.UTC(2026, 10, 18, 0, minute);
const key = (url: string) => new URL(url).searchParams.get("job") ?? new URL(url).pathname.split("/").pop()!;
const noSleep = async () => {};

function fixture(handler: (job: string) => Response | Promise<Response>) {
  const messages: string[] = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.telegram.org/")) {
      messages.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true });
    }
    return syntheticResponse(url) ?? handler(key(url));
  });
  let stored: string | null = null;
  const kv = { get: vi.fn(async () => stored), put: vi.fn(async (_key: string, value: string) => { stored = value; }) };
  const env: CronEnv = { ...baseEnv, CRON_STATE: kv };
  return { env, kv, messages, fetchFn,
    tick: (minute: number) => runOperationsTick(env, at(minute), fetchFn, noSleep),
    state: () => JSON.parse(stored!) as AlarmState,
  };
}
const ok = () => Response.json({ more: false });
const fail = () => Response.json({ error: "D1_ERROR: UNIQUE constraint failed: product_group_dirty.group_id" }, { status: 500 });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("per-step cron alarm", () => {
  it("R2-1: a delayed :00 cannot roll back :01–:05 alarm counters", async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    const f = fixture(async job => {
      if (job === "payments" && first) { first = false; entered(); await blocked; return fail(); }
      return job === "tunvn_catalog" ? fail() : ok();
    });
    const slow = f.tick(0);
    await started;
    for (let minute = 1; minute <= 5; minute++) await f.tick(minute);
    expect(f.state().steps["lite:tunvn_catalog"].failedTicks).toBe(5);
    release(); await slow;
    expect(f.state().steps["lite:tunvn_catalog"].failedTicks).toBe(5);
    expect(f.state().steps["lite:payments"]).toBeUndefined();
    expect(f.messages).toHaveLength(0);
  });
  it("R2-1: probes run even when the heavy pipeline exceeds its old 55s window", async () => {
    const now = Date.now(); let current = now;
    vi.spyOn(Date, "now").mockImplementation(() => current);
    const f = fixture(job => { if (job === "payments") current += 300_000; return ok(); });
    const result = await f.tick(0);
    expect(result.outcomes.filter(o => o.step.startsWith("synth:")).every(o => o.calls > 0)).toBe(true);
  });
  it("60 minute ticks: TUNVN fails every scheduled call and alerts at execution six", async () => {
    const f = fixture((job) => job === "tunvn_catalog" ? fail() : ok());
    const actions: string[] = [];
    for (let minute = 0; minute < 60; minute++) actions.push((await f.tick(minute)).action);
    expect(f.fetchFn.mock.calls.filter(([url]) => key(url) === "tunvn_catalog")).toHaveLength(60);
    expect(actions.slice(0, 6)).toEqual(["none", "none", "none", "none", "none", "start"]);
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toContain("lite:tunvn_catalog: HTTP 500 — D1_ERROR: UNIQUE constraint failed");
    expect(f.state().steps["lite:tunvn_catalog"].failedTicks).toBe(6);
  });

  it("70 minute ticks: non-due Games ticks neither reset failures nor recover the step", async () => {
    const f = fixture((job) => job === "games_catalog" ? fail() : ok());
    for (let minute = 0; minute < 70; minute++) {
      const result = await f.tick(minute);
      if (minute === 49) expect(f.state().steps["lite:games_catalog"].failedTicks).toBe(5);
      if (minute === 50) expect(result.action).toBe("start");
      if (minute > 50) expect(result.action).toBe("none");
    }
    expect(f.fetchFn.mock.calls.filter(([url]) => key(url) === "games_catalog")).toHaveLength(7);
    expect(f.messages).toHaveLength(1);
    expect(f.state().steps["lite:games_catalog"].okTicks).toBe(0);
  });

  it("mixed hard + soft starts at hard execution two, without resetting soft counts", async () => {
    const f = fixture((job) => ["payments", "tunvn_catalog"].includes(job) ? fail() : ok());
    expect((await f.tick(0)).action).toBe("none");
    expect((await f.tick(1)).action).toBe("start");
    for (let minute = 2; minute < 6; minute++) await f.tick(minute);
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toContain("lite:payments");
    expect(f.messages[0]).toContain("lite:tunvn_catalog");
    expect(f.state().steps["lite:tunvn_catalog"].failedTicks).toBe(6);
  });

  it("only the same step's successful execution resets its consecutive failure count", async () => {
    let failing = true;
    const f = fixture((job) => job === "games_catalog" && failing ? fail() : ok());
    await f.tick(0);
    await f.tick(1);
    expect(f.state().steps["lite:games_catalog"].failedTicks).toBe(1);
    failing = false;
    await f.tick(10);
    expect(f.state().steps["lite:games_catalog"]).toBeUndefined();
    failing = true;
    for (let minute = 20; minute <= 60; minute += 10) await f.tick(minute);
    expect(f.messages).toHaveLength(0);
    expect((await f.tick(70)).action).toBe("start");
  });

  it("recovery needs three eligible successes of Games, not other successful ticks", async () => {
    let failing = true;
    const f = fixture((job) => job === "games_catalog" && failing ? fail() : ok());
    for (let minute = 0; minute <= 50; minute += 10) await f.tick(minute);
    failing = false;
    for (let minute = 51; minute < 80; minute++) {
      expect((await f.tick(minute)).action).toBe("none");
      if (minute === 79) expect(f.state().steps["lite:games_catalog"].okTicks).toBe(2);
    }
    expect((await f.tick(80)).action).toBe("recovered");
    expect(f.messages).toHaveLength(2);
    expect(f.messages[1]).toContain("lite:games_catalog");
    expect(f.state().steps).toEqual({});
  });

  it("reminder includes newly failing steps even if recovered before the reminder", async () => {
    let extraFailure = false;
    const f = fixture((job) => job === "payments" || (extraFailure && job === "tunvn_catalog") ? fail() : ok());
    await f.tick(0);
    await f.tick(1);
    extraFailure = true;
    await f.tick(2);
    extraFailure = false;
    for (let minute = 3; minute <= 5; minute++) await f.tick(minute);
    expect(f.messages).toHaveLength(1);
    expect((await f.tick(1 + ALARM_REMINDER_MS / 60_000)).action).toBe("reminder");
    expect(f.messages[1]).toContain("lite:payments");
    expect(f.messages[1]).toContain("lite:tunvn_catalog");
    expect(f.state().pendingFailures).toEqual([]);
  });

  it("start and recovery retain all nine hard step identities", async () => {
    let failing = true;
    const jobs = ["payments", "expiry", "fulfillment", "wr_orders", "sk_orders", "tunvn_orders", "aivault_orders", "pedia_orders", "games_orders"];
    const f = fixture((job) => failing && jobs.includes(job) ? fail() : ok());
    await f.tick(0);
    await f.tick(1);
    expect(f.state().lastFailures).toHaveLength(9);
    failing = false;
    for (let minute = 2; minute <= 4; minute++) await f.tick(minute);
    for (const job of jobs) {
      expect(f.messages[0]).toContain(`lite:${job}: HTTP 500`);
      expect(f.messages[1]).toContain(`lite:${job}: HTTP 500`);
    }
  });

  it.each(["reminder", "recovered"] as const)("failed Telegram %s is retried, not acknowledged", async (action) => {
    let failing = true;
    const f = fixture((job) => job === "payments" && failing ? fail() : ok());
    await f.tick(0);
    await f.tick(1);
    f.env.TELEGRAM_BOT_TOKEN = undefined;
    let minute: number;
    if (action === "reminder") minute = 1 + ALARM_REMINDER_MS / 60_000;
    else {
      failing = false;
      await f.tick(2);
      await f.tick(3);
      minute = 4;
    }
    const result = await f.tick(minute);
    expect(result.action).toBe(action);
    expect(result.alerted).toBe(false);
    expect(f.state().alertedAt).toBe(at(1));
    f.env.TELEGRAM_BOT_TOKEN = baseEnv.TELEGRAM_BOT_TOKEN;
    expect((await f.tick(minute + 1)).action).toBe(action);
    expect(f.messages).toHaveLength(2);
  });
});

describe("error detail and publish-scheduled", () => {
  it.each([
    ["json", () => Response.json({ error: "stable_error", ignored: "not selected" }, { status: 500 }), "stable_error"],
    ["text", () => new Response("origin temporarily unavailable", { status: 503 }), "origin temporarily unavailable"],
    ["oversized", () => new Response("x".repeat(200), { status: 500 }), "x".repeat(120)],
    ["empty", () => new Response(null, { status: 401 }), undefined],
    ["unreadable", () => new Response(new ReadableStream({ start(c) { c.error(new Error("read failed")); } }), { status: 500 }), undefined],
  ] as const)("non-2xx %s detail stays bounded", async (_name, response, detail) => {
    const f = fixture((job) => job === "tunvn_catalog" ? response() : ok());
    const result = await f.tick(0);
    expect(result.failures[0].error).toBe(detail);
    expect(result.outcomes).toHaveLength(34);
  });

  it("redacts bearer, key/token/secret patterns and actual configured secrets before state or Telegram", async () => {
    const f = fixture((job) => job === "tunvn_catalog" ? Response.json({ error:
      `Bearer abc-value api_key="def-value" token=ghi-value secret:jkl-value ${baseEnv.AXVARA_CRON_SECRET} ${baseEnv.TELEGRAM_BOT_TOKEN}`,
    }, { status: 500 }) : ok());
    for (let minute = 0; minute < 6; minute++) await f.tick(minute);
    const text = JSON.stringify({ state: f.state(), messages: f.messages });
    for (const secret of ["abc-value", "def-value", "ghi-value", "jkl-value", baseEnv.AXVARA_CRON_SECRET, baseEnv.TELEGRAM_BOT_TOKEN]) expect(text).not.toContain(secret);
    expect(f.messages[0]).toContain("[REDACTED]");
    expect(f.state().steps["lite:tunvn_catalog"].outcome.error!.length).toBeLessThanOrEqual(120);
  });

  it.each([401, 500, "network"] as const)("publish %s is soft and alerts after six eligible executions", async (status) => {
    const f = fixture((job) => {
      if (job !== "publish-scheduled") return ok();
      if (status === "network") throw new Error(`Bearer sensitive-network-token ${baseEnv.AXVARA_CRON_SECRET}`);
      return Response.json({ error: "publish_failed" }, { status });
    });
    for (let minute = 0; minute < 30; minute++) await f.tick(minute);
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toContain("publish-scheduled:");
    expect(f.messages[0]).not.toContain("sensitive-network-token");
    expect(f.state().steps["publish-scheduled"].failedTicks).toBe(6);
    const publishCalls = f.fetchFn.mock.calls.filter(([url]) => key(url) === "publish-scheduled");
    expect(publishCalls).toHaveLength(6);
    for (const [url, init] of publishCalls) {
      expect(url).toBe("https://origin.test/api/cron/publish-scheduled");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ authorization: `Bearer ${baseEnv.AXVARA_CRON_SECRET}` });
    }
  });

  it("scheduled entrypoint has one handled pipeline; publish rejection is logged in failures", async () => {
    const f = fixture((job) => { if (job === "publish-scheduled") throw new Error("offline"); return ok(); });
    vi.stubGlobal("fetch", f.fetchFn);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const promises: Promise<unknown>[] = [];
    await worker.scheduled({ cron: "* * * * *", scheduledTime: at(0) }, f.env, { waitUntil(p) { promises.push(p); } });
    expect(promises).toHaveLength(1);
    await expect(Promise.all(promises)).resolves.toEqual([undefined]);
    expect(log).toHaveBeenCalledWith("cron failures", expect.stringContaining('"step":"publish-scheduled"'));
  });

  it("successful publish remains successful and success-body fields do not become errors", async () => {
    const f = fixture(() => Response.json({ error: "ignored-on-success", more: false }));
    expect((await f.tick(0)).failures).toEqual([]);
    expect((await f.tick(1)).outcomes.some((o) => o.step === "publish-scheduled")).toBe(false);
    expect(f.messages).toEqual([]);
  });
});

describe("KV degradation and recovery", () => {
  it.each(["get", "put", "missing", "corrupt", "invalid_json"] as const)("%s failure: log redacted and fallback hard + soft once per UTC day", async (mode) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture((job) => ["payments", "tunvn_catalog"].includes(job) ? fail() : ok());
    if (mode === "missing") delete f.env.CRON_STATE;
    else if (mode === "corrupt") f.kv.get.mockResolvedValue('{"steps":null}');
    else if (mode === "invalid_json") f.kv.get.mockResolvedValue("arbitrary-private-storage-data");
    else f.kv[mode].mockRejectedValue(new Error(`storage_failed Bearer sensitive-kv-token key=kv-fixture-key ${baseEnv.TELEGRAM_BOT_TOKEN}`));
    for (const minute of [0, 1, 30, 60, 90, 1439]) await f.tick(minute);
    expect(f.messages).toHaveLength(1);
    await f.tick(1440);
    expect(f.messages).toHaveLength(2);
    for (const message of f.messages) {
      expect(message).toContain("lite:payments");
      expect(message).toContain("lite:tunvn_catalog");
    }
    expect(log).toHaveBeenCalledTimes(7);
    const output = JSON.stringify(log.mock.calls);
    for (const secret of ["sensitive-kv-token", "kv-fixture-key", baseEnv.TELEGRAM_BOT_TOKEN]) expect(output).not.toContain(secret);
    expect(output).toContain("stateless fallback");
    expect(output).not.toContain("arbitrary-private-storage-data");
  });

  it("a failed delivery-ack write logs degradation without a duplicate fallback in the same tick", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture((job) => job === "payments" ? fail() : ok());
    await f.tick(29);
    const write = f.kv.put.getMockImplementation()!;
    f.kv.put.mockImplementationOnce(write).mockRejectedValueOnce(new Error("ack_write_failed"));
    const result = await f.tick(30);
    expect(result.alerted).toBe(true);
    expect(f.messages).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("stateless fallback"), "ack_write_failed");
    expect(f.state().alertedAt).toBeNull();
    expect((await f.tick(31)).alerted).toBe(true);
    expect(f.state().alertedAt).toBe(at(31));
  });

  it("missing KV does not discard soft-only failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture((job) => job === "games_catalog" ? fail() : ok());
    delete f.env.CRON_STATE;
    for (let minute = 0; minute < 60; minute++) await f.tick(minute);
    expect(f.messages).toHaveLength(1);
    expect(f.messages.every((m) => m.includes("lite:games_catalog"))).toBe(true);
  });

  it.each(["get", "put", "missing"] as const)("storage recovers from %s and stateful alarms resume", async (mode) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture((job) => job === "payments" ? fail() : ok());
    const healthy: KvLike = { get: f.kv.get, put: f.kv.put };
    if (mode === "missing") delete f.env.CRON_STATE;
    else f.kv[mode].mockRejectedValueOnce(new Error("storage_down"));
    expect((await f.tick(0)).alerted).toBe(true);
    f.env.CRON_STATE = healthy;
    expect((await f.tick(1)).action).toBe("none");
    expect((await f.tick(2)).action).toBe("start");
    expect((await f.tick(3)).action).toBe("none");
    expect(f.messages).toHaveLength(2);
    expect(f.state().steps["lite:payments"].failedTicks).toBe(2);
  });

  it("legacy aggregate state starts fresh without fabricating recovery", async () => {
    const f = fixture((job) => job === "payments" ? fail() : ok());
    await f.kv.put(ALARM_KV_KEY, JSON.stringify({ since: at(0), alertedAt: at(0), failedTicks: 2, okTicks: 0, lastFailures: ["lite:payments: HTTP 500"] }));
    expect((await f.tick(1)).action).toBe("none");
    expect((await f.tick(2)).action).toBe("start");
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).not.toContain("✅ Cron AXVARA pulih");
  });
});
