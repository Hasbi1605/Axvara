// Hook refresh pasar crypto di cron lite `cleanup` (LOCAL ONLY): berjalan saat
// jatuh tempo, dan kegagalan/timeout-nya tidak boleh merusak cleanup.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("CRON_SECRET", "s");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-key");
  vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock("@/lib/payments/market-snapshot-refresh"); vi.resetModules(); });

async function cleanup() {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest("http://localhost/api/cron/lite?job=cleanup", { method: "POST", headers: { authorization: "Bearer s" } }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const provider = () => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/estimate?")) return Response.json(new URL(url).searchParams.get("currency_from") === "idr"
    ? { currency_from: "idr", currency_to: "usdtbsc", estimated_amount: "55.4124257" }
    : { currency_from: "usd", currency_to: "usdtbsc", estimated_amount: "100.2283127" });
  if (url.endsWith("/merchant/coins")) return Response.json({ selectedCurrencies: ["BTC", "USDTBSC"] });
  if (url.includes("/min-amount?")) return Response.json({ currency_from: new URL(url).searchParams.get("currency_from"), fiat_equivalent: 0.5, min_amount: 0.1 });
  throw new Error(`unexpected network ${url}`);
}));

describe("cron lite cleanup -> crypto market refresh", () => {
  it("refreshes when due, then is a quiet no-op until 10 minutes pass", async () => {
    provider();
    const first = await cleanup();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, job: "cleanup", crypto_market: "refreshed" });
    expect(fx.sql.prepare("SELECT fx_rate_text,fx_source FROM crypto_market_snapshot WHERE id=1").get()).toEqual({ fx_rate_text: "18087.70", fx_source: "nowpayments-estimate" });
    const fetchCalls = vi.mocked(fetch).mock.calls.length;
    const second = await cleanup();
    expect(second.body.crypto_market).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCalls);
  });

  it("without NOWPAYMENTS_API_KEY it does nothing (no network, no row)", async () => {
    vi.stubEnv("NOWPAYMENTS_API_KEY", "");
    provider();
    const res = await cleanup();
    expect(res.status).toBe(200);
    expect(res.body.crypto_market).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM crypto_market_snapshot").get()!.n).toBe(0);
  });

  it("provider outage is recorded but cleanup (and the pair drain) still succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const res = await cleanup();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, pairs_decided: expect.any(Number), crypto_market: "refreshed" });
    expect(String(fx.sql.prepare("SELECT last_error FROM crypto_market_snapshot WHERE id=1").get()!.last_error)).toContain("fx_http_503");
  });

  it("a refresh that THROWS is swallowed: cleanup still returns 200 with its own results", async () => {
    vi.resetModules();
    vi.doMock("@/lib/payments/market-snapshot-refresh", () => ({ refreshCryptoMarketSnapshot: async () => { throw new Error("boom"); } }));
    const res = await cleanup();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, job: "cleanup", pairs_decided: expect.any(Number), crypto_market: "error" });
  });

  it("other lite jobs never touch the market refresh", async () => {
    provider();
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest("http://localhost/api/cron/lite?job=expiry", { method: "POST", headers: { authorization: "Bearer s" } }));
    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
