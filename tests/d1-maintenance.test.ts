import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { D1_AVAILABILITY_SQL, isD1DailyQuotaError, isD1InMaintenance, nextD1Reset } from "@/lib/d1-maintenance";
import { maintenancePage, maintenanceResponse } from "@/lib/maintenance-page";
import { middleware } from "@/middleware";
import { GET, HEAD } from "@/app/maintenance/route";
import { SITE, SUPPORT_WA_NUMBERS } from "@/lib/site";
import type { D1 } from "@/lib/db/types";

const quota = (type = "read") => new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row ${type} limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.`);
const now = Date.parse("2026-10-16T17:30:00Z");
function database(first = vi.fn(async (): Promise<unknown> => ({ key: "store_name" }))) {
  const prepare = vi.fn(() => ({ first }));
  return { db: { prepare } as unknown as D1, prepare, first };
}
function request(path = "/", headers?: Record<string, string>) {
  return new NextRequest(`https://axvara.tech${path}`, { headers: { host: "axvara.tech", ...headers } });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("daily D1 quota detection", () => {
  it("recognizes both documented quota errors and nested causes, without misclassifying other limits", () => {
    expect(isD1DailyQuotaError(quota())).toBe(true);
    expect(isD1DailyQuotaError(quota("write"))).toBe(true);
    expect(isD1DailyQuotaError(new Error("D1_ERROR", { cause: quota() }))).toBe(true);
    for (const error of [new Error("D1 DB exceeded its CPU time limit"), new Error("rate limit exceeded"), new Error("Exceeded maximum DB size"), null, undefined]) {
      expect(isD1DailyQuotaError(error)).toBe(false);
    }
    const circular: { message: string; cause?: unknown } = { message: "unrelated" };
    circular.cause = circular;
    expect(isD1DailyQuotaError(circular)).toBe(false);
  });

  it("uses a single-row read once per minute and coalesces parallel requests", async () => {
    const { db, prepare, first } = database();
    expect(await Promise.all(Array.from({ length: 20 }, () => isD1InMaintenance(db, SITE.webUrl)))).toEqual(Array(20).fill(false));
    expect(prepare).toHaveBeenCalledExactlyOnceWith(D1_AVAILABILITY_SQL);
    await isD1InMaintenance(db, SITE.webUrl);
    expect(first).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 60_001);
    await isD1InMaintenance(db, SITE.webUrl);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("enters maintenance on quota errors and exits after a successful recheck", async () => {
    const fixture = database(vi.fn().mockRejectedValueOnce(quota()).mockResolvedValue({ key: "store_name" }));
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(true);
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(true);
    expect(fixture.first).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 60_001);
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(false);
  });

  it("expires blocked state at midnight UTC even when the 60-second TTL has not elapsed", async () => {
    vi.setSystemTime(Date.parse("2026-10-16T23:59:50Z"));
    const fixture = database(vi.fn().mockRejectedValueOnce(quota()).mockResolvedValue({ key: "store_name" }));
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(true);
    vi.setSystemTime(Date.parse("2026-10-17T00:00:01Z"));
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(false);
    expect(fixture.first).toHaveBeenCalledTimes(2);
  });

  it("does not replace normal dev behavior or unrelated D1 errors with quota maintenance", async () => {
    expect(await isD1InMaintenance(null, SITE.webUrl)).toBe(false);
    const fixture = database(vi.fn().mockRejectedValue(new Error("no such table: store_settings")));
    expect(await isD1InMaintenance(fixture.db, SITE.webUrl)).toBe(false);
  });

  it("shares status through Cache API and survives broken cache operations", async () => {
    const entries = new Map<string, Response>();
    vi.stubGlobal("caches", { default: {
      match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
      put: vi.fn(async (key: Request, value: Response) => { entries.set(key.url, value.clone()); }),
    } });
    const first = database(vi.fn().mockRejectedValue(quota()));
    expect(await isD1InMaintenance(first.db, SITE.webUrl)).toBe(true);
    const otherIsolate = database();
    expect(await isD1InMaintenance(otherIsolate.db, SITE.webUrl)).toBe(true);
    expect(otherIsolate.first).not.toHaveBeenCalled();
    vi.setSystemTime(now + 60_001);
    expect(await isD1InMaintenance(otherIsolate.db, SITE.webUrl)).toBe(false);
    expect(otherIsolate.first).toHaveBeenCalledTimes(1);
    vi.stubGlobal("caches", { default: { match: vi.fn().mockRejectedValue(new Error("cache down")), put: vi.fn().mockRejectedValue(new Error("cache down")) } });
    expect(await isD1InMaintenance(database(vi.fn().mockRejectedValue(quota())).db, SITE.webUrl)).toBe(true);
  });
});

