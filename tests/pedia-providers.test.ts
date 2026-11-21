import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyPediaDiff } from "@/lib/pedia/sync";
import { callPediaProxy } from "@/lib/pedia/proxy";
import { processPediaPaidOrders } from "@/lib/pedia/dispatch";
import { createPediaQuoteToken, verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { SignJWT } from "jose";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
/** Historical supplier name used only by legacy rows in these fixtures. */
const RETIRED = "legacy_supplier";
const service = (rate = 1000, min = 100, service_id = 86) => ({ service_id, name: "Private supplier name", category: "IG", type: "Default", rate, min_qty: min, max_qty: 1000, api_refill: 1, api_cancel: 0, api_dripfeed: 0 });
const request = (body: unknown) => new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;

async function seed() {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  await db.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES ('ig','instagram','followers','profile','IG','[100,250]',10,1)`);
  // Curated IndoSMM sale tier.
  await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active) VALUES (1,'hemat','indosmm',86,'G3',20,1000,30,1)`);
  // Stale active tier of a retired supplier: must never be offered, quoted or ordered.
  await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active) VALUES (1,'standar',?,87,'G3',20,1000,30,1)`, RETIRED);
  await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES (?,87,'Private supplier name','IG','Default',5000,250,1000,1,1)`, RETIRED);
  await applyPediaDiff(db, "indosmm", [service()], [], "IDR");
  return { db, fx };
}

async function paid(db: ReturnType<typeof createDatabaseAccess>, supplier: string, status = "queued", code = "AXP-P") {
  await db.execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES (?,'','6281234567890','test@example.com','[]',10000,'qris','lunas','pedia')`, code);
  await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id) VALUES (?,1,1,'{}','x','x',250,40,10000,?,?,1000,?,'SAME-ORDER-ID')`, code, supplier, supplier === "indosmm" ? 86 : 87, status);
}

