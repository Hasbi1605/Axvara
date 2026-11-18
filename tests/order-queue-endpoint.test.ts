import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/queue/fulfill/route";
import { createD1Fixture } from "./helpers/d1-fixture";
const execute = vi.hoisted(() => vi.fn<(code: string, kind: string, deadline: number) => Promise<void>>(async () => undefined));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ fulfillPaidOrder: execute }));
let f: ReturnType<typeof createD1Fixture>;
const code = "AXV-20261118-QUEUE001";
const msg = { v: 1, kind: "order_paid", orderCode: code, orderKind: "apps", source: "klikqris", attempt: 1, dryRun: false };
function post(body: unknown = msg, token = "fixture-cron") {
  return POST(new NextRequest("https://fixture.test/api/internal/queue/fulfill", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
}
function order(kind = "apps", paid = true) {
  f.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,payment_account,status,payment_status,order_kind,sales_channel)
    VALUES(?,'fixture','628123456789','[]',10000,'qris','fixture',?,?,?,'web')`).run(code, paid ? "lunas" : "pending", paid ? "paid" : "pending", kind);
}
function link(status: string, lease: string | null = null, sent: string | null = null) {
  f.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,idempotency_key,status,lease_expires_at,request_sent_at)
    VALUES(?,?,1,100,?,?,?,?)`).run(code, crypto.randomUUID(), crypto.randomUUID(), status, lease, sent);
}
beforeEach(() => { f = createD1Fixture(); vi.stubEnv("CRON_SECRET", "fixture-cron"); execute.mockReset().mockResolvedValue(undefined); });
afterEach(() => { f.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("queue origin contract", () => {
  it("fails closed on missing/wrong auth before reading D1", async () => {
    expect((await post(msg, "wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", ""); expect((await post()).status).toBe(401);
    expect(f.control.queries).toBe(0); expect(execute).not.toHaveBeenCalled();
  });
  for (const change of [{ v: 2 }, { extra: 1 }, { orderCode: "../../admin" }, { kind: "bad" }, { orderKind: "bad" }, { source: "buyer@example.com" }, { attempt: 0 }, { dryRun: "false" }]) {
    it(`rejects strict malformed schema ${JSON.stringify(change)}`, async () => {
      expect((await post({ ...msg, ...change })).status).toBe(400);
      expect(f.control.queries).toBe(0); expect(execute).not.toHaveBeenCalled();
    });
  }
  it("not-paid is acknowledged, never dispatched", async () => {
    order("apps", false);
    expect(await (await post()).json()).toEqual({ ok: true, settled: true, state: "not_paid" });
    expect(execute).not.toHaveBeenCalled();
  });
  it("shadow performs just one paid status read, no side effects", async () => {
    order(); const before = f.control.queries;
    expect(await (await post({ ...msg, dryRun: true })).json()).toEqual({ ok: true, settled: true, state: "dry_run_ok" });
    expect(f.control.queries - before).toBe(1); expect(execute).not.toHaveBeenCalled();
  });
  it("refuses an order-kind mismatch", async () => {
    order("games"); expect((await post()).status).toBe(400); expect(execute).not.toHaveBeenCalled();
  });
  for (const kind of ["order_paid", "supplier_settled"]) {
    it(`${kind} done uses the same executor and a 40s deadline`, async () => {
      order(); link("completed"); const now = Date.now();
      expect(await (await post({ ...msg, kind })).json()).toEqual({ ok: true, settled: true, state: "done" });
      expect(execute).toHaveBeenCalledExactlyOnceWith(code, "apps", expect.any(Number));
      const deadline = execute.mock.calls[0][2]; expect(deadline).toBeGreaterThanOrEqual(now + 40_000);
    });
  }
  it("supplier in-flight is async, not a transport failure", async () => {
    order(); link("processing", null, new Date().toISOString());
    expect(await (await post()).json()).toEqual({ ok: true, settled: true, state: "async_polling" });
  });
  it("admin-required work is acknowledged", async () => {
    order(); link("failed");
    expect(await (await post()).json()).toEqual({ ok: true, settled: true, state: "manual_required" });
  });
  it("busy lease retry is at least its remaining 120 seconds", async () => {
    order(); link("claimed", new Date(Date.now() + 120_000).toISOString());
    const result = await (await post()).json(); expect(result.settled).toBe(false); expect(result.retrySec).toBeGreaterThanOrEqual(120);
  });
  it.each(["pedia", "games"])("%s: async/manual/300s busy lease are not a false all-done", async kind => {
    order(kind);
    if (kind === "pedia") f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name) VALUES(1,'fixture','instagram','followers','profile','Fixture');
      INSERT INTO pedia_tiers(id,product_id,supplier_service_id,price_group,markup_pct,min_profit_rp) VALUES(1,1,1,'G3',20,100);`);
    else f.sql.exec("INSERT INTO games_products(id,buyer_sku_code,product_name,cost,sell_price) VALUES(1,'fixture','Fixture',100,100)");
    if (kind === "pedia") f.sql.prepare(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status)
      VALUES(?,1,1,'{}','fixture','fixture',1,100,100,'indosmm',1,100,'submitted')`).run(code);
    else f.sql.prepare(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price,status)
      VALUES(?,1,'fixture','fixture',100,100,100,100,'pending')`).run(code);
    expect(await (await post({ ...msg, orderKind: kind })).json()).toMatchObject({ settled: true, state: "async_polling" });
    const table = kind === "pedia" ? "pedia_order_items" : "games_order_items";
    f.sql.prepare(`UPDATE ${table} SET lease_until=? WHERE order_code=?`).run(new Date(Date.now() + 300000).toISOString(), code);
    expect(await (await post({ ...msg, orderKind: kind })).json()).toMatchObject({ settled: true, state: "async_polling" });
    f.sql.prepare(`UPDATE ${table} SET status='submitting',lease_until=? WHERE order_code=?`).run(new Date(Date.now() + 300000).toISOString(), code);
    const busy = await (await post({ ...msg, orderKind: kind })).json();
    expect(busy.settled).toBe(false); expect(busy.retrySec).toBeGreaterThanOrEqual(300);
    f.sql.prepare(`UPDATE ${table} SET status='needs_check',lease_until=NULL WHERE order_code=?`).run(code);
    expect(await (await post({ ...msg, orderKind: kind })).json()).toMatchObject({ settled: true, state: "manual_required" });
  });
  it("a mixed multi-link pass never calls the first completed link all-done", async () => {
    order(); link("completed"); link("pending");
    expect(await (await post()).json()).toMatchObject({ ok: true, settled: false, retrySec: 60 });
  });
  it("missing materialized lines require another pass", async () => {
    order(); f.sql.prepare("UPDATE orders SET items=? WHERE code=?").run('[{"product_id":1,"qty":1}]', code);
    expect(await (await post()).json()).toMatchObject({ settled: false });
  });
  it("a transport/DB error is retryable without leaking exception content", async () => {
    order(); execute.mockRejectedValueOnce(new Error("private credential"));
    const response = await post(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
  });
});
