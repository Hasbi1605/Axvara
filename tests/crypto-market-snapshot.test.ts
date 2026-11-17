// FX otomatis + katalog koin crypto (LOCAL ONLY): hitung kurs, refresh dengan
// fetch ter-mock (tanpa jaringan nyata), pembaca (D1 -> env -> null), toleransi 2%.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { computeIdrPerUsd, isRateWithin } from "@/lib/payments/fx";
import { isFxSnapshotAcceptable } from "@/lib/payments/crypto-preflight";
import { CRYPTO_ASSETS, getCryptoAsset, isCuratedCryptoTicker } from "@/lib/payments/crypto-assets";
import { getCryptoMarketSnapshot, loadCurrentFxSnapshot, resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import { isMarketRefreshDue, refreshCryptoMarketSnapshot } from "@/lib/payments/market-snapshot-refresh";

let fx: ReturnType<typeof createD1Fixture>;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const MIN = 60_000, HOUR = 60 * MIN;

beforeEach(() => {
  fx = createD1Fixture();
  resetCryptoMarketMemo();
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-key");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
  vi.stubEnv("USD_IDR_RATE", "");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", "");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetCryptoMarketMemo(); });

const row = () => fx.sql.prepare("SELECT * FROM crypto_market_snapshot WHERE id=1").get() as Record<string, unknown> | undefined;
const seed = (v: Record<string, unknown>) => {
  const cols = Object.keys(v);
  fx.sql.prepare(`INSERT INTO crypto_market_snapshot (id,${cols.join(",")}) VALUES (1,${cols.map(() => "?").join(",")})`).run(...Object.values(v));
};

type Mock = { urls: string[]; maxInflight: number };
function mockProvider(over: {
  idrEstimate?: string; usdEstimate?: string; merchant?: string[] | "fail";
  minFail?: (ticker: string) => "http" | "garbage" | false; minNoFiat?: boolean; estimateFail?: boolean;
} = {}): Mock {
  const state: Mock = { urls: [], maxInflight: 0 };
  let inflight = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    state.urls.push(url);
    inflight++; state.maxInflight = Math.max(state.maxInflight, inflight);
    try {
      await new Promise((r) => setTimeout(r, 3));
      if (url.includes("/estimate?")) {
        if (over.estimateFail) return new Response("no", { status: 502 });
        const from = new URL(url).searchParams.get("currency_from");
        return Response.json(from === "idr"
          ? { currency_from: "idr", amount_from: 1000000, currency_to: "usdtbsc", estimated_amount: over.idrEstimate ?? "55.4124257" }
          : { currency_from: "usd", amount_from: 100, currency_to: "usdtbsc", estimated_amount: over.usdEstimate ?? "100.2283127" });
      }
      if (url.endsWith("/merchant/coins")) {
        if (over.merchant === "fail") return new Response("no", { status: 500 });
        return Response.json({ selectedCurrencies: (over.merchant ?? ["BTC", "USDTBSC", "TRX"]).map((t) => t.toUpperCase()) });
      }
      if (url.includes("/min-amount?")) {
        const u = new URL(url);
        const t = u.searchParams.get("currency_from")!;
        const fail = over.minFail?.(t);
        if (fail === "http") return new Response("no", { status: 500 });
        if (fail === "garbage") return new Response("<html>", { status: 200 });
        return Response.json({ currency_from: t, currency_to: u.searchParams.get("currency_to"), min_amount: 0.0001,
          ...(over.minNoFiat ? {} : { fiat_equivalent: t === "btc" ? 1.95 : 0.08 }) });
      }
      throw new Error(`unexpected network ${url}`);
    } finally { inflight--; }
  }));
  return state;
}

describe("computeIdrPerUsd (exact bigint, half-up 2dp, sanity 5000-50000)", () => {
  it("derives the live-fact sample rate and rounds to 2 decimals", () => {
    expect(computeIdrPerUsd("55.4124257", "100.2283127")).toBe("18087.70");
  });
  it("rounds half up on the third decimal", () => {
    expect(computeIdrPerUsd("2", "3.60000101")).toBe("18000.01"); // 18000.00505
    expect(computeIdrPerUsd("2", "3.6000009")).toBe("18000.00"); // 18000.0045
  });
  it.each([
    ["below 5000", "2", "0.9"], ["above 50000", "1", "6"], ["zero", "0", "1"], ["zero usd", "1", "0"],
    ["garbage", "abc", "1"], ["negative text", "-1", "1"], ["exponent", "1e2", "1"],
  ])("rejects %s", (_l, idr, usd) => { expect(computeIdrPerUsd(idr, usd)).toBeNull(); });
  it("boundaries 5000.00 and 50000.00 are accepted", () => {
    expect(computeIdrPerUsd("2", "1")).toBe("5000.00");
    expect(computeIdrPerUsd("1", "5")).toBe("50000.00");
  });
});

