import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyPediaDiff, applyProvidersmmDiff } from "@/lib/pedia/sync";
import { callPediaProxy, callPsmmProxy, type PediaProvider } from "@/lib/pedia/proxy";
import { processPediaPaidOrders } from "@/lib/pedia/dispatch";
import { createPediaQuoteToken, verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { SignJWT } from "jose";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const service = (rate = 1000, min = 100) => ({ service_id: 86, name: "Private supplier name", category: "IG", type: "Default", rate, min_qty: min, max_qty: 1000, api_refill: 1, api_cancel: 0, api_dripfeed: 0 });
const request = (body: unknown) => new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;

async function seed() {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  await db.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES ('ig','instagram','followers','profile','IG','[100,250]',10,1)`);
  for (const [provider, tier] of [["providersmm", "hemat"], ["indosmm", "standar"]]) {
    await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active) VALUES (1,?,?,86,'G3',20,1000,30,1)`, tier, provider);
  }
  await applyProvidersmmDiff(db, [service()], []);
  await applyPediaDiff(db, "indosmm", [service(5000, 250)], [], "IDR");
  return { db, fx };
}

async function paid(db: ReturnType<typeof createDatabaseAccess>, provider: PediaProvider, status = "queued", code = "AXP-P") {
  await db.execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES (?,'','6281234567890','test@example.com','[]',10000,'qris','lunas','pedia')`, code);
  await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id) VALUES (?,1,1,'{}','x','x',250,40,10000,?,86,1000,?,'SAME-ORDER-ID')`, code, provider, status);
}

describe("provider boundary and normalized diff", () => {
  it.each(["disable", "reprice"])("margin disable remains replay-safe after failed %s", async (failure) => {
    const { db, fx } = await seed();
    const before = await db.queryFirst(`SELECT package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    fx.control.fail = (q) => failure === "disable"
      ? q.includes("auto_disabled_reason='margin'")
      : q.includes("SET package_prices_json=?");
    await expect(applyPediaDiff(db, "indosmm", [service(100000, 250)], [], "IDR")).rejects.toThrow("Injected database interruption");
    const interrupted = await db.queryFirst(`SELECT is_active,package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    expect(interrupted?.package_prices_json).toBe(before?.package_prices_json);
    expect(interrupted?.is_active).toBe(failure === "disable" ? 1 : 0);
    fx.control.fail = null;
    await applyPediaDiff(db, "indosmm", [service(100000, 250)], [], "IDR");
    const replayed = await db.queryFirst(`SELECT is_active,auto_disabled_reason,package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    expect(replayed).toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });
    expect(replayed?.package_prices_json).not.toBe(before?.package_prices_json);
  });
  it("routes real calls through distinct VPS prefixes and retains the old wrapper", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async (url: unknown) => { void url; return new Response('{"order":1}', { status: 200 }); });
    vi.stubGlobal("fetch", fetch);
    await callPediaProxy("indosmm", "add", { service: 86 }, 1000, "AXP-P");
    await callPsmmProxy("status", { order: 1 });
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual(["https://proxy.example/indosmm/add", "https://proxy.example/psmm/status"]);
    expect(await callPediaProxy("unknown" as never, "add")).toMatchObject({ ok: false, kind: "invalid_provider" });
    expect(await callPediaProxy("indosmm", "unknown" as never)).toMatchObject({ ok: false, kind: "invalid_action" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("treats HTTP 200 supplier errors as rejection, not a successful order", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    vi.stubGlobal("fetch", async () => new Response('{"error":"Insufficient funds"}'));
    expect(await callPediaProxy("indosmm", "add")).toMatchObject({ ok: false, kind: "api_error" });
  });
  it("same service IDs retain independent rates, bounds, repricing and removal", async () => {
    const { db } = await seed();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const catalog = await (await GET()).json();
    expect(catalog.products[0].tiers.map((t: { min_qty: number }) => t.min_qty)).toEqual([100, 250]);
    expect(catalog.products[0].tiers[1].prices).toEqual({ "250": 2300 });
    expect(JSON.stringify(catalog)).not.toMatch(/supplier|providersmm|indosmm|rate|Private/);
    await applyPediaDiff(db, "indosmm", [], [86], "IDR");
    const rows = await db.queryAll(`SELECT supplier,present FROM pedia_supplier_services ORDER BY supplier`);
    expect(rows).toEqual([{ supplier: "indosmm", present: 0 }, { supplier: "providersmm", present: 1 }]);
    expect((await db.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier='providersmm'`))?.is_active).toBe(1);
  });
  it.each([undefined, "USD", "EUR"])("rejects unverified/non-IDR currency %s before changing the catalog", async (currency) => {
    const { db } = await seed();
    await expect(applyPediaDiff(db, "indosmm", [service(1)], [86], currency)).rejects.toThrow("unsupported_currency");
    expect((await db.queryFirst(`SELECT rate_idr_per_1k,present FROM pedia_supplier_services WHERE supplier='indosmm'`))).toMatchObject({ rate_idr_per_1k: 5000, present: 1 });
  });
  it("rejects invalid rows atomically at the input boundary", async () => {
    const { db } = await seed();
    await expect(applyPediaDiff(db, "indosmm", [service(9000), { ...service(), service_id: 0 }], [], "IDR")).rejects.toThrow("invalid_service");
    await expect(applyPediaDiff(db, "unknown" as never, [], [], "IDR")).rejects.toThrow("invalid_provider");
    expect((await db.queryFirst(`SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier='indosmm'`))?.rate_idr_per_1k).toBe(5000);
  });
  it("supplier-sync requires IDR for IndoSMM and does not acknowledge partial storage", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown) => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify(body) }) as never);
    expect((await send({ source: "indosmm", services: [service()], currency: "USD" })).status).toBe(400);
    fx.control.fail = (q) => q.includes("INSERT INTO pedia_supplier_services");
    expect((await send({ source: "indosmm", services: [service()], currency: "IDR" })).status).toBe(500);
    fx.control.fail = null;
    expect((await send({ source: "indosmm", services: [service()], currency: "IDR" })).status).toBe(200);
    expect(fx.sql.prepare(`SELECT value FROM store_settings WHERE key='pedia_indosmm_diff_last_at'`).get()).toBeTruthy();
  });
});

