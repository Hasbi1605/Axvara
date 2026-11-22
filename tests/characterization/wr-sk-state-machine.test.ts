import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { computeSkSignature } from "@/lib/sekalipay/client";
import { handleSkOrderPaid, processSkPendingOrders, reconcileBlockedSkBalance, reconcileSkInvoiceNow, recoverStaleSkClaims, retryFailedSkOrders } from "@/lib/sekalipay/order";
import { processWrPendingOrders, reconcileBlockedBalance, reconcileStuckWrOrders, recoverStaleClaims, retryFailedWrOrders } from "@/lib/warung-rebahan/order";
import { POST as retryWr } from "@/app/api/admin/warung/orders/[id]/retry/route";
import { POST as skWebhook } from "@/app/api/webhook/sekalipay/route";
import { seedWrCatalog, seedWrFulfillmentItem, seedWrOrder, setupWrFixture } from "../warung-rebahan/helpers";

vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ email: "admin@fixture.test" }) }));

const policy = {
  WR: { table: "wr_order_links", invoice: "wr_order_id", purchase: "/api/v1/order", process: processWrPendingOrders, recover: recoverStaleClaims, normalize: retryFailedWrOrders, revive: reconcileBlockedBalance },
  SK: { table: "sk_order_links", invoice: "sk_invoice", purchase: "/api/v1/trx", process: processSkPendingOrders, recover: recoverStaleSkClaims, normalize: retryFailedSkOrders, revive: reconcileBlockedSkBalance },
} as const;
type Supplier = keyof typeof policy;
type Fixture = Awaited<ReturnType<typeof setupWrFixture>>;

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearRateLimitBucketsForTest();
});

function due() {
  return { skipOrphanProbe: true, limit: 1 };
}

