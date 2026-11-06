// DP-1: POST /api/display-prices — display-only IDR -> USD cents.
// Fake env FX / clock / native CF context only; no provider, DB or real settings.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTest, RATE_LIMITS } from "@/lib/rateLimit";

let country: unknown;
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => ({ cf: { country } }) }));
vi.mock("@/lib/payments/fx", async (original) => {
  const actual = await original<typeof import("@/lib/payments/fx")>();
  return { ...actual, loadFxSnapshot: vi.fn(actual.loadFxSnapshot) };
});

import { loadFxSnapshot } from "@/lib/payments/fx";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import { createD1Fixture } from "./helpers/d1-fixture";
import { POST } from "@/app/api/display-prices/route";

const FRESH = new Date(Date.now() - 60_000).toISOString();
const PRIVACY = { "cache-control": "private, no-store", vary: "Cookie, Accept-Language" };

function call(body: unknown, headers: Record<string, string> = {}, raw = false) {
  return POST(new NextRequest("https://axvara.tech/api/display-prices", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  }));
}
function expectPrivate(res: Response) {
  for (const [name, value] of Object.entries(PRIVACY)) expect(res.headers.get(name)).toBe(value);
  expect(res.headers.get("set-cookie")).toBeNull();
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearRateLimitBucketsForTest();
  country = undefined;
  vi.mocked(loadFxSnapshot).mockClear();
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", FRESH);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("validation (rejected before any conversion)", () => {
  it.each([
    ["0 items", { amounts: [] }],
    ["65 items", { amounts: Array.from({ length: 65 }, () => 1) }],
    ["negative", { amounts: [-1] }],
    ["float", { amounts: [10.5] }],
    ["unsafe integer", { amounts: [Number.MAX_SAFE_INTEGER + 2] }],
    ["huge exponent", { amounts: [1e300] }],
    ["string (no coercion)", { amounts: ["10000"] }],
    ["null item", { amounts: [null] }],
    ["amounts not array", { amounts: 10000 }],
    ["missing amounts", {}],
    ["extra field", { amounts: [1], country: "US" }],
    ["array body", [1, 2]],
  ])("%s => 400 invalid_amounts", async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_amounts" });
    expectPrivate(res);
    expect(loadFxSnapshot).not.toHaveBeenCalled();
  });

  it("accepts exactly 64 items and the safe-integer ceiling", async () => {
    const res = await call({ amounts: [...Array.from({ length: 63 }, () => 1), Number.MAX_SAFE_INTEGER] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(64);
    expect(json.items[63]).toEqual({ idr: Number.MAX_SAFE_INTEGER, usdCents: "56294995342131" });
  });

  it("non-JSON => 400 and oversize (declared or streamed) => 413, with privacy headers", async () => {
    const bad = await call("{nope", {}, true);
    expect(bad.status).toBe(400);
    expectPrivate(bad);
    const big = await call(JSON.stringify({ amounts: [1], pad: "x".repeat(2100) }), {}, true);
    expect(big.status).toBe(413);
    expectPrivate(big);
    const declared = await call("{}", { "content-length": "999999" }, true);
    expect(declared.status).toBe(413);
    expect(loadFxSnapshot).not.toHaveBeenCalled();
  });
});

describe("exact conversion from fresh snapshot", () => {
  it("10000=>63, 250000=>1563, 0=>0; order and duplicates kept; one snapshot read", async () => {
    const res = await call({ amounts: [10000, 250000, 0, 10000] });
    expect(res.status).toBe(200);
    expectPrivate(res);
    const json = await res.json();
    expect(json.items).toEqual([
      { idr: 10000, usdCents: "63" },
      { idr: 250000, usdCents: "1563" },
      { idr: 0, usdCents: "0" },
      { idr: 10000, usdCents: "63" },
    ]);
    expect(json.fx).toEqual({ available: true, effectiveAt: FRESH });
    expect(loadFxSnapshot).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves the automatic D1 snapshot ahead of the env emergency pair (no network)", async () => {
    const fixture = createD1Fixture();
    try {
      const at = new Date(Date.now() - 120_000).toISOString();
      fixture.sql.prepare("INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at) VALUES (1,'18087.70','nowpayments-estimate',?)").run(at);
      resetCryptoMarketMemo();
      const json = await (await call({ amounts: [250000] })).json();
      expect(json.items).toEqual([{ idr: 250000, usdCents: "1382" }]); // 250000 / 18087.70 = 13.8213 USD
      expect(json.fx).toEqual({ available: true, effectiveAt: at });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fixture.close(); resetCryptoMarketMemo(); }
  });

  it("converts the discounted SUM once, not unit-rounded x qty (9000@16000)", async () => {
    const json = await (await call({ amounts: [9000, 12 * 9000] })).json();
    expect(json.items[0].usdCents).toBe("56"); // 56.25 -> 56
    expect(json.items[1].usdCents).toBe("675"); // 6.75 USD exact
    expect(BigInt(json.items[0].usdCents) * BigInt(12)).toBe(BigInt(672)); // would be wrong
    expect(json.items[1].usdCents).not.toBe("672");
  });

  it("returns cents even when the preferred currency is IDR", async () => {
    const json = await (await call({ amounts: [10000] }, { cookie: "axv_currency=IDR" })).json();
    expect(json.currency).toBe("IDR");
    expect(json.items[0].usdCents).toBe("63");
  });
});

