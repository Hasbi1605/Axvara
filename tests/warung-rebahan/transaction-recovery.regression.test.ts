import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { processWrPendingOrders, reconcileFreshWrLinks } from "@/lib/warung-rebahan/order";
import { seedWrCatalog, seedWrFulfillmentItem, seedWrOrder, setupWrFixture } from "./helpers";

const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => auth.allowed ? { email: "admin@example.test" } : null) }));
const code = "AXV-20261027-11223344";
afterEach(() => { auth.allowed = true; vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearRateLimitBucketsForTest(); });

async function setup(status = "submitted", known = false) {
  const fx = await setupWrFixture();
  seedWrCatalog(fx); seedWrOrder(fx, code); seedWrFulfillmentItem(fx, code);
  fx.sql.prepare("UPDATE wr_variants SET wr_type='Private',wr_duration='7 Hari',wr_warranty='7 Hari'").run();
  const id = Number(fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,request_sent_at,wr_order_id)
    VALUES(?,'var-1',1,5000,?,datetime('now','-5 minutes'),?) RETURNING id`).get(code, status, known ? "ORD-SELECTED" : null)!.id);
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true"); vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "fixture-key"); vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "");
  vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "fixture-key"); vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("WHATSAPP_ENABLED", "false"); vi.stubEnv("CRON_SECRET", "fixture-cron");
  const product: Record<string, unknown> = { product_name: "CapCut Pro", variant_name: "Pro 7 Hari", type: "Private", duration: "7 Hari", warranty: "7 Hari", price: 5000, quantity: 1 };
  const tx = { order_id: "ORD-SELECTED", status: "completed", payment_status: "paid", total_amount: 5000,
    products: [product], account_details: [{ email: "private@example.test", password: "secret" }], created_at: "2026-10-27 10:00:01" };
  const fetcher = vi.fn(async () => Response.json({ success: true, data: [tx] }));
  vi.stubGlobal("fetch", fetcher);
  const state = () => fx.sql.prepare("SELECT * FROM wr_order_links WHERE id=?").get(id)!;
  const call = async (body: string | undefined = JSON.stringify({ wr_order_id: "ORD-SELECTED" })) => {
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/sync-now/route");
    return POST(new NextRequest(`http://localhost/api/admin/warung/orders/${id}/sync-now`, { method: "POST", body }), { params: Promise.resolve({ id: String(id) }) });
  };
  return { ...fx, id, tx, product, fetcher, state, call };
}

