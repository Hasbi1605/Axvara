import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { checkMiraiLowBalance, MIRAI_BALANCE_ALERT_USDT } from "@/lib/mirai/balance";
import { processMiraiOrders, retryMiraiOrder } from "@/lib/mirai/orders";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "./helpers/d1-fixture";

let f: ReturnType<typeof createD1Fixture>;
let postStatus: number;
let postBody: Record<string, unknown>;
let getOrderStatus: number;
let getOrderBody: Record<string, unknown>;
let balanceVnd: number;
let unlimited: boolean;
let remainingToday: number;
let timeoutPost: boolean;
let postHeaders: Record<string, string>;

const pkgCode = "FULL_100M";
const orderCode = "AXV-20261118-MRTEST01";
const item = (qty = 1) => ({
  product_id: 1,
  variant_id: 1,
  name: "API GPT + Claude Token",
  price: 25000,
  qty,
  mirai_eligibility: {
    version: 1,
    package_code: pkgCode,
    mirai_family: "full",
    sku: `MR-${pkgCode}`,
    source_variant_id: 1,
    quantity: qty,
    cost_usdt: Math.round((76000 / 26000) * qty * 1_000_000) / 1_000_000,
  },
});

const link = () => f.sql.prepare("SELECT * FROM mirai_order_links").get()!;
const due = () => f.sql.exec("UPDATE mirai_order_links SET next_attempt_at=datetime('now','-1 minute'), lease_expires_at=NULL");
const tick = async () => {
  const b = createBudgetedDatabase(40, 2, f.db);
  await processMiraiOrders(b.access);
  expect(b.used).toBeLessThanOrEqual(38);
};
const buys = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
const orderGets = () =>
  vi.mocked(fetch).mock.calls.filter(([url, init]) => init?.method === "GET" && new URL(String(url)).pathname.includes("/orders/"));

beforeEach(() => {
  f = createD1Fixture();
  vi.stubEnv("MIRAI_ENABLED", "true");
  vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
  vi.stubEnv("MIRAI_API_KEY", "mr-fixture-key");
  vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");
  stubFulfillmentKey();

  f.sql.exec(
    `INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,mirai_family)
     VALUES(1,'API GPT + Claude Token','api-gpt-claude-token-mr',25000,-1,1,'manual','manual','full');
     INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt)
     VALUES(1,1,'MR-${pkgCode}','100M Token · 3 Hari',25000,-1,'manual',1,'${pkgCode}',2.923077,16000);
     INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,min_quantity,max_quantity,unlimited,remaining_today,axvara_product_id,fx_idr_per_usdt)
     VALUES('${pkgCode}','full','Full GPT + Claude 100M tokens · 3D',100000000,259200,76000,2.923077,1,10000,1,0,1,16000);`,
  );

  postStatus = 200;
  postHeaders = {};
  getOrderStatus = 404;
  balanceVnd = 1_000_000;
  unlimited = true;
  remainingToday = 0;
  timeoutPost = false;

  postBody = {
    success: true,
    data: {
      order_code: "MO-TEST-1",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 1,
      unit_price_vnd: 76000,
      amount_vnd: 76000,
      redeem_code: "MR-FIXTURE-CODE-1",
      redeem_codes: ["MR-FIXTURE-CODE-1"],
      status: "fulfilled",
    },
  };
  getOrderBody = {
    success: true,
    data: {
      order_code: "MO-TEST-1",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 1,
      unit_price_vnd: 76000,
      amount_vnd: 76000,
      redeem_code: "MR-FIXTURE-CODE-1",
      redeem_codes: ["MR-FIXTURE-CODE-1"],
      status: "fulfilled",
    },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/packages")) {
        return Response.json({
          success: true,
          data: [
            {
              code: pkgCode,
              group: "full",
              name: "Full GPT + Claude 100M tokens · 3D",
              quota_tokens: 100000000,
              duration_seconds: 259200,
              reseller_price_vnd: 76000,
              retail_price_vnd: 80000,
              discount_bps: 500,
              min_quantity: 1,
              max_quantity: 10000,
              preset_quantities: [1, 2, 3],
              models: ["claude-opus-5"],
              unlimited,
              remaining_today: remainingToday,
              custom_quantity: true,
            },
          ],
        });
      }
      if (path.endsWith("/balance")) {
        return Response.json({ success: true, data: { balance_vnd: balanceVnd, tier: "Silver", discount_bps: 500 } });
      }
      if (init?.method === "POST" && path.endsWith("/orders")) {
        expect(link().request_sent_at).toBeTruthy();
        if (timeoutPost) throw new Error("fixture timeout");
        return Response.json(postBody, { status: postStatus, headers: postHeaders });
      }
      if (init?.method === "GET" && path.endsWith(`/orders/${orderCode}-0`)) {
        return Response.json(getOrderBody, { status: getOrderStatus });
      }
      throw new Error(`Unexpected fixture request: ${init?.method} ${path}`);
    }),
  );
});

