import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1, D1Statement } from "@/lib/db";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { createAivaultOrderLinks, processAivaultOrders, retryAivaultOrder } from "@/lib/aivault/orders";
import { createStorebatOrderLinks, processStorebatOrders, retryStorebatOrder } from "@/lib/storebat/orders";
import { createMiraiOrderLinks, processMiraiOrders, retryMiraiOrder } from "@/lib/mirai/orders";
import { createTunvnOrderLinks, processTunvnOrders, retryTunvnOrder } from "@/lib/tunvn/orders";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "../helpers/d1-fixture";

type Fixture = ReturnType<typeof createD1Fixture>;
type Row = Record<string, unknown>;
type Mode = "ok" | "retryable" | "preflight";

type Budgets = {
  create: number;
  processOk: number;
  processRetry: number;
  retryOk: number;
  retryRetry: number;
  claimLossTotal: number;
};

type Adapter = {
  name: string;
  orderCode: string;
  linkTable: string;
  expected: Budgets;
  state: { mode: Mode; onPurchase?: () => void };
  setup: () => void;
  item: () => Row;
  seedOrder: (code?: string) => Row;
  createLinks: (code: string, db: DatabaseAccess) => Promise<number>;
  process: (db: DatabaseAccess) => Promise<number>;
  retry: (db: DatabaseAccess, id: number) => Promise<boolean>;
  installFetch: () => void;
  purchases: () => number;
  row: () => Row | null;
};

