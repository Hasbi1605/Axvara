import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import {
  checkSyncStaleness,
  NEVER_SUCCEEDED_GRACE_MS,
  STALE_REMINDER_INTERVAL_MS,
  SYNC_STALENESS_THRESHOLDS_MS,
} from "@/lib/sync-staleness";
import { sanitizeSyncError } from "@/lib/sync-status";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubTelegram(enabled = "true") {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", enabled);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-10099");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-fixture-token");
  const messages: { chat_id: string; text: string; parse_mode?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        messages.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json({ ok: true, result: { message_id: messages.length } });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    }),
  );
  return messages;
}

function enableTunvn() {
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "tunvn-secret-key");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
}

describe("sanitizeSyncError", () => {
  it("redacts secrets, tokens, query params, and truncates to 200 chars", () => {
    vi.stubEnv("TUNVN_API_KEY", "super-secret-tunvn-999");
    const long = `Bearer abcdef123456 https://u:pass@host.test/x?api_key=xyz&token=qrs key=super-secret-tunvn-999 ${"x".repeat(250)}`;
    const out = sanitizeSyncError(new Error(long));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).not.toContain("abcdef123456");
    expect(out).not.toContain("pass@");
    expect(out).not.toContain("xyz");
    expect(out).not.toContain("qrs");
    expect(out).not.toContain("super-secret-tunvn-999");
  });
});