describe("isRateWithin / create-time 2% tolerance", () => {
  const r = (n: number, d = 1) => ({ num: BigInt(n), den: BigInt(d) });
  it("exact rational tolerance", () => {
    expect(isRateWithin(r(16320), r(16000), 2, 100)).toBe(true); // exactly +2%
    expect(isRateWithin(r(16321), r(16000), 2, 100)).toBe(false);
    expect(isRateWithin(r(15680), r(16000), 2, 100)).toBe(true); // exactly -2%
    expect(isRateWithin(r(15679), r(16000), 2, 100)).toBe(false);
  });
  const cur = (rate: string, source: "nowpayments-estimate" | "operator-fixed" = "nowpayments-estimate") =>
    ({ rateText: rate, rateNum: rate.replace(".", ""), rateDen: rate.includes(".") ? "100" : "1", effectiveAt: iso(-MIN), source });
  const signed = (extra: Partial<{ rate_num: string; rate_den: string; effective_at: string }> = {}) =>
    ({ rate_num: "1600000", rate_den: "100", effective_at: iso(-10 * MIN), ...extra });
  it("accepts within 2%, rejects beyond, null current, stale/future/garbage signed", () => {
    expect(isFxSnapshotAcceptable(cur("16200.00"), signed())).toBe(true);
    expect(isFxSnapshotAcceptable(cur("16320.00"), signed())).toBe(true);
    expect(isFxSnapshotAcceptable(cur("16400.00"), signed())).toBe(false);
    expect(isFxSnapshotAcceptable(null, signed())).toBe(false);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ effective_at: iso(-25 * HOUR) }))).toBe(false);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ effective_at: iso(-23 * HOUR) }))).toBe(true);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ effective_at: iso(10 * MIN) }))).toBe(false);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ effective_at: "nope" }))).toBe(false);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ rate_num: "0" }))).toBe(false);
    expect(isFxSnapshotAcceptable(cur("16000.00"), signed({ rate_num: "x" }))).toBe(false);
  });
});

describe("crypto asset catalog", () => {
  it("contains exactly the curated 28 coins and excludes the disabled ones", () => {
    expect(CRYPTO_ASSETS).toHaveLength(28);
    expect(new Set(CRYPTO_ASSETS.map((a) => a.ticker)).size).toBe(28);
    for (const excluded of ["btclightning", "usddtrc20", "tusdtrc20"]) expect(isCuratedCryptoTicker(excluded)).toBe(false);
    expect(getCryptoAsset("USDTBSC")).toMatchObject({ symbol: "USDT", network: "bsc", networkLabel: "BNB Smart Chain", group: "stable", logo: "/payments/coins/usdtbsc.svg" });
    expect(getCryptoAsset("bnbbsc")).toMatchObject({ symbol: "BNB", group: "popular" });
    const orders = CRYPTO_ASSETS.map((a) => a.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(CRYPTO_ASSETS.filter((a) => a.group === "popular").map((a) => a.ticker)).toEqual(["btc", "eth", "bnbbsc", "trx", "ltc", "ton"]);
  });
});

describe("migration 0101 matches schema.sql", () => {
  it("creates the same single-row table and rejects id != 1", () => {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { all(): unknown[] } } };
    const mig = new DatabaseSync(":memory:");
    mig.exec(fs.readFileSync("drizzle/migrations/0101_crypto_market_snapshot.sql", "utf8"));
    const info = (db: { prepare(s: string): { all(): unknown[] } }) => db.prepare("PRAGMA table_info(crypto_market_snapshot)").all();
    expect(info(mig)).toEqual(info(fx.sql));
    expect(info(mig).length).toBe(10);
    expect(() => fx.sql.exec("INSERT INTO crypto_market_snapshot(id) VALUES (2)")).toThrow();
  });
});