function instrument(base: DatabaseAccess, options: { loseClaim?: boolean } = {}) {
  let reads = 0;
  let writes = 0;
  let batchMembers = 0;
  let total = 0;
  let afterDue = false;
  let claimSeen = false;
  let preClaimReads = 0;
  let claimPreReads = 0;
  const d1: D1 | null = base.d1
    ? new Proxy(base.d1, {
        get(target, prop, receiver) {
          if (prop === "batch") {
            return async (statements: D1Statement[]) => {
              batchMembers += statements.length;
              total += statements.length;
              return target.batch(statements);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      })
    : null;
  const access: DatabaseAccess = {
    ...base,
    d1,
    queryAll: async (q, ...p) => {
      total++;
      reads++;
      if (afterDue && !claimSeen) preClaimReads++;
      afterDue = true;
      return base.queryAll(q, ...p);
    },
    queryFirst: async (q, ...p) => {
      total++;
      reads++;
      if (afterDue && !claimSeen) preClaimReads++;
      return base.queryFirst(q, ...p);
    },
    execRun: async (q, ...p) => {
      if (afterDue && !claimSeen) {
        claimSeen = true;
        claimPreReads = preClaimReads;
        total++;
        writes++;
        if (options.loseClaim) return { changes: 0 };
        return base.execRun(q, ...p);
      }
      total++;
      writes++;
      return base.execRun(q, ...p);
    },
  };
  return {
    access,
    metrics: () => ({ total, reads, writes, batchMembers, claimPreReads, claimSeen }),
    reset: () => {
      reads = writes = batchMembers = total = claimPreReads = preClaimReads = 0;
      afterDue = claimSeen = false;
    },
  };
}

const json = (value: unknown, status = 200) => Response.json(value, { status });

function makeAivault(f: Fixture): Adapter {
  const orderCode = "AXV-BUDGET-AV";
  const serviceId = "service_budget";
  const credential = "aivault-budget-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "Gemini",
    price: 13500,
    qty: 1,
    aivault_eligibility: { version: 1, service_id: serviceId, source_variant_id: 1, quantity: 1, cost_usd: 0.5 },
  });
  return {
    name: "AIVault",
    orderCode,
    linkTable: "aivault_order_links",
    expected: { create: 2, processOk: 21, processRetry: 18, retryOk: 13, retryRetry: 10, claimLossTotal: 4 },
    state,
    setup() {
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "fixture-key");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,aivault_family) VALUES(1,'Gemini','gemini-budget',13500,10,'gemini-budget');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id) VALUES(1,1,'AV-${serviceId}','6 Bulan',13500,10,'manual',1,'${serviceId}');
        INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json) VALUES('${serviceId}','Gemini',10,0.5,'[]');`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createAivaultOrderLinks(code, db),
    process: (db) => processAivaultOrders(db, { orderCode }),
    retry: (db, id) => retryAivaultOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/quote")) {
            return json({
              service_id: serviceId,
              quantity: 1,
              currency: "USD",
              stock: 10,
              sufficient_balance: state.mode !== "preflight",
              pricing: { unit_price: 0.5, final_total: 0.5 },
            });
          }
          if (init?.method === "POST" && path.endsWith("/order")) {
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"error":"upstream"}', { status: 500 });
            return json(
              {
                success: true,
                order_id: "AV-BUDGET-1",
                external_order_id: `${orderCode}-0`,
                service_id: serviceId,
                quantity: 1,
                total_cost: 0.5,
                currency: "USD",
                status: "delivered",
                products: [credential],
              },
              201,
            );
          }
          throw new Error(`unexpected AIVault request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM aivault_order_links LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeStorebat(f: Fixture): Adapter {
  const orderCode = "AXV-BUDGET-SB";
  const key = `${orderCode}-0`;
  const credential = "storebat-budget-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "StoreBat",
    price: 13500,
    qty: 1,
    storebat_eligibility: {
      version: 1,
      kind: "product",
      sku: "SB-121",
      product_id: 121,
      family: "storebat-budget",
      source_variant_id: 1,
      quantity: 1,
      cost_usd: 0.5,
      fx_idr_per_usd: 20000,
    },
  });
  return {
    name: "Storebat",
    orderCode,
    linkTable: "storebat_order_links",
    expected: { create: 2, processOk: 21, processRetry: 18, retryOk: 13, retryRetry: 10, claimLossTotal: 4 },
    state,
    setup() {
      vi.stubEnv("STOREBAT_API_KEY", "fixture-key");
      vi.stubEnv("STOREBAT_BASE_URL", "https://storebat.test/api/reseller");
      vi.stubEnv("STOREBAT_ENABLED", "true");
      vi.stubEnv("STOREBAT_SYNC_ENABLED", "true");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,storebat_family) VALUES(1,'StoreBat','storebat-budget',13500,10,'storebat-budget');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id,storebat_cost_usd,storebat_fx_idr_per_usd) VALUES(1,1,'SB-121','Fixture',13500,10,'manual',1,121,0.5,20000);
        INSERT INTO storebat_products(id,name,price_usd,pricing_type,price_tiers_json,warranty_days,delivery_type,stock,last_seen_at,disappeared,api_test)
          VALUES(121,'Fixture',0.5,'standard','[]',0,'supplier_api',5,datetime('now'),0,0);`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createStorebatOrderLinks(code, db),
    process: (db) => processStorebatOrders(db, { orderCode }),
    retry: (db, id) => retryStorebatOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/quote")) {
            return json({
              success: true,
              quote: { product_id: 121, quantity: 1, unit_price: 0.5, total: 0.5, stock: 5, delivery_type: "supplier_api" },
              wallet_balance: state.mode === "preflight" ? 0 : 5,
            });
          }
          if (path.endsWith("/me")) return json({ success: true, wallet_balance: 5 });
          if (init?.method === "POST" && path.endsWith("/orders")) {
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"error":"upstream"}', { status: 500 });
            return json({
              success: true,
              order: {
                id: 21,
                product_id: 121,
                quantity: 1,
                status: "COMPLETED",
                delivery_type: "supplier_api",
                customer_reference: key,
                idempotency_key: key,
                amount_usd: 0.5,
                items: [{ account_data: credential }],
              },
            });
          }
          throw new Error(`unexpected Storebat request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM storebat_order_links LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeMirai(f: Fixture): Adapter {
  const orderCode = "AXV-BUDGET-MR";
  const pkgCode = "FULL_100M";
  const external = `${orderCode}-0`;
  const credential = "mirai-budget-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "Mirai",
    price: 25000,
    qty: 1,
    mirai_eligibility: {
      version: 1,
      package_code: pkgCode,
      mirai_family: "full",
      sku: `MR-${pkgCode}`,
      source_variant_id: 1,
      quantity: 1,
      cost_usdt: 2.923077,
    },
  });
  const purchaseBody = () => ({
    success: true,
    data: {
      order_code: "MO-BUDGET-1",
      external_order_id: external,
      package_code: pkgCode,
      quantity: 1,
      unit_price_vnd: 76000,
      amount_vnd: 76000,
      redeem_codes: [credential],
      status: "fulfilled",
    },
  });
  return {
    name: "Mirai",
    orderCode,
    linkTable: "mirai_order_links",
    expected: { create: 2, processOk: 21, processRetry: 18, retryOk: 13, retryRetry: 10, claimLossTotal: 4 },
    state,
    setup() {
      vi.stubEnv("MIRAI_ENABLED", "true");
      vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
      vi.stubEnv("MIRAI_API_KEY", "fixture-key");
      vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,mirai_family)
          VALUES(1,'Mirai','mirai-budget',25000,-1,1,'manual','manual','full');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt)
          VALUES(1,1,'MR-${pkgCode}','100M Token',25000,-1,'manual',1,'${pkgCode}',2.923077,16000);
        INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,min_quantity,max_quantity,unlimited,remaining_today,axvara_product_id,fx_idr_per_usdt)
          VALUES('${pkgCode}','full','Full GPT + Claude 100M',100000000,259200,76000,2.923077,1,10000,1,0,1,16000);`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createMiraiOrderLinks(code, db),
    process: (db) => processMiraiOrders(db, { orderCode }),
    retry: (db, id) => retryMiraiOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/packages")) {
            return json({
              success: true,
              data: [
                {
                  code: pkgCode,
                  group: "full",
                  name: "Full GPT + Claude 100M",
                  quota_tokens: 100000000,
                  duration_seconds: 259200,
                  reseller_price_vnd: 76000,
                  min_quantity: 1,
                  max_quantity: 10000,
                  preset_quantities: [1],
                  models: ["gpt"],
                  unlimited: true,
                  remaining_today: 0,
                },
              ],
            });
          }
          if (path.endsWith("/balance")) {
            return json({ success: true, data: { balance_vnd: state.mode === "preflight" ? 0 : 1000000, tier: "Silver", discount_bps: 500 } });
          }
          if (init?.method === "POST" && path.endsWith("/orders")) {
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"error":"upstream"}', { status: 500 });
            return json(purchaseBody());
          }
          throw new Error(`unexpected Mirai request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM mirai_order_links LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeTunvn(f: Fixture): Adapter {
  const orderCode = "AXV-BUDGET-TV";
  const credential = "tunvn-budget-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "TUNVN",
    price: 10000,
    qty: 1,
    tunvn_eligibility: {
      version: 1,
      kind: "account",
      source_product_id: 86,
      source_variant_id: 1,
      source_unit_b: null,
      quantity: 1,
      cost_usdt: 2,
    },
  });
  return {
    name: "TUNVN",
    orderCode,
    linkTable: "tunvn_order_links",
    expected: { create: 3, processOk: 23, processRetry: 23, retryOk: 14, retryRetry: 14, claimLossTotal: 5 },
    state,
    setup() {
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "fixture-key");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,source) VALUES(1,'TUNVN','tunvn-budget',10000,'manual');
        INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,is_active,tunvn_source_product_id)
          VALUES(1,1,'TUNVN-86','Account',10000,'manual',1,86);`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createTunvnOrderLinks(code, db),
    process: (db) => processTunvnOrders(db, { orderCode }),
    retry: (db, id) => retryTunvnOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/products") {
            return json({ success: true, products: [{ id: 86, name: "Account", price_vnd: 50000, price_usdt: 2, stock: 5 }], usdt_vnd: 16000 });
          }
          if (path === "/api/balance") {
            return json({
              success: true,
              username: "fixture",
              balance_vnd: 100000,
              balance_usdt: state.mode === "preflight" ? 0 : 10,
              usdt_vnd: 16000,
            });
          }
          if (init?.method === "POST" && path === "/api/buy") {
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"success":false}', { status: 500 });
            return json({
              success: true,
              order: { order_group: "ORD-BUDGET-1", quantity: 1, total_items: 1, total_price: 2, currency: "USDT" },
              items: [credential],
            });
          }
          throw new Error(`unexpected TUNVN request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM tunvn_order_links LIMIT 1").get() as Row | undefined) ?? null,
  };
}

