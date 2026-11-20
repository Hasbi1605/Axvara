// Audit X23-8 (cost): publish-scheduled runs every 5 minutes, so its expiry
// candidate query must not read every pending order. The range + matching
// ORDER BY are served by idx_orders_expires_dt (status, datetime(expires_at)).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { EXPIRED_ORDER_CANDIDATES_SQL } from "@/app/api/cron/publish-scheduled/route";

let f: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  f = createD1Fixture();
  f.sql.exec(`
    INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at) VALUES
      ('EXPIRED-ISO','B','6280','[]',1,'qris','pending','unpaid','web',datetime('now','-5 minutes')),
      ('FUTURE-ISO','B','6280','[]',1,'qris','pending','unpaid','web',datetime('now','+10 minutes')),
      ('EXPIRED-LEGACY','B','6280','[]',1,'qris','pending','unpaid','web','2000-01-01 00:00:00'),
      ('PAID-OLD','B','6280','[]',1,'qris','lunas','paid','web',datetime('now','-5 minutes'));
  `);
});
afterEach(() => f.close());

describe("publish-scheduled expiry candidates", () => {
  it("uses the (status, datetime(expires_at)) index for the range and the order", () => {
    const details = f.sql.prepare(`EXPLAIN QUERY PLAN ${EXPIRED_ORDER_CANDIDATES_SQL}`)
      .all().map((row) => String(row.detail)).join(" | ");
    expect(details).toMatch(/SEARCH orders USING INDEX idx_orders_expires_dt/);
    expect(details).not.toMatch(/SCAN orders/);
    expect(details).not.toMatch(/TEMP B-TREE FOR ORDER BY/);
  });

  it("returns only pending orders that are already expired", () => {
    const codes = f.sql.prepare(EXPIRED_ORDER_CANDIDATES_SQL).all().map((row) => String(row.code));
    expect(codes).toContain("EXPIRED-ISO");
    expect(codes).toContain("EXPIRED-LEGACY");
    expect(codes).not.toContain("FUTURE-ISO");
    expect(codes).not.toContain("PAID-OLD");
  });

  it("keeps the filter in the shipped SQL (reverting it would read future rows)", () => {
    expect(EXPIRED_ORDER_CANDIDATES_SQL).toContain("datetime(expires_at) <= datetime('now')");
    expect(EXPIRED_ORDER_CANDIDATES_SQL).toContain("ORDER BY datetime(expires_at) ASC");
    expect(EXPIRED_ORDER_CANDIDATES_SQL).not.toContain("ORDER BY expires_at ASC");
  });
});
