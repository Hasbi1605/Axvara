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
  ALARM_KV_KEY,
  ALARM_REMINDER_MS,
  ALERT_EVERY_MINUTES,
  CRON_STEPS,
  MAX_CHUNKS_PER_PHASE,
  formatAlert,
  nextAlarmState,
  runOperationsTick,
  shouldAlert,
  stepLabel,
  type AlarmState,
  type PhaseOutcome,
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

  it("ambang 14 menit: sweep 14 mnt 58 dtk lalu (tick menit ke-15) TIDAK ditunda ke tick berikut", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger,created_at)
       VALUES('products','success',49,'cron',datetime('now','-898 seconds'))`,
    ).run();
    await run("?phase=warung_rebahan&part=sync");
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

  it("diff VPS sehat: sweep pengaman hanya tiap 60 mnt; diff basi → kembali 14 mnt", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    const setState = (k: string, v: string) => fixture.sql.prepare(
      `INSERT INTO wr_sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v);
    const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
    fixture.sql.prepare(`INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger,created_at)
      VALUES('products','success',1,'cron',datetime('now','-30 minutes'))`).run();
    setState("diff_last_at", iso(2));
    setState("products_full_sweep_at", iso(30));
    await run("?phase=warung_rebahan&part=sync");
    expect(syncProductsMock).not.toHaveBeenCalled();
    setState("products_full_sweep_at", iso(61));
    await run("?phase=warung_rebahan&part=sync");
    expect(syncProductsMock).toHaveBeenCalledTimes(1);
    setState("products_full_sweep_at", iso(1));
    setState("diff_last_at", iso(11)); // diff basi → gerbang lama 14 mnt (log 30 mnt lalu)
    await run("?phase=warung_rebahan&part=sync");
    expect(syncProductsMock).toHaveBeenCalledTimes(2);
  });

  it("part=orders melewati sync katalog; part=sync melewati order", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    const orders = await run("?phase=warung_rebahan&part=orders");
    expect(orders.status).toBe(200);
    expect(orders.body.part).toBe("orders");
    expect(orders.body.wr_sync_skipped).toBe("part_orders");
    expect(syncProductsMock).not.toHaveBeenCalled();

    const sync = await run("?phase=warung_rebahan&part=sync");
    expect(sync.status).toBe(200);
    expect(syncProductsMock).toHaveBeenCalledTimes(1);
    expect((syncProductsMock.mock.calls[0][2] as { useProxySlices: boolean }).useProxySlices).toBe(true);
    expect(sync.body.wr_deliveries_processed).toBeUndefined();
  });

  it("part hanya untuk fase WR/SK dan nilai valid", async () => {
    expect((await run("?phase=expiry&part=orders")).status).toBe(400);
    expect((await run("?phase=warung_rebahan&part=semua")).body.error).toBe("invalid_part");
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
  const label = (u: string) => {
    const q = new URL(u).searchParams;
    if (q.get("job")) return `lite:${q.get("job")}`;
    return q.get("part") ? `${q.get("phase")}:${q.get("part")}` : String(q.get("phase"));
  };

  function mockFetch(handler: (url: string) => { status: number; body?: unknown }) {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string, _init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith("https://api.telegram.org/")) return new Response("{}", { status: 200 });
      const r = handler(url);
      return new Response(JSON.stringify(r.body ?? { ok: true }), { status: r.status });
    });
    const telegram = () => fn.mock.calls
      .filter((c) => String(c[0]).startsWith("https://api.telegram.org/"))
      .map((c) => JSON.parse(String(c[1]?.body)).text as string);
    return { fn, calls, telegram };
  }

  function memoryKv() {
    const store = new Map<string, string>();
    let puts = 0;
    return {
      kv: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { puts++; store.set(k, v); } },
      store,
      puts: () => puts,
    };
  }

  it("tick biasa (:05) hanya langkah lite; route besar tidak dipanggil", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200 }));
    const report = await runOperationsTick(env, at(5), fn as never);
    expect(report.failures).toEqual([]);
    expect(calls.map(label)).toEqual([
      "lite:expiry", "lite:fulfillment", "lite:wr_orders", "lite:sk_orders", "lite:notify", "lite:promo", "lite:cleanup",
    ]);
    expect(calls.some((u) => u.includes("/api/cron/operations"))).toBe(false);
  });

  it("tick :00 UTC: lite dulu, lalu route besar sebagai pelengkap per jam", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 200 }));
    const report = await runOperationsTick(env, Date.UTC(2026, 9, 3, 14, 0), fn as never);
    expect(report.failures).toEqual([]);
    expect(calls.map(label)).toEqual([
      "lite:expiry", "lite:fulfillment", "lite:wr_orders", "lite:sk_orders", "lite:notify", "lite:promo", "lite:cleanup",
      "expiry", "fulfillment", "warung_rebahan:orders", "sekalipay:orders",
      "notify", "warung_rebahan:sync", "sekalipay:sync", "cleanup",
    ]);
    expect(CRON_STEPS.map(stepLabel)).toEqual(calls.map(label));
    expect(fn.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { authorization: "Bearer s" } });
    expect(calls[0]).toBe("https://axvara.test/api/cron/lite?job=expiry");
  });

  it("mengulang potongan sync selama more:true lalu berhenti", async () => {
    let wrCalls = 0;
    const { fn, calls } = mockFetch((url) => {
      if (url.includes("phase=warung_rebahan&part=sync")) {
        wrCalls++;
        return { status: 200, body: { ok: true, more: wrCalls < 3 } };
      }
      return { status: 200 };
    });
    await runOperationsTick(env, at(0), fn as never);
    const wr = calls.filter((u) => u.includes("phase=warung_rebahan&part=sync"));
    expect(wr).toHaveLength(3);
    expect(wr[0]).not.toContain("continue=1");
    expect(wr[1]).toContain("continue=1");
    // Langkah orders tidak diulang walau membalas more:true.
    expect(calls.filter((u) => u.includes("part=orders") && u.includes("warung_rebahan"))).toHaveLength(1);
  });

  it("plafon potongan per langkah mencegah loop tanpa akhir", async () => {
    const { fn, calls } = mockFetch((url) =>
      url.includes("phase=sekalipay&part=sync") ? { status: 200, body: { more: true } } : { status: 200 });
    await runOperationsTick(env, at(0), fn as never);
    expect(calls.filter((u) => u.includes("phase=sekalipay&part=sync"))).toHaveLength(MAX_CHUNKS_PER_PHASE);
  });

  it("tanpa KV: fallback stateless — alarm hanya di tick :00/:30, hanya langkah lite (hard)", async () => {
    const failing = (url: string) => (url.includes("job=wr_orders") || url.includes("phase=") ? { status: 503 } : { status: 200 });
    const quiet = mockFetch(failing);
    const r1 = await runOperationsTick(env, at(25), quiet.fn as never);
    expect(r1.failures.map((f) => f.step)).toEqual(["lite:wr_orders"]);
    expect(r1.alerted).toBe(false);
    // Tick :00 UTC: route besar ikut dipanggil, tetapi kegagalannya tidak dihitung.
    const heavy = mockFetch(failing);
    const r0 = await runOperationsTick(env, at(0) + 60 * 60_000, heavy.fn as never);
    expect(heavy.calls.some((u) => u.includes("phase=cleanup"))).toBe(true);
    expect(r0.failures.map((f) => f.step)).toEqual(["lite:wr_orders"]);

    const loud = mockFetch(failing);
    const r2 = await runOperationsTick(env, at(30), loud.fn as never);
    expect(r2.alerted).toBe(true);
    expect(loud.telegram()[0]).toContain("lite:wr_orders: HTTP 503");
    expect(loud.telegram()[0]).not.toContain(":sync");
    expect(loud.telegram()[0]).not.toContain("notify");
  });

  it("dengan KV: 1 pesan mulai (2 tick gagal), diam di tengah, 1 pesan pulih (3 tick sukses)", async () => {
    const mem = memoryKv();
    const kvEnv = { ...env, CRON_STATE: mem.kv };
    const fail = mockFetch((url) => (url.includes("job=sk_orders") ? { status: 503 } : { status: 200 }));
    const ok = mockFetch(() => ({ status: 200 }));
    const tick = (m: number, f: typeof fail) => runOperationsTick(kvEnv, at(0) + m * 60_000, f.fn as never);

    expect((await tick(0, fail)).action).toBe("none");      // gagal ke-1: diam
    expect((await tick(5, fail)).action).toBe("start");     // gagal ke-2: alarm
    for (let m = 10; m <= 120; m += 5) expect((await tick(m, fail)).action).toBe("none");
    expect(fail.telegram()).toHaveLength(1);
    expect(fail.telegram()[0]).toContain("Pesan berikutnya");
    const putsDuringOutage = mem.puts();
    expect(putsDuringOutage).toBeLessThanOrEqual(3); // tidak menulis KV tiap tick

    expect((await tick(125, ok)).action).toBe("none");
    expect((await tick(130, ok)).action).toBe("none");
    expect((await tick(135, ok)).action).toBe("recovered");
    expect(ok.telegram()).toHaveLength(1);
    expect(ok.telegram()[0]).toContain("✅ Cron AXVARA pulih");
    expect(ok.telegram()[0]).toContain("Gangguan sejak 20:00 WIB");
    expect(JSON.parse(String(mem.store.get(ALARM_KV_KEY))).since).toBeNull();
  });

  it("route besar gagal total tak pernah alarm; promo (soft) baru setelah 6 tick; lite 2 tick", async () => {
    const memNone = memoryKv();
    const heavyDown = mockFetch((url) => (url.includes("/api/cron/operations") ? { status: 503 } : { status: 200 }));
    for (let i = 0; i < 8; i++) {
      expect((await runOperationsTick({ ...env, CRON_STATE: memNone.kv }, at(0) + i * 300_000, heavyDown.fn as never)).action).toBe("none");
    }
    expect(heavyDown.telegram()).toHaveLength(0);

    const mem = memoryKv();
    const kvEnv = { ...env, CRON_STATE: mem.kv };
    const softFail = mockFetch((url) => (url.includes("job=promo") ? { status: 503 } : { status: 200 }));
    const actions: string[] = [];
    for (let i = 0; i < 6; i++) actions.push((await runOperationsTick(kvEnv, at(0) + i * 300_000, softFail.fn as never)).action);
    expect(actions).toEqual(["none", "none", "none", "none", "none", "start"]);
    expect(softFail.telegram()).toHaveLength(1);
    // Kegagalan order tetap 2 tick.
    const mem2 = memoryKv();
    const hard = mockFetch((url) => (url.includes("job=expiry") ? { status: 503 } : { status: 200 }));
    const env2 = { ...env, CRON_STATE: mem2.kv };
    expect((await runOperationsTick(env2, at(0), hard.fn as never)).action).toBe("none");
    expect((await runOperationsTick(env2, at(5), hard.fn as never)).action).toBe("start");
  });

  it("gangguan sesaat (1 tick gagal lalu pulih) tidak mengirim apa pun", async () => {
    const mem = memoryKv();
    const kvEnv = { ...env, CRON_STATE: mem.kv };
    const fail = mockFetch(() => ({ status: 503 }));
    const ok = mockFetch(() => ({ status: 200 }));
    await runOperationsTick(kvEnv, at(0), fail.fn as never);
    const r = await runOperationsTick(kvEnv, at(5), ok.fn as never);
    expect(r.action).toBe("none");
    expect(fail.telegram().length + ok.telegram().length).toBe(0);
  });

  it("nextAlarmState: pengingat setelah 6 jam; pulih butuh 3 tick sukses beruntun", () => {
    const f: PhaseOutcome[] = [{ step: "sekalipay:orders", calls: 1, ok: false, status: 503 }];
    const t0 = at(0);
    const alerted: AlarmState = { since: t0, failedTicks: 2, okTicks: 0, alertedAt: t0, lastFailures: [] };
    expect(nextAlarmState(alerted, f, t0 + ALARM_REMINDER_MS - 1).action).toBe("none");
    expect(nextAlarmState(alerted, f, t0 + ALARM_REMINDER_MS).action).toBe("reminder");
    const ok1 = nextAlarmState(alerted, [], t0 + 1).state;
    const backToFail = nextAlarmState(ok1, f, t0 + 2);
    expect(backToFail.action).toBe("none"); // masih episode yang sama, tanpa alarm ulang
    expect(backToFail.state.okTicks).toBe(0);
  });

  it("Telegram gagal saat alarm mulai → dicoba lagi tick berikut", async () => {
    const mem = memoryKv();
    const kvEnv = { ...env, CRON_STATE: mem.kv, TELEGRAM_BOT_TOKEN: undefined };
    const fail = mockFetch(() => ({ status: 503 }));
    await runOperationsTick(kvEnv, at(0), fail.fn as never);
    const r = await runOperationsTick(kvEnv, at(5), fail.fn as never);
    expect(r.action).toBe("start");
    expect(r.alerted).toBe(false);
    expect(JSON.parse(String(mem.store.get(ALARM_KV_KEY))).alertedAt).toBeNull();
  });

  it("shouldAlert + formatAlert", () => {
    expect(ALERT_EVERY_MINUTES).toBe(30);
    expect(shouldAlert(at(0))).toBe(true);
    expect(shouldAlert(at(35))).toBe(false);
    const text = formatAlert([{ step: "sekalipay:sync", calls: 1, ok: false, status: 0, error: "timeout" }], at(30));
    expect(text).toContain("20:30 WIB");
    expect(text).toContain("sekalipay:sync: timeout");
  });
});
