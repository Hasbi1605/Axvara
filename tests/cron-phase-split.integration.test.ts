// tests/cron-phase-split.integration.test.ts
//
// Insiden 3 Okt 2026 20:25–23:50 WIB: 41 run beruntun /api/cron/operations
// dibunuh runtime Pages (`exceededResources` → 503, CPU >10 ms Free plan)
// karena satu request memikul semua fase + sync WR 49 produk + SK 157 varian.
// Heartbeat tetap tertulis (di depan handler) sehingga terlihat "hidup", dan
// Worker membuang status respons sehingga tak ada alarm 3,5 jam.
//
// Test ini mengunci obatnya: (1) `?phase=` menjalankan tepat satu fase tanpa
// menyentuh rotasi, (2) sync katalog dipotong kecil + `more:true`,
// (3) `cron_last_ok_at` hanya ditulis bila handler selesai, (4) Worker
// memanggil fase berurutan, mengulang potongan, dan mengirim alarm Telegram.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import {
  ALERT_EVERY_MINUTES,
  CRON_PHASES,
  MAX_CHUNKS_PER_PHASE,
  formatAlert,
  runOperationsTick,
  shouldAlert,
} from "../mcp-worker/src/cron";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

const syncProductsMock = vi.fn(async (..._args: unknown[]) => ({
  total: 49, synced: 10, excluded: 0, newProducts: 0, newVariants: 0, variantsSynced: 18,
  stockChanges: 0, priceChanges: 0, errors: [] as string[], durationMs: 5,
  budgetYielded: true, snapshotComplete: false,
}));
vi.mock("@/lib/warung-rebahan/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/warung-rebahan/sync")>();
  return { ...actual, syncProducts: (...args: unknown[]) => syncProductsMock(...args) };
});

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql, "manual", 1);
  syncProductsMock.mockClear();
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function run(query = "") {
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest(`http://localhost/api/cron/operations${query}`, {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const setting = (key: string) =>
  fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)?.value as string | undefined;

describe("route ?phase= (satu fase per request)", () => {
  it("menolak nama fase tak dikenal dengan 400", async () => {
    const res = await run("?phase=semua");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_phase");
  });

  it("tidak menyentuh rotasi cron_phase/cron_deferred dan menulis cron_last_ok_at", async () => {
    fixture.sql.prepare(
      `INSERT INTO store_settings(key,value) VALUES('cron_phase','notify'),('cron_deferred','["cleanup"]')`,
    ).run();
    const res = await run("?phase=expiry");
    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("expiry");
    expect(setting("cron_phase")).toBe("notify");
    expect(setting("cron_deferred")).toBe('["cleanup"]');
    expect(setting("cron_last_hit_at")).toBeTruthy();
    expect(setting("cron_last_ok_at")).toBeTruthy();
  });

  it("mode lama (tanpa ?phase) tetap memajukan rotasi dan tidak menulis cron_last_ok_at", async () => {
    fixture.sql.prepare(`INSERT INTO store_settings(key,value) VALUES('cron_phase','expiry')`).run();
    const res = await run();
    expect(res.status).toBe(200);
    expect(setting("cron_phase")).toBe("fulfillment");
    expect(setting("cron_last_ok_at")).toBeUndefined();
  });

  it("fase WR: sweep dipotong 10 produk + more:true; continue=1 hanya sync", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    const first = await run("?phase=warung_rebahan");
    expect(first.status).toBe(200);
    expect(syncProductsMock).toHaveBeenCalledTimes(1);
    expect((syncProductsMock.mock.calls[0][2] as { maxProducts: number }).maxProducts).toBe(10);
    expect(first.body.more).toBe(true);
    expect(first.body.wr_sync_skipped).toBe("budget_yielded");

    // Potongan lanjutan: cursor > 0 → lolos gerbang interval walau baru sync.
    fixture.sql.prepare(
      `INSERT INTO wr_sync_state(key,value) VALUES('products_cursor','10')
       ON CONFLICT(key) DO UPDATE SET value='10'`,
    ).run();
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger,created_at)
       VALUES('products','success',10,'cron',datetime('now'))`,
    ).run();
    const next = await run("?phase=warung_rebahan&continue=1");
    expect(next.status).toBe(200);
    expect(syncProductsMock).toHaveBeenCalledTimes(2);
    expect(next.body.wr_sync_resume).toBe(true);
    // syncOnly: langkah saldo/delivery tidak diulang.
    expect(next.body.wr_deliveries_processed).toBeUndefined();
  });

  it("interval sync katalog 15 menit: sweep 20 menit lalu (cursor 0) dimulai ulang", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger,created_at)
       VALUES('products','success',49,'cron',datetime('now','-20 minutes'))`,
    ).run();
    await run("?phase=warung_rebahan");
    expect(syncProductsMock).toHaveBeenCalledTimes(1);
  });

  it("interval sync katalog 15 menit: sweep 10 menit lalu (cursor 0) ditahan", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger,created_at)
       VALUES('products','success',49,'cron',datetime('now','-10 minutes'))`,
    ).run();
    const res = await run("?phase=warung_rebahan");
    expect(syncProductsMock).not.toHaveBeenCalled();
    expect(res.body.wr_sync_skipped).toBe("interval");
    expect(res.body.more).toBeUndefined();
  });
});

describe("Worker runOperationsTick", () => {
  const env = {
    AXVARA_API_ORIGIN: "https://axvara.test",
    AXVARA_CRON_SECRET: "s",
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_ADMIN_CHAT_ID: "-100",
  };
  const at = (minute: number) => Date.UTC(2026, 9, 3, 13, minute);

  function mockFetch(handler: (url: string) => { status: number; body?: unknown }) {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string, _init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith("https://api.telegram.org/")) return new Response("{}", { status: 200 });
      const r = handler(url);
      return new Response(JSON.stringify(r.body ?? { ok: true }), { status: r.status });
    });
    return { fn, calls };
  }

  it("memanggil semua fase berurutan, satu fase per request", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200 }));
    const report = await runOperationsTick(env, at(5), fn as never);
    expect(report.failures).toEqual([]);
    expect(calls.map((u) => new URL(u).searchParams.get("phase"))).toEqual([...CRON_PHASES]);
    expect(fn.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { authorization: "Bearer s" } });
  });

  it("mengulang potongan sync selama more:true lalu berhenti", async () => {
    let wrCalls = 0;
    const { fn, calls: seen } = mockFetch((url) => {
      if (url.includes("phase=warung_rebahan")) {
        wrCalls++;
        return { status: 200, body: { ok: true, more: wrCalls < 3 } };
      }
      return { status: 200 };
    });
    await runOperationsTick(env, at(5), fn as never);
    const wr = seen.filter((u) => u.includes("phase=warung_rebahan"));
    expect(wr).toHaveLength(3);
    expect(wr[0]).not.toContain("continue=1");
    expect(wr[1]).toContain("continue=1");
  });

  it("plafon potongan per fase mencegah loop tanpa akhir", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.includes("phase=sekalipay") ? { status: 200, body: { more: true } } : { status: 200 });
    await runOperationsTick(env, at(5), fn as never);
    expect(calls.filter((u) => u.includes("phase=sekalipay"))).toHaveLength(MAX_CHUNKS_PER_PHASE);
  });

  it("fase gagal tidak menghentikan fase berikut; alarm hanya di tick kelipatan 30 menit", async () => {
    const failing = (url: string) => (url.includes("phase=warung_rebahan") ? { status: 503 } : { status: 200 });
    const quiet = mockFetch(failing);
    const r1 = await runOperationsTick(env, at(25), quiet.fn as never);
    expect(r1.failures.map((f) => [f.phase, f.status])).toEqual([["warung_rebahan", 503]]);
    expect(r1.alerted).toBe(false);
    expect(quiet.calls.some((u) => u.includes("phase=cleanup"))).toBe(true);
    expect(quiet.calls.some((u) => u.startsWith("https://api.telegram.org/"))).toBe(false);

    const loud = mockFetch(failing);
    const r2 = await runOperationsTick(env, at(30), loud.fn as never);
    expect(r2.alerted).toBe(true);
    const tg = loud.fn.mock.calls.find((c) => String(c[0]).startsWith("https://api.telegram.org/"));
    const payload = JSON.parse(String(tg?.[1]?.body));
    expect(payload.chat_id).toBe("-100");
    expect(payload.text).toContain("warung_rebahan: HTTP 503");
  });

  it("tanpa secret Telegram tidak mengirim alarm, tanpa melempar", async () => {
    const { fn } = mockFetch(() => ({ status: 503 }));
    const report = await runOperationsTick(
      { AXVARA_API_ORIGIN: env.AXVARA_API_ORIGIN, AXVARA_CRON_SECRET: "s" }, at(0), fn as never);
    expect(report.failures).toHaveLength(CRON_PHASES.length);
    expect(report.alerted).toBe(false);
  });

  it("shouldAlert + formatAlert", () => {
    expect(ALERT_EVERY_MINUTES).toBe(30);
    expect(shouldAlert(at(0))).toBe(true);
    expect(shouldAlert(at(30))).toBe(true);
    expect(shouldAlert(at(35))).toBe(false);
    const text = formatAlert([{ phase: "sekalipay", calls: 1, ok: false, status: 0, error: "timeout" }], at(30));
    expect(text).toContain("20:30 WIB");
    expect(text).toContain("sekalipay: timeout");
  });
});
