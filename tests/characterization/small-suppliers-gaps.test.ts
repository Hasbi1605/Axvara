import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { createAivaultOrderLinks, processAivaultOrders, retryAivaultOrder } from "@/lib/aivault/orders";
import { createStorebatOrderLinks, processStorebatOrders, retryStorebatOrder } from "@/lib/storebat/orders";
import { createMiraiOrderLinks, processMiraiOrders, retryMiraiOrder } from "@/lib/mirai/orders";
import { createTunvnOrderLinks, processTunvnOrders, retryTunvnOrder } from "@/lib/tunvn/orders";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "../helpers/d1-fixture";

type Fixture = ReturnType<typeof createD1Fixture>;
type Row = Record<string, unknown>;
type Mode = "ok" | "retryable" | "preflight" | "rateLimit";

type Adapter = {
  name: string;
  orderCode: string;
  linkTable: string;
  state: { mode: Mode; onPurchase?: () => void };
  setup: () => void;
  item: () => Row;
  buffItem?: () => Row;
  seedOrder: (code?: string) => Row;
  seedBuffOrder?: (code?: string) => Row;
  createLinks: (code: string, db: DatabaseAccess) => Promise<number>;
  process: (db: DatabaseAccess, options?: { deadlineMs?: number }) => Promise<number>;
  processAll: (db: DatabaseAccess, options?: { limit?: number }) => Promise<number>;
  retry: (db: DatabaseAccess, id: number) => Promise<boolean>;
  reconcile?: (db: DatabaseAccess, id: number) => Promise<number>;
  installFetch: () => void;
  purchases: () => number;
  rateCalls: () => number;
  statusCalls?: () => number;
  row: () => Row | null;
  rowByCode: (code: string) => Row | null;
  linkCount: () => number;
};

const json = (value: unknown, status = 200) => Response.json(value, { status });

function clockAfterClaim(base: DatabaseAccess, advance: () => void): DatabaseAccess {
  let afterDue = false;
  let advanced = false;
  return {
    ...base,
    queryAll: async (q, ...p) => {
      const result = await base.queryAll(q, ...p);
      afterDue = true;
      return result;
    },
    queryFirst: (q, ...p) => base.queryFirst(q, ...p),
    execRun: async (q, ...p) => {
      if (afterDue && !advanced) {
        advanced = true;
        advance();
      }
      return base.execRun(q, ...p);
    },
  };
}