async function setup(supplier: Supplier) {
  const fx = fixture = await setupWrFixture();
  const p = policy[supplier];
  const code = `AXV-${supplier}-STATE-FIXTURE`;
  seedWrCatalog(fx);
  seedWrOrder(fx, code);
  seedWrFulfillmentItem(fx, code);
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("RESEND_API_KEY", "");
  const ref = `sk:${code}:1095:1`;
  if (supplier === "WR") {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "fixture");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "");
    vi.stubEnv("WARUNG_REBAHAN_BASE_URL", "");
    fx.sql.prepare(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,quantity,wr_cost,status)
      VALUES(1,?,'var-1',1,5000,'pending')`).run(code);
  } else {
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_API_KEY", "fixture");
    vi.stubEnv("SEKALIPAY_PROXY_URL", "");
    vi.stubEnv("SEKALIPAY_BASE_URL", "");
    vi.stubEnv("SEKALIPAY_SANDBOX", "false");
    fx.sql.exec("UPDATE product_variants SET wr_variant_id=NULL,sk_variant_id='1095'");
    fx.sql.prepare(`INSERT INTO sk_order_links(id,order_code,sk_variant_id,quantity,sk_cost,idempotency_key,status)
      VALUES(1,?,'1095',1,5000,?,'pending')`).run(code, ref);
  }
  const row = () => fx.sql.prepare(`SELECT * FROM ${p.table} WHERE id=1`).get()!;
  const set = (fields: string) => fx.sql.exec(`UPDATE ${p.table} SET ${fields} WHERE id=1`);
  return { fx, p, code, ref, row, set, db: createDatabaseAccess(fx.db) };
}

function supplierFetch(supplier: Supplier, purchase?: () => Response | Promise<Response>, lookup?: (path: string) => Response, pathOverride?: string) {
  const calls: string[] = [];
  const purchaseKey = `POST ${pathOverride ?? policy[supplier].purchase}`;
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const { hostname, pathname: path } = new URL(String(url));
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push(key);
    if (key === purchaseKey && purchase) return purchase();
    if (hostname === "api.resend.com" && key === "POST /emails") return Response.json({ id: "fixture-mail" });
    if (supplier === "WR" && key === "POST /api/v1/balance") return Response.json({ success: true, data: { balance: 100000 } });
    if (supplier === "SK" && key === "GET /api/v1/item/1095") {
      return Response.json({ data: { id: 1095, price: 5000, stock: 10, order_process: "auto" } });
    }
    if (supplier === "SK" && key === "GET /api/v1/balance") return Response.json({ data: { balance: 100000 } });
    if (supplier === "SK" && key.startsWith("GET /api/v1/trx/")) {
      return lookup ? lookup(path) : Response.json({ message: "not_found" }, { status: 404 });
    }
    throw new Error(`Unexpected fixture request: ${key}`);
  }));
  return { calls, buys: () => calls.filter(call => call === purchaseKey).length };
}

function acceptedReceipt(supplier: Supplier) {
  return supplier === "WR"
    ? Response.json({ success: true, data: { order_id: "WR-FIXTURE", status: "processing", current_balance: 95000 } })
    : Response.json({ data: { invoice: "SK-FIXTURE", status: "paid" } });
}

function changeAfterSelection(db: DatabaseAccess, change: () => void) {
  const query = db.queryAll;
  db.queryAll = async (...args) => {
    const rows = await query(...args);
    db.queryAll = query;
    change();
    return rows;
  };
}

describe.each(["WR", "SK"] as const)("%s purchase queue", supplier => {
  it("two runners sharing a due snapshot make exactly one purchase", async () => {
    const { fx, p, row } = await setup(supplier);
    const before = row();
    let observed = 0;
    let release = () => {};
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const runner = () => {
      const db = createDatabaseAccess(fx.db);
      const query = db.queryAll;
      db.queryAll = async (...args) => {
        const rows = await query(...args);
        db.queryAll = query;
        expect(rows).toEqual([supplier === "WR" ? { ...before, h4_unbound: 1 } : before]);
        if (++observed === 2) release();
        await bothRead;
        return rows;
      };
      return p.process(db, due());
    };
    const http = supplierFetch(supplier, () => {
      expect(row()).toMatchObject({ status: "claimed", request_sent_at: expect.any(String), attempt_count: 1,
        lease_owner: expect.any(String), lease_expires_at: expect.any(String) });
      return acceptedReceipt(supplier);
    });
    const results = await Promise.all([runner(), runner()]);
    expect(results.map(r => r.processed)).toEqual([1, 1]);
    expect(results.map(r => r.succeeded).sort()).toEqual([0, 1]);
    expect(http.buys()).toBe(1);
    expect(row()).toMatchObject({ status: "processing", attempt_count: 1, request_sent_at: expect.any(String),
      lease_owner: null, lease_expires_at: null, [p.invoice]: `${supplier}-FIXTURE` });
  });

  it("does not select or normalize a future retry", async () => {
    const { p, db, row, set } = await setup(supplier);
    set("status='retry', attempt_count=1, next_attempt_at=datetime('now','+1 hour')");
    const before = row();
    const http = supplierFetch(supplier);
    expect(await p.normalize(db)).toBe(0);
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    expect(row()).toEqual(before);
    expect(http.calls).toEqual([]);
    set("next_attempt_at=datetime('now','-1 hour')");
    expect(await p.normalize(db)).toBe(1);
    expect(row()).toMatchObject({ status: "retry", attempt_count: 1, lease_owner: null, request_sent_at: null });
    expect(parseExpiry(String(row().next_attempt_at))).toBeGreaterThan(Date.now() - 30_000);
    expect(http.calls).toEqual([]);
  });

  it("loses a stale snapshot to a live foreign lease and leaves that row untouched", async () => {
    const { p, db, row, set } = await setup(supplier);
    const http = supplierFetch(supplier);
    let foreign: ReturnType<typeof row> | undefined;
    changeAfterSelection(db, () => {
      set("status='claimed', attempt_count=1, lease_owner='peer', lease_expires_at=datetime('now','+1 hour')");
      foreign = row();
    });
    expect(await p.process(db, due())).toMatchObject({ processed: 1, retried: 1 });
    expect(await p.recover(db)).toBe(0);
    expect(row()).toEqual(foreign);
    expect(http.calls).toEqual([]);
  });

  it("distinguishes a generic out-of-stock purchase response from a safe SK retry", async () => {
    const { p, db, row } = await setup(supplier);
    const http = supplierFetch(supplier, () => Response.json({ success: false, message: "OUT_OF_STOCK" }, { status: 409 }));
    expect(await p.process(db, due())).toMatchObject({ retried: 1 });
    expect(http.buys()).toBe(1);
    expect(row()).toMatchObject({ status: supplier === "WR" ? "retry" : "submitted", attempt_count: 1,
      [p.invoice]: null, lease_owner: null, lease_expires_at: null,
      request_sent_at: supplier === "WR" ? null : expect.any(String) });
    expect(parseExpiry(String(row().next_attempt_at))).toBeGreaterThan(Date.now());
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    expect(http.buys()).toBe(1);
  });

  it("uses supplier-specific due policy for balance revival", async () => {
    const { p, db, row, set } = await setup(supplier);
    set(`status='blocked_balance', last_error='${supplier === "WR" ? "saldo_wr_habis" : "preflight_insufficient_balance"}',
      next_attempt_at=datetime('now','+1 hour')`);
    const before = row();
    const http = supplierFetch(supplier);
    if (supplier === "WR") {
      expect(await p.revive(db)).toBe(1);
      expect(row()).toMatchObject({ status: "pending", attempt_count: 0, last_error: null });
      expect(http.calls).toEqual(["POST /api/v1/balance"]);
    } else {
      expect(await p.revive(db)).toBe(0);
      expect(row()).toEqual(before);
      expect(http.calls).toEqual([]);
    }
    expect(http.buys()).toBe(0);
  });
});

describe("WR Premium purchase and admin retry", () => {
  it("exhausts a last definitive WR stock rejection without another automatic purchase", async () => {
    const { p, db, fx, row, set } = await setup("WR");
    set("attempt_count=max_attempts-1, fulfillment_item_id=1");
    const http = supplierFetch("WR", () => Response.json({ success: false, message: "OUT_OF_STOCK" }, { status: 409 }));
    expect(await p.process(db, due())).toMatchObject({ failed: 1 });
    expect(row()).toMatchObject({ status: "failed", attempt_count: 3, request_sent_at: null, wr_order_id: null,
      lease_owner: null, lease_expires_at: null });
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("failed");
    expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("failed");
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    expect(http.buys()).toBe(1);
  });

  it("keeps a lost purchase receipt fenced until an admin selects an exact invoice", async () => {
    const { p, db, row, set } = await setup("WR");
    const http = supplierFetch("WR", () => { throw new DOMException("fixture timeout", "AbortError"); });
    expect(await p.process(db, due())).toMatchObject({ retried: 1 });
    expect(row()).toMatchObject({ status: "submitted", request_sent_at: expect.any(String), attempt_count: 1,
      wr_order_id: null, lease_owner: null, lease_expires_at: null });
    set("request_sent_at=datetime('now','-20 minutes'), next_attempt_at=datetime('now','-10 minutes')");
    const before = row();
    expect(await reconcileStuckWrOrders(db, { minAgeMinutes: 2 })).toBe(0);
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/sync-now/route");
    const response = await POST(new NextRequest("https://fixture.test/api/admin/warung/orders/1/sync-now", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "invoice_required" });
    expect(row()).toEqual(before);
    expect(http.calls).toEqual(["POST /api/v1/order"]);
  });

  it("re-arms exhausted failed pre-send work on the same row with a fresh budget", async () => {
    const { row, set } = await setup("WR");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
    set("status='failed', attempt_count=max_attempts, next_attempt_at=datetime('now','+1 hour'), last_error='fixture_rejected'");
    const http = supplierFetch("WR");
    const response = await callWrRetry();
    expect(response.status).toBe(200);
    expect(row()).toMatchObject({ id: 1, status: "retry", attempt_count: 0, last_error: null,
      lease_owner: null, lease_expires_at: null, request_sent_at: null, wr_order_id: null });
    expect(parseExpiry(String(row().next_attempt_at))).toBeLessThanOrEqual(Date.now());
    expect(http.calls).toEqual([]);
  });

  it.each(["retry", "failed"])("rejects %s admin retry with either sent evidence or an invoice, unchanged", async status => {
    const { row, set } = await setup("WR");
    const http = supplierFetch("WR");
    set(`status='${status}', attempt_count=1, request_sent_at=datetime('now')`);
    let before = row();
    let response = await callWrRetry();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(status === "failed" ? "not_retryable" : "retry_race_lost");
    expect(row()).toEqual(before);
    set("request_sent_at=NULL, wr_order_id='WR-KNOWN'");
    before = row();
    response = await callWrRetry();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(status === "failed" ? "not_retryable" : "retry_race_lost");
    expect(row()).toEqual(before);
    expect(http.calls).toEqual([]);
  });

  it.each([
    ["not lunas", "status='pending'"],
    ["not paid", "payment_status='pending'"],
    ["purchase disabled", "supplier_purchase_disabled=1"],
  ])("rejects admin retry when order is %s", async (_label, gate) => {
    const { fx, row, set } = await setup("WR");
    set("status='failed', attempt_count=max_attempts, last_error='definitive_rejection'");
    fx.sql.exec(`UPDATE orders SET ${gate}`);
    const before = row();
    const http = supplierFetch("WR");
    const response = await callWrRetry();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_retryable", status: "failed" });
    expect(row()).toEqual(before);
    expect(http.calls).toEqual([]);
  });

  it.each(["failed", "retry"])("rejects a disable racing the %s admin retry CAS", async status => {
    const { fx, row, set } = await setup("WR");
    set(`status='${status}', attempt_count=2, last_error='definitive_rejection'`);
    const before = row();
    const http = supplierFetch("WR");
    let disabled = false;
    fx.control.beforeRun = async sql => {
      if (!sql.startsWith("UPDATE wr_order_links SET status='retry'")) return;
      fx.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
      disabled = true;
    };
    const response = await callWrRetry();
    expect(disabled).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "retry_race_lost", status });
    expect(row()).toEqual(before);
    expect(http.calls).toEqual([]);
  });

  it("requeues only expired unsent claims without invoices", async () => {
    const { fx, db, code, row, set } = await setup("WR");
    set("status='claimed', wr_order_id='WR-KNOWN', lease_owner='old', lease_expires_at=datetime('now','-1 minute')");
    fx.sql.prepare(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost,status,lease_owner,lease_expires_at)
      VALUES(2,?,'var-1',5000,'claimed','old',datetime('now','-1 minute'))`).run(code);
    const before = row();
    expect(await recoverStaleClaims(db)).toBe(1);
    expect(row()).toEqual(before);
    expect(fx.sql.prepare("SELECT status, lease_owner, lease_expires_at FROM wr_order_links WHERE id=2").get())
      .toEqual({ status: "pending", lease_owner: null, lease_expires_at: null });
  });
});

