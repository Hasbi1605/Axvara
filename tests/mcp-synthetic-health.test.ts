import { afterEach, describe, expect, it, vi } from "vitest";
import { nextAlarmState, runOperationsTick, type AlarmState } from "../mcp-worker/src/cron";
import { runSyntheticProbes, SYNTH_BUDGET_MS, SYNTH_TIMEOUT_MS } from "../mcp-worker/src/synthetic";
import { syntheticResponse } from "./helpers/synthetic-response";

const env = { AXVARA_API_ORIGIN: "https://origin.test", AXVARA_CRON_SECRET: "fixture-secret" };
const variant = { id: 309, is_active: 1, stock: 8, min_qty: 3, fulfillment_mode: "manual" };
function fixture(override?: (url: string, init?: RequestInit) => Response | Promise<Response | undefined> | undefined) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const custom = await override?.(url, init); if (custom) return custom;
    if (url.includes("/api/products")) return Response.json({ products: [{ id: 45, slug: "dynamic-sku", stock: 8 }] });
    if (url.includes("/api/catalog?")) return Response.json({ product: { id: 45, variants: [variant] } });
    if (url.endsWith("/api/checkout/quote")) return Response.json({ ok: true, quoteToken: "signed-token".repeat(5), paymentMethods: [{ id: "qris", available: true }] });
    return syntheticResponse(url) ?? Response.json({ ok: true });
  });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("synthetic health", () => {
  it("runs before scheduled CRON_STEP work, selects a dynamic variant/minimum and never calls orders", async () => {
    const fetchFn = fixture();
    const report = await runOperationsTick(env, Date.UTC(2026, 10, 18, 0, 0), fetchFn);
    expect(report.outcomes.slice(-3).map(o => o.step)).toEqual(["synth:home", "synth:catalog", "synth:quote"]);
    const urls = fetchFn.mock.calls.map(([url]) => url);
    const firstProbe = urls.indexOf(`${env.AXVARA_API_ORIGIN}/`);
    expect(firstProbe).toBe(0);
    expect(urls.indexOf(`${env.AXVARA_API_ORIGIN}/api/checkout/quote`)).toBeLessThan(urls.findIndex(url => url.includes("/api/cron/")));
    expect(urls.some(url => url.includes("/api/orders"))).toBe(false);
    const quote = fetchFn.mock.calls.find(([url]) => url.endsWith("/quote"))!;
    expect(JSON.parse(String(quote[1]?.body))).toEqual({ items: [{ product_id: 45, variant_id: 309, qty: 3 }] });
    expect(quote[1]).toMatchObject({ redirect: "manual", headers: { "x-axvara-synthetic": "1", authorization: `Bearer ${env.AXVARA_CRON_SECRET}` } });
    expect(fetchFn.mock.calls.filter(([url]) => !url.endsWith("/quote")).every(([, init]) => !(init?.headers as Record<string, string>)?.["x-axvara-synthetic"])).toBe(true);
    expect(report.failures).toEqual([]);
  });
  it("no buyable variant sends a real quote and accepts structured 409", async () => {
    const fetchFn = fixture(url => url.includes("/api/catalog?") ? Response.json({ product: { id: 45, variants: [{ ...variant, buyer_field_key: "muse_invite_code" }] } }) : url.endsWith("/quote") ? syntheticResponse(url)! : undefined);
    expect((await runSyntheticProbes(env, fetchFn))[2]).toMatchObject({ ok: true, status: 409 });
    expect(JSON.parse(String(fetchFn.mock.calls.at(-1)![1]?.body))).toEqual({ items: [{ product_id: 45, qty: 1 }] });
  });
  it.each([500, 409, 200])("invalid quote contract/status %i is hard", async status => {
    const outcomes = await runSyntheticProbes(env, fixture(url => url.endsWith("/quote") ? Response.json({ ok: false, issues: [] }, { status }) : undefined));
    expect(outcomes[2]).toMatchObject({ ok: false, alarm: "hard" });
  });
  it("rejects maintenance HTML even with a mistaken 200", async () => {
    const outcomes = await runSyntheticProbes(env, fixture(url => url.endsWith("/") ? new Response("<title>Maintenance sementara · AXVARA</title>", { headers: { "content-type": "text/html" } }) : undefined));
    expect(outcomes[0]).toMatchObject({ ok: false, alarm: "hard" });
  });
  it("requires available local QRIS, not merely a remote payment method", async () => {
    const outcomes = await runSyntheticProbes(env, fixture(url => url.endsWith("/quote") ? Response.json({ ok: true, quoteToken: "x".repeat(40), paymentMethods: [{ id: "remote", available: true }] }) : undefined));
    expect(outcomes[2]).toMatchObject({ ok: false, alarm: "hard", status: 200 });
  });
  it("caps PDP selection at three and skips unavailable unique inventory", async () => {
    const fetchFn = fixture(url => {
      if (url.includes("/api/products")) return Response.json({ products: [1, 2, 3, 4].map(id => ({ id, slug: `product-${id}`, stock: 8 })) });
      if (url.includes("/api/catalog?")) return Response.json({ product: { id: Number(url.at(-1)), variants: [{ ...variant, fulfillment_mode: "unique", inventory_available: 0 }] } });
      if (url.endsWith("/quote")) return syntheticResponse(url)!;
    });
    expect((await runSyntheticProbes(env, fetchFn))[2]).toMatchObject({ ok: true, status: 409, calls: 4 });
    expect(fetchFn.mock.calls.filter(([url]) => url.includes("/api/catalog?"))).toHaveLength(3);
  });
  it.each([true, false])("timeout includes stalled %s (fetch/body) and aborts at ten seconds", async stalledFetch => {
    vi.useFakeTimers();
    const fetchFn = fixture(url => url.endsWith("/") ? stalledFetch ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/html" } }) : undefined);
    const result = runSyntheticProbes(env, fetchFn);
    await vi.advanceTimersByTimeAsync(SYNTH_TIMEOUT_MS);
    expect((await result)[0]).toMatchObject({ ok: false, alarm: "hard", error: "probe_timeout" });
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("slow success uses soft six-failure alarm; hard failure uses two", async () => {
    vi.useFakeTimers();
    const result = runSyntheticProbes(env, fixture(async url => {
      if (!url.endsWith("/")) return undefined;
      await new Promise(resolve => setTimeout(resolve, 4001));
      return syntheticResponse(url)!;
    }));
    await vi.advanceTimersByTimeAsync(4001);
    const slow = (await result)[0];
    expect(slow).toMatchObject({ ok: false, alarm: "soft", error: "slow_4001ms" });
    const initial = (): AlarmState => ({ since: null, alertedAt: null, lastFailures: [], steps: {}, pendingFailures: [] });
    for (const [outcome, threshold] of [[slow, 6], [{ ...slow, alarm: "hard" as const }, 2]] as const) {
      let state = initial();
      for (let i = 1; i <= threshold; i++) {
        const next = nextAlarmState(state, [outcome], i * 60_000); state = next.state;
        expect(next.action).toBe(i === threshold ? "start" : "none");
      }
    }
  });
  it("bounded independent timeout runs probes even when the subsequent cron work is slow", async () => {
    vi.useFakeTimers();
    const fetchFn = fixture(async url => {
      if (url.includes("/api/cron/")) { vi.setSystemTime(Date.now() + 4000); return Response.json({ ok: true }); }
      return undefined;
    });
    const report = await runOperationsTick(env, Date.UTC(2026, 10, 18, 0, 0), fetchFn);
    expect(report.outcomes.slice(-3).every(o => o.calls > 0)).toBe(true);
    expect(fetchFn.mock.calls.some(([url]) => url.includes("/api/cron/"))).toBe(true);
    const start = Date.now();
    const probes = runSyntheticProbes(env, fixture(() => new Promise<Response>(() => {})));
    await vi.advanceTimersByTimeAsync(SYNTH_BUDGET_MS);
    expect((await probes).every(o => !o.ok)).toBe(true);
    expect(Date.now() - start).toBe(SYNTH_BUDGET_MS);
  });
});