function makeAivault(f: Fixture): Adapter {
  const orderCode = "AXV-GAP-AV";
  const serviceId = "service_gap";
  const credential = "aivault-gap-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  let rateCount = 0;
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
    state,
    setup() {
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "fixture-key");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,aivault_family) VALUES(1,'Gemini','gemini-gap',13500,10,'gemini-gap');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id) VALUES(1,1,'AV-${serviceId}','6 Bulan',13500,10,'manual',1,'${serviceId}');
        INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json) VALUES('${serviceId}','Gemini',10,0.5,'[]');`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createAivaultOrderLinks(code, db),
    process: (db, options = {}) => processAivaultOrders(db, { orderCode, ...options }),
    processAll: (db, options = {}) => processAivaultOrders(db, options),
    retry: (db, id) => retryAivaultOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      rateCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/quote")) {
            if (state.mode === "rateLimit") {
              rateCount++;
              return new Response("", { status: 429 });
            }
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
            const sent = JSON.parse(String(init?.body)) as { external_order_id: string };
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"error":"upstream"}', { status: 500 });
            return json(
              {
                success: true,
                order_id: "AV-GAP-1",
                external_order_id: sent.external_order_id,
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
    rateCalls: () => rateCount,
    row: () => (f.sql.prepare("SELECT * FROM aivault_order_links LIMIT 1").get() as Row | undefined) ?? null,
    rowByCode: (code) =>
      (f.sql.prepare("SELECT * FROM aivault_order_links WHERE order_code=?").get(code) as Row | undefined) ?? null,
    linkCount: () => Number((f.sql.prepare("SELECT COUNT(*) n FROM aivault_order_links").get() as { n: number }).n),
  };
}

function makeStorebat(f: Fixture): Adapter {
  const orderCode = "AXV-GAP-SB";
  const key = `${orderCode}-0`;
  const credential = "storebat-gap-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  let rateCount = 0;
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
      family: "storebat-gap",
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
    state,
    setup() {
      vi.stubEnv("STOREBAT_API_KEY", "fixture-key");
      vi.stubEnv("STOREBAT_BASE_URL", "https://storebat.test/api/reseller");
      vi.stubEnv("STOREBAT_ENABLED", "true");
      vi.stubEnv("STOREBAT_SYNC_ENABLED", "true");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,storebat_family) VALUES(1,'StoreBat','storebat-gap',13500,10,'storebat-gap');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id,storebat_cost_usd,storebat_fx_idr_per_usd) VALUES(1,1,'SB-121','Fixture',13500,10,'manual',1,121,0.5,20000);
        INSERT INTO storebat_products(id,name,price_usd,pricing_type,price_tiers_json,warranty_days,delivery_type,stock,last_seen_at,disappeared,api_test)
          VALUES(121,'Fixture',0.5,'standard','[]',0,'supplier_api',5,datetime('now'),0,0);`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createStorebatOrderLinks(code, db),
    process: (db, options = {}) => processStorebatOrders(db, { orderCode, ...options }),
    processAll: (db, options = {}) => processStorebatOrders(db, options),
    retry: (db, id) => retryStorebatOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      rateCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/quote")) {
            if (state.mode === "rateLimit") {
              rateCount++;
              return new Response("", { status: 429 });
            }
            return json({
              success: true,
              quote: { product_id: 121, quantity: 1, unit_price: 0.5, total: 0.5, stock: 5, delivery_type: "supplier_api" },
              wallet_balance: state.mode === "preflight" ? 0 : 5,
            });
          }
          if (path.endsWith("/me")) return json({ success: true, wallet_balance: 5 });
          if (init?.method === "POST" && path.endsWith("/orders")) {
            const sent = JSON.parse(String(init?.body)) as { customer_reference: string; idempotency_key: string };
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
                customer_reference: sent.customer_reference,
                idempotency_key: sent.idempotency_key,
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
    rateCalls: () => rateCount,
    row: () => (f.sql.prepare("SELECT * FROM storebat_order_links LIMIT 1").get() as Row | undefined) ?? null,
    rowByCode: (code) =>
      (f.sql.prepare("SELECT * FROM storebat_order_links WHERE order_code=?").get(code) as Row | undefined) ?? null,
    linkCount: () => Number((f.sql.prepare("SELECT COUNT(*) n FROM storebat_order_links").get() as { n: number }).n),
  };
}

function makeMirai(f: Fixture): Adapter {
  const orderCode = "AXV-GAP-MR";
  const pkgCode = "FULL_100M";
  const external = `${orderCode}-0`;
  const credential = "mirai-gap-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  let rateCount = 0;
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
      order_code: "MO-GAP-1",
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
    state,
    setup() {
      vi.stubEnv("MIRAI_ENABLED", "true");
      vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
      vi.stubEnv("MIRAI_API_KEY", "fixture-key");
      vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,mirai_family)
          VALUES(1,'Mirai','mirai-gap',25000,-1,1,'manual','manual','full');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt)
          VALUES(1,1,'MR-${pkgCode}','100M Token',25000,-1,'manual',1,'${pkgCode}',2.923077,16000);
        INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,min_quantity,max_quantity,unlimited,remaining_today,axvara_product_id,fx_idr_per_usdt)
          VALUES('${pkgCode}','full','Full GPT + Claude 100M',100000000,259200,76000,2.923077,1,10000,1,0,1,16000);`);
    },
    item: itemSnapshot,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] }),
    createLinks: (code, db) => createMiraiOrderLinks(code, db),
    process: (db, options = {}) => processMiraiOrders(db, { orderCode, ...options }),
    processAll: (db, options = {}) => processMiraiOrders(db, options),
    retry: (db, id) => retryMiraiOrder(db, id),
    installFetch() {
      purchaseCount = 0;
      rateCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/packages")) {
            if (state.mode === "rateLimit") {
              rateCount++;
              return new Response("", { status: 429 });
            }
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
            const sent = JSON.parse(String(init?.body)) as { external_order_id: string };
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"error":"upstream"}', { status: 500 });
            return json({
              ...purchaseBody(),
              data: { ...purchaseBody().data, external_order_id: sent.external_order_id },
            });
          }
          throw new Error(`unexpected Mirai request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    rateCalls: () => rateCount,
    row: () => (f.sql.prepare("SELECT * FROM mirai_order_links LIMIT 1").get() as Row | undefined) ?? null,
    rowByCode: (code) =>
      (f.sql.prepare("SELECT * FROM mirai_order_links WHERE order_code=?").get(code) as Row | undefined) ?? null,
    linkCount: () => Number((f.sql.prepare("SELECT COUNT(*) n FROM mirai_order_links").get() as { n: number }).n),
  };
}