describe("refreshCryptoMarketSnapshot", () => {
  const access = () => createDatabaseAccess(fx.db);

  it("first run: writes FX + curated coins with floating min-amount form", async () => {
    const mock = mockProvider({ merchant: ["btc", "usdtbsc", "trx", "usddtrc20", "btclightning", "tusdtrc20", "weird"] });
    const result = await refreshCryptoMarketSnapshot(access());
    expect(result).toMatchObject({ status: "refreshed", fx: "updated", coins: 3 });
    const saved = row()!;
    expect(saved).toMatchObject({ fx_rate_text: "18087.70", fx_source: "nowpayments-estimate", last_error: null, lease_until: null });
    expect(Date.parse(String(saved.fx_effective_at))).toBeGreaterThan(Date.now() - 5000);
    expect(JSON.parse(String(saved.coins_json))).toEqual([
      { ticker: "btc", min_usd_text: "1.95" }, { ticker: "trx", min_usd_text: "0.08" }, { ticker: "usdtbsc", min_usd_text: "0.08" },
    ]);
    const estimates = mock.urls.filter((u) => u.includes("/estimate?"));
    expect(estimates.map((u) => new URL(u).searchParams.get("amount")).sort()).toEqual(["100", "1000000"]);
    for (const u of mock.urls.filter((x) => x.includes("/min-amount?"))) {
      expect(u).toContain("fiat_equivalent=usd");
      expect(u).toContain("currency_to=usdtbsc");
      expect(u).not.toMatch(/is_fixed_rate|is_fee_paid_by_user/);
    }
    expect(mock.urls.every((u) => u.startsWith("https://api.nowpayments.io/v1/"))).toBe(true);
  });

  it("does not depend on NOWPAYMENTS_ENABLED and uses fallback outcome usdtbsc when unset", async () => {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "false");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "");
    const mock = mockProvider();
    expect((await refreshCryptoMarketSnapshot(access())).status).toBe("refreshed");
    expect(mock.urls.some((u) => u.includes("currency_to=usdtbsc") && u.includes("/min-amount?"))).toBe(true);
  });

  it("missing key is a no-op without network or row", async () => {
    vi.stubEnv("NOWPAYMENTS_API_KEY", "");
    const mock = mockProvider();
    expect(await refreshCryptoMarketSnapshot(access())).toEqual({ status: "skipped_no_key" });
    expect(mock.urls).toHaveLength(0);
    expect(row()).toBeUndefined();
  });

  it("not due when both FX and coins are younger than 30 minutes; due when either is older", async () => {
    seed({ fx_rate_text: "18000.00", fx_source: "nowpayments-estimate", fx_effective_at: iso(-10 * MIN), coins_json: "[]", coins_refreshed_at: iso(-10 * MIN) });
    const mock = mockProvider();
    expect(await refreshCryptoMarketSnapshot(access())).toEqual({ status: "not_due" });
    expect(mock.urls).toHaveLength(0);
    fx.sql.prepare("UPDATE crypto_market_snapshot SET coins_refreshed_at=?").run(iso(-31 * MIN));
    expect(isMarketRefreshDue(row() as never, Date.now())).toBe(true);
    expect((await refreshCryptoMarketSnapshot(access())).status).toBe("refreshed");
  });

  it("a recent failed attempt (<2 min) is not retried immediately", async () => {
    seed({ last_attempt_at: iso(-30_000), last_error: "fx_http_502" });
    const mock = mockProvider();
    expect(await refreshCryptoMarketSnapshot(access())).toEqual({ status: "not_due" });
    expect(mock.urls).toHaveLength(0);
  });

  it("partial coin failures omit only the failed coins and record the count", async () => {
    mockProvider({ merchant: ["btc", "trx", "usdtbsc", "eth", "ltc"], minFail: (t) => (t === "btc" ? "http" : t === "trx" ? "garbage" : t === "eth" ? "http" : false) });
    // eth missing fiat_equivalent handled below; here btc/trx/eth fail
    const result = await refreshCryptoMarketSnapshot(access());
    expect(result).toMatchObject({ status: "refreshed", coins: 2 });
    expect(JSON.parse(String(row()!.coins_json)).map((c: { ticker: string }) => c.ticker)).toEqual(["ltc", "usdtbsc"]);
    expect(String(row()!.last_error)).toContain("coins_min_omitted_3");
  });

  it("coin without fiat_equivalent is omitted (never guessed)", async () => {
    mockProvider({ merchant: ["btc"], minNoFiat: true });
    const result = await refreshCryptoMarketSnapshot(access());
    expect(result.coins).toBe("kept");
    expect(String(row()!.last_error)).toContain("coins_min_failed");
  });

  it("merchant/coins failure keeps previous coins, still updates FX, sets last_error", async () => {
    const oldCoins = JSON.stringify([{ ticker: "btc", min_usd_text: "2.5" }]);
    const oldAt = iso(-40 * MIN);
    seed({ fx_rate_text: "18000.00", fx_source: "nowpayments-estimate", fx_effective_at: iso(-40 * MIN), coins_json: oldCoins, coins_refreshed_at: oldAt });
    mockProvider({ merchant: "fail" });
    const result = await refreshCryptoMarketSnapshot(access());
    expect(result).toMatchObject({ status: "refreshed", fx: "updated", coins: "kept" });
    expect(row()).toMatchObject({ coins_json: oldCoins, coins_refreshed_at: oldAt, fx_rate_text: "18087.70", last_error: "coins_merchant_failed" });
  });

  it("FX jump >10% against a fresh stored rate is rejected and the old value kept", async () => {
    const at = iso(-40 * MIN);
    seed({ fx_rate_text: "16000.00", fx_source: "nowpayments-estimate", fx_effective_at: at, coins_json: "[]", coins_refreshed_at: iso(-40 * MIN) });
    mockProvider();
    const result = await refreshCryptoMarketSnapshot(access());
    expect(result).toMatchObject({ status: "refreshed", fx: "kept" });
    expect(row()).toMatchObject({ fx_rate_text: "16000.00", fx_effective_at: at });
    expect(String(row()!.last_error)).toContain("fx_jump_rejected");
  });

  it("a stored rate older than 24h no longer anchors the jump guard", async () => {
    seed({ fx_rate_text: "10000.00", fx_source: "nowpayments-estimate", fx_effective_at: iso(-26 * HOUR) });
    mockProvider();
    expect(await refreshCryptoMarketSnapshot(access())).toMatchObject({ fx: "updated" });
    expect(row()!.fx_rate_text).toBe("18087.70");
  });

  it("small change (<10%) is accepted", async () => {
    seed({ fx_rate_text: "17500.00", fx_source: "nowpayments-estimate", fx_effective_at: iso(-40 * MIN) });
    mockProvider();
    expect(await refreshCryptoMarketSnapshot(access())).toMatchObject({ fx: "updated" });
  });

  it("out-of-range estimate and estimate HTTP failure keep FX and record the error", async () => {
    mockProvider({ idrEstimate: "2000", usdEstimate: "1" });
    expect(await refreshCryptoMarketSnapshot(access(), { force: true })).toMatchObject({ fx: "kept" });
    expect(String(row()!.last_error)).toContain("fx_out_of_range");
    expect(row()!.fx_rate_text).toBeNull();
    mockProvider({ estimateFail: true });
    expect(await refreshCryptoMarketSnapshot(access(), { force: true })).toMatchObject({ fx: "kept" });
    expect(String(row()!.last_error)).toContain("fx_http_502");
  });

  it("lease contention: live lease blocks, expired lease is taken over, concurrent calls refresh once", async () => {
    seed({ lease_until: iso(60_000) });
    const mock = mockProvider();
    expect(await refreshCryptoMarketSnapshot(access(), { force: true })).toEqual({ status: "lease_busy" });
    expect(mock.urls).toHaveLength(0);
    fx.sql.prepare("UPDATE crypto_market_snapshot SET lease_until=?, last_attempt_at=NULL").run(iso(-1000));
    expect((await refreshCryptoMarketSnapshot(access(), { force: true })).status).toBe("refreshed");
    expect(row()!.lease_until).toBeNull();
    // Concurrent isolates (both saw "due"): exactly one performs the refresh.
    fx.sql.exec("DELETE FROM crypto_market_snapshot");
    const m2 = mockProvider();
    const results = await Promise.all([refreshCryptoMarketSnapshot(access()), refreshCryptoMarketSnapshot(access())]);
    expect(results.map((r) => r.status).sort()).toEqual(["lease_busy", "refreshed"]);
    expect(m2.urls.filter((u) => u.includes("/estimate?"))).toHaveLength(2);
  });

  it("lease stolen mid-refresh: final write is CAS-guarded and does not clobber", async () => {
    mockProvider();
    fx.control.afterRun = async (q) => {
      if (q.startsWith("INSERT INTO crypto_market_snapshot")) fx.sql.prepare("UPDATE crypto_market_snapshot SET lease_until='2999-01-01T00:00:00.000Z'").run();
    };
    const result = await refreshCryptoMarketSnapshot(access(), { force: true });
    expect(result.status).toBe("lease_busy");
    expect(result.errors).toContain("lease_lost");
    expect(row()!.fx_rate_text).toBeNull();
  });

  it("caps concurrency at 2 for min-amount calls and runs FX estimates sequentially before coin calls", async () => {
    const tickers = CRYPTO_ASSETS.map((a) => a.ticker);
    const events: string[] = [];
    let inflight = 0;
    let maxInflight = 0;
    let coinSeen = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      try {
        await new Promise((r) => setTimeout(r, 3));
        if (url.includes("/estimate?")) {
          expect(coinSeen).toBe(false);
          expect(inflight).toBe(1);
          events.push("estimate");
          const from = new URL(url).searchParams.get("currency_from");
          return Response.json(from === "idr"
            ? { currency_from: "idr", currency_to: "usdtbsc", estimated_amount: "55.4124257" }
            : { currency_from: "usd", currency_to: "usdtbsc", estimated_amount: "100.2283127" });
        }
        coinSeen = true;
        if (url.endsWith("/merchant/coins")) {
          events.push("merchant");
          return Response.json({ selectedCurrencies: tickers.map((t) => t.toUpperCase()) });
        }
        if (url.includes("/min-amount?")) {
          events.push("min");
          const t = new URL(url).searchParams.get("currency_from")!;
          return Response.json({ currency_from: t, currency_to: "usdtbsc", min_amount: 0.01, fiat_equivalent: 0.5 });
        }
        throw new Error(`unexpected ${url}`);
      } finally { inflight--; }
    }));
    expect(await refreshCryptoMarketSnapshot(access(), { concurrency: 6 })).toMatchObject({ status: "refreshed", fx: "updated", coins: 28 });
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBeGreaterThan(1);
    expect(events.slice(0, 3)).toEqual(["estimate", "estimate", "merchant"]);
  });

  it("retries FX estimate once on 429 honoring Retry-After<=5s or 2s fallback within client deadline", async () => {
    const oldAt = iso(-40 * MIN);
    seed({ fx_rate_text: "18000.00", fx_source: "nowpayments-estimate", fx_effective_at: oldAt, coins_json: "[]", coins_refreshed_at: oldAt });
    const sleeps: number[] = [];
    let idrCalls = 0;
    let usdCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/estimate?")) {
        const from = new URL(url).searchParams.get("currency_from");
        if (from === "idr") {
          idrCalls++;
          if (idrCalls === 1) return new Response("rate limit", { status: 429, headers: { "Retry-After": "3" } });
          return Response.json({ currency_from: "idr", currency_to: "usdtbsc", estimated_amount: "55.4124257" });
        }
        usdCalls++;
        if (usdCalls === 1) return new Response("rate limit", { status: 429, headers: { "Retry-After": "12" } });
        return Response.json({ currency_from: "usd", currency_to: "usdtbsc", estimated_amount: "100.2283127" });
      }
      if (url.endsWith("/merchant/coins")) return Response.json({ selectedCurrencies: ["BTC"] });
      return Response.json({ currency_from: "btc", currency_to: "usdtbsc", min_amount: 0.0001, fiat_equivalent: 1.95 });
    }));
    const res = await refreshCryptoMarketSnapshot(access(), {
      force: true,
      sleepImpl: async (ms) => { sleeps.push(ms); },
    });
    expect(res).toMatchObject({ status: "refreshed", fx: "updated", coins: 1 });
    expect(sleeps).toEqual([3000, 2000]);
    expect(row()!.fx_rate_text).toBe("18087.70");
    expect(Date.parse(String(row()!.fx_effective_at))).toBeGreaterThan(Date.parse(oldAt));
    expect(row()!.last_error).toBeNull();

    // Persistent 429 retries only once; tight deadline skips sleep/retry.
    let persistentCalls = 0;
    const sleeps2: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/estimate?")) { persistentCalls++; return new Response("429", { status: 429 }); }
      if (url.endsWith("/merchant/coins")) return Response.json({ selectedCurrencies: ["BTC"] });
      return Response.json({ currency_from: "btc", currency_to: "usdtbsc", min_amount: 0.0001, fiat_equivalent: 1.95 });
    }));
    const failRes = await refreshCryptoMarketSnapshot(access(), {
      force: true,
      sleepImpl: async (ms) => { sleeps2.push(ms); },
    });
    expect(failRes).toMatchObject({ status: "refreshed", fx: "kept" });
    expect(persistentCalls).toBe(2);
    expect(sleeps2).toEqual([2000]);
    expect(String(row()!.last_error)).toContain("fx_http_429");

    persistentCalls = 0;
    const sleeps3: number[] = [];
    const deadlineRes = await refreshCryptoMarketSnapshot(access(), {
      force: true,
      totalDeadlineMs: 500,
      sleepImpl: async (ms) => { sleeps3.push(ms); },
    });
    expect(deadlineRes).toMatchObject({ status: "refreshed", fx: "kept" });
    expect(persistentCalls).toBe(1);
    expect(sleeps3).toEqual([]);
  });

  it("429 on coins stops min-amount early, preserves previous coins, and still advances FX", async () => {
    const oldCoins = JSON.stringify([{ ticker: "btc", min_usd_text: "2.5" }]);
    const oldAt = iso(-40 * MIN);
    seed({ fx_rate_text: "18000.00", fx_source: "nowpayments-estimate", fx_effective_at: oldAt, coins_json: oldCoins, coins_refreshed_at: oldAt });
    const minCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/estimate?")) {
        const from = new URL(url).searchParams.get("currency_from");
        return Response.json(from === "idr"
          ? { currency_from: "idr", currency_to: "usdtbsc", estimated_amount: "55.4124257" }
          : { currency_from: "usd", currency_to: "usdtbsc", estimated_amount: "100.2283127" });
      }
      if (url.endsWith("/merchant/coins")) {
        return Response.json({ selectedCurrencies: CRYPTO_ASSETS.map((a) => a.ticker.toUpperCase()) });
      }
      if (url.includes("/min-amount?")) {
        const t = new URL(url).searchParams.get("currency_from")!;
        minCalls.push(t);
        if (minCalls.length >= 2) return new Response("rate limit", { status: 429 });
        return Response.json({ currency_from: t, currency_to: "usdtbsc", min_amount: 0.01, fiat_equivalent: 0.5 });
      }
      throw new Error(`unexpected ${url}`);
    }));
    const res = await refreshCryptoMarketSnapshot(access(), { force: true });
    expect(res).toMatchObject({ status: "refreshed", fx: "updated", coins: "kept" });
    expect(minCalls.length).toBeLessThan(CRYPTO_ASSETS.length);
    expect(row()!.coins_json).toBe(oldCoins);
    expect(row()!.coins_refreshed_at).toBe(oldAt);
    expect(row()!.fx_rate_text).toBe("18087.70");
    expect(Date.parse(String(row()!.fx_effective_at))).toBeGreaterThan(Date.parse(oldAt));
    expect(String(row()!.last_error)).toContain("coins_http_429");
  });

  it("caps concurrency at 6 for min-amount calls", async () => {
    const tickers = CRYPTO_ASSETS.map((a) => a.ticker);
    const mock = mockProvider({ merchant: tickers });
    expect(await refreshCryptoMarketSnapshot(access())).toMatchObject({ status: "refreshed", coins: 28 });
    expect(mock.maxInflight).toBeLessThanOrEqual(6);
    expect(mock.maxInflight).toBeGreaterThan(1);
  });

  it("deadline exceeded keeps previous coins instead of writing a truncated list", async () => {
    const old = JSON.stringify([{ ticker: "btc", min_usd_text: "2.5" }]);
    seed({ coins_json: old, coins_refreshed_at: iso(-40 * MIN) });
    mockProvider({ merchant: CRYPTO_ASSETS.map((a) => a.ticker) });
    const result = await refreshCryptoMarketSnapshot(access(), { force: true, totalDeadlineMs: -1 });
    expect(result.coins).toBe("kept");
    expect(row()!.coins_json).toBe(old);
    expect(String(row()!.last_error)).toContain("coins_deadline");
  });

  it("spends at most 4 D1 statements and honors a tight budget", async () => {
    mockProvider();
    const before = fx.control.queries;
    await refreshCryptoMarketSnapshot(access());
    expect(fx.control.queries - before).toBeLessThanOrEqual(4);
    const tight = { ...access(), canSpend: () => false };
    expect(await refreshCryptoMarketSnapshot(tight, { force: true })).toEqual({ status: "skipped_budget" });
  });

  it("refresh invalidates the reader memo", async () => {
    await getCryptoMarketSnapshot(fx.db); // memoizes "no row"
    mockProvider();
    await refreshCryptoMarketSnapshot(access());
    expect((await getCryptoMarketSnapshot(fx.db)).fx?.source).toBe("nowpayments-estimate");
  });
});

