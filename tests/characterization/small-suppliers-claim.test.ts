import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { createAivaultOrderLinks, processAivaultOrders, retryAivaultOrder } from "@/lib/aivault/orders";
import { createStorebatOrderLinks, processStorebatOrders, retryStorebatOrder } from "@/lib/storebat/orders";
import { createMiraiOrderLinks, processMiraiOrders, retryMiraiOrder } from "@/lib/mirai/orders";
import { createTunvnOrderLinks, processTunvnOrders, retryTunvnOrder } from "@/lib/tunvn/orders";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "../helpers/d1-fixture";
import { stubStorebatEnv } from "../helpers/storebat-fixture";

vi.mock("@/lib/notify-buyer", () => ({
  notifyBuyerTunvnProcessing: vi.fn(async () => true),
  notifyBuyerBuffCompleted: vi.fn(async () => true),
  notifyBuyerDeliveryFailed: vi.fn(async () => true),
}));

type Fixture = ReturnType<typeof createD1Fixture>;
type Row = Record<string, unknown>;
type Mode = "ok" | "retryable" | "preflight";

type Adapter = {
  name: string;
  orderCode: string;
  linkTable: string;
  providerField: string;
  providerId: unknown;
  providerViolation: string;
  credential: string;
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
  itemRow: () => Row | null;
};

const json = (value: unknown, status = 200) => Response.json(value, { status });
const future = (value: unknown) => {
  const raw = String(value ?? "").trim().replace(" ", "T");
  const ms = Date.parse(raw.endsWith("Z") ? raw : `${raw}Z`);
  return Number.isFinite(ms) && ms > Date.now();
};

function makeAivault(f: Fixture): Adapter {
  const orderCode = "AXV-CHAR-AV-0001";
  const serviceId = "service_fixture";
  const base = "https://aivault.test";
  const credential = "aivault-credential-CHARACTERIZATION";
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
    providerField: "provider_order_id",
    providerId: "AV-ORDER-1",
    providerViolation: "provider_order_id='KNOWN'",
    credential,
    state,
    setup() {
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "fixture-key");
      vi.stubEnv("AIVAULT_BASE_URL", base);
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,aivault_family) VALUES(1,'Gemini','gemini-fixture',13500,10,'gemini-family');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id) VALUES(1,1,'AV-${serviceId}','6 Bulan',13500,10,'manual',1,'${serviceId}');
        INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json) VALUES('${serviceId}','Gemini',10,0.5,'[]');`);
    },
    item: itemSnapshot,
    seedOrder(code = orderCode) {
      return insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] });
    },
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
                order_id: "AV-ORDER-1",
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
    itemRow: () => (f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeStorebat(f: Fixture): Adapter {
  const orderCode = "AXV-CHAR-SB-0001";
  const key = `${orderCode}-0`;
  const base = "https://storebat.test/api/reseller";
  const credential = "storebat-credential-CHARACTERIZATION";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "StoreBat Fixture",
    price: 13500,
    qty: 1,
    storebat_eligibility: {
      version: 1,
      kind: "product",
      sku: "SB-121",
      product_id: 121,
      family: "storebat-family",
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
    providerField: "provider_order_id",
    providerId: 21,
    providerViolation: "provider_order_id=21",
    credential,
    state,
    setup() {
      stubStorebatEnv();
      vi.stubEnv("STOREBAT_BASE_URL", base);
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,storebat_family) VALUES(1,'StoreBat Fixture','storebat-fixture',13500,10,'storebat-family');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id,storebat_cost_usd,storebat_fx_idr_per_usd) VALUES(1,1,'SB-121','Fixture',13500,10,'manual',1,121,0.5,20000);
        INSERT INTO storebat_products(id,name,price_usd,pricing_type,price_tiers_json,warranty_days,delivery_type,stock,last_seen_at,disappeared,api_test)
          VALUES(121,'Fixture',0.5,'standard','[]',0,'supplier_api',5,datetime('now'),0,0);`);
    },
    item: itemSnapshot,
    seedOrder(code = orderCode) {
      return insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] });
    },
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
          if (path.endsWith("/orders/lookup")) {
            return json({ success: true, results: [{ request_status: "failed_no_charge", idempotency_key: key, order: null }] });
          }
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
    itemRow: () => (f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeMirai(f: Fixture): Adapter {
  const orderCode = "AXV-CHAR-MR-0001";
  const pkgCode = "FULL_100M";
  const external = `${orderCode}-0`;
  const base = "https://mirai.test/api/reseller/v1";
  const credential = "mirai-credential-CHARACTERIZATION";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "Mirai Fixture",
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
      order_code: "MI-ORDER-1",
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
    providerField: "provider_order_code",
    providerId: "MI-ORDER-1",
    providerViolation: "provider_order_code='KNOWN'",
    credential,
    state,
    setup() {
      vi.stubEnv("MIRAI_ENABLED", "true");
      vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
      vi.stubEnv("MIRAI_API_KEY", "fixture-key");
      vi.stubEnv("MIRAI_BASE_URL", base);
      f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,mirai_family)
          VALUES(1,'Mirai Fixture','mirai-fixture',25000,-1,1,'manual','manual','full');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt)
          VALUES(1,1,'MR-${pkgCode}','100M Token',25000,-1,'manual',1,'${pkgCode}',2.923077,16000);
        INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,min_quantity,max_quantity,unlimited,remaining_today,axvara_product_id,fx_idr_per_usdt)
          VALUES('${pkgCode}','full','Full GPT + Claude 100M',100000000,259200,76000,2.923077,1,10000,1,0,1,16000);`);
    },
    item: itemSnapshot,
    seedOrder(code = orderCode) {
      return insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] });
    },
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
                  retail_price_vnd: 80000,
                  discount_bps: 500,
                  min_quantity: 1,
                  max_quantity: 10000,
                  preset_quantities: [1],
                  models: ["gpt"],
                  unlimited: true,
                  remaining_today: 0,
                  custom_quantity: true,
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
          if (init?.method === "GET" && path.endsWith(`/orders/${external}`)) {
            if (state.mode === "retryable") return new Response("", { status: 404 });
            return json(purchaseBody());
          }
          throw new Error(`unexpected Mirai request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM mirai_order_links LIMIT 1").get() as Row | undefined) ?? null,
    itemRow: () => (f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row | undefined) ?? null,
  };
}

