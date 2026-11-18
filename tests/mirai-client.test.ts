import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMiraiOrder,
  fetchMiraiBalance,
  fetchMiraiPackages,
  getMiraiOrder,
  isMiraiConfigured,
  isMiraiDispatchEnabled,
  isMiraiEnabled,
  isMiraiSyncEnabled,
  parseMiraiBalance,
  parseMiraiPackage,
  parseMiraiPackages,
  parseRetryAfterSeconds,
} from "@/lib/mirai/client";

const samplePkg = {
  code: "GPT_10M",
  group: "gpt",
  name: "GPT 10M tokens · 1D",
  quota_tokens: 10000000,
  duration_seconds: 86400,
  reseller_price_vnd: 6650,
  retail_price_vnd: 7000,
  discount_bps: 500,
  min_quantity: 1,
  max_quantity: 10000,
  preset_quantities: [1, 2, 3, 5, 10],
  models: ["gpt-5.6-luna"],
  unlimited: true,
  remaining_today: 0,
  custom_quantity: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MiraiAPI client contracts", () => {
  it("enforces HTTPS configuration and never fetches when disabled or invalid", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    vi.stubEnv("MIRAI_ENABLED", "false");
    expect(isMiraiEnabled()).toBe(false);
    expect(isMiraiConfigured()).toBe(false);
    expect(await fetchMiraiPackages()).toEqual({ kind: "config", reason: "not_configured" });

    vi.stubEnv("MIRAI_ENABLED", "true");
    vi.stubEnv("MIRAI_API_KEY", "mr-fixture-key");
    vi.stubEnv("MIRAI_BASE_URL", "http://mirai.test/api/reseller/v1");
    expect(isMiraiConfigured()).toBe(false);
    expect(await fetchMiraiBalance()).toEqual({ kind: "config", reason: "not_configured" });

    vi.stubEnv("MIRAI_BASE_URL", "https://user:pass@mirai.test/api/reseller/v1");
    expect(isMiraiConfigured()).toBe(false);

    vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1/");
    vi.stubEnv("MIRAI_SYNC_ENABLED", "false");
    expect(isMiraiConfigured()).toBe(true);
    expect(isMiraiSyncEnabled()).toBe(false);
    expect(isMiraiDispatchEnabled()).toBe(false);

    vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
    expect(isMiraiSyncEnabled()).toBe(true);
    expect(isMiraiDispatchEnabled()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends Bearer auth, Accept JSON, manual redirect, and Idempotency-Key on POST", async () => {
    vi.stubEnv("MIRAI_ENABLED", "true");
    vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
    vi.stubEnv("MIRAI_API_KEY", "mr-fixture-secret");
    vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");

    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, data: { status: "fulfilled" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    const postRes = await createMiraiOrder({
      external_order_id: "AXV-ORDER-0",
      package_code: "FULL_100M",
      quantity: 2,
    });
    expect(postRes.status).toBe(200);
    expect(postRes.text).toContain("fulfilled");

    const [postUrl, postInit] = fetcher.mock.calls[0]!;
    expect(postUrl).toBe("https://mirai.test/api/reseller/v1/orders");
    expect(postInit?.method).toBe("POST");
    expect(postInit?.redirect).toBe("manual");
    expect(postInit?.headers).toMatchObject({
      authorization: "Bearer mr-fixture-secret",
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": "AXV-ORDER-0",
    });
    expect(JSON.parse(String(postInit?.body))).toEqual({
      external_order_id: "AXV-ORDER-0",
      package_code: "FULL_100M",
      quantity: 2,
    });

    const getRes = await getMiraiOrder("AXV-ORDER-0");
    expect(getRes.status).toBe(200);
    const [getUrl, getInit] = fetcher.mock.calls[1]!;
    expect(getUrl).toBe("https://mirai.test/api/reseller/v1/orders/AXV-ORDER-0");
    expect(getInit?.method).toBe("GET");
    expect(getInit?.redirect).toBe("manual");
  });

  it("parses balance and packages strictly and rejects malformed payloads", () => {
    expect(parseMiraiBalance({ success: true, data: { balance_vnd: 1000000, tier: "Silver", discount_bps: 500 } })).toEqual({
      balance_vnd: 1000000,
      tier: "Silver",
      discount_bps: 500,
    });
    expect(parseMiraiBalance({ success: false, data: { balance_vnd: 1000 } })).toBeNull();
    expect(parseMiraiBalance({ success: true, data: { balance_vnd: -1 } })).toBeNull();

    expect(parseMiraiPackage(samplePkg)).toMatchObject({
      code: "GPT_10M",
      group: "gpt",
      reseller_price_vnd: 6650,
      unlimited: true,
    });
    expect(parseMiraiPackages({ success: true, data: [samplePkg] })).toHaveLength(1);
    expect(parseMiraiPackages({ success: true, data: [samplePkg, samplePkg] })).toBeNull();
    expect(parseMiraiPackages({ success: false, data: [samplePkg] })).toBeNull();
  });

  it.each([
    { code: "../bad" },
    { quota_tokens: 0 },
    { duration_seconds: -5 },
    { reseller_price_vnd: 0 },
    { unlimited: "true" },
    { remaining_today: -1 },
    { min_quantity: 5, max_quantity: 2 },
  ])("rejects malformed package %j", (override) => {
    expect(parseMiraiPackage({ ...samplePkg, ...override })).toBeNull();
  });

  it("honors Retry-After header on 429 for both read and order calls", async () => {
    vi.stubEnv("MIRAI_ENABLED", "true");
    vi.stubEnv("MIRAI_API_KEY", "mr-fixture-secret");
    vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");

    const now = Date.UTC(2026, 10, 18, 12, 0, 0);
    expect(parseRetryAfterSeconds("120", now)).toBe(120);
    expect(parseRetryAfterSeconds(new Date(now + 90_000).toUTCString(), now)).toBe(90);
    expect(parseRetryAfterSeconds("99999", now)).toBe(3600);
    expect(parseRetryAfterSeconds("0", now)).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "180" } })),
    );
    expect(await fetchMiraiPackages()).toEqual({ kind: "ambiguous", reason: "http_429", retryAfterSeconds: 180 });
    expect(await createMiraiOrder({ external_order_id: "AXV-1-0", package_code: "GPT_10M", quantity: 1 })).toMatchObject({
      status: 429,
      retryAfterSeconds: 180,
    });
  });

  it("treats redirects and 401/403 as config errors without following redirects", async () => {
    vi.stubEnv("MIRAI_ENABLED", "true");
    vi.stubEnv("MIRAI_API_KEY", "mr-fixture-secret");
    vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 302, headers: { location: "https://evil.test" } })));
    expect(await fetchMiraiBalance()).toEqual({ kind: "config", reason: "http_302" });
  });
});