describe("curated IndoSMM sale surface", () => {
  it("offers only curated IndoSMM tiers and hides stale retired-supplier rows", async () => {
    await seed();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const catalog = await (await GET()).json();
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].tiers).toHaveLength(1);
    expect(catalog.products[0].tiers[0]).toMatchObject({ id: 1, min_qty: 100, refill_days: 30 });
    expect(catalog.products[0].tiers[0].description).toBeNull();
    expect(JSON.stringify(catalog)).not.toMatch(/supplier|Private|rate|legacy_supplier/);
  });

  it("quotes the curated IndoSMM tier and signs its supplier identity", async () => {
    await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q.quote_token.split(".")).toHaveLength(5);
    expect(JSON.stringify(q)).not.toMatch(/supplier|rate_snapshot|indosmm|legacy_supplier/);
    expect(await verifyPediaQuoteToken(q.quote_token)).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 1000 });
  });

  it("refuses a quote for an active row of a supplier this build no longer sells", async () => {
    await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 2, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("comparison prices come from the sale supplier only", async () => {
    await seed();
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/pedia/prices/route");
    const res = await GET(new NextRequest("http://x/api/pedia/prices?product_slug=ig&quantity=250"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices).toHaveLength(1);
    expect(body.prices[0].tier_id).toBe(1);
    expect(body.prices[0].total).toBeGreaterThan(0);
  });

  it("hides a product whose only tiers belong to the retired supplier", async () => {
    const { db } = await seed();
    await db.execRun("UPDATE pedia_tiers SET supplier=? WHERE id=1", RETIRED);
    const { GET } = await import("@/app/api/pedia/catalog/route");
    expect((await (await GET()).json()).products).toEqual([]);
  });
});

describe("quote and order snapshots", () => {
  it("persists an IndoSMM order snapshot without making an upstream order", async () => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const q = await (await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }))).json();
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "");
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const res = await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(res.status).not.toBe(409);
    const item = await db.queryFirst(`SELECT * FROM pedia_order_items`);
    expect(item).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 1000 });
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 30, supplier: "indosmm" });
  });

  it("returns a persisted order retry BEFORE later DB/tier gates", async () => {
    const { db } = await seed();
    const { token, quoteId } = await createPediaQuoteToken({
      product_id: 1, tier_id: 1, quantity: 250, target_raw: "https://instagram.com/buyer",
      target_normalized: "https://www.instagram.com/buyer/", unit_price: 5.2, total: 1300,
      credit_code_hash: null, credit_used: 0, supplier: "indosmm", supplier_service_id: 86, supplier_rate_snapshot: 1000,
    });
    await db.execRun(`INSERT INTO orders (code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind)
      VALUES ('AXP-PERSISTED',?,'','6281234567890','test@example.com','[]',1300,'qris','lunas','pedia')`, `pedia:${quoteId}`);
    await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status)
      VALUES ('AXP-PERSISTED',1,1,'{}','https://instagram.com/buyer','https://www.instagram.com/buyer/',250,5.2,1300,0,'indosmm',86,1000,'awaiting_payment')`);
    // The sale row is gone after checkout; the saved order must still resolve.
    await db.execRun("UPDATE pedia_tiers SET is_active=0");
    const { POST } = await import("@/app/api/pedia/orders/route");
    const res = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "AXP-PERSISTED", reused: true });
  });

  it("accepts legacy encrypted quotes and old HS256 tokens without supplier identity", async () => {
    vi.stubEnv("ADMIN_JWT_SECRET", "legacy-test");
    const token = await new SignJWT({ purpose: "pedia_quote", product_id: 1, tier_id: 1, quantity: 250, total: 2300, unit_price: 9.2, target_normalized: "x", supplier_service_id: 86, supplier_rate_snapshot: 5000 })
      .setProtectedHeader({ alg: "HS256" }).setJti("legacy").setExpirationTime("30m").sign(new TextEncoder().encode("legacy-test"));
    // Missing supplier falls back to the only supported supplier.
    expect(await verifyPediaQuoteToken(token)).toMatchObject({ supplier: "indosmm", supplier_service_id: 86 });
  });
});

describe("historical rows of an unknown supplier", () => {
  it("never dispatches an item of a supplier this build cannot serve", async () => {
    const { db } = await seed();
    await paid(db, RETIRED);
    const caller = vi.fn();
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    expect(await db.queryFirst(`SELECT status,submit_attempts,last_error FROM pedia_order_items`)).toMatchObject({ status: "needs_check", submit_attempts: 0, last_error: "invalid_provider" });
  });

  it("renders a legacy expired item generically without leaking the supplier", async () => {
    const { db } = await seed();
    await db.execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind)
      VALUES ('AXP-20261014-E4FC8247','','6281234567890','test@example.com','[]',10000,'qris','expired','pedia')`);
    await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status)
      VALUES ('AXP-20261014-E4FC8247',1,1,'{}','x','x',250,40,10000,?,87,1000,'expired')`, RETIRED);
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const req = new Request("http://x/", { headers: { "x-order-contact": "test@example.com" } }) as never;
    const res = await GET(req, { params: Promise.resolve({ code: "AXP-20261014-E4FC8247" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toMatchObject({ code: "AXP-20261014-E4FC8247", status: "expired", quantity: 250 });
    expect(JSON.stringify(body)).not.toMatch(new RegExp(RETIRED));
  });
});

describe("transport and normalized diff", () => {
  it("routes real calls through the IndoSMM prefix only", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async (_url: unknown) => new Response('{"order":1}', { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await callPediaProxy("indosmm", "add", { service: 86 }, 1000, "AXP-P");
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual(["https://proxy.example/indosmm/add"]);
    expect(await callPediaProxy("retired" as never, "add")).toMatchObject({ ok: false, kind: "invalid_provider" });
    expect(await callPediaProxy("indosmm", "unknown" as never)).toMatchObject({ ok: false, kind: "invalid_action" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats HTTP 200 supplier errors as rejection, not a successful order", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    vi.stubGlobal("fetch", async () => new Response('{"error":"Insufficient funds"}'));
    expect(await callPediaProxy("indosmm", "add")).toMatchObject({ ok: false, kind: "api_error" });
  });

  it("rejects unverified currency and invalid rows before changing the catalog", async () => {
    const { db } = await seed();
    await expect(applyPediaDiff(db, "indosmm", [service(1)], [86], undefined)).rejects.toThrow("unsupported_currency");
    await expect(applyPediaDiff(db, "indosmm", [service(1)], [86], "USD")).rejects.toThrow("unsupported_currency");
    await expect(applyPediaDiff(db, "indosmm", [service(9000), { ...service(), service_id: 0 }], [], "IDR")).rejects.toThrow("invalid_service");
    await expect(applyPediaDiff(db, "retired" as never, [], [], "IDR")).rejects.toThrow("invalid_provider");
    expect((await db.queryFirst(`SELECT rate_idr_per_1k,present FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=86`))).toMatchObject({ rate_idr_per_1k: 1000, present: 1 });
  });

  it("same service IDs retain independent rates, bounds, repricing and removal", async () => {
    const { db } = await seed();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const catalog = await (await GET()).json();
    expect(catalog.products[0].tiers).toHaveLength(1);
    await applyPediaDiff(db, "indosmm", [], [86], "IDR");
    const rows = await db.queryAll(`SELECT supplier,present FROM pedia_supplier_services ORDER BY supplier`);
    expect(rows).toEqual([{ supplier: "indosmm", present: 0 }, { supplier: RETIRED, present: 1 }]);
    expect((await db.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier=?`, RETIRED))?.is_active).toBe(1);
  });

  it("margin disable remains replay-safe after a failed write", async () => {
    const { db, fx } = await seed();
    const before = await db.queryFirst(`SELECT package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    fx.control.fail = (q) => q.includes("SET package_prices_json=?");
    await expect(applyPediaDiff(db, "indosmm", [{ ...service(100000, 250) }], [], "IDR")).rejects.toThrow("Injected database interruption");
    expect((await db.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier='indosmm'`))?.is_active).toBe(0);
    fx.control.fail = null;
    await applyPediaDiff(db, "indosmm", [{ ...service(100000, 250) }], [], "IDR");
    const replayed = await db.queryFirst(`SELECT is_active,auto_disabled_reason,package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    expect(replayed).toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });
    expect(replayed?.package_prices_json).not.toBe(before?.package_prices_json);
  });
});

describe("supplier-sync", () => {
  it("requires IDR for IndoSMM and does not acknowledge partial storage", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown) => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify(body) }) as never);
    expect((await send({ source: "indosmm", services: [service()], currency: "USD" })).status).toBe(400);
    fx.control.fail = (q) => q.includes("INSERT INTO pedia_supplier_services");
    expect((await send({ source: "indosmm", services: [service()], currency: "IDR" })).status).toBe(500);
    fx.control.fail = null;
    expect((await send({ source: "indosmm", services: [{ ...service(1200) }], currency: "IDR" })).status).toBe(200);
    expect(fx.sql.prepare(`SELECT value FROM store_settings WHERE key='pedia_indosmm_diff_last_at'`).get()).toBeTruthy();
  });

  it("acknowledges the retired supplier's diff with no DB writes", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const before = {
      services: fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services`).get()?.n,
      settings: fx.sql.prepare(`SELECT COUNT(*) n FROM store_settings`).get()?.n,
    };
    const res = await POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify({ source: "providersmm", services: [{ ...service(), service_id: 777 }], removed_service_ids: [86] }) }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services`).get()?.n).toBe(before.services);
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM store_settings`).get()?.n).toBe(before.settings);
    expect(fx.sql.prepare(`SELECT present FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=86`).get()).toEqual({ present: 1 });
  });

  it("never acknowledges malformed or over-limit IndoSMM input", async () => {
    await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown, token = "test-sync") => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": token }, body: JSON.stringify(body) }) as never);
    expect((await send({ source: "indosmm", services: [service()] }, "wrong")).status).toBe(401);
    expect((await send({ source: "indosmm" })).status).toBe(400);
    expect((await send({ source: "indosmm", services: [{ ...service(), service_id: 0 }], currency: "IDR" })).status).toBe(400);
    expect((await send({ source: "indosmm", services: Array.from({ length: 101 }, (_, i) => ({ ...service(), service_id: 900 + i })), currency: "IDR" })).status).toBe(413);
  });
});

