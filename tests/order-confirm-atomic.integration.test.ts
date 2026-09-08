import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { transitionPendingOrder } from "@/lib/db";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
    VALUES ('ATOMIC','Buyer','628000000000','[]',10000,'qris','pending','unpaid','web')`).run();
});
afterEach(() => fixture.close());

// R6: manual admin confirmation must flip the order and create the job in
// ONE atomic batch. A crash between the two used to strand a paid order
// with zero job rows — no delivery, ever.
describe("R6 manual confirmation commits order + job atomically", () => {
  it("interruption during confirm leaves the order pending with no job", async () => {
    fixture.control.fail = (q) => q.includes("INSERT OR IGNORE INTO fulfillment_jobs");
    await expect(transitionPendingOrder("ATOMIC", "lunas", null, [{ product_id: 1, variant_id: 1, qty: 1 }]))
      .rejects.toThrow();
    fixture.control.fail = null;
    expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code='ATOMIC'").get())
      .toMatchObject({ status: "pending", payment_status: "unpaid" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='ATOMIC'").get()?.n).toBe(0);
  });

  it("happy path confirms and creates exactly one job in one batch", async () => {
    const before = fixture.control.queries;
    await transitionPendingOrder("ATOMIC", "lunas", null, [{ product_id: 1, variant_id: 1, qty: 1 }]);
    expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code='ATOMIC'").get())
      .toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='ATOMIC'").get()?.n).toBe(1);
    // One batch for the confirm (UPDATE + INSERT) — never two commits.
    expect(fixture.control.queries - before).toBeLessThanOrEqual(4);
  });

  it("double confirm stays idempotent (one job, still lunas)", async () => {
    await transitionPendingOrder("ATOMIC", "lunas", null, [{ product_id: 1, variant_id: 1, qty: 1 }]);
    await expect(transitionPendingOrder("ATOMIC", "lunas", null, [{ product_id: 1, variant_id: 1, qty: 1 }]))
      .rejects.toThrow();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='ATOMIC'").get()?.n).toBe(1);
  });
});
