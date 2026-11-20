import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { computeSkSignature } from "@/lib/sekalipay/client";
import { bindSkInvoiceByRef, processSkPendingOrders, recoverStaleSkClaims, skRefId } from "@/lib/sekalipay/order";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture, stubFulfillmentKey } from "../helpers/d1-fixture";

function stubFetch(fetch: (url: RequestInfo | URL, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("/v1/item/1095")) return Promise.resolve(Response.json({ data: { id: 1095, price: 5000, stock: 10, order_process: "auto", status: "on" } }));
    if (String(url).endsWith("/v1/balance")) return Promise.resolve(Response.json({ data: { balance: 100000 } }));
    return fetch(url, init);
  });
}

afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearRateLimitBucketsForTest();
});

function setup(status = "claimed", code = "AXV-20261022-STUCK") {
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "fixture-key");
  vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("CRON_SECRET", "fixture-cron");
  stubFulfillmentKey();
  const fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Capcut','capcut',7259,10);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id)
      VALUES(1,1,'CAPCUT','7 Hari Private',7259,10,'1095');
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process)
      VALUES('1095','9','Capcut','7 Hari Private',5000,10,'auto')`);
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at)
    VALUES(?,'Buyer','628','[{"product_id":1,"variant_id":1,"qty":1}]',7259,'qris','lunas','paid','web',datetime('now'))`).run(code);
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
    VALUES(?,0,1,1,1,'manual','web','queued')`).run(code);
  fx.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,
    request_sent_at,lease_expires_at,next_attempt_at,idempotency_key)
    VALUES(?,'1095',1,5000,?,1,datetime('now','-5 minutes'),datetime('now','-3 minutes'),datetime('now','-5 minutes'),?)`)
    .run(code, status, skRefId(code, "1095", 1));
  if (status === "pending") fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL");
  return { fx, code, db: createDatabaseAccess(fx.db) };
}

function completed(code: string) {
  return { invoice: "SK-RECOVERED", ref_id: skRefId(code, "1095", 1), status: "completed",
    items: [{ variant_id: 1095, product_name: "Capcut", variant_name: "7 Hari Private", product_license: "Email: fixture@example.com\nPassword: fixture-pass" }] };
}

async function webhook(code: string, signatureOverride?: string) {
  const { POST } = await import("@/app/api/webhook/sekalipay/route");
  const data = completed(code);
  const signature = signatureOverride ?? await computeSkSignature(data.ref_id, data.invoice, data.status, "fixture-secret");
  return POST(new NextRequest("http://localhost/api/webhook/sekalipay", { method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body: JSON.stringify({ event: "order.completed", data }),
  }));
}

function expectDelivered(fx: ReturnType<typeof createD1Fixture>) {
  expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
    .toMatchObject({ status: "completed", sk_invoice: "SK-RECOVERED" });
  expect(fx.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get())
    .toMatchObject({ status: "delivered", delivered_ciphertext: expect.any(String) });
  expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("delivered");
}

