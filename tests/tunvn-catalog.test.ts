import fs from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess, createBudgetedDatabase } from "@/lib/db-access";
import {
  TUNVN_BUFF_COST_USDT_PER_B, TUNVN_BUFF_MARKUP_PERCENT, TUNVN_CHATGPT_MARKUP_PERCENT,
  tunvnBuffSellPriceIdr, tunvnChatGptSellPriceIdr,
} from "@/lib/tunvn/pricing";
import { publishTunvnCatalog, TUNVN_CHATGPT_IMAGE_URL } from "@/lib/tunvn/catalog";
import { TUNVN_FAMILIES, tunvnFamilyForSupplierId, tunvnFallbackFamily } from "@/lib/tunvn/families";
import { createD1Fixture } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth",()=>({requireAdmin:vi.fn(async()=>({email:"fixture@example.test"}))}));

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const RATE = 18_086;

const upstreamProduct = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: id === 86 ? "ACC CHAT GPT BUSINESS 1M(W1D)" : "CHAT GPT GPAY (W1D)",
  price_vnd: id === 86 ? 119_000 : 129_000, price_usdt: id === 86 ? 4.6 : 4.96,
  discount_threshold: 0, discount_price_vnd: 0, discount_threshold_usdt: 0,
  discount_price_usdt: 0, stock: id === 86 ? 22 : 6, description: "d", ...over,
});

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "test-key-not-real");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
  fx.sql.exec("INSERT INTO products(name,slug,price,stock,source) VALUES('Muse AI 1 Miliar Token','muse-ai-1-miliar-token',16000,0,'manual')");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/buff/check") ? {
    success: true, gross_cost_vnd: 390, sell_price_vnd: 390, sell_price_usdt: 0.0588, fundable: true,
    orders_breakdown: [{ invite_code: "AXVARA", quantity_b: 1, valid: true }],
  } : { success: true, products: [upstreamProduct(86), upstreamProduct(83)], usdt_vnd: 25_496 })));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const db = () => createDatabaseAccess(fx.db);
const supplier = (products = [upstreamProduct(86), upstreamProduct(83)], cost = 0.0588, fundable = true) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/buff/check") ? {
    success: true, gross_cost_vnd: 390, sell_price_vnd: 390, sell_price_usdt: cost, fundable,
    orders_breakdown: [{ invite_code: "AXVARA", quantity_b: 1, valid: true }],
  } : { success: true, products })));
};

describe("TUNVN pricing (markup owner 35%/40%, kurs Rp18.086)", () => {
  it("computes ChatGPT prices rounded up to Rp100", () => {
    expect(TUNVN_CHATGPT_MARKUP_PERCENT).toBe(35);
    expect(tunvnChatGptSellPriceIdr(4.6, RATE)).toBe(112_400);
    expect(tunvnChatGptSellPriceIdr(4.96, RATE)).toBe(121_200);
  });

  it("computes Buff prices per variant at 40%", () => {
    expect(TUNVN_BUFF_MARKUP_PERCENT).toBe(40);
    expect(tunvnBuffSellPriceIdr(5, RATE)).toBe(7_500);
    expect(tunvnBuffSellPriceIdr(10, RATE)).toBe(14_900);
    expect(tunvnBuffSellPriceIdr(20, RATE)).toBe(29_800);
    expect(tunvnBuffSellPriceIdr(30, RATE)).toBe(44_700);
    expect(TUNVN_BUFF_COST_USDT_PER_B * 20).toBeCloseTo(1.176);
    expect(() => tunvnBuffSellPriceIdr(31, RATE)).toThrow();
  });
});

describe("0112 tunvn catalog publish migration", () => {
  const migration = fs.readFileSync("drizzle/migrations/0112_tunvn_catalog_publish.sql", "utf8");
  it("adds TUNVN columns and seeds the approved catalog idempotently", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(fs.readFileSync("drizzle/schema.sql", "utf8"));
    } finally { sqlite.close(); }
    expect(migration).toContain("chatgpt-business-1-bulan-tunvn");
    expect(migration).toContain("TUNVN-BUFF-30B");
    expect(migration).toContain(TUNVN_CHATGPT_IMAGE_URL);
  });
});