describe.each(["premium", "jaspay"] as const)("WR %s transport and receipt", family => {
  const endpoint = family === "jaspay" ? "/api/v1/jaspay/order" : "/api/v1/order";
  async function setupFamily() {
    const fixture = await setup("WR");
    if (family === "jaspay") {
      fixture.fx.sql.exec(`UPDATE wr_variants SET wr_variant_id='jaspay:PROD:PACK', wr_max_quantity=5;
        UPDATE product_variants SET wr_variant_id='jaspay:PROD:PACK';
        UPDATE wr_order_links SET wr_variant_id='jaspay:PROD:PACK'`);
    }
    return fixture;
  }
  const receipt = () => family === "jaspay"
    ? Response.json({ success: true, data: { invoice: "WR-FIXTURE", product: "PROD", status: "processing", quantity: 1 } })
    : acceptedReceipt("WR");

  it.each(["boom", "Failed to fetch", "socket hang up", "connection reset", "Network connection lost."])(
    "keeps the sent fence on %s and makes no second purchase across three dispatch ticks", async message => {
      const { db, row, set } = await setupFamily();
      const sent: unknown[] = [];
      const http = supplierFetch("WR", () => {
        sent.push(row().request_sent_at);
        if (sent.length === 1) throw new Error(message);
        return receipt();
      }, undefined, endpoint);
      expect(await processWrPendingOrders(db, due())).toMatchObject({ processed: 1, retried: 1 });
      expect(sent).toEqual([expect.any(String)]);
      for (let tick = 0; tick < 3; tick++) {
        expect(row()).toMatchObject({ status: "submitted", request_sent_at: sent[0], wr_order_id: null, attempt_count: 1 });
        if (tick === 2) break;
        set("next_attempt_at=datetime('now','-1 minute')");
        expect(await processWrPendingOrders(db, due())).toMatchObject({ processed: 0 });
      }
      expect(http.calls).toEqual([`POST ${endpoint}`]);
    },
  );

  it.each([
    ["bad host", { WARUNG_REBAHAN_BASE_URL: "https://disallowed.fixture.test/api/v1" }, "wr_host_not_allowed"],
    ["missing key", { WARUNG_REBAHAN_API_KEY: "" }, "WARUNG_REBAHAN_API_KEY not configured"],
    ["missing proxy token", { WARUNG_REBAHAN_PROXY_URL: "https://proxy.fixture.test", WARUNG_REBAHAN_PROXY_TOKEN: "" }, "WARUNG_REBAHAN_PROXY_TOKEN not configured"],
  ] as const)("keeps %s pre-send and retryable without a POST", async (_label, env, lastError) => {
    const { db, row } = await setupFamily();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const http = supplierFetch("WR", receipt, undefined, endpoint);
    expect(await processWrPendingOrders(db, due())).toMatchObject({ processed: 1, retried: 1 });
    expect(row()).toMatchObject({ status: "retry", request_sent_at: null, wr_order_id: null, attempt_count: 1, last_error: lastError });
    expect(http.calls).toEqual([]);
  });

  it("assigns an invoice and exits claimed atomically on the normal purchase path", async () => {
    const { db, row } = await setupFamily();
    const atPurchase: ReturnType<typeof row>[] = [];
    const http = supplierFetch("WR", () => { atPurchase.push(row()); return receipt(); }, undefined, endpoint);
    expect(await processWrPendingOrders(db, due())).toMatchObject({ succeeded: 1 });
    expect(atPurchase).toMatchObject([{ status: "claimed", wr_order_id: null, request_sent_at: expect.any(String) }]);
    const persisted = row();
    expect(persisted).toMatchObject({ status: "processing", wr_order_id: "WR-FIXTURE", request_sent_at: atPurchase[0].request_sent_at,
      lease_owner: null, lease_expires_at: null });
    expect(await recoverStaleClaims(db)).toBe(0);
    expect(row()).toEqual(persisted);
    expect(http.calls).toEqual([`POST ${endpoint}`]);
  });

  it("WR purchase exhaustion waits for queued siblings before failing the order or emailing", async () => {
    const { fx, db, row, set } = await setupFamily();
    set("attempt_count=max_attempts-1, fulfillment_item_id=1");
    fx.sql.exec(`UPDATE fulfillment_items SET wr_link_id=1;
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(2,1,'SIBLING','Sibling',5000,1,'manual');
      UPDATE orders SET customer_email='buyer@fixture.test', items='[{"product_id":1,"variant_id":1,"qty":1},{"product_id":1,"variant_id":2,"qty":1}]';
      INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
        SELECT code,1,1,2,1,'manual','web','queued' FROM orders`);
    vi.stubEnv("RESEND_API_KEY", "fixture");
    vi.stubEnv("FORWARD_FROM_EMAIL", "sender@fixture.test");
    const http = supplierFetch("WR", () => Response.json({ success: false, message: "OUT_OF_STOCK" }, { status: 409 }), undefined, endpoint);
    expect(await processWrPendingOrders(db, due())).toMatchObject({ failed: 1 });
    expect(row()).toMatchObject({ status: "failed", request_sent_at: null, attempt_count: 3 });
    expect(fx.sql.prepare("SELECT status FROM fulfillment_items ORDER BY item_index").all())
      .toEqual([{ status: "failed" }, { status: "queued" }]);
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("queued");
    expect(http.calls).toEqual([`POST ${endpoint}`]);
  });
});

