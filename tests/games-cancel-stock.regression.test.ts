import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { transitionPendingOrder } from "@/lib/db";

let fixture: ReturnType<typeof createD1Fixture>;
afterEach(() => { fixture?.close(); vi.unstubAllEnvs(); });

// Game product/variant IDs can collide with Market IDs; neither was reserved.
const ITEMS = [{ product_id: 1, qty: 2 }, { product_id: 1, variant_id: 1, qty: 2 }];

describe("Games cancel/expiry never restocks Market", () => {
  it.each(["dibatalkan", "kadaluarsa"] as const)("%s preserves colliding product AND variant stock", async status => {
    fixture = createD1Fixture();
    stubFulfillmentKey();
    await insertTestProduct(fixture.sql);
    fixture.sql.exec("UPDATE products SET stock=50; UPDATE product_variants SET stock=50");
    const code = "AXG-20261109-STOCK001";
    insertTestOrder(fixture.sql, code, { channel: "web", items: ITEMS });
    fixture.sql.prepare("UPDATE orders SET order_kind='games' WHERE code=?").run(code);
    await transitionPendingOrder(code, status, null, ITEMS);
    expect(fixture.sql.prepare("SELECT stock FROM products WHERE id=1").get()).toEqual({ stock: 50 });
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()).toEqual({ stock: 50 });
    expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(code))
      .toEqual({ status, payment_status: status === "kadaluarsa" ? "expired" : "failed" });
    await expect(transitionPendingOrder(code, status, null, ITEMS)).rejects.toThrow();
  });
});