describe("explicit human-selected WR invoice", () => {
  it.each(["submitted", "ordering", "claimed"])("binds %s from documented unzoned metadata, queues credentials, and replays safely", async (status) => {
    const fx = await setup(status);
    try {
      expect((await fx.call()).status).toBe(200);
      expect(fx.state()).toMatchObject({ status: "completed", wr_order_id: "ORD-SELECTED", wr_account_details: expect.any(String), delivery_status: "queued" });
      expect(fx.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get()).toMatchObject({ status: "delivered", delivered_ciphertext: expect.any(String) });
      expect(fx.fetcher).toHaveBeenCalledTimes(1);
      expect((await fx.call()).status).toBe(200);
      expect(fx.fetcher).toHaveBeenCalledTimes(2);
      await processWrPendingOrders(createDatabaseAccess(fx.db), { skipOrphanProbe: true });
      expect(fx.fetcher).toHaveBeenCalledTimes(2);
    } finally { fx.close(); }
  });

  it("accepts exact variant identity without metadata guessing", async () => {
    const fx = await setup();
    try {
      fx.tx.products = [{ variant_id: "var-1", quantity: 1, price: 5000 }];
      expect((await fx.call()).status).toBe(200);
    } finally { fx.close(); }
  });

  it("binds the full quantity and cost snapshot, not a single unit total", async () => {
    const fx = await setup();
    try {
      fx.sql.prepare("UPDATE wr_order_links SET quantity=2,wr_cost=10000 WHERE id=?").run(fx.id);
      fx.product.quantity = 2; fx.tx.total_amount = 10000;
      expect((await fx.call()).status).toBe(200);
      expect(fx.state()).toMatchObject({ quantity: 2, wr_cost: 10000, status: "completed" });
    } finally { fx.close(); }
  });

  it("auth runs before reading body, DB or supplier", async () => {
    const fx = await setup();
    try { auth.allowed = false; expect((await fx.call("x".repeat(2000))).status).toBe(401); expect(fx.fetcher).not.toHaveBeenCalled(); }
    finally { fx.close(); }
  });

  it.each(["{", "null", "[]", "{}", '{"wr_order_id":42}', '{"wr_order_id":"has space"}', '{"wr_order_id":"a","extra":true}', JSON.stringify({ wr_order_id: "a".repeat(121) })])("rejects invalid body %s", async (body) => {
    const fx = await setup();
    try { expect((await fx.call(body)).status).toBe(400); expect(fx.fetcher).not.toHaveBeenCalled(); expect(fx.state().wr_order_id).toBeNull(); }
    finally { fx.close(); }
  });

  it("bounds actual body bytes and requires a selection for a missing ID", async () => {
    const fx = await setup();
    try {
      expect((await fx.call(JSON.stringify({ wr_order_id: "a".repeat(1100) }))).status).toBe(413);
      expect((await fx.call("")).status).toBe(409);
      expect(fx.fetcher).not.toHaveBeenCalled();
    } finally { fx.close(); }
  });

  it.each(["missing", "duplicate", "unpaid", "unknown-status", "total", "qty", "price", "variant", "name", "type", "duration", "warranty", "mirror", "duplicate-name"])("rejects %s evidence", async (failure) => {
    const fx = await setup();
    try {
      if (failure === "missing") fx.tx.order_id = "OTHER";
      if (failure === "duplicate") fx.fetcher.mockImplementation(async () => Response.json({ success: true, data: [fx.tx, fx.tx] }));
      if (failure === "unpaid") fx.tx.payment_status = "unpaid";
      if (failure === "unknown-status") fx.tx.status = "not_completed";
      if (failure === "total") fx.tx.total_amount = 5001;
      if (failure === "qty") fx.product.quantity = 2;
      if (failure === "price") fx.product.price = 4999;
      if (failure === "variant") fx.product.variant_id = "other";
      if (failure === "name") fx.product.variant_name = "Other";
      if (["type", "duration", "warranty"].includes(failure)) delete fx.product[failure];
      if (failure === "mirror") fx.sql.prepare("UPDATE wr_variants SET wr_price=6000").run();
      if (failure === "duplicate-name") fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price) VALUES('duplicate','prod-capcut','Pro 7 Hari',5000)").run();
      expect((await fx.call()).status).toBe(409);
      expect(fx.state().wr_order_id).toBeNull();
    } finally { fx.close(); }
  });

  it.each(["invoice", "status", "request", "variant", "quantity", "cost", "payment", "mirror"])("CAS rejects concurrent %s mutation", async (race) => {
    const fx = await setup();
    try {
      fx.control.beforeRun = async (query) => {
        if (!query.includes("SET wr_order_id=?,status='processing'")) return;
        fx.control.beforeRun = null;
        if (race === "invoice") fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,wr_order_id) VALUES(?,'other',1,5000,'completed','ORD-SELECTED')`).run(code);
        if (race === "status") fx.sql.prepare("UPDATE wr_order_links SET status='failed' WHERE id=?").run(fx.id);
        if (race === "request") fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=NULL WHERE id=?").run(fx.id);
        if (race === "variant") fx.sql.prepare("UPDATE wr_order_links SET wr_variant_id='other' WHERE id=?").run(fx.id);
        if (race === "quantity") fx.sql.prepare("UPDATE wr_order_links SET quantity=2 WHERE id=?").run(fx.id);
        if (race === "cost") fx.sql.prepare("UPDATE wr_order_links SET wr_cost=6000 WHERE id=?").run(fx.id);
        if (race === "payment") fx.sql.prepare("UPDATE orders SET payment_status='unpaid' WHERE code=?").run(code);
        if (race === "mirror") fx.sql.prepare("UPDATE wr_variants SET wr_type='Sharing'").run();
      };
      expect((await fx.call()).status).toBe(409); expect(fx.state().wr_order_id).toBeNull();
    } finally { fx.close(); }
  });

  it("rejects rebind, unpaid orders, and unsent claimed links", async () => {
    const fx = await setup("claimed");
    try {
      fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=NULL WHERE id=?").run(fx.id);
      expect((await fx.call()).status).toBe(409);
      fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=datetime('now'),wr_order_id='OTHER' WHERE id=?").run(fx.id);
      expect((await fx.call()).status).toBe(409);
      fx.sql.prepare("UPDATE wr_order_links SET wr_order_id=NULL WHERE id=?").run(fx.id);
      fx.sql.prepare("UPDATE orders SET payment_status='unpaid'").run();
      expect((await fx.call()).status).toBe(409);
    } finally { fx.close(); }
  });

  it("two simultaneous assignments cannot steal an invoice", async () => {
    const fx = await setup();
    try {
      const results = await Promise.all([fx.call(), fx.call()]);
      expect(results.some((result) => result.status === 200)).toBe(true);
      expect(results.every((result) => [200, 409].includes(result.status))).toBe(true);
      expect(fx.state().wr_order_id).toBe("ORD-SELECTED");
    } finally { fx.close(); }
  });

  it("different links cannot claim the same human-selected invoice", async () => {
    const fx = await setup();
    try {
      const secondId = Number(fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,request_sent_at)
        VALUES(?,'var-1',1,5000,'submitted',datetime('now')) RETURNING id`).get(code)!.id);
      const { POST } = await import("@/app/api/admin/warung/orders/[id]/sync-now/route");
      const results = await Promise.all([fx.call(), POST(new NextRequest("http://localhost/api/admin/warung/orders/2/sync-now", {
        method: "POST", body: JSON.stringify({ wr_order_id: "ORD-SELECTED" }),
      }), { params: Promise.resolve({ id: String(secondId) }) })]);
      expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM wr_order_links WHERE wr_order_id='ORD-SELECTED'").get()!.n).toBe(1);
    } finally { fx.close(); }
  });

  it("streamed oversized JSON is rejected despite a false Content-Length", async () => {
    const fx = await setup();
    try {
      const { POST } = await import("@/app/api/admin/warung/orders/[id]/sync-now/route");
      const response = await POST(new NextRequest("http://localhost/api/admin/warung/orders/1/sync-now", {
        method: "POST", headers: { "content-length": "1" }, body: " ".repeat(1001),
      }), { params: Promise.resolve({ id: String(fx.id) }) });
      expect(response.status).toBe(413); expect(fx.fetcher).not.toHaveBeenCalled();
    } finally { fx.close(); }
  });
});