function makeTunvn(f: Fixture): Adapter {
  const orderCode = "AXV-CHAR-TV-0001";
  const base = "https://tunvn.test";
  const credential = "tunvn-credential-CHARACTERIZATION";
  const state: Adapter["state"] = { mode: "ok" };
  let purchaseCount = 0;
  const itemSnapshot = (): Row => ({
    product_id: 1,
    variant_id: 1,
    name: "TUNVN Fixture",
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
    providerField: "provider_order_group",
    providerId: "ORD-CHAR-1",
    providerViolation: "provider_order_group='KNOWN'",
    credential,
    state,
    setup() {
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "fixture-key");
      vi.stubEnv("TUNVN_BASE_URL", base);
      f.sql.exec(`INSERT INTO products(id,name,slug,price,source) VALUES(1,'TUNVN Fixture','tunvn-fixture',10000,'manual');
        INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,is_active,tunvn_source_product_id)
          VALUES(1,1,'TUNVN-86','Account',10000,'manual',1,86);`);
    },
    item: itemSnapshot,
    seedOrder(code = orderCode) {
      return insertTestOrder(f.sql, code, { status: "lunas", channel: "web", items: [itemSnapshot()] });
    },
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
              order: { order_group: "ORD-CHAR-1", quantity: 1, total_items: 1, total_price: 2, currency: "USDT" },
              items: [credential],
            });
          }
          throw new Error(`unexpected TUNVN request: ${init?.method ?? "GET"} ${path}`);
        }),
      );
    },
    purchases: () => purchaseCount,
    row: () => (f.sql.prepare("SELECT * FROM tunvn_order_links LIMIT 1").get() as Row | undefined) ?? null,
    itemRow: () => (f.sql.prepare("SELECT * FROM fulfillment_items LIMIT 1").get() as Row | undefined) ?? null,
  };
}

const FACTORIES: Record<string, (f: Fixture) => Adapter> = {
  AIVault: makeAivault,
  Storebat: makeStorebat,
  Mirai: makeMirai,
  TUNVN: makeTunvn,
};