describe("checkSyncStaleness", () => {
  it("ignores disabled/unconfigured sources and sends no Telegram when fresh", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("true");
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);

      // No sources enabled -> 0 DB writes, 0 alerts
      expect(await checkSyncStaleness(db, { now: t0 })).toEqual({
        checked: true,
        sources: [],
        alerted: [],
        reminded: [],
        recovered: [],
      });
      expect(messages).toHaveLength(0);

      // Enable TUNVN with fresh success (5 minutes ago < 15m threshold) -> 0 alerts
      enableTunvn();
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_success_at',?)").run(String(t0 - 5 * 60_000));
      const res = await checkSyncStaleness(db, { now: t0 });
      expect(res).toEqual({
        checked: true,
        sources: ["tunvn"],
        alerted: [],
        reminded: [],
        recovered: [],
      });
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("alerts once when stale, stays silent < 6h, reminds >= 6h, and sends recovery once", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("true");
      enableTunvn();
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);

      // Stale by 38 minutes + stored last error
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_success_at',?)").run(String(t0 - 38 * 60_000));
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_last_error',?)").run(
        JSON.stringify({ at: new Date(t0 - 5 * 60_000).toISOString(), error: "products_ambiguous:http_502" }),
      );

      // 1) Initial stale alert -> 1 message with age, WIB time, and error
      const r1 = await checkSyncStaleness(db, { now: t0 });
      expect(r1).toMatchObject({ checked: true, alerted: ["tunvn"], reminded: [], recovered: [] });
      const st1 = JSON.parse(
        (fx.sql.prepare("SELECT value FROM store_settings WHERE key='sync_stale_state_tunvn'").get() as { value: string }).value,
      );
      expect(st1).toMatchObject({ alerted_at: t0, last_stale_at: t0 });
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("⚠️ <b>Sinkronisasi TUNVN basi</b>");
      expect(messages[0].text).toContain("38 menit");
      expect(messages[0].text).toContain("WIB");
      expect(messages[0].text).toContain("products_ambiguous:http_502");

      // 2) Next tick < 6h later -> 0 new messages
      const r2 = await checkSyncStaleness(db, { now: t0 + 5 * 60 * 60_000 });
      expect(r2).toMatchObject({ checked: true, alerted: [], reminded: [], recovered: [] });
      expect(messages).toHaveLength(1);

      // 3) >= 6h later -> 1 reminder
      const r3 = await checkSyncStaleness(db, { now: t0 + STALE_REMINDER_INTERVAL_MS });
      expect(r3).toMatchObject({ checked: true, alerted: [], reminded: ["tunvn"], recovered: [] });
      expect(messages).toHaveLength(2);
      expect(messages[1].text).toContain("⚠️ <b>Sinkronisasi TUNVN basi</b>");

      // 4) Recovery -> 1 recovery message, and subsequent tick sends nothing
      const recoveredAt = t0 + STALE_REMINDER_INTERVAL_MS + 60_000;
      fx.sql.prepare("UPDATE store_settings SET value=? WHERE key='tunvn_catalog_success_at'").run(String(recoveredAt));
      fx.sql.prepare("UPDATE store_settings SET value='' WHERE key='tunvn_catalog_last_error'").run();

      const r4 = await checkSyncStaleness(db, { now: recoveredAt + 30_000 });
      expect(r4).toMatchObject({ checked: true, alerted: [], reminded: [], recovered: ["tunvn"] });
      const stRec = JSON.parse(
        (fx.sql.prepare("SELECT value FROM store_settings WHERE key='sync_stale_state_tunvn'").get() as { value: string }).value,
      );
      expect(stRec).toMatchObject({ last_stale_at: t0, last_recovered_at: recoveredAt + 30_000 });
      expect(stRec.alerted_at).toBeUndefined();
      expect(messages).toHaveLength(3);
      expect(messages[2].text).toContain("✅ <b>Sinkronisasi TUNVN pulih</b>");
      expect(messages[2].text).toContain("WIB");

      const r5 = await checkSyncStaleness(db, { now: recoveredAt + 120_000 });
      expect(r5).toMatchObject({ checked: true, alerted: [], reminded: [], recovered: [] });
      expect(messages).toHaveLength(3);
    } finally {
      fx.close();
    }
  });

  it("prevents duplicate alerts under parallel callers via store_settings CAS", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("true");
      enableTunvn();
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_success_at',?)").run(String(t0 - 20 * 60_000));

      const results = await Promise.all([
        checkSyncStaleness(db, { now: t0 }),
        checkSyncStaleness(db, { now: t0 }),
        checkSyncStaleness(db, { now: t0 }),
      ]);
      expect(results.flatMap((r) => r.alerted)).toEqual(["tunvn"]);
      expect(messages).toHaveLength(1);

      // Parallel recovery -> only 1 recovery message
      fx.sql.prepare("UPDATE store_settings SET value=? WHERE key='tunvn_catalog_success_at'").run(String(t0 + 60_000));
      const recResults = await Promise.all([
        checkSyncStaleness(db, { now: t0 + 90_000 }),
        checkSyncStaleness(db, { now: t0 + 90_000 }),
      ]);
      expect(recResults.flatMap((r) => r.recovered)).toEqual(["tunvn"]);
      expect(messages).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("does not send Telegram when TELEGRAM_BOT_ENABLED is false", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("false");
      enableTunvn();
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_success_at',?)").run(String(t0 - 40 * 60_000));

      const res = await checkSyncStaleness(db, { now: t0 });
      expect(res).toMatchObject({ checked: true, alerted: [], reminded: [], recovered: [] });
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("suppresses alert for never-succeeded sources until enabled for more than 1 hour", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("true");
      enableTunvn();
      const db = createDatabaseAccess(fx.db);
      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);

      // First seen enabled without success -> silent grace period starts
      await checkSyncStaleness(db, { now: t0 });
      expect(messages).toHaveLength(0);

      // 59 minutes later -> still within 1h grace period
      await checkSyncStaleness(db, { now: t0 + NEVER_SUCCEEDED_GRACE_MS - 60_000 });
      expect(messages).toHaveLength(0);

      // 61 minutes later -> alerts once
      const late = await checkSyncStaleness(db, { now: t0 + NEVER_SUCCEEDED_GRACE_MS + 60_000 });
      expect(late.alerted).toEqual(["tunvn"]);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("Belum pernah");
    } finally {
      fx.close();
    }
  });

  it("evaluates SK, Jaspay, AIVault, Games SK, Pedia IndoSMM (when marker present), and FX crypto_market_snapshot with per-source thresholds (excluding WR)", async () => {
    const fx = createD1Fixture();
    try {
      const messages = stubTelegram("true");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_API_KEY", "sk-key");
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "av-key");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "px-tok");
      vi.stubEnv("NOWPAYMENTS_API_KEY", "np-key");

      const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);

      // WR has an old wr_sync_log -> must NOT be alerted by sync-staleness (owned by alertStaleWrSync)
      fx.sql.prepare("INSERT INTO wr_sync_log(sync_type,status,created_at) VALUES('products','success',?)").run(new Date(t0 - 180 * 60_000).toISOString());

      // SK diff stale (20m >= 15m)
      fx.sql.prepare("INSERT INTO sk_sync_state(key,value) VALUES('diff_last_at',?)").run(new Date(t0 - 20 * 60_000).toISOString());
      // Jaspay stale (16m >= 15m)
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('jaspay_catalog_success_at',?)").run(String(t0 - 16 * 60_000));
      // AIVault fresh (10m < 15m)
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('aivault_catalog_success_at',?)").run(String(t0 - 10 * 60_000));
      // Games SK fresh at 25m (< 30m threshold), Pedia IndoSMM stale at 35m (>= 30m), Crypto FX stale at 95m (>= 90m)
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('games_sk_catalog_success_at',?)").run(String(t0 - 25 * 60_000));
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('pedia_indosmm_diff_last_at',?)").run(new Date(t0 - 35 * 60_000).toISOString());
      fx.sql.prepare("INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at,last_error) VALUES(1,'18000','nowpayments-estimate',?,'fx_network')").run(new Date(t0 - (SYNC_STALENESS_THRESHOLDS_MS.crypto_market + 5 * 60_000)).toISOString());

      const res = await checkSyncStaleness(createDatabaseAccess(fx.db), { now: t0 });
      expect(res.sources).toEqual(["sk", "jaspay", "aivault", "games_sk", "pedia_indosmm", "crypto_market"]);
      expect(res.alerted).toEqual(["sk", "jaspay", "pedia_indosmm", "crypto_market"]);
      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.text).join("\n")).not.toContain("Warung Rebahan");
      expect(messages[3].text).toContain("FX Pasar Crypto");
      expect(messages[3].text).toContain("fx_network");
    } finally {
      fx.close();
    }
  });

  it("yields cleanly when db.canSpend(6) is false without throwing", async () => {
    const fx = createD1Fixture();
    try {
      enableTunvn();
      const budget = createBudgetedDatabase(4, 0, fx.db);
      const res = await checkSyncStaleness(budget.access, { now: Date.now() });
      expect(res).toMatchObject({ checked: false, skipped: "query_budget" });
      expect(budget.used).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("runs from cron/lite job=cleanup and triggers Telegram alert without failing cleanup", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      const messages = stubTelegram("true");
      enableTunvn();
      const staleAt = Date.now() - 25 * 60_000;
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_success_at',?)").run(String(staleAt));

      const { POST } = await import("@/app/api/cron/lite/route");
      const { NextRequest } = await import("next/server");
      const res = await POST(
        new NextRequest("http://localhost/api/cron/lite?job=cleanup", {
          method: "POST",
          headers: { authorization: "Bearer s" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        job: "cleanup",
        staleness: { checked: true, alerted: ["tunvn"] },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("Sinkronisasi TUNVN basi");
    } finally {
      fx.close();
    }
  });
});