function makeTunvn(f: Fixture): Adapter {
  const orderCode = "AXV-GAP-TV";
  const credential = "tunvn-gap-credential";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  let rateCount = 0;
  let statusCount = 0;
  const accountItem = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "TUNVN Account",
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
  const buffItem = (): Row => ({
    product_id: 2,
    variant_id: 2,
    name: "TUNVN Buff",
    price: 2000,
    qty: 1,
    buyer_field_key: "muse_invite_code",
    max_qty: 30,
    buyer_fields: { muse_invite_code: "Ab12Cd" },
    tunvn_eligibility: {
      version: 1,
      kind: "buff",
      source_product_id: null,
      source_variant_id: 2,
      source_unit_b: 1,
      quantity: 1,
      cost_usdt: 2,
    },
  });
  return {
    name: "TUNVN",
    orderCode,
    linkTable: "tunvn_order_links",
    state,
    setup() {
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "fixture-key");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      f.sql.exec(`INSERT INTO products(id,name,slug,price,source) VALUES(1,'TUNVN','tunvn-gap',10000,'manual'),(2,'Muse','muse-ai-1-miliar-token',2000,'manual');
        INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,is_active,tunvn_source_product_id) VALUES(1,1,'TUNVN-86','Account',10000,'manual',1,86);
        INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,is_active,buyer_field_key,max_qty,tunvn_buff_quantity_b,tunvn_fx_idr_per_usdt)
          VALUES(2,2,'TUNVN-BUFF-1B','Buff',2000,'manual',1,'muse_invite_code',30,1,16000);`);
    },
    item: accountItem,
    buffItem,
    seedOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [accountItem()] }),
    seedBuffOrder: (code = orderCode) => insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [buffItem()] }),
    createLinks: (code, db) => createTunvnOrderLinks(code, db),
    process: (db, options = {}) => processTunvnOrders(db, { orderCode, ...options }),
    processAll: (db, options = {}) => processTunvnOrders(db, options),
    retry: (db, id) => retryTunvnOrder(db, id),
    reconcile: (db, id) => processTunvnOrders(db, { reconcileId: id }),
    installFetch() {
      purchaseCount = 0;
      rateCount = 0;
      statusCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          const path = url.pathname;
          if (path === "/api/products") {
            if (state.mode === "rateLimit") {
              rateCount++;
              return new Response("", { status: 429 });
            }
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
          if (path === "/api/buff/check") {
            const text = String(JSON.parse(String(init?.body)).orders_text);
            const qty = Number(text.split(" ")[1]);
            return json({
              success: true,
              fundable: state.mode !== "preflight",
              sell_price_usdt: 2 * qty,
              orders_breakdown: [{ invite_code: "Ab12Cd", quantity_b: qty, valid: true }],
            });
          }
          if (path === "/api/buff/order") {
            purchaseCount++;
            state.onPurchase?.();
            return json({ batch_id: "BUFF-GAP" }, 202);
          }
          if (path === "/api/buff/status") {
            statusCount++;
            return json({
              success: true,
              batch_id: "BUFF-GAP",
              is_done: true,
              orders: [{ invite_code: "Ab12Cd", quantity_b: 1, currency: "usdt", order_code: "TELE-GAP", status: "done" }],
            });
          }
          if (init?.method === "POST" && path === "/api/buy") {
            purchaseCount++;
            state.onPurchase?.();
            if (state.mode === "retryable") return new Response('{"success":false}', { status: 500 });
            return json({
              success: true,
              order: { order_group: "ORD-GAP-1", quantity: 1, total_items: 1, total_price: 2, currency: "USDT" },
              items: [credential],
            });
          }
          throw new Error(`unexpected TUNVN request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    rateCalls: () => rateCount,
    statusCalls: () => statusCount,
    row: () => (f.sql.prepare("SELECT * FROM tunvn_order_links LIMIT 1").get() as Row | undefined) ?? null,
    rowByCode: (code) =>
      (f.sql.prepare("SELECT * FROM tunvn_order_links WHERE order_code=?").get(code) as Row | undefined) ?? null,
    linkCount: () => Number((f.sql.prepare("SELECT COUNT(*) n FROM tunvn_order_links").get() as { n: number }).n),
  };
}

const FACTORIES: Record<string, (f: Fixture) => Adapter> = {
  AIVault: makeAivault,
  Storebat: makeStorebat,
  Mirai: makeMirai,
  TUNVN: makeTunvn,
};

const setDue = (f: Fixture, table: string, code: string, pagesAgo = 1) => {
  f.sql.prepare(`UPDATE ${table} SET next_attempt_at=datetime('now', ?), lease_owner=NULL, lease_expires_at=NULL WHERE order_code=?`)
    .run(`-${pagesAgo} minutes`, code);
};

describe.each(Object.keys(FACTORIES))("%s gap coverage", (name) => {
  let f: Fixture;
  let adapter: Adapter;
  const db = () => createDatabaseAccess(f.db);
  const row = () => adapter.row()!;

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
    vi.useRealTimers();
  });

  it("an expired lease held by the same owner settles according to the supplier guard", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    adapter.state.onPurchase = () =>
      f.sql.exec(`UPDATE ${adapter.linkTable} SET lease_expires_at=datetime('now','-1 minute')`);
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(1);
    const link = row();
    const item = f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row | undefined;
    if (name === "TUNVN") {
      expect(link.status).toBe("completed");
      expect(link.lease_owner).toBeNull();
      expect(item?.delivered_ciphertext).toBeTruthy();
    } else {
      expect(link.status).toBe("claimed");
      expect(link.lease_owner).toBeTruthy();
      expect(item?.delivered_ciphertext).toBeNull();
    }
  });

  it("a paid order on an ineligible channel creates zero links", async () => {
    insertTestOrder(f.sql, `${adapter.orderCode}-WA`, { status: "lunas", channel: "whatsapp", items: [adapter.item()] });
    expect(await adapter.createLinks(`${adapter.orderCode}-WA`, db())).toBe(0);
    expect(adapter.linkCount()).toBe(0);
  });

  it("rate-limit stops the batch after the first link", async () => {
    const a = `${adapter.orderCode}-RATE-A`;
    const b = `${adapter.orderCode}-RATE-B`;
    adapter.seedOrder(a);
    adapter.seedOrder(b);
    await adapter.createLinks(a, db());
    await adapter.createLinks(b, db());
    setDue(f, adapter.linkTable, a, 2);
    setDue(f, adapter.linkTable, b, 1);
    const beforeB = JSON.stringify(adapter.rowByCode(b));
    adapter.state.mode = "rateLimit";
    expect(await adapter.processAll(db())).toBe(1);
    expect(adapter.rateCalls()).toBe(1);
    expect(adapter.purchases()).toBe(0);
    expect(JSON.stringify(adapter.rowByCode(b))).toBe(beforeB);
    const first = adapter.rowByCode(a)!;
    expect(["pending", "needs_admin"]).toContain(String(first.status));
    expect(first.lease_owner).toBeNull();
  });

  it("a deadline crossed after claim defers before any supplier call", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const frozen = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(frozen);
    try {
      const access = clockAfterClaim(db(), () => vi.setSystemTime(frozen + 5_000));
      expect(await adapter.process(access, { deadlineMs: frozen + 1_000 })).toBe(1);
      expect(adapter.purchases()).toBe(0);
      const link = row();
      expect(link.status).toBe("pending");
      expect(link.lease_owner).toBeNull();
      expect(link.request_sent_at).toBeNull();
      if (name !== "TUNVN") expect(link.last_error).toBe("dispatch_deferred");
    } finally {
      vi.useRealTimers();
    }
  });

  it("limit processes only the earliest due link", async () => {
    const a = `${adapter.orderCode}-LIMIT-A`;
    const b = `${adapter.orderCode}-LIMIT-B`;
    adapter.seedOrder(a);
    adapter.seedOrder(b);
    await adapter.createLinks(a, db());
    await adapter.createLinks(b, db());
    setDue(f, adapter.linkTable, a, 1);
    setDue(f, adapter.linkTable, b, 2);
    expect(await adapter.processAll(db(), { limit: 1 })).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(adapter.rowByCode(b)!.status).toBe("completed");
    expect(adapter.rowByCode(a)!.status).toBe("pending");
    expect(Number(adapter.rowByCode(a)!.attempt_count)).toBe(0);
  });
});

describe("TUNVN reconcile and auto policy", () => {
  let f: Fixture;
  let adapter: Adapter;
  const db = () => createDatabaseAccess(f.db);
  const link = () => adapter.row()!;

  beforeEach(() => {
    f = createD1Fixture();
    stubFulfillmentKey();
    adapter = makeTunvn(f);
    adapter.setup();
    adapter.installFetch();
  });

  afterEach(() => {
    f.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reconcileId polls only a saved Buff batch", async () => {
    adapter.seedBuffOrder!();
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(link()).toMatchObject({ status: "processing", kind: "buff", provider_batch_id: "BUFF-GAP" });

    expect(await adapter.reconcile!(db(), Number(link().id))).toBe(1);
    expect(adapter.statusCalls!()).toBe(1);
    expect(link().status).toBe("completed");
    expect(adapter.purchases()).toBe(1);

    adapter.seedOrder("AXV-GAP-TV-ACCOUNT-RECONCILE");
    await adapter.createLinks("AXV-GAP-TV-ACCOUNT-RECONCILE", db());
    const account = adapter.rowByCode("AXV-GAP-TV-ACCOUNT-RECONCILE")!;
    expect(await adapter.reconcile!(db(), Number(account.id))).toBe(0);
    expect(adapter.statusCalls!()).toBe(1);
    expect(adapter.rowByCode("AXV-GAP-TV-ACCOUNT-RECONCILE")!.status).toBe("pending");
  });

  it("auto-recovers a fresh pre-send failure after top-up", async () => {
    adapter.seedOrder();
    adapter.state.mode = "preflight";
    expect(await adapter.process(db())).toBe(1);
    expect(link()).toMatchObject({ status: "needs_admin", last_error: "insufficient_balance", attempt_count: 0, request_sent_at: null });
    adapter.state.mode = "ok";
    setDue(f, adapter.linkTable, adapter.orderCode, 1);
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(link().status).toBe("completed");
  });

  it("does not auto-recover an old or disabled pre-send failure", async () => {
    adapter.seedOrder();
    adapter.state.mode = "preflight";
    await adapter.process(db());
    adapter.state.mode = "ok";
    f.sql.exec("UPDATE orders SET created_at=datetime('now','-25 hours')");
    setDue(f, adapter.linkTable, adapter.orderCode, 1);
    expect(await adapter.process(db())).toBe(0);
    expect(adapter.purchases()).toBe(0);
    expect(link().status).toBe("needs_admin");

    f.sql.exec("UPDATE orders SET created_at=datetime('now'), supplier_purchase_disabled=1");
    setDue(f, adapter.linkTable, adapter.orderCode, 1);
    expect(await adapter.process(db())).toBe(0);
    expect(adapter.purchases()).toBe(0);
  });

  it("auto-recovers dispatch_unconfirmed only with a sealed receipt", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const receipt = {
      success: true,
      order: { order_group: "ORD-GAP-REC", quantity: 1, total_items: 1, total_price: 2, currency: "USDT" },
      items: ["tunvn-gap-recovered"],
    };
    const sealed = await encryptSecret(JSON.stringify(receipt));
    f.sql.prepare(
      `UPDATE tunvn_order_links SET status='needs_admin', last_error='dispatch_unconfirmed',
       request_sent_at=datetime('now'), attempt_count=1, receipt_ciphertext=?, receipt_iv=?, receipt_http_status=200,
       next_attempt_at=datetime('now','-1 minute')
       WHERE order_code=?`,
    ).run(sealed.ciphertext, sealed.iv, adapter.orderCode);
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(0);
    expect(link().status).toBe("completed");
    const item = f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row;
    expect(await decryptSecret(String(item.delivered_ciphertext), String(item.delivered_iv))).toBe("tunvn-gap-recovered");
  });

  it("does not auto-recover dispatch_unconfirmed without a sealed receipt", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.exec(
      `UPDATE tunvn_order_links SET status='needs_admin', last_error='dispatch_unconfirmed',
       request_sent_at=datetime('now'), attempt_count=1, receipt_ciphertext=NULL, receipt_iv=NULL, receipt_http_status=NULL,
       next_attempt_at=datetime('now','-1 minute')`,
    );
    expect(await adapter.process(db())).toBe(0);
    expect(adapter.purchases()).toBe(0);
    expect(link().status).toBe("needs_admin");
  });
});