describe("SK sent claim recovery — incident 23 October", () => {
  it.each(["selection", "send"])("preserves a bound manual handover even after catalog remapping: %s", async phase => {
    const { fx, db } = setup("pending");
    try {
      const handover = () => fx.sql.exec(`UPDATE fulfillment_items SET ${phase === "selection" ? "sk_link_id=NULL" : "sk_link_id=(SELECT id FROM sk_order_links)"},last_error='manual_handover:admin',delivered_message_id='manual'; UPDATE sk_order_links SET fulfillment_item_id=(SELECT id FROM fulfillment_items); UPDATE product_variants SET sk_variant_id=NULL`);
      if (phase === "selection") handover();
      const exec = db.execRun;
      db.execRun = async (sql, ...args) => {
        if (phase === "send" && sql.includes("SET request_sent_at=datetime('now')")) handover();
        return exec(sql, ...args);
      };
      const fetch = vi.fn(); stubFetch(fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fx.close(); }
  });
  it("does not let unpaid history consume all dispatch slots", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET id=100");
      for (let i = 1; i <= 4; i++) {
        fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES(?,'Buyer','628','[]',1,'qris','lunas','pending')`).run(`UNPAID-${i}`);
        fx.sql.prepare(`INSERT INTO sk_order_links(id,order_code,sk_variant_id,sk_cost,status,next_attempt_at) VALUES(?,?,'1095',5000,'pending',datetime('now','-1 day'))`).run(i, `UNPAID-${i}`);
      }
      const fetch = vi.fn(async () => Response.json({ data: { invoice: "SK-PAID", ref_id: skRefId(code, "1095", 1), status: "paid" } })); stubFetch(fetch);
      expect(await processSkPendingOrders(db, { skipOrphanProbe: true })).toMatchObject({ processed: 1, succeeded: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE id=1").get()).toEqual({ status: "pending", attempt_count: 0 });
    } finally { fx.close(); }
  });
  it("keeps the admin low-balance notice without spamming each preflight retry", async () => {
    const { fx, db } = setup("pending");
    try {
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true"); vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "123");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-token");
      const notices: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("api.telegram.org")) { notices.push(String(init?.body)); return Response.json({ ok: true, result: { message_id: 1 } }); }
        return Response.json({ data: String(url).includes("/v1/item/") ? { id: 1095, price: 6000, stock: 10, order_process: "auto" } : { balance: 100 } });
      }));
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
      const { reconcileBlockedSkBalance } = await import("@/lib/sekalipay/order");
      await reconcileBlockedSkBalance(db);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(notices.filter(text => text.includes("Saldo Sekalipay"))).toHaveLength(1);
    } finally { fx.close(); }
  });
  it("preserves the complete SK auto flow with explicit GET preflight, stable ref, two licenses and no rebuy", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET quantity=2,sk_cost=10000,idempotency_key=NULL; UPDATE fulfillment_items SET qty=2");
      const calls: string[] = [];
      const ref = skRefId(code, "1095", 2);
      vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path.endsWith("/item/1095")) return Response.json({ data: { id: 1095, price: 6000, stock: -1, order_process: "auto" } });
        if (path.endsWith("/balance")) return Response.json({ data: { balance: 12000 } });
        if (init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual({ ref_id: ref, carts: [{ item_id: 1095, quantity: 2 }] });
          expect(fx.sql.prepare("SELECT request_sent_at FROM sk_order_links").get()?.request_sent_at).toEqual(expect.any(String));
          return Response.json({ data: { invoice: "SK-RECOVERED", ref_id: ref, status: "paid" } });
        }
        expect(path).toBe("/api/v1/trx/SK-RECOVERED");
        return Response.json({ data: { invoice: "SK-RECOVERED", ref_id: ref, status: "completed", items: [{ variant_id: 1095, licenses: [{ product_license: "UNIT-ONE" }, { product_license: "UNIT-TWO" }] }] } });
      }));
      expect(await processSkPendingOrders(db, { skipOrphanProbe: true })).toMatchObject({ succeeded: 1 });
      const { reconcileSkInvoiceNow } = await import("@/lib/sekalipay/order");
      expect(await reconcileSkInvoiceNow("SK-RECOVERED", db)).toBe(true);
      expect(await reconcileSkInvoiceNow("SK-RECOVERED", db)).toBe(true);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(calls.slice(0, 3)).toEqual(["GET /api/v1/item/1095", "GET /api/v1/balance", "POST /api/v1/trx"]);
      expect(calls.filter(call => call.startsWith("POST"))).toHaveLength(1);
      expectDelivered(fx);
      const item = fx.sql.prepare("SELECT delivered_ciphertext,delivered_iv FROM fulfillment_items").get();
      const { decryptSecret } = await import("@/lib/fulfillment/crypto");
      const plaintext = await decryptSecret(String(item?.delivered_ciphertext), String(item?.delivered_iv));
      expect(plaintext).toContain("UNIT-ONE"); expect(plaintext).toContain("UNIT-TWO");
      expect(fx.sql.prepare("SELECT sk_cost FROM sk_order_links").get()?.sk_cost).toBe(10000);
      expect(fx.sql.prepare("SELECT subtotal FROM orders").get()?.subtotal).toBe(7259);
    } finally { fx.close(); }
  });
  it.each([
    ["low balance", { id: 1095, price: 6000, stock: 2, order_process: "auto", status: "on" }, { balance: 5999 }, "blocked_balance"],
    ["unreadable balance", { id: 1095, price: 6000, stock: 2, order_process: "auto", status: "on" }, {}, "retry"],
    ["no stock", { id: 1095, price: 6000, stock: 0, order_process: "auto", status: "on" }, { balance: 10000 }, "retry"],
    ["disabled item", { id: 1095, price: 6000, stock: 2, order_process: "auto", status: "off" }, { balance: 10000 }, "retry"],
    ["wrong identity", { id: 8, price: 6000, stock: 2, order_process: "auto", status: "on" }, { balance: 10000 }, "retry"],
  ])("preflight %s never buys or consumes an attempt", async (_label, item, balance, expected) => {
    const { fx, db } = setup("pending");
    try {
      const fetch = vi.fn(async (url: RequestInfo | URL) => Response.json({ data: String(url).includes("/v1/item/") ? item : balance }));
      vi.stubGlobal("fetch", fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fx.sql.prepare("SELECT status,attempt_count,request_sent_at FROM sk_order_links").get()).toEqual({ status: expected, attempt_count: 1, request_sent_at: null });
      expect(fetch.mock.calls.every(([url]) => !String(url).endsWith("/v1/trx"))).toBe(true);
    } finally { fx.close(); }
  });
  it("revives a preflight-blocked order after top-up and buys at live cost", async () => {
    const { fx, code, db } = setup("pending");
    try {
      let balance = 3000;
      const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("/v1/item/")) return Response.json({ data: { id: 1095, price: 6000, stock: 10, order_process: "auto" } });
        if (String(url).endsWith("/v1/balance")) return Response.json({ data: { balance } });
        expect(init?.method).toBe("POST");
        return Response.json({ data: { invoice: "SK-PAID", ref_id: skRefId(code, "1095", 1), status: "paid" } });
      });
      vi.stubGlobal("fetch", fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links").get()).toEqual({ status: "blocked_balance", attempt_count: 1 });
      balance = 6000;
      const { reconcileBlockedSkBalance } = await import("@/lib/sekalipay/order");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
      expect(await reconcileBlockedSkBalance(db)).toBe(1);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fx.sql.prepare("SELECT status,attempt_count,sk_cost FROM sk_order_links").get()).toEqual({ status: "processing", attempt_count: 2, sk_cost: 5000 });
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    } finally { fx.close(); }
  });
  it("selects eligible balance blocks before LIMIT and ignores stale cost for due preflight blocks", async () => {
    const { fx, db, code } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET status='blocked_balance',last_error='preflight_insufficient_balance',sk_cost=20000,next_attempt_at=datetime('now','-1 minute')");
      fx.sql.exec(`UPDATE sk_order_links SET id=100;
        INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status)
        VALUES('OLD','Buyer','628','[]',1,'qris','lunas','paid');`);
      for (let i = 1; i <= 10; i++) fx.sql.prepare(`INSERT INTO sk_order_links(id,order_code,sk_variant_id,sk_cost,status,updated_at) VALUES(?,'OLD',?,1,'blocked_balance',datetime('now','-2 days'))`).run(i, String(i));
      const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith('/v1/balance')) return Response.json({ data: { balance: 6000 } });
        if (String(url).includes('/v1/item/')) return Response.json({ data: { id: 1095, price: 6000, stock: 1, order_process: 'auto' } });
        expect(init?.method).toBe('POST');
        return Response.json({ data: { invoice: 'SK-PAID', ref_id: skRefId(code, '1095', 1), status: 'paid' } });
      });
      vi.stubGlobal('fetch', fetch);
      const { reconcileBlockedSkBalance } = await import('@/lib/sekalipay/order');
      expect(await reconcileBlockedSkBalance(db)).toBe(1);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fx.sql.prepare("SELECT status,sk_cost FROM sk_order_links WHERE id=100").get()).toEqual({ status: 'processing', sk_cost: 20000 });
      expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    } finally { fx.close(); }
  });
  it("does not extend preflight balance recovery beyond 24h by refreshing updated_at", async () => {
    const { fx, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET status='blocked_balance',last_error='preflight_insufficient_balance',created_at=datetime('now','-25 hours'),updated_at=datetime('now'),next_attempt_at=datetime('now','-1 minute')");
      stubFetch(vi.fn());
      const { reconcileBlockedSkBalance } = await import("@/lib/sekalipay/order");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      expect(fx.sql.prepare("SELECT status FROM sk_order_links").get()?.status).toBe("blocked_balance");
    } finally { fx.close(); }
  });
  it("preserves legacy cost gate and rejects invalid wallet, unpaid, sent, manual and disabled recovery", async () => {
    const { fx, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET status='blocked_balance',last_error='legacy',sk_cost=5000");
      let balance: unknown = null;
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { balance } })));
      const { reconcileBlockedSkBalance } = await import("@/lib/sekalipay/order");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      balance = 4999;
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      balance = 5000;
      fx.sql.exec("UPDATE orders SET payment_status='pending'");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      fx.sql.exec("UPDATE orders SET payment_status='paid'; UPDATE sk_order_links SET request_sent_at=datetime('now')");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL; UPDATE fulfillment_items SET delivered_message_id='manual'");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      fx.sql.exec("UPDATE fulfillment_items SET delivered_message_id=NULL");
      vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "false");
      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
      expect(await reconcileBlockedSkBalance(db)).toBe(1);
    } finally { fx.close(); }
  });
  it("rejects unrelated credentials and supports empty licenses with product_license", async () => {
    const { fx, code, db } = setup();
    try {
      const data = { ...completed(code), items: [{ variant_id: 1095, licenses: [], product_license: "MATCH" }, { variant_id: 999, product_license: "OTHER" }] };
      stubFetch(vi.fn(async () => Response.json({ data })));
      expect(await recoverStaleSkClaims(db)).toBe(0);
      const row = fx.sql.prepare("SELECT status,sk_account_details,sk_account_iv FROM sk_order_links").get();
      expect(row?.status).toBe("processing");
      const { decryptSecret } = await import("@/lib/fulfillment/crypto");
      expect(await decryptSecret(String(row?.sk_account_details), String(row?.sk_account_iv))).toContain("OTHER");
      const { reconcileSkInvoiceNow } = await import("@/lib/sekalipay/order");
      stubFetch(vi.fn(async () => Response.json({ data: { ...data, items: [data.items[0]] } })));
      expect(await reconcileSkInvoiceNow("SK-RECOVERED", db)).toBe(true);
      expectDelivered(fx);
    } finally { fx.close(); }
  });
  it("does not claim a stale queue snapshot after another worker changed its attempt", async () => {
    const { fx, db } = setup("pending");
    try {
      const original = db.execRun;
      db.execRun = async (sql, ...params) => {
        if (sql.includes("SET status='claimed', attempt_count=?")) fx.sql.exec("UPDATE sk_order_links SET attempt_count=attempt_count+1");
        return original(sql, ...params);
      };
      const fetch = vi.fn(); stubFetch(fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).not.toHaveBeenCalled();
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links").get()).toEqual({ status: "pending", attempt_count: 2 });
    } finally { fx.close(); }
  });
  it("refunds an expired unsent claim so its last attempt remains dispatchable", async () => {
    const { fx, code, db } = setup();
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=max_attempts");
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links").get()).toEqual({ status: "pending", attempt_count: 2 });
      const fetch = vi.fn(async () => Response.json({ data: { invoice: "SK-PAID", ref_id: skRefId(code, "1095", 1), status: "paid" } }));
      stubFetch(fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links").get()).toEqual({ status: "processing", attempt_count: 3 });
    } finally { fx.close(); }
  });
  it.each(["unpaid", "manual", "fence_error", "lost_lease"])("never posts when the pre-send fence fails: %s", async reason => {
    const { fx, db } = setup("pending");
    try {
      if (reason === "unpaid") fx.sql.exec("UPDATE orders SET payment_status='pending'");
      if (reason === "manual") fx.sql.exec("UPDATE fulfillment_items SET delivered_message_id='manual'");
      const original = db.execRun;
      db.execRun = async (sql, ...params) => {
        if (sql.includes("SET request_sent_at=datetime('now')")) {
          if (reason === "fence_error") throw new Error("database unavailable");
          if (reason === "lost_lease") fx.sql.exec("UPDATE sk_order_links SET lease_owner='other'");
        }
        return original(sql, ...params);
      };
      const fetch = vi.fn(); stubFetch(fetch);
      if (reason === "fence_error") await expect(processSkPendingOrders(db, { skipOrphanProbe: true })).rejects.toThrow("database unavailable");
      else await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).not.toHaveBeenCalled();
      expect(fx.sql.prepare("SELECT request_sent_at FROM sk_order_links").get()?.request_sent_at).toBeNull();
    } finally { fx.close(); }
  });

  it("keeps a duplicate reference fenced when lookup fails", async () => {
    const { fx, db } = setup("pending");
    try {
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
        ? Response.json({ message: "REF_ID_ALREADY_EXIST" }, { status: 422 })
        : Response.json({ message: "TRX_NOT_FOUND" }, { status: 404 }));
      stubFetch(fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fx.sql.prepare("SELECT status,request_sent_at FROM sk_order_links").get()).toMatchObject({ status: "claimed", request_sent_at: expect.any(String) });
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    } finally { fx.close(); }
  });
  it("keeps an empty completed receipt processing until credentials arrive", async () => {
    const { fx, code, db } = setup();
    try {
      const fetch = vi.fn(async () => Response.json({ data: { ...completed(code), items: [null, { seller_note: "Instructions only" }] } }));
      stubFetch(fetch);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fx.sql.prepare("SELECT status,last_error FROM sk_order_links").get()).toEqual({ status: "processing", last_error: "completed_without_license" });
      expect(fx.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get()).toEqual({ status: "queued", delivered_ciphertext: null });
      fetch.mockImplementation(async () => Response.json({ data: completed(code) }));
      const { reconcileSkInvoiceNow } = await import("@/lib/sekalipay/order");
      expect(await reconcileSkInvoiceNow("SK-RECOVERED", db)).toBe(true);
      expectDelivered(fx);
    } finally { fx.close(); }
  });
  it.each([[400, "INVALID_ORDER"], [402, "BALANCE_IS_INSUFFICIENT"], [409, "OUT_OF_STOCK"], [422, "validation error"]])(
    "keeps HTTP%s %s fenced and reconciles by GET only", async (status, message) => {
      const { fx, db } = setup("pending");
      try {
        const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
          ? Response.json({ message }, { status }) : Response.json({ message: "not found" }, { status: 404 }));
        stubFetch(fetch);
        await processSkPendingOrders(db, { skipOrphanProbe: true });
        expect(fx.sql.prepare("SELECT status,request_sent_at FROM sk_order_links").get()).toMatchObject({ status: "submitted", request_sent_at: expect.any(String) });
        fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
        await recoverStaleSkClaims(db);
        await processSkPendingOrders(db, { skipOrphanProbe: true });
        expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
      } finally { fx.close(); }
    },
  );
  it("encrypts partial licenses without delivery, then completes when all units arrive", async () => {
    const { fx, code, db } = setup();
    try {
      fx.sql.exec("UPDATE sk_order_links SET quantity=2, idempotency_key=NULL");
      const ref_id = skRefId(code, "1095", 2);
      const data = { ...completed(code), ref_id, items: [{ variant_id: 1095, licenses: [{ product_license: "PARTIAL-SECRET" }] }] };
      const fetch = vi.fn(async () => Response.json({ data })); stubFetch(fetch);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      const row = fx.sql.prepare("SELECT status,last_error,sk_account_details,sk_account_iv FROM sk_order_links").get();
      expect(row).toMatchObject({ status: "processing", last_error: "completed_partial_license" });
      expect(String(row?.sk_account_details)).not.toContain("PARTIAL-SECRET");
      const { decryptSecret } = await import("@/lib/fulfillment/crypto");
      expect(await decryptSecret(String(row?.sk_account_details), String(row?.sk_account_iv))).toContain("PARTIAL-SECRET");
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("queued");
      fetch.mockImplementation(async () => Response.json({ data: { ...data, items: [{ variant_id: 1095, licenses: [{ product_license: "ONE" }, { product_license: "TWO" }] }] } }));
      const { reconcileSkInvoiceNow } = await import("@/lib/sekalipay/order");
      expect(await reconcileSkInvoiceNow("SK-RECOVERED", db)).toBe(true);
      expectDelivered(fx);
    } finally { fx.close(); }
  });
  it("does not downgrade a completed item on a later failure", async () => {
    const { fx, code, db } = setup();
    try {
      stubFetch(vi.fn(async () => Response.json({ data: completed(code) })));
      await recoverStaleSkClaims(db);
      const { handleSkOrderFailed } = await import("@/lib/sekalipay/deliver");
      await handleSkOrderFailed("SK-RECOVERED", "canceled", db);
      expectDelivered(fx);
    } finally { fx.close(); }
  });
  it.each([
    [500,{message:"INTERNAL_SERVER_ERROR"}],
    [503,{message:"SERVICE_UNAVAILABLE"}],
    [502,{message:"sk_proxy_unreadable_response"}],
    [200,{data:{status:"paid"}}],
    [200,{data:{invoice:"INV",ref_id:"different-order",status:"paid"}}],
  ])("keeps a sent claim ambiguous on HTTP%s or a missing/mismatched purchase receipt",async(status,body)=>{
    const {fx,db}=setup("pending");
    try {
      const fetch=vi.fn(async()=>Response.json(body,{status}));stubFetch(fetch);
      await processSkPendingOrders(db,{skipOrphanProbe:true});
      expect(fx.sql.prepare("SELECT status,request_sent_at,sk_invoice FROM sk_order_links").get()).toMatchObject({status:"submitted",request_sent_at:expect.any(String),sk_invoice:null});
      await processSkPendingOrders(db,{skipOrphanProbe:true});expect(fetch).toHaveBeenCalledTimes(1);
    } finally {fx.close();}
  });
  it("only explicit PRODUCT_TEMPORARILY_UNAVAILABLE permits a normal retry",async()=>{
    const {fx,db}=setup("pending");
    try {
      stubFetch(vi.fn(async()=>Response.json({message:"PRODUCT_TEMPORARILY_UNAVAILABLE"},{status:503})));
      await processSkPendingOrders(db,{skipOrphanProbe:true});
      expect(fx.sql.prepare("SELECT status,request_sent_at FROM sk_order_links").get()).toEqual({status:"retry",request_sent_at:null});
    } finally {fx.close();}
  });
  it("FX-11: three definite temporary rejections fail the paid order",async()=>{
    const {fx,db}=setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET attempt_count=0");
      const post=vi.fn(async()=>Response.json({message:"PRODUCT_TEMPORARILY_UNAVAILABLE"},{status:503}));
      stubFetch(post);
      for(let i=0;i<4;i++) {
        fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
        await processSkPendingOrders(db,{skipOrphanProbe:true});
      }
      expect(post).toHaveBeenCalledTimes(3);
      expect(fx.sql.prepare("SELECT status,attempt_count,request_sent_at FROM sk_order_links").get())
        .toEqual({status:"failed",attempt_count:3,request_sent_at:null});
      expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("failed");
    } finally {fx.close();}
  });
  it("FX-11: ages an unresolved SK link without changing status or fence", async () => {
    const {fx,db}=setup("submitted");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=datetime('now','-14 hours')");
      vi.stubEnv("TELEGRAM_BOT_ENABLED","true");vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID","123");vi.stubEnv("TELEGRAM_BOT_TOKEN","fixture");
      const send=vi.fn(async()=>Response.json({ok:true,result:{message_id:1}}));
      vi.stubGlobal("fetch",send);
      const sk = await import("@/lib/sekalipay/order");
      await sk.alertAgingSkOrders?.(db);await sk.alertAgingSkOrders?.(db);
      expect(send).toHaveBeenCalledTimes(1);
      expect(fx.sql.prepare("SELECT status,request_sent_at FROM sk_order_links").get()).toMatchObject({status:"submitted",request_sent_at:expect.any(String)});
    } finally {fx.close();}
  });
  it("paid background work binds SK ownership before generic manual fulfillment can settle the item",async()=>{
    const {fx,code}=setup();
    try {
      fx.sql.exec("DELETE FROM sk_order_links");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED","false");vi.stubEnv("AUTO_FULFILLMENT_ENABLED","true");
      const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
        expect(init?.method).toBe("POST");
        return Response.json({data:{invoice:"SK-BOUND",ref_id:skRefId(code,"1095",1),status:"paid"}});
      });stubFetch(fetch);
      const {schedulePaidFulfillment}=await import("@/lib/payments/paid-fulfillment");
      await schedulePaidFulfillment(code,"market");
      expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get()).toMatchObject({status:"processing",sk_invoice:"SK-BOUND"});
      const item=fx.sql.prepare("SELECT status,sk_link_id FROM fulfillment_items").get();
      expect(item?.sk_link_id).toBeTruthy();expect(item?.status).not.toBe("manual_required");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {fx.close();}
  });
  it("records lookup failures for admin while preserving the sent claim, original request time and ref_id",async()=>{
    const {fx,db,code}=setup();
    try {
      const before=fx.sql.prepare("SELECT request_sent_at,idempotency_key FROM sk_order_links").get();
      const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
        expect(init?.method).not.toBe("POST");return Response.json({message:"TRX_NOT_FOUND"},{status:404});
      });stubFetch(fetch);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fx.sql.prepare("SELECT status,last_error,request_sent_at,idempotency_key FROM sk_order_links").get()).toEqual({status:"claimed",last_error:"ambiguous_lookup_http_404",...before});
      expect(fetch).toHaveBeenCalledTimes(1);expect(String(fetch.mock.calls[0][0])).toContain(encodeURIComponent(skRefId(code,"1095",1)));
    } finally {fx.close();}
  });
  it("immediate dispatch processes only the paid order instead of buying another order earlier in the queue",async()=>{
    const {fx,db,code}=setup("pending");
    try {
      fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('OTHER','Other','628','[]',5000,'qris','lunas','paid');
        INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,next_attempt_at) VALUES('OTHER','1095',1,5000,'pending',datetime('now','-1 hour'))`);
      const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
        expect(init?.method).toBe("POST");expect(JSON.parse(String(init?.body)).ref_id).toBe(skRefId(code,"1095",1));
        return Response.json({data:{invoice:"SK-PAID",ref_id:skRefId(code,"1095",1),status:"paid"}});
      });stubFetch(fetch);
      expect(await processSkPendingOrders(db,{skipOrphanProbe:true,orderCode:code,limit:1})).toMatchObject({processed:1,succeeded:1});
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE order_code='OTHER'").get()).toEqual({status:"pending",attempt_count:0});
    } finally {fx.close();}
  });
  it.each(["claimed", "submitted", "ordering"])("recovers %s without an invoice using GET ref_id and delivers without a second purchase", async status => {
    const { fx, code } = setup(status);
    try {
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      stubFetch(fetch);
      const budget = createBudgetedDatabase(40, 2, fx.db);
      expect(await recoverStaleSkClaims(budget.access)).toBe(1);
      expectDelivered(fx);
      expect(budget.used).toBeLessThanOrEqual(38);
      await recoverStaleSkClaims(createDatabaseAccess(fx.db));
      await processSkPendingOrders(createDatabaseAccess(fx.db), { skipOrphanProbe: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(decodeURIComponent(String(fetch.mock.calls[0][0]))).toContain(skRefId(code, "1095", 1));
    } finally { fx.close(); }
  });

  it("the existing lite cron repairs a sent claim and delivers automatically", async () => {
    const { fx, code } = setup();
    try {
      stubFetch(vi.fn(async () => Response.json({ data: completed(code) })));
      const { POST } = await import("@/app/api/cron/lite/route");
      const response = await POST(new NextRequest("http://localhost/api/cron/lite?job=sk_orders", {
        method: "POST", headers: { authorization: "Bearer fixture-cron" },
      }));
      expect(response.status).toBe(200);
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("recovery delivers the credential email within the existing 40-statement cron budget", async () => {
    const { fx, code } = setup();
    try {
      vi.stubEnv("RESEND_API_KEY", "fixture-email");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@example.com");
      fx.sql.exec("UPDATE orders SET customer_email='buyer@example.com'");
      const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("api.resend.com")) return Response.json({ id: "EMAIL-RECOVERED" });
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      stubFetch(fetch);
      const budget = createBudgetedDatabase(40, 2, fx.db);
      expect(await recoverStaleSkClaims(budget.access)).toBe(1);
      expectDelivered(fx);
      expect(fx.sql.prepare("SELECT status FROM buyer_notice_log WHERE idempotency_key LIKE 'email:sk-credential:%'").get()?.status).toBe("sent");
      expect(budget.used).toBeLessThanOrEqual(38);
      expect(fetch.mock.calls.filter(([url]) => String(url).includes("api.resend.com"))).toHaveLength(1);
    } finally { fx.close(); }
  });

  it.each(["query", "path", "lookup"])("buyer %s polling recovers a missing invoice immediately without waiting for a lease or cron", async route => {
    const { fx, code } = setup("claimed", "AXV-20261022-11223344");
    try {
      fx.sql.exec("UPDATE orders SET customer_wa='6281234567890'; UPDATE sk_order_links SET lease_expires_at=datetime('now','+2 minutes')");
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      stubFetch(fetch);
      const request = new NextRequest(`http://localhost/api/orders?code=${code}`);
      let response: Response;
      if (route === "query") {
        const { GET } = await import("@/app/api/orders/route");
        response = await GET(request);
      } else if (route === "path") {
        const { GET } = await import("@/app/api/orders/[code]/route");
        response = await GET(request, { params: Promise.resolve({ code }) });
      } else {
        const { POST } = await import("@/app/api/orders/lookup/route");
        response = await POST(new NextRequest("http://localhost/api/orders/lookup", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ code, wa: "6281234567890" }) }));
      }
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ order: { credentials_ready: true, fulfillment_status: "delivered" } });
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("throttles buyer polling by ref_id and records a processing invoice for the next poll", async () => {
    const { fx, code, db } = setup();
    try {
      const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
      const fetch = vi.fn(async () => Response.json({ data: { ...completed(code), status: "processing" } }));
      stubFetch(fetch);
      expect(await maybeRefreshSupplierOrder(code, db)).toEqual({ refreshed: false, skipped: false });
      expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "processing", sk_invoice: "SK-RECOVERED" });
      expect(await maybeRefreshSupplierOrder(code, db)).toEqual({ refreshed: false, skipped: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("binds an early completion webhook before the POST response and never regresses completed on the late response", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=0");
      const fetch = vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        expectDelivered(fx);
        return Response.json({ data: { invoice: "SK-RECOVERED", status: "processing" } });
      });
      stubFetch(fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await webhook(code)).status).toBe(200);
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("a timeout after an early completion webhook does not overwrite delivered status", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=0");
      stubFetch(vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        throw new Error("network timeout");
      }));
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it.each([400, 402])("a late HTTP%s cannot fail or block an order already delivered by its webhook", async status => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=2");
      stubFetch(vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        return Response.json({ message: status === 402 ? "BALANCE_IS_INSUFFICIENT" : "INVALID_ORDER" }, { status });
      }));
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("does not attach an invoice from an unsigned webhook or an unrelated/mismatched reference", async () => {
    const { fx, code, db } = setup();
    try {
      expect((await webhook(code, "invalid")).status).toBe(401);
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 2), "SK-OTHER", db)).toBe(false);
      expect(await bindSkInvoiceByRef("sk:OTHER:1095:1", "SK-OTHER", db)).toBe(false);
      expect(fx.sql.prepare("SELECT sk_invoice,status FROM sk_order_links").get()).toMatchObject({ sk_invoice: null, status: "claimed" });
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 1), "SK-FIRST", db)).toBe(true);
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 1), "SK-OTHER", db)).toBe(false);
      expect(fx.sql.prepare("SELECT sk_invoice FROM sk_order_links").get()?.sk_invoice).toBe("SK-FIRST");
    } finally { fx.close(); }
  });

  it("keeps active claims alone and preserves ambiguous failures for read-only recovery", async () => {
    const { fx, db } = setup();
    try {
      const fetch = vi.fn(async () => Response.json({ message: "not found" }, { status: 404 }));
      stubFetch(fetch);
      fx.sql.exec("UPDATE sk_order_links SET lease_expires_at=datetime('now','+1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      fx.sql.exec("UPDATE sk_order_links SET lease_expires_at=datetime('now','-1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fx.sql.prepare("SELECT status,attempt_count,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "claimed", attempt_count: 1, sk_invoice: null });
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("supports legacy links without idempotency_key and unsent claims still return to pending", async () => {
    const { fx, code, db } = setup();
    try {
      fx.sql.exec("UPDATE sk_order_links SET idempotency_key=NULL");
      stubFetch(vi.fn(async () => Response.json({ data: completed(code) })));
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expectDelivered(fx);
      fx.sql.exec("UPDATE sk_order_links SET status='claimed',sk_invoice=NULL,request_sent_at=NULL,lease_expires_at=datetime('now','-1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expect(fx.sql.prepare("SELECT status FROM sk_order_links").get()?.status).toBe("pending");
    } finally { fx.close(); }
  });

  it("reconciles a manually handed-over old order without replacing or sending its credentials again", async () => {
    const { fx, code, db } = setup();
    try {
      vi.stubEnv("RESEND_API_KEY", "fixture-email");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@example.com");
      fx.sql.exec(`UPDATE orders SET customer_email='buyer@example.com',fulfillment_status='delivered';
        UPDATE fulfillment_items SET status='delivered',last_error='manual_handover:admin',
          delivered_ciphertext='manual-contents',delivered_iv='manual-iv',delivered_message_id='manual'`);
      const fetch = vi.fn(async () => Response.json({ data: completed(code) }));
      stubFetch(fetch);
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expect(fx.sql.prepare("SELECT status,delivered_ciphertext,delivered_message_id FROM fulfillment_items").get())
        .toMatchObject({ status: "delivered", delivered_ciphertext: "manual-contents", delivered_message_id: "manual" });
      expect(fx.sql.prepare("SELECT status FROM sk_order_links").get()?.status).toBe("completed");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("throttles failed recovery lookups while preserving the original purchase reference", async () => {
    const { fx, code, db } = setup();
    try {
      const fetch = vi.fn(async () => Response.json({ message: "not found" }, { status: 404 }));
      stubFetch(fetch);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
      fetch.mockImplementation(async () => Response.json({ data: completed(code) }));
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { fx.close(); }
  });

  it("returns a retryable response for a signed webhook whose reference cannot be bound", async () => {
    const { fx } = setup();
    try {
      expect((await webhook("OTHER-ORDER")).status).toBe(500);
      expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "claimed", sk_invoice: null });
    } finally { fx.close(); }
  });
});