describe("0123 tunvn full catalog migration", () => {
  it("adds durable identity columns, backfills ChatGPT and generalizes the trigger", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, is_active INTEGER DEFAULT 1);
        CREATE TABLE product_variants(id INTEGER PRIMARY KEY, product_id INTEGER, sku TEXT UNIQUE, is_active INTEGER DEFAULT 0);
        CREATE TABLE tunvn_products(supplier_product_id INTEGER PRIMARY KEY, publish_requested INTEGER NOT NULL DEFAULT 0);
        INSERT INTO products(id,slug,name) VALUES(1,'chatgpt-tunvn','ChatGPT Private');
        INSERT INTO product_variants(id,product_id,sku) VALUES(1,1,'TUNVN-86'),(2,1,'TUNVN-83'),(3,1,'TUNVN-BUFF-1B');
        INSERT INTO tunvn_products(supplier_product_id) VALUES(86),(83);`);
      sqlite.exec(fs.readFileSync("drizzle/migrations/0123_tunvn_full_catalog.sql", "utf8"));
      const columns = (table: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);
      expect(columns("products")).toContain("tunvn_family");
      expect(columns("product_variants")).toContain("tunvn_source_product_id");
      expect(sqlite.prepare("SELECT tunvn_family FROM products WHERE slug='chatgpt-tunvn'").get()).toEqual({ tunvn_family: "chatgpt" });
      expect(sqlite.prepare("SELECT sku,tunvn_source_product_id FROM product_variants ORDER BY id").all()).toEqual([
        { sku: "TUNVN-86", tunvn_source_product_id: 86 },
        { sku: "TUNVN-83", tunvn_source_product_id: 83 },
        { sku: "TUNVN-BUFF-1B", tunvn_source_product_id: null },
      ]);
      sqlite.exec("UPDATE product_variants SET is_active=1 WHERE sku='TUNVN-83'");
      expect(sqlite.prepare("SELECT publish_requested FROM tunvn_products WHERE supplier_product_id=83").get()).toEqual({ publish_requested: 1 });
      // Idempoten: migrasi dijalankan ulang harus melewati backfill yang sudah ada.
      expect(sqlite.prepare("SELECT COUNT(*) n FROM products WHERE tunvn_family='chatgpt'").get()).toEqual({ n: 1 });
    } finally { sqlite.close(); }
  });
});

describe("publishTunvnCatalog", () => {
  it("refreshes upstream stock, live unit costs and prices within the cron40 budget without changing admin gates/copy",async () => {
    await publishTunvnCatalog(db(),RATE);
    fx.sql.exec("UPDATE products SET is_active=1,name='Admin copy' WHERE slug='chatgpt-tunvn'; UPDATE product_variants SET is_active=1 WHERE sku IN ('TUNVN-86','TUNVN-BUFF-1B')");
    supplier([upstreamProduct(86,{price_usdt:6,stock:3}),upstreamProduct(83,{stock:0})],0.1);
    const budget=createBudgetedDatabase(40,2,fx.db);
    expect(await publishTunvnCatalog(budget.access,20000,{force:false,now:Date.now()+180_000})).toMatchObject({ok:true});
    expect(budget.used).toBeLessThanOrEqual(38);
    expect(fx.sql.prepare("SELECT price,stock,is_active FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({price:162000,stock:3,is_active:1});
    expect(fx.sql.prepare("SELECT price,stock,tunvn_cost_usdt,is_active FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({price:2800,stock:-1,tunvn_cost_usdt:0.1,is_active:1});
    expect(fx.sql.prepare("SELECT stock,is_active FROM product_variants WHERE sku='TUNVN-83'").get()).toEqual({stock:0,is_active:0});
    expect(fx.sql.prepare("SELECT name,is_active,price,stock FROM products WHERE slug='chatgpt-tunvn'").get()).toEqual({name:"Admin copy",is_active:1,price:162000,stock:3});
    expect(fx.sql.prepare("SELECT stock FROM products WHERE slug='muse-ai-1-miliar-token'").get()).toEqual({stock:-1});
    const fetcher=vi.mocked(fetch); fetcher.mockClear();
    expect(await publishTunvnCatalog(db(),20000,{force:false,now:Date.now()+180_001})).toEqual({skipped:"throttled"});
    expect(fetcher).not.toHaveBeenCalled();
    supplier([upstreamProduct(86,{price_usdt:3,stock:3}),upstreamProduct(83,{stock:0})],0.05);
    expect(await publishTunvnCatalog(db(),20000,{force:false,now:Date.now()+360_000})).toMatchObject({ok:true});
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({price:81000});
    expect(fx.sql.prepare("SELECT price,tunvn_cost_usdt,tunvn_markup_percent FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({price:1400,tunvn_cost_usdt:0.05,tunvn_markup_percent:40});
  });
  it("sets removed accounts and unfundable Buff to zero and restores availability without reactivating variants",async () => {
    await publishTunvnCatalog(db(),RATE);
    supplier([upstreamProduct(83)],0.08,false);
    await publishTunvnCatalog(db(),RATE);
    expect(fx.sql.prepare("SELECT stock,is_active FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({stock:0,is_active:0});
    expect(fx.sql.prepare("SELECT stock,is_active,tunvn_cost_usdt FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({stock:0,is_active:0,tunvn_cost_usdt:0.08});
    supplier(); await publishTunvnCatalog(db(),RATE);
    expect(fx.sql.prepare("SELECT stock,is_active FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({stock:-1,is_active:0});
  });
  it("retains manual price/markup on live updates and uses saved live cost when admin changes markup",async () => {
    await publishTunvnCatalog(db(),RATE);
    fx.sql.exec("UPDATE product_variants SET tunvn_admin_price_idr=9900,price=9900,tunvn_markup_percent=60 WHERE sku='TUNVN-BUFF-1B'");
    supplier(undefined,0.1); await publishTunvnCatalog(db(),20000);
    expect(fx.sql.prepare("SELECT price,tunvn_cost_usdt,tunvn_markup_percent FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({price:9900,tunvn_cost_usdt:0.1,tunvn_markup_percent:60});
    const {PATCH}=await import("@/app/api/admin/tunvn/buff/[sku]/route");
    const response=await PATCH(new NextRequest("http://localhost/api/admin/tunvn/buff/TUNVN-BUFF-1B",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({admin_price_idr:null,markup_percent:50})}),{params:Promise.resolve({sku:"TUNVN-BUFF-1B"})});
    expect(response.status).toBe(200);
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual({price:3000});
  });
  it("does not fabricate stock or reset Buff price on unavailable/invalid probe",async () => {
    await publishTunvnCatalog(db(),RATE);
    const before=fx.sql.prepare("SELECT * FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get();
    const real=fetch;
    vi.stubGlobal("fetch",vi.fn(async (url:string) => String(url).endsWith("/buff/check") ? Response.json({success:true,gross_cost_vnd:1,sell_price_vnd:1,sell_price_usdt:99,fundable:true,orders_breakdown:[]}) : real(url)));
    expect(await publishTunvnCatalog(db(),20000)).toEqual({ok:false,error:"buff_api_error:buff_identity"});
    expect(fx.sql.prepare("SELECT * FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get()).toEqual(before);
  });
  it("refuses an oversized mirror before partial writes consume the reserved publication budget",async () => {
    supplier(Array.from({length:1000},(_,i)=>upstreamProduct(i+100)));
    const budget=createBudgetedDatabase(40,2,fx.db);
    expect(await publishTunvnCatalog(budget.access,RATE)).toEqual({ok:false,error:"catalog_budget_exceeded"});
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM tunvn_products").get()).toEqual({n:0});
    expect(budget.used).toBe(5);
    const errRow = fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_last_error'").get() as { value: string } | undefined;
    expect(JSON.parse(errRow!.value).error).toBe("catalog_budget_exceeded");
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_success_at'").get()).toBeUndefined();
  });

  it("tracks account projection and Buff independently, throttles failed probes, and clears errors on recovery", async () => {
    const t0 = 1_800_000_000_000;
    const realFetch = fetch;
    // 1) Failure during fetch advances throttle claim, leaves success_at unset, and stores sanitized error
    vi.stubGlobal("fetch", vi.fn(async () => new Response("token=test-key-not-real", { status: 502 })));
    const fail1 = await publishTunvnCatalog(db(), RATE, { force: false, now: t0 });
    expect(fail1).toEqual({ ok: false, error: "products_ambiguous" });
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_sync_at'").get()).toEqual({ value: String(t0) });
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_success_at'").get()).toBeUndefined();
    const err1 = fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_last_error'").get() as { value: string };
    expect(JSON.parse(err1.value)).toMatchObject({ at: new Date(t0).toISOString(), error: "products_ambiguous:http_502" });

    // 2) Full success writes tunvn_catalog_success_at and clears tunvn_catalog_last_error
    vi.stubGlobal("fetch", realFetch);
    const ok1 = await publishTunvnCatalog(db(), RATE, { force: false, now: t0 + 60_000 });
    expect(ok1).toMatchObject({ ok: true });
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_success_at'").get()).toEqual({ value: String(t0 + 60_000) });
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_last_error'").get()).toEqual({ value: "" });

    // 3) Buff failure keeps its last good data, without hiding fresh account stock.
    const buffRow = () => fx.sql.prepare("SELECT price,stock,tunvn_cost_usdt,is_active FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get();
    const setting = (key: string) => (fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;
    const before = buffRow();
    const outage = vi.fn(async (url: string) => String(url).endsWith("/buff/check")
      ? new Response("untrusted supplier response", { status: 502 })
      : Response.json({ success: true, products: [upstreamProduct(86, { stock: 3 }), upstreamProduct(83)] }));
    vi.stubGlobal("fetch", outage);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect(await publishTunvnCatalog(budget.access, 20_000, { force: false, now: t0 + 240_000 }))
      .toMatchObject({ ok: true, buff_variants: 0, buff_error: "buff_ambiguous:http_502" });
    expect(budget.used).toBeLessThanOrEqual(38);
    expect(setting("tunvn_catalog_success_at")).toBe(String(t0 + 240_000));
    expect(setting("tunvn_catalog_last_error")).toBe("");
    expect(setting("tunvn_buff_sync_at")).toBe(String(t0 + 60_000));
    expect(JSON.parse(setting("tunvn_buff_last_error")!)).toMatchObject({ error: "buff_ambiguous:http_502" });
    expect(buffRow()).toEqual(before);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({ stock: 3 });

    expect(await publishTunvnCatalog(db(), 21_000, { force: false, now: t0 + 300_000 }))
      .toMatchObject({ ok: true, buff_error: "buff_ambiguous:http_502" });
    expect(outage.mock.calls.filter(([url]) => url.endsWith("/buff/check"))).toHaveLength(1);
    expect(setting("tunvn_catalog_success_at")).toBe(String(t0 + 300_000));
    expect(buffRow()).toEqual(before);

    supplier(undefined, 0.1);
    expect(await publishTunvnCatalog(db(), 20_000, { force: false, now: t0 + 420_000 }))
      .toMatchObject({ ok: true, buff_variants: 1 });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/buff/check"))).toHaveLength(1);
    expect(setting("tunvn_buff_sync_at")).toBe(String(t0 + 420_000));
    expect(setting("tunvn_buff_last_error")).toBe("");
    expect(buffRow()).toMatchObject({ price: 2800, stock: -1, tunvn_cost_usdt: 0.1 });
  });
  it("a forced admin refresh cannot overtake a running catalog projection",async () => {
    const real=fetch;
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{await gate; return real(url);}));
    const first=publishTunvnCatalog(db(),RATE);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(await publishTunvnCatalog(db(),RATE)).toEqual({skipped:"claimed_elsewhere"});
    release(); expect(await first).toMatchObject({ok:true});
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_catalog_lease'").get()).toBeUndefined();
  });
  it("writes a 45s lease duration and throttles non-force Buff probes for 3 minutes while recomputing Buff price on FX changes", async () => {
    const t0 = 1_800_000_000_000;
    const seenLeaseUntils: number[] = [];
    const access = db();
    const origExecRun = access.execRun;
    access.execRun = async (sql, ...params) => {
      if (sql.includes("'tunvn_catalog_lease'") && typeof params[0] === "string") {
        seenLeaseUntils.push(Number(JSON.parse(params[0]).until));
      }
      return origExecRun(sql, ...params);
    };
    await publishTunvnCatalog(access, 20_000, { force: false, now: t0 });
    expect(seenLeaseUntils[0]).toBe(t0 + 45_000);
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_buff_sync_at'").get()).toEqual({ value: String(t0) });

    // 1 minute later (past 45s catalog throttle, inside 3m Buff throttle):
    // /api/products runs, /api/buff/check is NOT called, Buff price recomputes for new FX.
    const fetcher = vi.mocked(fetch);
    fetcher.mockClear();
    supplier([upstreamProduct(86, { price_usdt: 4.6, stock: 10 }), upstreamProduct(83, { stock: 2 })], 0.99);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    expect(await publishTunvnCatalog(budget.access, 25_000, { force: false, now: t0 + 60_000 })).toMatchObject({ ok: true, buff_variants: 1 });
    expect(budget.used).toBeLessThanOrEqual(38);
    const buffCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/buff/check"));
    expect(buffCalls).toHaveLength(0);
    // Stored cost 0.0588 * 25_000 * 1.4 = 2058 -> ceil100 = 2100; cost stays 0.0588.
    expect(fx.sql.prepare("SELECT price,tunvn_cost_usdt,tunvn_fx_idr_per_usdt FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ price: 2100, tunvn_cost_usdt: 0.0588, tunvn_fx_idr_per_usdt: 25_000 });

    // 3 minutes later: Buff probe runs again and updates cost & timestamp.
    await publishTunvnCatalog(db(), 25_000, { force: false, now: t0 + 180_000 });
    const buffCallsAt3m = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/buff/check"));
    expect(buffCallsAt3m).toHaveLength(1);
    expect(fx.sql.prepare("SELECT price,tunvn_cost_usdt FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ price: 34_700, tunvn_cost_usdt: 0.99 });
    expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_buff_sync_at'").get()).toEqual({ value: String(t0 + 180_000) });

    // Force mode bypasses the 3-minute Buff throttle immediately.
    supplier(undefined, 0.2);
    await publishTunvnCatalog(db(), 20_000, { force: true, now: t0 + 200_000 });
    const buffCallsForced = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/buff/check"));
    expect(buffCallsForced).toHaveLength(1);
    expect(fx.sql.prepare("SELECT price,tunvn_cost_usdt FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ price: 5600, tunvn_cost_usdt: 0.2 });
  });
  it("does not overwrite a manual price that changes between read and upsert",async () => {
    await publishTunvnCatalog(db(),RATE);
    const access=db(); const write=access.execRun;
    // CAS di UPDATE varian: harga manual yang diedit admin setelah pembacaan
    // sinkron tidak boleh ditimpa rumus publikasi.
    access.execRun=async(sql,...params)=>{
      if(sql.includes("UPDATE product_variants AS pv")) fx.sql.exec("UPDATE product_variants SET price=12345,tunvn_admin_price_idr=12345 WHERE sku='TUNVN-86'");
      return write(sql,...params);
    };
    expect(await publishTunvnCatalog(access,20000)).toMatchObject({ok:true});
    expect(fx.sql.prepare("SELECT price,tunvn_admin_price_idr FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({price:12345,tunvn_admin_price_idr:12345});
  });
  it("retains sibling deactivation, base Muse and manual account overrides through publication",async () => {
    await publishTunvnCatalog(db(),RATE);
    fx.sql.exec("UPDATE products SET is_active=1 WHERE slug='chatgpt-tunvn'; UPDATE product_variants SET is_active=1 WHERE sku='TUNVN-86'; UPDATE product_variants SET is_active=0 WHERE sku='TUNVN-83'; UPDATE product_variants SET price=123400,tunvn_admin_price_idr=123400 WHERE sku='TUNVN-86'");
    const ids=fx.sql.prepare("SELECT id,sku FROM product_variants ORDER BY id").all();
    await publishTunvnCatalog(db(),20000);
    expect(fx.sql.prepare("SELECT id,sku FROM product_variants ORDER BY id").all()).toEqual(ids);
    expect(fx.sql.prepare("SELECT is_active,price FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({ is_active:1,price:123400 });
    expect(fx.sql.prepare("SELECT is_active FROM product_variants WHERE sku='TUNVN-83'").get()).toEqual({ is_active:0 });
    expect(fx.sql.prepare("SELECT price FROM products WHERE slug='muse-ai-1-miliar-token'").get()).toEqual({ price:16000 });
    fx.sql.exec("UPDATE products SET is_active=0 WHERE slug='chatgpt-tunvn'");
    await publishTunvnCatalog(db(),RATE);
    expect(fx.sql.prepare("SELECT is_active FROM products WHERE slug='chatgpt-tunvn'").get()).toEqual({ is_active:0 });
  });
  it("creates one hidden ChatGPT product and one per-1B Buff variant", async () => {
    const result = await publishTunvnCatalog(db(), RATE);
    expect(result).toMatchObject({ ok: true, families: 1, variants: 2, buff_variants: 1, idr_per_usdt: RATE, activated: 0 });

    const business = fx.sql.prepare("SELECT * FROM products WHERE slug='chatgpt-tunvn'").get() as Record<string, unknown>;
    expect(business).toMatchObject({ name:"ChatGPT Private",price: 112_400, stock: 0, is_active: 0, image_url: TUNVN_CHATGPT_IMAGE_URL });
    expect(fx.sql.prepare("SELECT COUNT(DISTINCT product_id) AS n FROM product_variants WHERE sku IN ('TUNVN-86','TUNVN-83')").get()).toEqual({ n:1 });
    expect(fx.sql.prepare("SELECT price,stock,is_active FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({ price: 112_400, stock: 22, is_active: 0 });
    expect(fx.sql.prepare("SELECT visible,sell_price_idr FROM tunvn_products WHERE supplier_product_id=86").get())
      .toEqual({ visible: 0, sell_price_idr: 112_400 });

    const buff = fx.sql.prepare("SELECT sku,price,tunvn_buff_quantity_b FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%' ORDER BY tunvn_buff_quantity_b").all();
    expect(buff).toEqual([
      { sku: "TUNVN-BUFF-1B", price: 1_500, tunvn_buff_quantity_b: 1 },
    ]);
    // Produk Muse manual lain dari fixture schema tidak berubah harganya.
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%' AND product_id=(SELECT id FROM products WHERE slug='muse-ai-1-miliar-token')").get()).toEqual({ c: 1 });
  });

  it("is idempotent on re-publish and refreshes price from a new FX", async () => {
    await publishTunvnCatalog(db(), RATE);
    const again = await publishTunvnCatalog(db(), 20_000);
    expect(again).toMatchObject({ ok: true, families: 1, variants: 2 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM products WHERE slug='chatgpt-tunvn'").get()).toEqual({ c: 1 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM product_variants WHERE sku LIKE 'TUNVN-BUFF-%'").get()).toEqual({ c: 1 });
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE sku='TUNVN-86'").get())
      .toEqual({ price: tunvnChatGptSellPriceIdr(4.6, 20_000) });
  });

  it("honours admin publish request, markup, and copy without re-hiding on sync", async () => {
    await publishTunvnCatalog(db(), RATE);
    fx.sql.exec(`UPDATE tunvn_products SET publish_requested=1, markup_percent=50,
      admin_name='ChatGPT Bisnis Spesial', admin_description='Deskripsi admin.' WHERE supplier_product_id=86`);
    fx.sql.exec("UPDATE products SET is_active=1,name='Copy admin',description='Deskripsi admin.' WHERE slug='chatgpt-tunvn'; UPDATE product_variants SET is_active=1 WHERE sku='TUNVN-86'");
    const result = await publishTunvnCatalog(db(), RATE);
    expect(result).toMatchObject({ ok: true, activated: 1 });
    const business = fx.sql.prepare("SELECT * FROM products WHERE slug='chatgpt-tunvn'").get() as Record<string, unknown>;
    expect(business).toMatchObject({ name: "Copy admin", description: "Deskripsi admin.", is_active: 1, price: tunvnChatGptSellPriceIdr(4.6, RATE, 50) });
    expect(fx.sql.prepare("SELECT is_active FROM product_variants WHERE sku='TUNVN-86'").get()).toEqual({ is_active: 1 });
    expect(fx.sql.prepare("SELECT visible FROM tunvn_products WHERE supplier_product_id=86").get()).toEqual({ visible: 1 });
    // Produk lain yang tidak diminta tetap tersembunyi.
    expect(fx.sql.prepare("SELECT is_active FROM product_variants WHERE sku='TUNVN-83'").get()).toEqual({ is_active: 0 });
  });

  it("keeps a manual Buff price and custom markup across re-publish", async () => {
    await publishTunvnCatalog(db(), RATE);
    fx.sql.exec("UPDATE product_variants SET tunvn_markup_percent=60, tunvn_admin_price_idr=99900, price=99900, is_active=1 WHERE sku='TUNVN-BUFF-1B'");
    await publishTunvnCatalog(db(), 20_000);
    expect(fx.sql.prepare("SELECT price,tunvn_markup_percent,is_active FROM product_variants WHERE sku='TUNVN-BUFF-1B'").get())
      .toEqual({ price: 99_900, tunvn_markup_percent: 60, is_active: 1 });
  });

  it("does nothing when the sync gate is off", async () => {
    vi.stubEnv("TUNVN_SYNC_ENABLED", "false");
    expect(await publishTunvnCatalog(db(), RATE)).toEqual({ skipped: "not_configured" });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM products WHERE slug LIKE 'chatgpt-%-tunvn'").get()).toEqual({ c: 0 });
  });
});

describe("family map (owner 15 Nov 2026)", () => {
  it("maps every supplier id exactly once and never maps #60", () => {
    const ids = TUNVN_FAMILIES.flatMap(family => family.members.map(member => member.supplier_product_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(60);
    expect(tunvnFamilyForSupplierId(60)).toBeNull();
    expect(tunvnFamilyForSupplierId(44)?.family.key).toBe("capcut");
    expect(tunvnFamilyForSupplierId(86)?.member.label).toBe("Business 1 Bulan");
    const muse = tunvnFamilyForSupplierId(97)?.family;
    expect(muse).toMatchObject({ key: "muse", markFamily: false, slug: "muse-ai-1-miliar-token" });
  });

  it("builds a collision-safe 1:1 fallback family for unknown products", () => {
    expect(tunvnFallbackFamily(999, "  Produk Baru X  ")).toMatchObject({
      key: "p999", name: "Produk Baru X", slug: "produk-baru-x-tunvn", imageFromSlugs: [],
    });
    expect(tunvnFallbackFamily(1000, "")).toMatchObject({ key: "p1000", slug: "produk-tunvn-1000-tunvn" });
  });
});

describe("generic family publication", () => {
  const mirror = (id: number, name: string, priceUsdt: number, stock: number) => upstreamProduct(id, { name, price_usdt: priceUsdt, stock });

  it("creates one inactive parent per family with variants, images, category and #60 excluded", async () => {
    fx.sql.exec("INSERT INTO products(name,slug,price,image_url) VALUES('CapCut Pro','capcut-pro',10000,'/r2/capcut.webp'),('Claude Pro','claude-pro',10000,'/r2/claude.webp')");
    supplier([
      mirror(44, "CAPCUT PRO 7D", 1, 5),
      mirror(87, "CAPCUT PRO 1M", 2, 2),
      mirror(69, "CLAUDE API 100", 10, 1),
      mirror(97, "MUSE 1B", 0.5, 8),
      mirror(60, "API TEST", 1, 99),
      mirror(999, "PRODUK BARU X", 1.5, 3),
    ]);
    const result = await publishTunvnCatalog(db(), RATE);
    expect(result).toMatchObject({ ok: true, families: 4, variants: 5 });

    const capcut = fx.sql.prepare("SELECT * FROM products WHERE slug='capcut-pro-tunvn'").get() as Record<string, unknown>;
    expect(capcut).toMatchObject({ name: "CapCut Pro", is_active: 0, tunvn_family: "capcut", image_url: "/r2/capcut.webp", category_id: 3, price: 24500 });
    const capcutVariants = fx.sql.prepare("SELECT sku,label,price,stock,is_active,tunvn_source_product_id FROM product_variants WHERE product_id=? ORDER BY sku").all(capcut.id);
    expect(capcutVariants).toEqual([
      { sku: "TUNVN-44", label: "7 Hari · 500 Kredit", price: 24500, stock: 5, is_active: 0, tunvn_source_product_id: 44 },
      { sku: "TUNVN-87", label: "1 Bulan", price: 48900, stock: 2, is_active: 0, tunvn_source_product_id: 87 },
    ]);

    expect(fx.sql.prepare("SELECT name,is_active,image_url,tunvn_family FROM products WHERE slug='claude-api-tunvn'").get())
      .toEqual({ name: "Claude API Credit", is_active: 0, image_url: "/r2/claude.webp", tunvn_family: "claude-api" });
    // Muse: produk owner tidak berubah identitasnya, varian baru menempel.
    expect(fx.sql.prepare("SELECT name,is_active,tunvn_family FROM products WHERE slug='muse-ai-1-miliar-token'").get())
      .toEqual({ name: "Muse AI 1 Miliar Token", is_active: 1, tunvn_family: null });
    expect(fx.sql.prepare("SELECT product_id,is_active,stock FROM product_variants WHERE sku='TUNVN-97'").get())
      .toMatchObject({ is_active: 0, stock: 8 });
    // Fallback 1:1.
    const fallback = fx.sql.prepare("SELECT * FROM products WHERE slug='produk-baru-x-tunvn'").get() as Record<string, unknown>;
    expect(fallback).toMatchObject({ name: "PRODUK BARU X", tunvn_family: "p999", is_active: 0 });
    expect(fx.sql.prepare("SELECT label,price FROM product_variants WHERE sku='TUNVN-999'").get())
      .toEqual({ label: "PRODUK BARU X", price: 36700 });
    // #60 tidak pernah dibuat/dibeli.
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE tunvn_source_product_id=60 OR sku='TUNVN-60'").get()).toEqual({ n: 0 });
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM products WHERE tunvn_family='p60'").get()).toEqual({ n: 0 });
    // Tidak ada varian TUNVN yang tiba-tiba aktif.
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE tunvn_source_product_id IS NOT NULL AND is_active=1").get()).toEqual({ n: 0 });
  });

  it("respects admin manual price and markup on later publishes", async () => {
    supplier([mirror(44, "CAPCUT 7D", 1, 5), mirror(87, "CAPCUT 1M", 2, 2)]);
    await publishTunvnCatalog(db(), RATE);
    fx.sql.exec("UPDATE product_variants SET tunvn_admin_price_idr=50000,price=50000 WHERE sku='TUNVN-44'; UPDATE tunvn_products SET markup_percent=60 WHERE supplier_product_id=87");
    await publishTunvnCatalog(db(), RATE);
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE sku='TUNVN-44'").get()).toEqual({ price: 50000 });
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE sku='TUNVN-87'").get()).toEqual({ price: 57900 });
  });

  it("keeps the publication statement count constant for the whole mirror", async () => {
    const all = TUNVN_FAMILIES.flatMap(family => family.members.map(member => mirror(member.supplier_product_id, `UPSTREAM ${member.supplier_product_id}`, 1, 4)));
    supplier(all);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    const result = await publishTunvnCatalog(budget.access, RATE);
    expect(result).toMatchObject({ ok: true, families: TUNVN_FAMILIES.length, variants: all.length });
    expect(budget.used).toBeLessThanOrEqual(25);
  });
});