afterEach(() => {
  f.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("buys N codes once under concurrent ticks, seals full receipt, and joins codes with newline", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(3)] });
  postBody = {
    success: true,
    data: {
      order_code: "MO-MULTI-3",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 3,
      unit_price_vnd: 76000,
      amount_vnd: 228000,
      redeem_code: "MR-FIXTURE-A",
      redeem_codes: ["MR-FIXTURE-A", "MR-FIXTURE-B", "MR-FIXTURE-C"],
      status: "fulfilled",
    },
  };

  await Promise.all([tick(), tick(), tick()]);
  expect(buys()).toHaveLength(1);
  const [, init] = buys()[0];
  expect(init?.headers).toMatchObject({ "idempotency-key": `${orderCode}-0` });
  expect(JSON.parse(String(init?.body))).toEqual({
    external_order_id: `${orderCode}-0`,
    package_code: pkgCode,
    quantity: 3,
  });

  expect(link()).toMatchObject({
    status: "completed",
    attempt_count: 1,
    provider_order_code: "MO-MULTI-3",
    external_order_id: `${orderCode}-0`,
    idempotency_key: `${orderCode}-0`,
    fx_idr_per_usdt: 16000,
  });
  expect(JSON.stringify(link())).not.toContain("MR-FIXTURE-A");
  expect(await decryptSecret(String(link().receipt_ciphertext), String(link().receipt_iv))).toContain("MR-FIXTURE-C");

  const fi = f.sql.prepare("SELECT * FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(fi.delivered_ciphertext), String(fi.delivered_iv))).toBe(
    "MR-FIXTURE-A\nMR-FIXTURE-B\nMR-FIXTURE-C",
  );

  await tick();
  expect(buys()).toHaveLength(1);
});

it("supports legacy singular redeem_code fallback only when quantity===1 and redeem_codes absent", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  postBody = {
    success: true,
    data: {
      order_code: "MO-LEGACY-1",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 1,
      redeem_code: "MR-SINGLE-ONLY",
      status: "fulfilled",
    },
  };
  await tick();
  expect(link()).toMatchObject({ status: "completed" });
  const fi = f.sql.prepare("SELECT * FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(fi.delivered_ciphertext), String(fi.delivered_iv))).toBe("MR-SINGLE-ONLY");
});

it("stops with needs_admin when redeem_codes count mismatches quantity or status is not fulfilled", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(3)] });
  postBody = {
    success: true,
    data: {
      order_code: "MO-MISMATCH",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 3,
      redeem_code: "MR-ONLY-1",
      redeem_codes: ["MR-ONLY-1", "MR-ONLY-2"],
      status: "fulfilled",
    },
  };
  await tick();
  expect(link()).toMatchObject({ status: "needs_admin", last_error: "incomplete_receipt", attempt_count: 1 });
  expect(f.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items").get()?.delivered_ciphertext).toBeNull();
  expect(await retryMiraiOrder(createDatabaseAccess(f.db), Number(link().id))).toBe(false);
});