const FACTORIES: Record<string, (f: Fixture) => Adapter> = {
  AIVault: makeAivault,
  Storebat: makeStorebat,
  Mirai: makeMirai,
  TUNVN: makeTunvn,
};

describe.each(Object.keys(FACTORIES))("%s statement budget", (name) => {
  let f: Fixture;
  let adapter: Adapter;
  const db = () => createDatabaseAccess(f.db);
  const row = () => adapter.row()!;
  const id = () => Number(row().id);

  async function reachNeedsAdmin() {
    adapter.state.mode = "preflight";
    expect(await adapter.process(db())).toBeGreaterThan(0);
    expect(row().status).toBe("needs_admin");
    adapter.state.mode = "ok";
  }

  beforeEach(() => {
    f = createD1Fixture();
    stubFulfillmentKey();
    adapter = FACTORIES[name](f);
    adapter.setup();
    adapter.installFetch();
  });

  afterEach(() => {
    f.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("create*Links emits the pinned statement count", async () => {
    adapter.seedOrder();
    const meter = instrument(db());
    expect(await adapter.createLinks(adapter.orderCode, meter.access)).toBe(1);
    expect(meter.metrics().total).toBe(adapter.expected.create);
  });

  it("dispatch success emits the pinned total", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const meter = instrument(db());
    expect(await adapter.process(meter.access)).toBe(1);
    expect(meter.metrics().total).toBe(adapter.expected.processOk);
    expect(row().status).toBe("completed");
    expect(adapter.purchases()).toBe(1);
  });

  it("dispatch retryable POST emits the pinned total", async () => {
    adapter.state.mode = "retryable";
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const meter = instrument(db());
    expect(await adapter.process(meter.access)).toBe(1);
    expect(meter.metrics().total).toBe(adapter.expected.processRetry);
    expect(adapter.purchases()).toBe(1);
  });

  it("retry* success emits the pinned total", async () => {
    adapter.seedOrder();
    await reachNeedsAdmin();
    adapter.state.mode = "ok";
    const meter = instrument(db());
    expect(await adapter.retry(meter.access, id())).toBe(true);
    expect(meter.metrics().total).toBe(adapter.expected.retryOk);
    expect(row().status).toBe("completed");
    expect(adapter.purchases()).toBe(1);
  });

  it("retry* retryable emits the pinned total", async () => {
    adapter.seedOrder();
    await reachNeedsAdmin();
    adapter.state.mode = "retryable";
    const meter = instrument(db());
    expect(await adapter.retry(meter.access, id())).toBe(true);
    expect(meter.metrics().total).toBe(adapter.expected.retryRetry);
    expect(adapter.purchases()).toBe(1);
  });

  it("claim is one UPDATE after the due read with no pre-read", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const meter = instrument(db(), { loseClaim: true });
    expect(await adapter.process(meter.access)).toBe(0);
    const metrics = meter.metrics();
    expect(metrics.claimSeen).toBe(true);
    expect(metrics.claimPreReads).toBe(0);
    expect(metrics.total).toBe(adapter.expected.claimLossTotal);
    expect(metrics.writes).toBe(adapter.expected.create);
    expect(adapter.purchases()).toBe(0);
  });
});
