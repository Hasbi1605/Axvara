import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readPrivateFinancialSnapshot } from "@/lib/admin-report-cache";
import { createD1Fixture } from "./helpers/d1-fixture";

const now = new Date("2026-10-19T15:00:00Z");
let entries: Map<string, Response>;
let open: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ADMIN_JWT_SECRET", "cache-fixture-secret-not-a-real-key");
  vi.useFakeTimers(); vi.setSystemTime(now);
  entries = new Map();
  open = vi.fn(async () => ({ match: async (key: Request) => entries.get(key.url)?.clone(),
    put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()); } }));
  vi.stubGlobal("caches", { open });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const fresh = () => ({ generatedAt: new Date().toISOString(), revenue: 123456789, product: "Private aggregate" });

it("stores authenticated ciphertext, reuses it across callers and never slides the generation time", async () => {
  const load = vi.fn(async () => fresh());
  const first = await readPrivateFinancialSnapshot("report:A", load);
  const stored = [...entries.values()][0];
  expect(stored.headers.get("cache-control")).toBe("max-age=300");
  const encrypted = await stored.clone().text();
  expect(encrypted).not.toContain("Private aggregate"); expect(encrypted).not.toContain("123456789");
  expect([...entries.keys()][0]).not.toContain("report:A");
  vi.advanceTimersByTime(299_000);
  expect(await readPrivateFinancialSnapshot("report:A", load)).toEqual(first);
  expect(load).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000); // Even if Cache API mistakenly retains an expired entry.
  expect((await readPrivateFinancialSnapshot("report:A", load)).generatedAt).toBe(new Date().toISOString());
  expect(load).toHaveBeenCalledTimes(2);
});

it("scope and key rotation isolate snapshots", async () => {
  const load = vi.fn(async () => fresh());
  await readPrivateFinancialSnapshot("a", load); await readPrivateFinancialSnapshot("b", load);
  vi.stubEnv("ADMIN_JWT_SECRET", "rotated-fixture-secret");
  await readPrivateFinancialSnapshot("a", load);
  expect(load).toHaveBeenCalledTimes(3); expect(entries.size).toBe(3);
});

it("tampering or copying ciphertext to a different key cannot produce a report", async () => {
  await readPrivateFinancialSnapshot("a", async () => fresh());
  const original = [...entries.values()][0].clone();
  const load = vi.fn(async () => fresh());
  // Populate the second cache URL, then replace it with ciphertext for the first.
  await readPrivateFinancialSnapshot("b", load);
  const keys = [...entries.keys()]; entries.set(keys[1], original);
  await readPrivateFinancialSnapshot("b", load);
  entries.set(keys[0], new Response("corrupt"));
  await readPrivateFinancialSnapshot("a", load);
  expect(load).toHaveBeenCalledTimes(3);
});

it("cache failures fall back to fresh data and loader failures are not cached", async () => {
  const load = vi.fn(async () => fresh());
  open.mockRejectedValueOnce(new Error("unavailable"));
  expect(await readPrivateFinancialSnapshot("a", load)).toEqual(fresh());
  const failed = vi.fn(async () => { throw new Error("D1 failed"); });
  await expect(readPrivateFinancialSnapshot("failed", failed)).rejects.toThrow("D1 failed");
  expect(entries.size).toBe(0);
  open.mockResolvedValueOnce({ match: async () => undefined, put: async () => { throw new Error("write down"); } });
  expect(await readPrivateFinancialSnapshot("a", load)).toEqual(fresh());
});

it("production financial reports survive module/binding replacement without extending their lifetime", async () => {
  const fx = createD1Fixture();
  try {
    const firstModule = await import("@/lib/dashboard-report");
    const first = await firstModule.readOverviewFinancialReport(now);
    const queries = fx.control.queries;
    vi.advanceTimersByTime(270_000);
    vi.resetModules();
    // A fresh isolate module has no WeakMap snapshot, but can read encrypted edge data.
    const secondModule = await import("@/lib/dashboard-report");
    expect(await secondModule.readOverviewFinancialReport(new Date())).toEqual(first);
    expect(fx.control.queries).toBe(queries);
    vi.advanceTimersByTime(31_000);
    expect((await secondModule.readOverviewFinancialReport(new Date())).generatedAt).toBe(new Date().toISOString());
    expect(fx.control.queries).toBe(queries + 1);
  } finally { fx.close(); }
});