it.each([
  [409, "Insufficient balance in wallet", "blocked_balance"],
  [409, "idempotency payload mismatch", "idempotency_mismatch"],
  [409, "Unknown package code", "bad_package"],
  [400, "Bad request", "http_400"],
  [401, "Unauthorized", "http_401"],
  [403, "Forbidden", "http_403"],
  [404, "Not found", "http_404"],
])("HTTP %s (%s) stops at needs_admin (%s) with no retry storm", async (status, message, expectedError) => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  postStatus = status;
  postBody = { success: false, message };
  await tick();
  due();
  await tick();
  expect(buys()).toHaveLength(1);
  expect(link()).toMatchObject({ status: "needs_admin", last_error: expectedError, attempt_count: 1 });
  expect(await retryMiraiOrder(createDatabaseAccess(f.db), Number(link().id))).toBe(false);
});

it("recovers via GET /orders/{external_order_id} after POST timeout without sending a second POST", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(2)] });
  timeoutPost = true;
  await tick();
  expect(buys()).toHaveLength(1);
  expect(link()).toMatchObject({ status: "pending", attempt_count: 1, last_error: "retry_same_external_id" });

  // Next tick: GET /orders/{external_order_id} returns 200 fulfilled
  timeoutPost = false;
  getOrderStatus = 200;
  getOrderBody = {
    success: true,
    data: {
      order_code: "MO-RECOVERED",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 2,
      redeem_codes: ["MR-REC-1", "MR-REC-2"],
      status: "fulfilled",
    },
  };
  due();
  await tick();
  expect(orderGets()).toHaveLength(1);
  expect(buys()).toHaveLength(1);
  expect(link()).toMatchObject({ status: "completed", attempt_count: 1, provider_order_code: "MO-RECOVERED" });
  const fi = f.sql.prepare("SELECT * FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(fi.delivered_ciphertext), String(fi.delivered_iv))).toBe("MR-REC-1\nMR-REC-2");
});

it("checks GET 404 then replays POST with the SAME external_order_id and Idempotency-Key", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  timeoutPost = true;
  await tick();
  expect(link()).toMatchObject({ status: "pending", attempt_count: 1 });

  // GET returns 404, balance depleted on next check is skipped for replay, POST replays same key+id
  timeoutPost = false;
  getOrderStatus = 404;
  balanceVnd = 0;
  due();
  await tick();

  expect(orderGets()).toHaveLength(1);
  expect(buys()).toHaveLength(2);
  expect(buys().map(([, i]) => (i?.headers as Record<string, string>)["idempotency-key"])).toEqual([
    `${orderCode}-0`,
    `${orderCode}-0`,
  ]);
  expect(buys().map(([, i]) => JSON.parse(String(i?.body)).external_order_id)).toEqual([
    `${orderCode}-0`,
    `${orderCode}-0`,
  ]);
  expect(link()).toMatchObject({ status: "completed", attempt_count: 2 });
});

it("honors Retry-After on 429 and exhausts at max 3 POST attempts with same ID", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  postStatus = 429;
  postHeaders = { "Retry-After": "300" };
  postBody = { success: false, message: "Too many requests" };

  await tick();
  const afterFirst = link();
  expect(afterFirst).toMatchObject({ status: "pending", attempt_count: 1 });
  // Verify next_attempt_at was pushed >= 290s ahead (honoring 300s Retry-After over 120s 2m backoff)
  const diffSec = f.sql
    .prepare("SELECT (strftime('%s', next_attempt_at) - strftime('%s', 'now')) AS diff FROM mirai_order_links WHERE id=?")
    .get(afterFirst.id) as { diff: number };
  expect(diffSec.diff).toBeGreaterThanOrEqual(290);

  // Exhaust attempts 2 and 3 (GET returns 404 before each replay)
  getOrderStatus = 404;
  for (let i = 0; i < 4; i++) {
    due();
    await tick();
  }
  expect(buys()).toHaveLength(3);
  expect(link()).toMatchObject({
    status: "needs_admin",
    last_error: "attempts_exhausted",
    attempt_count: 3,
    external_order_id: `${orderCode}-0`,
  });
});