describe("getCryptoMarketSnapshot reader (D1 fresh -> env -> null)", () => {
  const d1Row = (over: Record<string, unknown> = {}) => seed({ fx_rate_text: "18087.70", fx_source: "nowpayments-estimate", fx_effective_at: iso(-5 * MIN),
    coins_json: JSON.stringify([{ ticker: "btc", min_usd_text: "1.95" }, { ticker: "usddtrc20", min_usd_text: "1" }, { ticker: "trx", min_usd_text: "bad" }]), coins_refreshed_at: iso(-5 * MIN), ...over });

  it("prefers a fresh D1 snapshot over the env pair", async () => {
    d1Row();
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", iso(-MIN));
    const snap = await getCryptoMarketSnapshot(fx.db);
    expect(snap.fx).toMatchObject({ rateText: "18087.70", rateNum: "1808770", rateDen: "100", source: "nowpayments-estimate" });
    expect(snap.coins).toEqual([{ ticker: "btc", minUsdText: "1.95" }]); // non-curated + invalid min dropped
    expect(snap.coinsStale).toBe(false);
  });

  it("falls back to the env pair when D1 is missing or stale, else null", async () => {
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", iso(-MIN));
    expect((await getCryptoMarketSnapshot(fx.db)).fx).toMatchObject({ source: "operator-fixed", rateText: "16000" });
    resetCryptoMarketMemo();
    d1Row({ fx_effective_at: iso(-25 * HOUR) });
    expect((await getCryptoMarketSnapshot(fx.db)).fx?.source).toBe("operator-fixed");
    resetCryptoMarketMemo();
    vi.stubEnv("USD_IDR_RATE", "");
    expect((await getCryptoMarketSnapshot(fx.db)).fx).toBeNull();
    expect(await loadCurrentFxSnapshot(fx.db)).toBeNull();
  });

  it("rejects D1 rows with foreign source, bad rate or future timestamp", async () => {
    for (const bad of [{ fx_source: "operator-fixed" }, { fx_rate_text: "0" }, { fx_rate_text: "1e4" }, { fx_effective_at: iso(10 * MIN) }, { fx_effective_at: "2026-11-05" }]) {
      fx.sql.exec("DELETE FROM crypto_market_snapshot"); resetCryptoMarketMemo();
      d1Row(bad);
      expect((await getCryptoMarketSnapshot(fx.db)).fx).toBeNull();
    }
  });

  it("coins older than 2h come back EMPTY and flagged stale", async () => {
    d1Row({ coins_refreshed_at: iso(-3 * HOUR) });
    const snap = await getCryptoMarketSnapshot(fx.db);
    expect(snap).toMatchObject({ coins: [], coinsStale: true });
    expect(snap.coinsRefreshedAt).not.toBeNull();
    expect(snap.fx?.source).toBe("nowpayments-estimate"); // FX independent of coin staleness
  });

  it("per-isolate memo saves D1 reads for ~60s; reset forces a re-read; read errors fall back to env", async () => {
    d1Row();
    const q0 = fx.control.queries;
    await getCryptoMarketSnapshot(fx.db); await getCryptoMarketSnapshot(fx.db); await loadCurrentFxSnapshot(fx.db);
    expect(fx.control.queries - q0).toBe(1);
    resetCryptoMarketMemo();
    await getCryptoMarketSnapshot(fx.db);
    expect(fx.control.queries - q0).toBe(2);
    resetCryptoMarketMemo();
    fx.control.fail = (q) => q.includes("crypto_market_snapshot");
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", iso(-MIN));
    expect((await getCryptoMarketSnapshot(fx.db)).fx?.source).toBe("operator-fixed");
    fx.control.fail = null;
    expect((await getCryptoMarketSnapshot(fx.db)).fx?.source).toBe("nowpayments-estimate"); // failure was not memoized
  });

  it("no D1 at all: env pair only", async () => {
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", iso(-MIN));
    expect((await getCryptoMarketSnapshot(null)).fx?.source).toBe("operator-fixed");
  });
});