describe("FX unavailable => 200, resolved prefs, null cents", () => {
  it.each([
    ["missing", () => { vi.stubEnv("USD_IDR_RATE", ""); }],
    ["invalid rate", () => { vi.stubEnv("USD_IDR_RATE", "0"); }],
    ["stale (>24h)", () => { vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 25 * 3600_000).toISOString()); }],
    ["future-dated", () => { vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() + 60_000).toISOString()); }],
    ["no zone", () => { vi.stubEnv("USD_FX_EFFECTIVE_AT", "2026-11-04"); }],
  ])("%s", async (_label, arrange) => {
    arrange();
    country = "US";
    const res = await call({ amounts: [10000, 0] });
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(await res.json()).toEqual({
      locale: "en", currency: "USD",
      fx: { available: false, effectiveAt: null },
      items: [{ idr: 10000, usdCents: null }, { idr: 0, usdCents: null }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("preference resolution (cookie > Accept-Language > native CF country)", () => {
  async function prefs(headers: Record<string, string>) {
    const json = await (await call({ amounts: [1] }, headers)).json();
    return [json.locale, json.currency];
  }
  it("no signal => id/IDR", async () => { expect(await prefs({})).toEqual(["id", "IDR"]); });
  it("country ID => id/IDR; non-ID => en/USD (native context only)", async () => {
    country = "ID"; expect(await prefs({})).toEqual(["id", "IDR"]);
    country = "SG"; expect(await prefs({})).toEqual(["en", "USD"]);
    country = "ZZ"; expect(await prefs({})).toEqual(["id", "IDR"]);
  });
  it("Accept-Language decides locale (weighted) but never currency", async () => {
    expect(await prefs({ "accept-language": "en-US,en;q=0.9" })).toEqual(["en", "IDR"]);
    expect(await prefs({ "accept-language": "en;q=0.5, id;q=0.9" })).toEqual(["id", "IDR"]);
    country = "ID";
    expect(await prefs({ "accept-language": "en-US" })).toEqual(["en", "IDR"]);
  });
  it("explicit cookies override and are independent of each other", async () => {
    country = "US";
    expect(await prefs({ cookie: "axv_locale=id", "accept-language": "en" })).toEqual(["id", "USD"]);
    expect(await prefs({ cookie: "axv_currency=IDR" })).toEqual(["en", "IDR"]);
    country = "ID";
    expect(await prefs({ cookie: "axv_locale=en; axv_currency=USD" })).toEqual(["en", "USD"]);
    expect(await prefs({ cookie: "axv_locale=fr; axv_currency=EUR" })).toEqual(["id", "IDR"]);
  });
  it("forged country headers, query and body are ignored", async () => {
    const forged = { "cf-ipcountry": "US", "x-vercel-ip-country": "US", "x-country": "US", "x-forwarded-for": "8.8.8.8" };
    expect(await prefs(forged)).toEqual(["id", "IDR"]);
    const res = await POST(new NextRequest("https://axvara.tech/api/display-prices?country=US&currency=USD", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amounts: [1] }),
    }));
    const json = await res.json();
    expect([json.locale, json.currency]).toEqual(["id", "IDR"]);
    expect((await call({ amounts: [1], country: "US" })).status).toBe(400);
  });
});

describe("rate limit", () => {
  it("scope is registered at 120/min; the 121st call is 429 with privacy headers", async () => {
    expect(RATE_LIMITS["display:prices"]).toBe(120);
    for (let i = 0; i < 120; i++) expect((await call({ amounts: [1] })).status).toBe(200);
    const res = await call({ amounts: [1] });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expectPrivate(res);
    // another client has its own bucket
    expect((await call({ amounts: [1] }, { "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
  });
});

describe("static boundaries", () => {
  const source = readFileSync("src/app/api/display-prices/route.ts", "utf8");
  it("route is POST-only edge, with no DB, catalog cache, provider or env access", () => {
    expect(source).toMatch(/export async function POST/);
    expect(source).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE|HEAD)/);
    expect(source).toContain('export const runtime = "edge"');
    expect(source).not.toMatch(/@\/lib\/db|catalog-cache|process\.env|fetch\(|Set-Cookie|cookies\(\)/i);
    expect(source).not.toMatch(/console\./);
  });
  it("catalog routes remain public, locale-neutral and free of display fields", () => {
    for (const file of ["src/app/api/catalog/route.ts", "src/app/api/products/route.ts"]) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/display-prices|usdCents|resolveBuyerPreferences|Vary/);
    }
  });
});