describe("maintenance documents and middleware", () => {
  it("renders an independent 503 document with honest dated WIB estimate and no scripts or raw D1 error", async () => {
    const response = maintenanceResponse(now);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const html = await response.text();
    expect(html).toContain("07.00–08.00 WIB");
    expect(html).toContain("17 Oktober 2026");
    expect(html.split("<body>")[1]).not.toContain("Maintenance sementara");
    expect(html).not.toContain('class="badge"');
    expect(html).toContain(`${SITE.webUrl}/wa?pesan=`);
    expect(html).not.toMatch(/<script|\/api\/|D1_ERROR|paid plan/);
    expect(await HEAD().text()).toBe("");
    expect(GET().status).toBe(503);
    // Above 07.00 WIB, the next reset is tomorrow, not this morning.
    expect(maintenancePage(Date.parse("2026-10-17T01:00:00Z"))).toContain("18 Oktober 2026");
    expect(nextD1Reset(now)).toBe(Date.parse("2026-10-17T00:00:00Z"));
  });

  it("shows active contact choices without a database, escapes messages and uses support instead of the ordering bot", () => {
    const html = maintenancePage(now, true, '"><script>alert(1)</script>');
    for (const number of SUPPORT_WA_NUMBERS) {
      expect(html.includes(`wa.me/${number.intl}?`)).toBe(number.status === "active");
    }
    expect(html).toContain(`https://t.me/${SITE.supportTelegram}`);
    expect(html).not.toContain(`https://t.me/${SITE.adminTelegram}`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Pesan dibalas pada jam layanan");
    expect(html.split("<body>")[1]).not.toContain("Maintenance sementara");
  });

  it.each(["/", "/produk/chatgpt", "/checkout", "/pesanan/AXV-123", "/admin", "/pedia", "/pedia/o/instagram"])("protects page %s before it renders", async path => {
    vi.stubGlobal("DB", database(vi.fn().mockRejectedValue(quota())).db);
    const response = await middleware(request(path));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Kami sedang maintenance");
  });

  it("protects the Pedia host before the rewrite and keeps /maintenance outside Pedia rewriting", async () => {
    vi.stubEnv("PEDIA_ENABLED", "true");
    vi.stubGlobal("DB", database(vi.fn().mockRejectedValue(quota())).db);
    const response = await middleware(new NextRequest("https://pedia.axvara.tech/", { headers: { host: "pedia.axvara.tech" } }));
    expect(response.status).toBe(503);
    const standalone = await middleware(new NextRequest("https://pedia.axvara.tech/maintenance", { headers: { host: "pedia.axvara.tech" } }));
    expect(standalone.headers.get("x-middleware-next")).toBe("1");
    expect(standalone.headers.has("x-middleware-rewrite")).toBe(false);
  });

  it("keeps WA hub usable on both hosts with preserved buyer message", async () => {
    vi.stubGlobal("DB", database(vi.fn().mockRejectedValue(quota())).db);
    const response = await middleware(request("/wa?pesan=Saya%20mau%20Canva"));
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain("Tetap bisa order manual");
    expect(html).toContain("text=Saya%20mau%20Canva");
    expect(html).toContain("6283177738496");
  });

  it("redirects React navigation to the independent document and supports HEAD", async () => {
    vi.stubGlobal("DB", database(vi.fn().mockRejectedValue(quota())).db);
    const response = await middleware(request("/checkout", { rsc: "1" }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://axvara.tech/maintenance");
    const head = await middleware(new NextRequest("https://axvara.tech/", { method: "HEAD", headers: { host: "axvara.tech" } }));
    expect(head.status).toBe(503);
    expect(await head.text()).toBe("");
  });

  it.each(["/api/orders", "/api/webhook/gopay", "/api/cron/lite", "/api/supplier-sync", "/r2/products/1", "/mcp", "/icons/chatgpt.svg", "/fonts/inter.woff2", "/robots.txt", "/sitemap.xml"])("does not probe or replace protocol/asset %s", async path => {
    const fixture = database(vi.fn().mockRejectedValue(quota()));
    vi.stubGlobal("DB", fixture.db);
    const response = await middleware(request(path));
    expect(fixture.first).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("preserves CSRF rejection and normal Pedia routing when D1 is available", async () => {
    const fixture = database();
    vi.stubGlobal("DB", fixture.db);
    const csrf = await middleware(new NextRequest("https://axvara.tech/api/orders", { method: "POST", headers: { host: "axvara.tech", origin: "https://attacker.test" } }));
    expect(csrf.status).toBe(403);
    expect(fixture.first).not.toHaveBeenCalled();
    vi.stubEnv("PEDIA_ENABLED", "true");
    const pedia = await middleware(new NextRequest("https://pedia.axvara.tech/", { headers: { host: "pedia.axvara.tech" } }));
    expect(pedia.headers.get("x-middleware-rewrite")).toBe("https://pedia.axvara.tech/pedia");
    const market = await middleware(request());
    expect(market.headers.get("x-middleware-next")).toBe("1");
    expect(market.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

it("actual status helper works in workerd with native Cache API, and the D1 probe reads at most one row", async () => {
  vi.useRealTimers();
  const source = ts.transpileModule(readFileSync("src/lib/d1-maintenance.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    // This helper is normally bundled into a worker, not exposed as an entrypoint.
    .replace("export const D1_AVAILABILITY_SQL", "const D1_AVAILABILITY_SQL");
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", d1Databases: ["DB"], script: `${source}
    let probes=0;
    export default { async fetch(request,env) {
      // Fresh object bypasses isolate memory, so request 2 must use native Cache API.
      const db={prepare(sql){probes++;return env.DB.prepare(sql);}};
      const maintenance=await isD1InMaintenance(db,"https://axvara.tech");
      return Response.json({maintenance,probes});
    } };` });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE store_settings(key TEXT PRIMARY KEY,value TEXT)").run();
    await db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO store_settings SELECT 'key'||x,'value' FROM n").run();
    const result = await db.prepare(D1_AVAILABILITY_SQL).all();
    expect(result.results).toHaveLength(1);
    expect(result.meta.rows_read).toBeLessThanOrEqual(1);
    expect(result.meta.rows_written).toBe(0);
    expect(await (await runtime.dispatchFetch("https://axvara.tech/")).json()).toEqual({ maintenance: false, probes: 1 });
    expect(await (await runtime.dispatchFetch("https://axvara.tech/")).json()).toEqual({ maintenance: false, probes: 1 });
  } finally { await runtime.dispose(); }
}, 20000);
