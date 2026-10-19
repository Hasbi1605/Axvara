import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { readAdminOverviewSnapshot } from "@/lib/admin-overview-cache";
import { readTelegramCatalog, telegramSearchMatch } from "@/lib/telegram/catalog-snapshot";
import { listTelegramProducts } from "@/lib/telegram/handlers/catalog";
import { getBestsellers } from "@/lib/telegram/handlers/shared";
import { NextRequest } from "next/server";
import { GET as overview } from "@/app/api/admin/overview/route";
import { createAdminToken, createIdleToken } from "@/lib/auth";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("NODE_ENV", "production");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-17T04:00:00Z"));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("private overview coalesces complete snapshots, scopes admins/periods and expires", async () => {
  const load = vi.fn(async () => ({ value: { pending: 2 }, cacheable: true }));
  const [first, second] = await Promise.all([readAdminOverviewSnapshot("admin:today", load),readAdminOverviewSnapshot("admin:today", load)]);
  expect(first).toEqual({ pending: 2 }); expect(second).toBe(first); expect(load).toHaveBeenCalledTimes(1);
  await readAdminOverviewSnapshot("other-admin:today", load);
  await readAdminOverviewSnapshot("admin:week", load);
  expect(load).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(61_000);
  await readAdminOverviewSnapshot("admin:today", load);
  expect(load).toHaveBeenCalledTimes(4);
});

it("failed/degraded overview loads remain retryable", async () => {
  const failed = vi.fn(async () => { throw new Error("D1 down"); });
  await expect(readAdminOverviewSnapshot("a", failed)).rejects.toThrow("D1 down");
  await expect(readAdminOverviewSnapshot("a", failed)).rejects.toThrow("D1 down");
  expect(failed).toHaveBeenCalledTimes(2);
  const degraded = vi.fn(async () => ({ value: { pending: 0 }, cacheable: false }));
  await readAdminOverviewSnapshot("a", degraded); await readAdminOverviewSnapshot("a", degraded);
  expect(degraded).toHaveBeenCalledTimes(2);
});

it("overview route checks auth/revocation and validation before serving a complete cached snapshot", async () => {
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("ADMIN_JWT_SECRET", "phase2-test-secret-0123456789");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  const { token,sid } = await createAdminToken("admin@example.test");
  const idle = await createIdleToken(sid);
  const headers = {cookie:`axvara_admin_token=${token}; axvara_idle=${idle}`};
  const read = (query="",auth=true) => overview(new NextRequest(`https://axvara.tech/api/admin/overview${query}`,{headers:auth?headers:{}}));
  const first=await (await read()).json();
  const afterFirst=fx.control.queries;
  fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status)
    VALUES('NEW','X','6280','[]',1000,'qris','pending')`);
  expect(await (await read()).json()).toEqual(first);
  expect(fx.control.queries-afterFirst).toBe(1); // Revocation lookup still runs; report queries do not.
  expect((await read("?period=bogus")).status).toBe(400);
  expect((await read("",false)).status).toBe(401);
  vi.advanceTimersByTime(40_000);
  expect((await (await read("?period=today")).json()).total_orders).toBe(first.total_orders+1);
  fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status)
    VALUES('NEW2','X','6280','[]',1000,'qris','pending')`);
  vi.advanceTimersByTime(21_000);
  // Operational data keeps its own 60s TTL, separate from five-minute finances.
  expect((await (await read("?period=today")).json()).total_orders).toBe(first.total_orders+1);
  vi.advanceTimersByTime(40_000);
  const refreshed = await (await read("?period=today")).json();
  expect(refreshed.total_orders).toBe(first.total_orders+2);
  expect(refreshed.selected_report.generated_at).toBe(first.selected_report.generated_at);
  fx.sql.prepare(`INSERT INTO admin_session_revocations(sid,version,revoked_at,expires_at)
    VALUES(?,1,datetime('now'),datetime('now','+9 hours'))`).run(sid);
  expect((await read()).status).toBe(401);
});

it("Telegram catalog/category/bestseller share one cached read; stock refreshes after TTL", async () => {
  const entries = new Map<string,{ response: Response; expires: number }>();
  vi.stubGlobal("caches", { default: {
    match: async (request: Request) => { const entry=entries.get(request.url); return entry && entry.expires>Date.now() ? entry.response.clone() : undefined; },
    put: async (request: Request,response: Response) => { entries.set(request.url,{ response:response.clone(),expires:Date.now()+30_000 }); },
  } });
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,telegram_enabled,sold_count) VALUES(1,'Alpha Ready','alpha',5000,10,1,10),(2,'Bravo Habis','bravo',3000,0,1,100);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'A','A',5000,10,'manual'),(2,2,'B','B',3000,0,'manual')`);
  const before=fx.control.queries;
  expect((await listTelegramProducts()).map(row=>row.name)).toEqual(["Alpha Ready"]);
  fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=1");
  expect((await getBestsellers()).map(row=>row.productId)).toEqual([1]);
  expect(await readTelegramCatalog()).toEqual(expect.arrayContaining([expect.objectContaining({ id:2,price:null })]));
  expect(fx.control.queries-before).toBe(1);
  vi.advanceTimersByTime(31_000);
  expect(await listTelegramProducts()).toEqual([]);
  expect(fx.control.queries-before).toBe(2);
});

it.each([["Netflix Premium","netflix",true],["Netflix Premium","n_t%premium",true],["Netflix Premium","canva",false],[null,"",true]] as const)("search preserves SQL LIKE semantics for %s / %s",(value,keyword,expected)=>{
  expect(telegramSearchMatch(value,keyword)).toBe(expected);
});