describe("read-only reconciliation and cron budget", () => {
  it.each(["2026-10-27 10:00:01", "2026-10-27T10:00:01+07:00"])("never auto-binds unrelated same-variant supplier traffic at %s", async (time) => {
    const fx = await setup();
    try {
      fx.tx.created_at = time;
      expect(await reconcileFreshWrLinks([{ id: fx.id, order_code: code, wr_order_id: "" }], createDatabaseAccess(fx.db))).toBe(0);
      expect(fx.state()).toMatchObject({ status: "submitted", wr_order_id: null });
      expect(fx.fetcher).not.toHaveBeenCalled();
    } finally { fx.close(); }
  });

  it.each(["query", "path", "lookup"])("public %s route keeps missing-ID links running and never selects a supplier invoice", async (route) => {
    const fx = await setup();
    try {
      fx.sql.prepare("UPDATE orders SET customer_wa='6281234567890'").run();
      let response: Response;
      if (route === "query") {
        const { GET } = await import("@/app/api/orders/route"); response = await GET(new NextRequest(`http://localhost/api/orders?code=${code}`));
      } else if (route === "path") {
        const { GET } = await import("@/app/api/orders/[code]/route"); response = await GET(new NextRequest("http://localhost/api/orders"), { params: Promise.resolve({ code }) });
      } else {
        const { POST } = await import("@/app/api/orders/lookup/route"); response = await POST(new NextRequest("http://localhost/api/orders/lookup", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, wa: "6281234567890" }),
        }));
      }
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ order: { supplier_running: true, credentials_ready: false } });
      expect(fx.state().wr_order_id).toBeNull(); expect(fx.fetcher).not.toHaveBeenCalled();
    } finally { fx.close(); }
  });

  it.each([false, true])("actual 40-statement cron handles known-ID=%s without the 29-statement starvation", async (known) => {
    const fx = await setup("submitted", known);
    try {
      const { POST } = await import("@/app/api/cron/lite/route");
      const response = await POST(new NextRequest("http://localhost/api/cron/lite?job=wr_orders", { method: "POST", headers: { authorization: "Bearer fixture-cron" } }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.budget_exhausted).toBeUndefined();
      expect(fx.state()).toMatchObject({ status: known ? "completed" : "submitted", wr_order_id: known ? "ORD-SELECTED" : null });
      expect(fx.fetcher.mock.calls.length).toBeLessThanOrEqual(2);
      if (!known) expect(fx.fetcher).not.toHaveBeenCalled();
      expect(fx.control.queries).toBeLessThanOrEqual(38);
    } finally { fx.close(); }
  });

  it.each(["failed", "cancelled", "refunded"])("known-ID %s settles an unbound item within the 12-statement failure budget", async (status) => {
    const fx = await setup("processing", true);
    try {
      fx.tx.status = status;
      const budget = createBudgetedDatabase(40, 2, fx.db);
      for (let i = 0; i < 25; i++) await budget.access.queryFirst("SELECT 1");
      expect(await reconcileFreshWrLinks([{ id: fx.id, order_code: code, wr_order_id: "ORD-SELECTED" }], budget.access)).toBe(1);
      expect(fx.state()).toMatchObject({ status: "failed", wr_account_details: null });
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()!.status).toBe("failed");
      expect(fx.sql.prepare("SELECT fulfillment_status,payment_status FROM orders").get()).toMatchObject({ fulfillment_status: "failed", payment_status: "paid" });
      expect(budget.used).toBeLessThanOrEqual(38);
    } finally { fx.close(); }
  });

  it("never purchases again when a pending link already has an invoice but no request timestamp", async () => {
    const fx = await setup("pending", true);
    try {
      fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=NULL WHERE id=?").run(fx.id);
      expect((await processWrPendingOrders(createDatabaseAccess(fx.db), { skipOrphanProbe: true })).succeeded).toBe(0);
      expect(fx.fetcher).not.toHaveBeenCalled();
      expect(fx.state().wr_order_id).toBe("ORD-SELECTED");
    } finally { fx.close(); }
  });

  it("a refunded supplier invoice preserves an item already handed over manually", async () => {
    const fx = await setup();
    try {
      fx.tx.status = "refunded";
      fx.sql.prepare("UPDATE fulfillment_items SET status='delivered',last_error='manual_handover:admin',delivered_ciphertext='manual-content'").run();
      expect((await fx.call()).status).toBe(200);
      expect(fx.sql.prepare("SELECT status,last_error,delivered_ciphertext FROM fulfillment_items").get()).toMatchObject({ status: "delivered", last_error: "manual_handover:admin", delivered_ciphertext: "manual-content" });
    } finally { fx.close(); }
  });

  it.each(["failed", "refunded"])("manual binding of %s also settles a previously unbound fulfillment item", async (status) => {
    const fx = await setup();
    try {
      fx.tx.status = status;
      expect((await fx.call()).status).toBe(200);
      expect(fx.state().status).toBe("failed");
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()!.status).toBe("failed");
    } finally { fx.close(); }
  });

  it("does not partially complete when fewer than 24 statements remain after loading the known link", async () => {
    const fx = await setup("processing", true);
    try {
      const budget = createBudgetedDatabase(40, 2, fx.db);
      for (let i = 0; i < 14; i++) await budget.access.queryFirst("SELECT 1");
      expect(await reconcileFreshWrLinks([{ id: fx.id, order_code: code, wr_order_id: "ORD-SELECTED" }], budget.access)).toBe(0);
      expect(fx.state()).toMatchObject({ status: "processing", wr_account_details: null });
    } finally { fx.close(); }
  });

  it("known ID progresses with only 28 statements left", async () => {
    const fx = await setup("processing", true);
    try {
      const budget = createBudgetedDatabase(40, 2, fx.db);
      for (let i = 0; i < 10; i++) await budget.access.queryFirst("SELECT 1");
      expect(budget.remaining).toBe(28);
      expect(await reconcileFreshWrLinks([{ id: fx.id, order_code: code, wr_order_id: "ORD-SELECTED" }], budget.access)).toBe(1);
      expect(budget.used).toBeLessThanOrEqual(38);
      expect(fx.state().delivery_status).toBe("queued");
    } finally { fx.close(); }
  });

  it.each(["success", "timeout", "rejection"])("late purchase %s does not regress terminal state or report success", async (outcome) => {
    const fx = await setup("pending");
    try {
      fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=NULL WHERE id=?").run(fx.id);
      fx.fetcher.mockImplementation(async () => {
        fx.sql.prepare("UPDATE wr_order_links SET wr_order_id='ORD-SELECTED',status='completed'").run();
        if (outcome === "timeout") throw new Error("network timeout");
        return outcome === "rejection" ? Response.json({ success: false, message: "Saldo tidak mencukupi" }, { status: 402 })
          : Response.json({ success: true, data: { order_id: "ORD-SELECTED", current_balance: 10000 } });
      });
      expect((await processWrPendingOrders(createDatabaseAccess(fx.db), { skipOrphanProbe: true })).succeeded).toBe(0);
      expect(fx.state()).toMatchObject({ status: "completed", wr_order_id: "ORD-SELECTED", request_sent_at: expect.any(String) });
    } finally { fx.close(); }
  });
});

describe("unmatched WR terminal webhooks", () => {
  it.each(["order.completed", "order.account_updated", "order.failed", "order.refunded"])("%s retries without exposing payload", async (event) => {
    const fx = await setup();
    try {
      const body = JSON.stringify({ event, data: { order_id: "ORD-SELECTED", accounts: [{ password: "private" }] } });
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("hex");
      const { POST } = await import("@/app/api/webhook/warung/route");
      const response = await POST(new NextRequest("http://localhost/api/webhook/warung", { method: "POST", body, headers: { "content-type": "application/json", "x-digitals-signature": signature } }));
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "retryable" });
      expect(fx.state().wr_order_id).toBeNull();
    } finally { fx.close(); }
  });
});