it.each(["timeout", "5xx", "invalid_json"])("%s exhausts at 3 total POST attempts", async (fault) => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  getOrderStatus = 404;
  if (fault === "timeout") timeoutPost = true;
  else if (fault === "5xx") postStatus = 502;
  else {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      init?.method === "POST" ? new Response("{broken-json", { status: 200 }) : original(url, init),
    );
  }
  for (let i = 0; i < 5; i++) {
    await tick();
    due();
  }
  expect(buys()).toHaveLength(3);
  expect(link()).toMatchObject({ status: "needs_admin", last_error: "attempts_exhausted", attempt_count: 3 });
});

it("preflight fails safely on insufficient balance and allows admin retry only pre-send", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(2)] });
  balanceVnd = 100_000; // needs 76000 * 2 = 152000 VND
  await tick();
  expect(buys()).toHaveLength(0);
  expect(link()).toMatchObject({
    status: "needs_admin",
    last_error: "insufficient_balance",
    attempt_count: 0,
    request_sent_at: null,
  });

  balanceVnd = 200_000;
  postBody = {
    success: true,
    data: {
      order_code: "MO-RETRY-2",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 2,
      redeem_codes: ["MR-RETRY-1", "MR-RETRY-2"],
      status: "fulfilled",
    },
  };
  expect(await retryMiraiOrder(createDatabaseAccess(f.db), Number(link().id))).toBe(true);
  expect(buys()).toHaveLength(1);
  expect(link()).toMatchObject({ status: "completed", attempt_count: 1, external_order_id: `${orderCode}-0` });
});

it.each(["unpaid", "disabled", "wrong_sku", "legacy", "source", "inactive", "archived"])(
  "never buys %s",
  async (fault) => {
    const row = item(1);
    if (fault === "legacy") delete (row as Partial<typeof row>).mirai_eligibility;
    insertTestOrder(f.sql, orderCode, { status: fault === "unpaid" ? "pending" : "lunas", channel: "web", items: [row] });
    if (fault === "disabled") f.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
    if (fault === "wrong_sku") f.sql.exec("UPDATE product_variants SET sku='WR-SKU'");
    if (fault === "source") f.sql.exec("UPDATE products SET source='warung_rebahan'");
    if (fault === "inactive") f.sql.exec("UPDATE product_variants SET is_active=0");
    if (fault === "archived") f.sql.exec("UPDATE products SET is_active=0, archived_at=datetime('now')");
    await tick();
    expect(buys()).toHaveLength(0);
  },
);

it("checks Mirai balance in USDT (never VND) against MIRAI_BALANCE_ALERT_USDT=5", async () => {
  expect(MIRAI_BALANCE_ALERT_USDT).toBe(5);
  balanceVnd = 104_000; // 104000 / 26000 = 4 USDT < 5 USDT
  const db = createDatabaseAccess(f.db);
  const res = await checkMiraiLowBalance(db, Date.now());
  expect(res).toMatchObject({ checked: true, balance: 4, alerted: false });
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='mirai_balance_last_value'").get()).toEqual({ value: "4" });
});