const RETRY_VIOLATIONS: { label: string; apply: (f: Fixture, a: Adapter) => void }[] = [
  { label: "status is not needs_admin", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET status='pending'`) },
  { label: "attempt_count is not zero", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET attempt_count=1`) },
  { label: "request_sent_at is set", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET request_sent_at=datetime('now')`) },
  { label: "a provider id is already stored", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET ${a.providerViolation}`) },
  { label: "a receipt is already stored", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET receipt_ciphertext='sealed', receipt_iv='iv'`) },
  { label: "completed_at is set", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET completed_at=datetime('now')`) },
  { label: "an unexpired lease is held elsewhere", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET lease_owner='other-owner', lease_expires_at=datetime('now','+10 minutes')`) },
  { label: "last_error is not retryable", apply: (f, a) => f.sql.exec(`UPDATE ${a.linkTable} SET last_error='source_changed'`) },
  { label: "the order is no longer paid", apply: (f) => f.sql.exec("UPDATE orders SET payment_status='pending'") },
  { label: "the fulfillment item is already delivered", apply: (f) => f.sql.exec("UPDATE fulfillment_items SET status='delivered'") },
];

describe.each(Object.keys(FACTORIES))("%s claim / lease / settle contract", (name) => {
  let f: Fixture;
  let adapter: Adapter;
  const db = () => createDatabaseAccess(f.db);
  const row = () => adapter.row()!;

  const reachRetryableNeedsAdmin = async () => {
    adapter.state.mode = "preflight";
    expect(await adapter.process(db())).toBeGreaterThan(0);
    const link = row();
    expect(link.status).toBe("needs_admin");
    expect(Number(link.attempt_count)).toBe(0);
    expect(link.request_sent_at).toBeNull();
    expect(adapter.purchases()).toBe(0);
    adapter.state.mode = "ok";
    return Number(link.id);
  };

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

  it("creates links only for a paid order and is idempotent on a second call", async () => {
    const unpaid = "AXV-CHAR-UNPAID";
    insertTestOrder(f.sql, unpaid, { status: "pending", channel: "web", items: [adapter.item()] });
    expect(await adapter.createLinks(unpaid, db())).toBe(0);

    const unknown = "AXV-CHAR-UNKNOWN";
    insertTestOrder(f.sql, unknown, { status: "lunas", channel: "web", items: [adapter.item()] });
    f.sql.prepare("UPDATE orders SET payment_status='pending' WHERE code=?").run(unknown);
    expect(await adapter.createLinks(unknown, db())).toBe(0);

    const count = () => Number((f.sql.prepare(`SELECT COUNT(*) n FROM ${adapter.linkTable}`).get() as { n: number }).n);
    expect(count()).toBe(0);

    adapter.seedOrder();
    expect(await adapter.createLinks(adapter.orderCode, db())).toBe(1);
    expect(await adapter.createLinks(adapter.orderCode, db())).toBe(0);
    expect(count()).toBe(1);
  });

  it("claims one due link once under two concurrent process calls", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    const results = await Promise.all([adapter.process(db()), adapter.process(db())]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(row().status).toBe("completed");
    expect(row().lease_owner).toBeNull();
  });

  it("does not claim a link whose next_attempt_at is in the future", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.exec(`UPDATE ${adapter.linkTable} SET next_attempt_at=datetime('now','+10 minutes')`);
    const before = JSON.stringify(row());
    expect(await adapter.process(db())).toBe(0);
    expect(adapter.purchases()).toBe(0);
    expect(JSON.stringify(row())).toBe(before);
  });

  it("does not claim a link under an unexpired lease held by another owner", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.exec(
      `UPDATE ${adapter.linkTable} SET status='claimed', lease_owner='other-owner', lease_expires_at=datetime('now','+10 minutes'), next_attempt_at=datetime('now','-1 second')`,
    );
    const before = JSON.stringify(row());
    expect(await adapter.process(db())).toBe(0);
    expect(adapter.purchases()).toBe(0);
    expect(JSON.stringify(row())).toBe(before);
  });

  it("reclaims a link whose lease has expired", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.exec(
      `UPDATE ${adapter.linkTable} SET status='claimed', lease_owner='dead-owner', lease_expires_at=datetime('now','-1 minute'), next_attempt_at=datetime('now','-1 minute')`,
    );
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(row().status).toBe("completed");
    expect(row().lease_owner).toBeNull();
  });

  it("does not settle or deliver for an owner whose lease was taken over mid-flight", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    adapter.state.onPurchase = () => f.sql.exec(`UPDATE ${adapter.linkTable} SET lease_owner='intruder-owner'`);
    expect(await adapter.process(db())).toBe(1);
    expect(adapter.purchases()).toBe(1);
    expect(row().lease_owner).toBe("intruder-owner");
    expect(row().status).not.toBe("completed");
    expect(adapter.itemRow()?.delivered_ciphertext).toBeNull();
  });

  it("backs off and clears the lease after a retryable supplier failure", async () => {
    adapter.state.mode = "retryable";
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    expect(await adapter.process(db())).toBe(1);
    const link = row();
    expect(adapter.purchases()).toBe(1);
    expect(Number(link.attempt_count)).toBe(1);
    expect(link.request_sent_at).toBeTruthy();
    expect(link.lease_owner).toBeNull();
    expect(link.lease_expires_at).toBeNull();
    expect(future(link.next_attempt_at)).toBe(true);
    expect(link.last_error).toBeTruthy();
  });

  it("moves an attempts-exhausted link to needs_admin with the lease cleared", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.exec(
      `UPDATE ${adapter.linkTable} SET attempt_count=3, request_sent_at=NULL, lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=datetime('now','-1 second')`,
    );
    expect(await adapter.process(db())).toBe(1);
    const link = row();
    expect(adapter.purchases()).toBe(0);
    expect(link.status).toBe("needs_admin");
    expect(Number(link.attempt_count)).toBe(3);
    expect(link.lease_owner).toBeNull();
    expect(link.lease_expires_at).toBeNull();
  });

  it("completes a link, clears the lease, seals credentials and requeues fulfillment", async () => {
    adapter.seedOrder();
    await adapter.createLinks(adapter.orderCode, db());
    f.sql.prepare("INSERT INTO fulfillment_jobs(order_code,status) VALUES(?, 'delivered')").run(adapter.orderCode);

    expect(await adapter.process(db())).toBe(1);
    const link = row();
    const item = adapter.itemRow()!;
    const job = f.sql.prepare("SELECT * FROM fulfillment_jobs WHERE order_code=?").get(adapter.orderCode) as Row;

    expect(adapter.purchases()).toBe(1);
    expect(link.status).toBe("completed");
    expect(link.lease_owner).toBeNull();
    expect(link.lease_expires_at).toBeNull();
    expect(link[adapter.providerField]).toEqual(adapter.providerId);
    expect(link.receipt_ciphertext).toBeTruthy();
    expect(link.receipt_iv).toBeTruthy();
    expect(item.status).toBe("queued");
    expect(item.delivered_ciphertext).toBeTruthy();
    expect(item.delivered_iv).toBeTruthy();
    expect(await decryptSecret(String(item.delivered_ciphertext), String(item.delivered_iv))).toBe(adapter.credential);
    expect(job.status).toBe("queued");
    expect(Number(job.attempt_count)).toBe(0);
    expect(JSON.stringify(link)).not.toContain(adapter.credential);
    expect(JSON.stringify(item)).not.toContain(adapter.credential);
  });

  it("re-arms and completes a pre-send retryable needs_admin link", async () => {
    adapter.seedOrder();
    const id = await reachRetryableNeedsAdmin();
    expect(await adapter.retry(db(), id)).toBe(true);
    expect(adapter.purchases()).toBe(1);
    expect(row().status).toBe("completed");
    expect(row().lease_owner).toBeNull();
  });

  it.each(RETRY_VIOLATIONS)("retry refuses and leaves the row unchanged when $label", async ({ apply }) => {
    adapter.seedOrder();
    const id = await reachRetryableNeedsAdmin();
    apply(f, adapter);
    const before = JSON.stringify(row());
    expect(await adapter.retry(db(), id)).toBe(false);
    expect(JSON.stringify(row())).toBe(before);
    expect(adapter.purchases()).toBe(0);
  });
});
