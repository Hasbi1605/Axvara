import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess, QueryBudgetExceeded } from "@/lib/db-access";
import { processSkPendingOrders, reconcileMissingSkLinks } from "@/lib/sekalipay/order";
import { createD1Fixture } from "../helpers/d1-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
type Fx = ReturnType<typeof createD1Fixture>;

function setup() {
  vi.stubEnv("CRON_SECRET", "s");
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "fixture-key");
  const fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Disney','disney',16500,100);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id) VALUES(1,1,'SK','2 User',16500,100,'689');
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price)
      VALUES('689','9','Disney','2 User',10000,100,'auto',1,1,16500)`);
  return fx;
}
function seedOrder(fx: Fx, code: string, status?: string) {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at)
    VALUES(?,'Buyer','628',?,16500,'qris','lunas','paid','web',datetime('now'))`)
    .run(code, JSON.stringify([{ product_id: 1, variant_id: 1, qty: 1 }]));
  if (status) fx.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,sk_cost,status,sk_invoice)
    VALUES(?,'689',10000,?,?)`).run(code, status, status === "completed" ? `OLD-${code}` : null);
}
function supplier() {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Response.json({ data: { invoice: "SK-NEW", ref_id: "fixture", status: "processing", price: 10000, fees: 0 } });
    }
    return Response.json({ data: { status: "processing", invoice: "SK-NEW" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
async function tick() {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const response = await POST(new NextRequest("http://localhost/api/cron/lite?job=sk_orders", {
    method: "POST", headers: { authorization: "Bearer s" },
  }));
  return { status: response.status, body: await response.json() };
}

describe("SK queue starvation — 19 October", () => {
  it("dispatches a due order with 24 completed orders and does not repurchase on the next tick", async () => {
    const fx = setup();
    try {
      for (let i = 0; i < 24; i++) seedOrder(fx, `DONE-${i}`, "completed");
      seedOrder(fx, "DUE", "pending");
      const fetch = supplier();
      expect(await tick()).toMatchObject({ status: 200, body: { processed: 1, succeeded: 1 } });
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE order_code='DUE'").get())
        .toMatchObject({ status: "processing", attempt_count: 1 });
      await tick();
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    } finally { fx.close(); }
  });

  it("finds an older orphan behind 24 completed orders and dispatches it without manual Retry", async () => {
    const fx = setup();
    try {
      seedOrder(fx, "ORPHAN");
      for (let i = 0; i < 24; i++) seedOrder(fx, `DONE-${i}`, "completed");
      supplier();
      expect(await tick()).toMatchObject({ status: 200, body: { orphan_links_healed: 1, processed: 1, succeeded: 1 } });
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE order_code='ORPHAN'").get())
        .toMatchObject({ status: "processing", attempt_count: 1 });
    } finally { fx.close(); }
  });

  it("checks linked history in one statement regardless of volume", async () => {
    const fx = setup();
    try {
      for (let i = 0; i < 100; i++) seedOrder(fx, `DONE-${i}`, "completed");
      const budget = createBudgetedDatabase(40, 2, fx.db);
      expect(await reconcileMissingSkLinks(budget.access)).toEqual({ orders: 0, links: 0 });
      expect(budget.used).toBe(1);
    } finally { fx.close(); }
  });

  it("does not recreate completed/failed links or order manual, unpaid, expired or malformed items", async () => {
    const fx = setup();
    try {
      seedOrder(fx, "DONE", "completed"); seedOrder(fx, "FAILED", "failed");
      for (const code of ["UNPAID", "CANCELLED", "OLD", "INVALID", "MANUAL"]) seedOrder(fx, code);
      fx.sql.exec(`UPDATE orders SET payment_status='pending' WHERE code='UNPAID';
        UPDATE orders SET status='dibatalkan' WHERE code='CANCELLED';
        UPDATE orders SET paid_at=datetime('now','-8 days') WHERE code='OLD';
        UPDATE orders SET items='invalid-json' WHERE code='INVALID';
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id) VALUES(2,1,'MANUAL','Manual',10000,1,'999');
        INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process)
          VALUES('999','9','Disney','Manual',10000,1,'manual');
        UPDATE orders SET items='[{"product_id":1,"variant_id":2,"qty":1}]' WHERE code='MANUAL'`);
      expect(await reconcileMissingSkLinks(createDatabaseAccess(fx.db))).toEqual({ orders: 0, links: 0 });
      expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM sk_order_links").get()?.n).toBe(2);
    } finally { fx.close(); }
  });

  it("surfaces an exhausted query budget instead of returning an empty queue", async () => {
    const fx = setup();
    try {
      seedOrder(fx, "DUE", "pending");
      const budget = createBudgetedDatabase(2, 2, fx.db);
      await expect(processSkPendingOrders(budget.access)).rejects.toBeInstanceOf(QueryBudgetExceeded);
      expect(fx.sql.prepare("SELECT attempt_count FROM sk_order_links WHERE order_code='DUE'").get()?.attempt_count).toBe(0);
    } finally { fx.close(); }
  });

  it("dispatches existing links before repairing orphans, with at most four buys per tick", async () => {
    const fx = setup();
    try {
      for (let i = 0; i < 4; i++) seedOrder(fx, `DUE-${i}`, "pending");
      seedOrder(fx, "ORPHAN");
      const fetch = supplier();
      let probed = false;
      const base = fx.db.prepare;
      fx.db.prepare = sql => {
        if (sql.includes("json_each")) probed = true;
        return base(sql);
      };
      fetch.mockImplementation(async (_url, init) => {
        if (init?.method === "POST") {
          expect(probed).toBe(false);
          return Response.json({ data: { invoice: `SK-${fetch.mock.calls.length}`, status: "processing" } });
        }
        return Response.json({ data: { status: "processing" } });
      });
      expect(await tick()).toMatchObject({ status: 200, body: { processed: 4, succeeded: 4, orphan_links_healed: 1 } });
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(4);
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE order_code='ORPHAN'").get())
        .toMatchObject({ status: "pending", attempt_count: 0 });
    } finally { fx.close(); }
  });

  it("reports insufficient admission budget without claiming or sending an order", async () => {
    const fx = setup();
    try {
      seedOrder(fx, "DUE", "pending");
      const fetch = supplier();
      const budget = createBudgetedDatabase(7, 2, fx.db);
      await expect(processSkPendingOrders(budget.access, { skipOrphanProbe: true })).rejects.toBeInstanceOf(QueryBudgetExceeded);
      expect(fetch).not.toHaveBeenCalled();
      expect(fx.sql.prepare("SELECT status,attempt_count FROM sk_order_links WHERE order_code='DUE'").get())
        .toMatchObject({ status: "pending", attempt_count: 0 });
    } finally { fx.close(); }
  });

  it("automatically delivers credentials after dispatch and deduplicates a repeated completion webhook", async () => {
    const fx = setup();
    try {
      vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      vi.stubEnv("RESEND_API_KEY", "fixture-email-key");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@example.com");
      vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", "fixture-secret");
      seedOrder(fx, "BUYER", "pending");
      fx.sql.exec(`UPDATE orders SET customer_email='buyer@example.com' WHERE code='BUYER';
        INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
          VALUES('BUYER',0,1,1,1,'manual','web','queued')`);
      const fetch = supplier();
      fetch.mockImplementation(async (url, init) => {
        if (String(url).includes("api.resend.com")) return Response.json({ id: "EMAIL-1" });
        if (init?.method === "POST") return Response.json({ data: { invoice: "SK-NEW", status: "processing" } });
        return Response.json({ data: { invoice: "SK-NEW", status: "processing" } });
      });
      expect(await tick()).toMatchObject({ status: 200, body: { processed: 1, succeeded: 1 } });
      const { POST } = await import("@/app/api/webhook/sekalipay/route");
      const { NextRequest } = await import("next/server");
      const { computeSkSignature } = await import("@/lib/sekalipay/client");
      const payload = { event: "order.completed", data: { invoice: "SK-NEW", ref_id: "sk:BUYER:689:1", status: "completed",
        items: [{ product_name: "Disney", variant_name: "2 User", product_license: "Email: fixture@example.com\nPassword: fixture-pass" }] } };
      const signature = await computeSkSignature(payload.data.ref_id, "SK-NEW", "completed", "fixture-secret");
      for (let i = 0; i < 2; i++) {
        const response = await POST(new NextRequest("http://localhost/api/webhook/sekalipay", {
          method: "POST", headers: { "content-type": "application/json", "x-signature": signature }, body: JSON.stringify(payload),
        }));
        expect(response.status).toBe(200);
      }
      expect(fx.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='BUYER'").get()?.fulfillment_status).toBe("delivered");
      expect(fx.sql.prepare("SELECT status FROM buyer_notice_log WHERE idempotency_key LIKE 'email:sk-credential:BUYER:%'").get()?.status).toBe("sent");
      expect(fetch.mock.calls.filter(([url]) => String(url).includes("api.resend.com"))).toHaveLength(1);
      expect(fetch.mock.calls.filter(([url, init]) => !String(url).includes("api.resend.com") && init?.method === "POST")).toHaveLength(1);
    } finally { fx.close(); }
  });
});