function callWrRetry() {
  return retryWr(new NextRequest("https://fixture.test/api/admin/warung/orders/1/retry", { method: "POST" }),
    { params: Promise.resolve({ id: "1" }) });
}

describe("SK premium purchase recovery", () => {
  it("takes over an expired unsent claim from a stale snapshot without charging a second attempt", async () => {
    const { p, db, row, set } = await setup("SK");
    changeAfterSelection(db, () => set("status='claimed', attempt_count=1, lease_owner='dead', lease_expires_at=datetime('now','-1 minute')"));
    const http = supplierFetch("SK", () => {
      expect(row()).toMatchObject({ status: "claimed", attempt_count: 1, request_sent_at: expect.any(String) });
      expect(row().lease_owner).not.toBe("dead");
      return acceptedReceipt("SK");
    });
    expect(await p.process(db, due())).toMatchObject({ succeeded: 1 });
    expect(http.buys()).toBe(1);
    expect(row()).toMatchObject({ status: "processing", attempt_count: 1, lease_owner: null, lease_expires_at: null });
  });

  it("backs off an explicit temporary rejection and releases its lease before trying again", async () => {
    const { p, db, row } = await setup("SK");
    const http = supplierFetch("SK", () => Response.json({ message: "PRODUCT_TEMPORARILY_UNAVAILABLE" }, { status: 503 }));
    expect(await p.process(db, due())).toMatchObject({ retried: 1 });
    const before = row();
    expect(before).toMatchObject({ status: "retry", attempt_count: 1, request_sent_at: null, sk_invoice: null,
      lease_owner: null, lease_expires_at: null, last_error: "PRODUCT_TEMPORARILY_UNAVAILABLE" });
    expect(parseExpiry(String(before.next_attempt_at))).toBeGreaterThan(Date.now());
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    expect(row()).toEqual(before);
    expect(http.buys()).toBe(1);
  });

  it("rejects an old owner's SK preflight deferral after the lease was replaced", async () => {
    const { p, db, row, set } = await setup("SK");
    let peer: ReturnType<typeof row> | undefined;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      expect(new URL(String(url)).pathname).toBe("/api/v1/item/1095");
      expect(row()).toMatchObject({ status: "claimed", attempt_count: 1, request_sent_at: null });
      set("lease_expires_at=datetime('now','-1 minute')");
      expect(await p.recover(db)).toBe(1);
      set("status='claimed', attempt_count=1, lease_owner='new-owner', lease_expires_at=datetime('now','+1 hour')");
      peer = row();
      return Response.json({ data: { id: 1095, price: 5000, stock: 0, order_process: "auto" } });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await p.process(db, due())).toMatchObject({ retried: 1 });
    expect(peer).toBeDefined();
    expect(row()).toEqual(peer);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails only the exhausted SK item while another item is still queued", async () => {
    const { p, db, fx, code, row, set } = await setup("SK");
    fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
      VALUES(?,1,1,1,1,'manual','web','queued')`).run(code);
    set("attempt_count=max_attempts-1, fulfillment_item_id=(SELECT id FROM fulfillment_items WHERE item_index=0)");
    const http = supplierFetch("SK", () => Response.json({ message: "PRODUCT_TEMPORARILY_UNAVAILABLE" }, { status: 503 }));
    expect(await p.process(db, due())).toMatchObject({ failed: 1 });
    expect(row()).toMatchObject({ status: "failed", attempt_count: 3, request_sent_at: null, lease_owner: null,
      lease_expires_at: null, last_error: "PRODUCT_TEMPORARILY_UNAVAILABLE:final_rejection" });
    expect(fx.sql.prepare("SELECT status FROM fulfillment_items ORDER BY item_index").all()).toEqual([{ status: "failed" }, { status: "queued" }]);
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("queued");
    expect(http.buys()).toBe(1);
  });

  it("settles an already accepted SK invoice as failed via a read-only lookup", async () => {
    const { db, fx, ref, row, set } = await setup("SK");
    set("status='processing', sk_invoice='SK-FIXTURE', request_sent_at=datetime('now','-5 minutes'), attempt_count=1, fulfillment_item_id=(SELECT id FROM fulfillment_items)");
    fx.sql.exec("UPDATE fulfillment_items SET sk_link_id=1");
    const before = row();
    const http = supplierFetch("SK", undefined, () => Response.json({ data: { invoice: "SK-FIXTURE", ref_id: ref, status: "canceled" } }));
    expect(await reconcileSkInvoiceNow("SK-FIXTURE", db)).toBe(true);
    expect(row()).toMatchObject({ status: "failed", sk_invoice: "SK-FIXTURE", attempt_count: 1,
      request_sent_at: before.request_sent_at, lease_owner: null, lease_expires_at: null });
    expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("failed");
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("failed");
    expect(http.calls).toEqual(["GET /api/v1/trx/SK-FIXTURE"]);
  });

  it.each(["timeout", "unreadable 2xx"])("recovers a sent %s by GET ref only, even after a 404", async failure => {
    const { p, db, fx, ref, row, set } = await setup("SK");
    let found = false;
    const lookupKey = `GET /api/v1/trx/${encodeURIComponent(ref)}`;
    const http = supplierFetch("SK", () => {
      if (failure === "timeout") throw new DOMException("fixture timeout", "AbortError");
      return new Response("not-json", { status: 200 });
    }, () => found ? Response.json({ data: { invoice: "SK-FIXTURE", ref_id: ref, status: "completed",
      items: [{ variant_id: 1095, product_license: "FIXTURE-LICENSE" }] } })
      : Response.json({ message: "not_found" }, { status: 404 }));
    expect(await p.process(db, due())).toMatchObject({ retried: 1 });
    const sent = row().request_sent_at;
    expect(row()).toMatchObject({ status: "submitted", request_sent_at: expect.any(String), attempt_count: 1,
      sk_invoice: null, lease_owner: null, lease_expires_at: null });
    expect(parseExpiry(String(row().next_attempt_at))).toBeGreaterThan(Date.now());
    expect(await p.recover(db)).toBe(0);
    expect(http.calls).not.toContain(lookupKey);
    set("next_attempt_at=datetime('now','-1 minute')");
    expect(await p.recover(db)).toBe(0);
    expect(row()).toMatchObject({ status: "submitted", last_error: "ambiguous_lookup_http_404", request_sent_at: sent, attempt_count: 1 });
    expect(await p.process(db, due())).toMatchObject({ processed: 0 });
    expect(await p.recover(db)).toBe(0);
    expect(http.calls.filter(call => call === lookupKey)).toHaveLength(1);
    found = true;
    set("next_attempt_at=datetime('now','-1 minute')");
    expect(await p.recover(db)).toBe(1);
    expect(row()).toMatchObject({ status: "completed", sk_invoice: "SK-FIXTURE", request_sent_at: sent, attempt_count: 1,
      lease_owner: null, lease_expires_at: null });
    const item = fx.sql.prepare("SELECT status,delivered_ciphertext,delivered_iv FROM fulfillment_items").get()!;
    expect(item.status).toBe("delivered");
    expect(String(item.delivered_ciphertext)).not.toContain("FIXTURE-LICENSE");
    expect(await decryptSecret(String(item.delivered_ciphertext), String(item.delivered_iv))).toContain("FIXTURE-LICENSE");
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("delivered");
    expect(http.calls.filter(call => call === lookupKey)).toHaveLength(2);
    expect(http.buys()).toBe(1);
  });

  it("clears the expired lease on SK terminal recovery while keeping the send fence", async () => {
    const { fx, db, ref, row, set } = await setup("SK");
    set("status='claimed', attempt_count=1, request_sent_at=datetime('now','-5 minutes'), lease_owner='dead-worker', lease_expires_at=datetime('now','-3 minutes'), fulfillment_item_id=1");
    fx.sql.exec("UPDATE fulfillment_items SET sk_link_id=1");
    const sent = row().request_sent_at;
    const http = supplierFetch("SK", undefined, () => Response.json({ data: { invoice: "SK-FIXTURE", ref_id: ref, status: "completed",
      items: [{ variant_id: 1095, product_license: "FIXTURE-LICENSE" }] } }));
    expect(await recoverStaleSkClaims(db)).toBe(1);
    expect(http.calls).toEqual([`GET /api/v1/trx/${encodeURIComponent(ref)}`]);
    expect(row()).toMatchObject({ status: "completed", sk_invoice: "SK-FIXTURE", request_sent_at: sent, attempt_count: 1,
      lease_owner: null, lease_expires_at: null });
    expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("delivered");
    expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("delivered");
  });

  it("clears the purchase lease when the paid handler advances a sent claim to processing", async () => {
    const { db, row, set } = await setup("SK");
    set("status='claimed', sk_invoice='SK-FIXTURE', attempt_count=1, request_sent_at=datetime('now'), lease_owner='worker', lease_expires_at=datetime('now','+3 minutes')");
    const sent = row().request_sent_at;
    expect(await handleSkOrderPaid("SK-FIXTURE", db)).toBe(true);
    expect(row()).toMatchObject({ status: "processing", request_sent_at: sent, attempt_count: 1,
      lease_owner: null, lease_expires_at: null });
  });

  it("does not count a late SK receipt after a signed terminal webhook won the CAS", async () => {
    const { fx, db, ref, row, set } = await setup("SK");
    set("fulfillment_item_id=1");
    fx.sql.exec("UPDATE fulfillment_items SET sk_link_id=1");
    const secret = "fixture-webhook-key";
    vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", secret);
    const canceled = { invoice: "SK-FIXTURE", ref_id: ref, status: "canceled" };
    const signature = await computeSkSignature(ref, canceled.invoice, canceled.status, secret);
    let webhookStatus: number | undefined;
    let terminal: ReturnType<typeof row> | undefined;
    const http = supplierFetch("SK", async () => {
      const response = await skWebhook(new NextRequest("https://fixture.test/api/webhook/sekalipay", {
        method: "POST", headers: { "content-type": "application/json", "x-signature": signature },
        body: JSON.stringify({ event: "order.canceled", data: canceled }),
      }));
      webhookStatus = response.status;
      terminal = row();
      return Response.json({ data: { ...canceled, status: "paid" } });
    });
    const result = await processSkPendingOrders(db, due());
    expect(webhookStatus).toBe(200);
    expect(terminal).toMatchObject({ status: "failed", sk_invoice: "SK-FIXTURE", request_sent_at: expect.any(String) });
    expect(row()).toEqual(terminal);
    expect(http.calls).toEqual(["GET /api/v1/item/1095", "GET /api/v1/balance", "POST /api/v1/trx"]);
    expect(result).toMatchObject({ processed: 1, succeeded: 0, retried: 1 });
  });
});