it("Blocker 3: preflight blocks purchase when live package reseller_price_vnd increases over snapshot cost_usdt", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  const baseFetch = vi.mocked(fetch).getMockImplementation()!;
  let livePriceVnd = 80_000; // snapshot cost_usdt was 76000 / 26000 = 2.923077
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (new URL(String(url)).pathname.endsWith("/packages")) {
      return Response.json({
        success: true,
        data: [{
          code: pkgCode, group: "full", name: "Full 100M", quota_tokens: 100000000, duration_seconds: 259200,
          reseller_price_vnd: livePriceVnd, retail_price_vnd: 120000, min_quantity: 1, max_quantity: 10000,
          unlimited: true, remaining_today: 0, preset_quantities: [1], models: ["gpt-5"], is_active: true,
        }],
      });
    }
    return baseFetch(url, init);
  });

  await tick();
  expect(buys()).toHaveLength(0);
  expect(link()).toMatchObject({
    status: "needs_admin",
    last_error: "price_increased",
    attempt_count: 0,
    request_sent_at: null,
  });

  // Admin retry succeeds after upstream price drops back to snapshot level
  livePriceVnd = 76_000;
  expect(await retryMiraiOrder(createDatabaseAccess(f.db), Number(link().id))).toBe(true);
  expect(buys()).toHaveLength(1);
  expect(link()).toMatchObject({ status: "completed", attempt_count: 1 });
});

it("Should-Fix 1: 3rd POST timeout still runs GET /orders/{external_order_id} recovery before exhausting", async () => {
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1)] });
  getOrderStatus = 404;
  timeoutPost = true;

  // Attempts 1 and 2 time out -> GET returns 404 -> retries
  await tick(); // attempt 1 fails
  due(); await tick(); // GET 404 -> attempt 2 fails

  // Attempt 3 times out on POST, even though Mirai actually processed it!
  due(); await tick();
  expect(buys()).toHaveLength(3);
  expect(link()).toMatchObject({ status: "processing", attempt_count: 3, last_error: "lookup_required" });

  // Next tick runs GET recovery and settles completed without a 4th POST
  timeoutPost = false;
  getOrderStatus = 200;
  getOrderBody = {
    success: true,
    data: {
      order_code: "MO-3RD-RECOVERED",
      external_order_id: `${orderCode}-0`,
      package_code: pkgCode,
      quantity: 1,
      redeem_codes: ["MR-3RD-REC"],
      status: "fulfilled",
    },
  };
  due(); await tick();
  expect(buys()).toHaveLength(3);
  expect(orderGets()).toHaveLength(3);
  expect(link()).toMatchObject({ status: "completed", attempt_count: 3, provider_order_code: "MO-3RD-RECOVERED" });
  const fi = f.sql.prepare("SELECT delivered_ciphertext,delivered_iv FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(fi.delivered_ciphertext), String(fi.delivered_iv))).toBe("MR-3RD-REC");
});

it("Should-Fix 2/5 & NIT-1: batch creates multi-line Mirai links, dirty trigger uses hex version, and excludes storebat ownership", async () => {
  // Multi-line batch creation
  const { createMiraiOrderLinks } = await import("@/lib/mirai/orders");
  insertTestOrder(f.sql, orderCode, { status: "lunas", channel: "web", items: [item(1), item(2)] });
  expect(await createMiraiOrderLinks(orderCode, createDatabaseAccess(f.db))).toBe(2);

  // pg_dirty_mirai_variant_update trigger emits 32-char hex token
  f.sql.exec("INSERT INTO product_groups(id,name) VALUES(1,'G'); INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0);");
  f.sql.exec("UPDATE product_variants SET mirai_cost_usdt=3.1 WHERE id=1");
  const dirty = f.sql.prepare("SELECT version,pending FROM product_group_dirty WHERE group_id=1").get() as { version: string; pending: number };
  expect(dirty.pending).toBe(1);
  expect(dirty.version).toMatch(/^[0-9a-f]{32}$/);

  // Cross-supplier guard refuses variants carrying storebat_product_id
  f.sql.exec("UPDATE product_variants SET storebat_product_id=121 WHERE id=1");
  await tick();
  expect(buys()).toHaveLength(0);
  expect(f.sql.prepare("SELECT status,last_error FROM mirai_order_links WHERE item_index=0").get()).toMatchObject({
    status: "needs_admin",
    last_error: "source_changed",
  });
});
