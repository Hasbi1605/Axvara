import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "../helpers/d1-fixture";
import { POST } from "@/app/api/admin/sekalipay/orders/[id]/retry/route";
import { processSkPendingOrders } from "@/lib/sekalipay/order";
import { requireAdmin } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@test" })) }));
vi.mock("@/lib/sekalipay/order", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/sekalipay/order")>(),
  processSkPendingOrders: vi.fn(async () => undefined),
}));

let f: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  f = createD1Fixture();
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.mocked(requireAdmin).mockResolvedValue({ email: "fixture@test" } as Awaited<ReturnType<typeof requireAdmin>>);
  vi.mocked(processSkPendingOrders).mockClear();
  f.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status)
    VALUES('SK-RETRY','Fixture','628','[]',10000,'qris','lunas','paid');
    INSERT INTO sk_order_links(id,order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts)
    VALUES(1,'SK-RETRY','fixture',1,5000,'failed',1,3);`);
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); });
const call = (id = "1") => POST(new NextRequest(`https://fixture.test/api/admin/sekalipay/orders/${id}/retry`, { method: "POST" }), { params: Promise.resolve({ id }) });
const row = () => f.sql.prepare("SELECT * FROM sk_order_links WHERE id=1").get();

describe("SK admin retry: pre-send only, CAS, no fence erasure", () => {
  it.each([
    ["invoice", "UPDATE sk_order_links SET sk_invoice='SK-KNOWN'"],
    ["ambiguous sent", "UPDATE sk_order_links SET request_sent_at=datetime('now')"],
    ["void link", "UPDATE sk_order_links SET last_error='cancelled_by_admin'"],
    ["void link detail", "UPDATE sk_order_links SET last_error='cancelled_by_admin: fixture'"],
    ["cancelled order", "UPDATE orders SET status='dibatalkan',payment_status='failed'"],
    ["refunded order", "UPDATE orders SET payment_status='refunded'"],
    ["unpaid order", "UPDATE orders SET status='pending',payment_status='pending'"],
    ["completed link", "UPDATE sk_order_links SET status='completed'"],
  ])("rejects %s without writes or dispatch", async (_name, sql) => {
    f.sql.exec(sql);
    const before = row();
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(row()).toEqual(before);
    expect(processSkPendingOrders).not.toHaveBeenCalled();
  });

  it.each(["pending", "retry", "failed", "blocked_balance"])("allows %s with no receipt/fence and a paid order", async status => {
    f.sql.prepare("UPDATE sk_order_links SET status=?").run(status);
    expect((await call()).status).toBe(200);
    expect(row()).toMatchObject({ status: "retry", request_sent_at: null, attempt_count: status === "failed" ? 0 : 1 });
    expect(processSkPendingOrders).toHaveBeenCalledWith(undefined, { skipOrphanProbe: true });
  });

  it("revives exhausted failed pre-send attempts, but not exhausted pending", async () => {
    f.sql.exec("UPDATE sk_order_links SET status='pending',attempt_count=3");
    expect((await call()).status).toBe(409);
    f.sql.exec("UPDATE sk_order_links SET status='failed'");
    expect((await call()).status).toBe(200);
    expect(row()).toMatchObject({ status: "retry", attempt_count: 0 });
  });

  it.each([
    ["invoice", "UPDATE sk_order_links SET sk_invoice='SK-RACE'"],
    ["sent", "UPDATE sk_order_links SET request_sent_at=datetime('now')"],
    ["void link", "UPDATE sk_order_links SET last_error='cancelled_by_admin'"],
    ["void order", "UPDATE orders SET status='dibatalkan'"],
    ["worker claim", "UPDATE sk_order_links SET status='claimed',attempt_count=2"],
  ])("CAS rejects a concurrent %s after the read", async (_name, sql) => {
    f.control.beforeRun = async query => {
      if (query.startsWith("UPDATE sk_order_links SET status='retry'")) f.sql.exec(sql);
    };
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "retry_race_lost" });
    expect(processSkPendingOrders).not.toHaveBeenCalled();
    expect(row()?.status).not.toBe("retry");
  });

  it("keeps auth, enabled, id and not-found guards", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    vi.stubEnv("SEKALIPAY_ENABLED", "false");
    expect((await call()).status).toBe(503);
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    expect((await call("abc")).status).toBe(400);
    expect((await call("999")).status).toBe(404);
  });
});