describe("quote and order provider snapshots", () => {
  it.each(["refill_days", "min_profit_rp"])("preserves quoted %s after an equal-price term change", async (term) => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const q = await (await POST(request({ product_id: 1, tier_id: 2, quantity: 250, target: "https://instagram.com/buyer" }))).json();
    expect(await verifyPediaQuoteToken(q.quote_token)).toMatchObject({ refill_days: 30, min_profit_rp: 1000 });
    await db.execRun(`UPDATE pedia_tiers SET ${term}=? WHERE id=2`, term === "refill_days" ? 0 : 1050);
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const result = await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(result.status).not.toBe(409);
    const item = await db.queryFirst(`SELECT snapshot_json,total FROM pedia_order_items`);
    expect(item?.total).toBe(q.total);
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 30, min_profit_rp: 1000 });
  });
  it("legacy encrypted quotes without terms retain current-tier fallback", async () => {
    const { db } = await seed();
    const { token } = await createPediaQuoteToken({ product_id: 1, tier_id: 2, quantity: 250, target_raw: "https://instagram.com/buyer", target_normalized: "https://www.instagram.com/buyer/", unit_price: 9.2, total: 2300, credit_code_hash: null, credit_used: 0, supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 5000 });
    await db.execRun(`UPDATE pedia_tiers SET refill_days=15,min_profit_rp=1050 WHERE id=2`);
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST } = await import("@/app/api/pedia/orders/route");
    await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    const item = await db.queryFirst(`SELECT snapshot_json FROM pedia_order_items`);
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 15, min_profit_rp: 1050 });
  });
  it("accepts unexpired legacy ProviderSMM signed quotes", async () => {
    vi.stubEnv("ADMIN_JWT_SECRET", "legacy-test");
    const token = await new SignJWT({ purpose: "pedia_quote", product_id: 1, tier_id: 1, quantity: 250, total: 2300, unit_price: 9.2, target_normalized: "x", supplier_service_id: 86, supplier_rate_snapshot: 5000 })
      .setProtectedHeader({ alg: "HS256" }).setJti("legacy").setExpirationTime("30m").sign(new TextEncoder().encode("legacy-test"));
    expect(await verifyPediaQuoteToken(token)).toMatchObject({ supplier: "providersmm", supplier_service_id: 86 });
  });
  it("quotes the mapped provider and rejects an equal-price mapping change before payment", async () => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 2, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q.quote_token.split(".")).toHaveLength(5);
    expect(JSON.stringify(q)).not.toMatch(/supplier|rate_snapshot|indosmm|providersmm/);
    expect(await verifyPediaQuoteToken(q.quote_token)).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 5000 });
    await db.execRun(`UPDATE pedia_tiers SET supplier='providersmm' WHERE id=2`);
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const order = await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(order.status).toBe(409);
    expect((await order.json()).error).toBe("service_changed");
    expect(await db.queryAll(`SELECT * FROM orders`)).toEqual([]);
  });
  it("persists IndoSMM on a new order without making an upstream order", async () => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const q = await (await POST(request({ product_id: 1, tier_id: 2, quantity: 250, target: "https://instagram.com/buyer" }))).json();
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    const item = await db.queryFirst(`SELECT * FROM pedia_order_items`);
    expect(item).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 5000 });
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 30, supplier: "indosmm" });
  });
});