describe("durable dispatch", () => {
  it("uses the stored provider/service even after the tier is remapped", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    await db.execRun(`UPDATE pedia_tiers SET supplier=?,supplier_service_id=999 WHERE id=1`, RETIRED);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { order: "NEW" }, status: 200 } as never; }, db);
    expect(calls[0]).toEqual(["add", { service: 86, link: "x", quantity: 250 }, 30000, "AXP-P", "indosmm"]);
  });

  it("timeout never retries across ticks", async () => {
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

  it("refill status polling routes by the stored item provider", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET refill_status='submitted',refill_supplier_id='42'`);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { status: "Completed" }, status: 200 } as never; }, db);
    expect(calls).toEqual([["refill_status", { refill: "42" }, 20000, undefined, "indosmm"]]);
    expect((await db.queryFirst(`SELECT refill_status FROM pedia_order_items`))?.refill_status).toBe("completed");
  });

  it("unpaid queued items cannot submit", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    const caller = vi.fn();
    await db.execRun(`UPDATE orders SET status='pending'`);
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
  });

  it("low-balance alerts share one throttle key for the only supplier", async () => {
    const { db } = await seed();
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "test-chat");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetch = vi.fn(async () => new Response('{"ok":true,"result":{}}'));
    vi.stubGlobal("fetch", fetch);
    const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
    expect(await notifyPediaLowBalance(0, db)).toBe(true);
    expect(await notifyPediaLowBalance(0, db)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("rejects a video target for a feed-only Facebook share quote", async () => {
  const { db } = await seed();
  await db.execRun("UPDATE pedia_products SET platform='facebook',metric='shares',target_kind='post' WHERE id=1");
  const { POST } = await import("@/app/api/pedia/quote/route");
  expect((await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://facebook.com/reel/123456" }))).status).toBe(422);
  expect((await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://facebook.com/page/posts/123456/" }))).status).toBe(200);
});