describe("durable provider-specific dispatch", () => {
  it.each(["requested", "submitted", "needs_check"])("does not overwrite unresolved %s refill after 24 hours", async (status) => {
    const { db } = await seed();
    const code = "AXP-20261012-12345678";
    await paid(db, "indosmm", "completed", code);
    await db.execRun(`UPDATE pedia_order_items SET refill_status=?,refill_supplier_id='OLD-ID',refill_last_at=datetime('now','-25 hours')`, status);
    const before = await db.queryFirst(`SELECT refill_status,refill_supplier_id,refill_last_at FROM pedia_order_items`);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code }) })).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id,refill_last_at FROM pedia_order_items`)).toEqual(before);
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const res = await GET(request({}), { params: Promise.resolve({ code }) });
    expect((await res.json()).order.refill_eligible).toBe(false);
  });
  it.each(["completed", "supplier_rejected"])("allows a new refill after conclusively %s and 24 hours", async (status) => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET refill_status=?,refill_supplier_id='OLD-ID',refill_last_at=datetime('now','-25 hours')`, status);
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async () => new Response('{"refill":43}'));
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id FROM pedia_order_items`)).toMatchObject({ refill_status: "submitted", refill_supplier_id: "43" });
  });
  it("atomic refill claim blocks a stale read racing an unresolved refill", async () => {
    const { db, fx } = await seed();
    await paid(db, "indosmm", "completed");
    fx.control.beforeRun = async (q) => {
      if (q.includes("SET refill_last_at=")) fx.sql.prepare(`UPDATE pedia_order_items SET refill_status='needs_check',refill_supplier_id='RACE-ID',refill_last_at=datetime('now','-25 hours')`).run();
    };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) })).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id FROM pedia_order_items`)).toMatchObject({ refill_status: "needs_check", refill_supplier_id: "RACE-ID" });
  });
  it("refill status polling routes by the item provider", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET refill_status='submitted',refill_supplier_id='42'`);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { status: "Completed" }, status: 200 } as never; }, db);
    expect(calls).toEqual([["refill_status", { refill: "42" }, 20000, undefined, "indosmm"]]);
    expect((await db.queryFirst(`SELECT refill_status FROM pedia_order_items`))?.refill_status).toBe("completed");
  });
  it.each(["IDR", "USD"])("cron records only verified IDR IndoSMM balances (%s)", async (currency) => {
    const { db } = await seed();
    vi.stubEnv("CRON_SECRET", "test-cron");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    vi.stubGlobal("fetch", async (url: unknown) => new Response(String(url).includes("/psmm/") ? '{"error":"Provider offline"}' : JSON.stringify({ balance: "150000", currency })));
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest("http://x/api/cron/lite?job=pedia_orders", { method: "POST", headers: { authorization: "Bearer test-cron" } }));
    expect(res.status).toBe(200);
    const rows = await db.queryAll(`SELECT supplier,balance FROM pedia_supplier_balance_log`);
    expect(rows).toEqual(currency === "IDR" ? [{ supplier: "indosmm", balance: 150000 }] : []);
  });
  it.each(["providersmm", "indosmm"] as const)("polls old %s orders using their stored provider/service after tier remapping", async (provider) => {
    const { db } = await seed();
    await paid(db, provider, "submitted");
    await db.execRun(`UPDATE pedia_tiers SET supplier=?, supplier_service_id=999 WHERE id=1`, provider === "indosmm" ? "providersmm" : "indosmm");
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { status: "In progress" }, status: 200 } as never; }, db);
    expect(calls).toEqual([["status", { order: "SAME-ORDER-ID" }, 20000, undefined, provider]]);
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("in_progress");
  });
  it("dispatch uses original service, never the tier's replacement", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    await db.execRun(`UPDATE pedia_tiers SET supplier='providersmm',supplier_service_id=999 WHERE id=1`);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { order: "NEW" }, status: 200 } as never; }, db);
    expect(calls[0]).toEqual(["add", { service: 86, link: "x", quantity: 250 }, 30000, "AXP-P", "indosmm"]);
  });
  it("timeout never retries or crosses providers, including later cron ticks", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    const caller = vi.fn(async (...args: unknown[]) => { void args; return { ok: false, kind: "timeout" } as never; });
    await processPediaPaidOrders(caller, db);
    await processPediaPaidOrders(caller, db);
    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller.mock.calls[0]?.[4]).toBe("indosmm");
    expect(await db.queryFirst(`SELECT status,submit_attempts FROM pedia_order_items`)).toMatchObject({ status: "needs_check", submit_attempts: 1 });
  });
  it("crashed submitting orders become needs_check without any network call", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "submitting");
    const caller = vi.fn();
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("needs_check");
  });
  it("provider low-balance alerts have independent throttle keys", async () => {
    const { db } = await seed();
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "test-chat");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetch = vi.fn(async () => new Response('{"ok":true,"result":{}}'));
    vi.stubGlobal("fetch", fetch);
    const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
    expect(await notifyPediaLowBalance(0, db)).toBe(true);
    expect(await notifyPediaLowBalance(0, db, "indosmm")).toBe(true);
    expect(await notifyPediaLowBalance(0, db)).toBe(false);
    expect(await notifyPediaLowBalance(0, db, "indosmm")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("unknown providers and unpaid queued items cannot submit", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    const caller = vi.fn();
    await db.execRun(`UPDATE orders SET status='pending'`);
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    await db.execRun(`UPDATE orders SET status='lunas'`);
    await db.execRun(`UPDATE pedia_order_items SET supplier='unknown'`);
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("needs_check");
  });
  it("refill follows the old order provider and stored eligibility, not its remapped tier", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET snapshot_json='{"refill_days":30}'`);
    await db.execRun(`UPDATE pedia_tiers SET supplier='providersmm',supplier_service_id=999,refill_days=0 WHERE id=1`);
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async (url: unknown) => { void url; return new Response('{"refill":42}'); });
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    const res = await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) });
    expect(res.status).toBe(200);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://proxy.example/indosmm/refill");
    expect((await db.queryFirst(`SELECT refill_supplier_id FROM pedia_order_items`))?.refill_supplier_id).toBe("42");
  });
});
