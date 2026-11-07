// tests/pedia-cancel-stock.regression.test.ts — Pedia tidak pernah mereservasi stok
// Market; cancel/expiry Pedia (buyer, admin, cron, webhook) TIDAK boleh menambah
// products/product_variants dari orders.items (product_id = pedia_products id).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { transitionPendingOrder } from "@/lib/db";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); });

const A = "AXV-20261107-STOCK001";
const P = "AXP-20261107-STOCK001";
// Satu item tanpa varian (restock products) + satu item bervarian (restock product_variants),
// keduanya memakai id numerik 1 seperti kasus nyata Pedia (pedia_products id 1).
const ITEMS = [{ product_id: 1, qty: 2 }, { product_id: 1, variant_id: 1, qty: 2 }];

async function seed(orderKind: "apps" | "pedia", code: string) {
  const f = createD1Fixture();
  fixtures.push(f);
  stubFulfillmentKey();
  await insertTestProduct(f.sql); // products id 1 + product_variants id 1
  f.sql.exec("UPDATE products SET stock=50; UPDATE product_variants SET stock=50;");
  insertTestOrder(f.sql, code, { channel: "web", items: ITEMS, qty: 2 });
  f.sql.prepare("UPDATE orders SET order_kind=?, expires_at=? WHERE code=?").run(orderKind, new Date(Date.now() + 900000).toISOString(), code);
  return f;
}
const stocks = (f: ReturnType<typeof createD1Fixture>) => ({
  product: (f.sql.prepare("SELECT stock FROM products WHERE id=1").get() as { stock: number }).stock,
  variant: (f.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number }).stock,
});
const status = (f: ReturnType<typeof createD1Fixture>, code: string) =>
  f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(code) as Record<string, unknown>;

describe("transitionPendingOrder: restock hanya untuk order Market", () => {
  it("kontrol Market: cancel mengembalikan stok product + variant", async () => {
    const f = await seed("apps", A);
    await transitionPendingOrder(A, "dibatalkan", null, ITEMS);
    expect(stocks(f)).toEqual({ product: 52, variant: 52 });
    expect(status(f, A)).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
  });

  it("buyer cancel Pedia: status berubah, stok Market TIDAK bertambah", async () => {
    const f = await seed("pedia", P);
    await transitionPendingOrder(P, "dibatalkan", "buyer_cancel", ITEMS);
    expect(stocks(f)).toEqual({ product: 50, variant: 50 });
    expect(status(f, P)).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
  });

  it("expiry/admin Pedia (jalur bersama kadaluarsa): status berubah, stok Market TIDAK bertambah", async () => {
    const f = await seed("pedia", P);
    await transitionPendingOrder(P, "kadaluarsa", "gateway_expired", ITEMS);
    expect(stocks(f)).toEqual({ product: 50, variant: 50 });
    expect(status(f, P)).toMatchObject({ status: "kadaluarsa", payment_status: "expired" });
  });

  it("order_kind default 'apps' (baris Market lama) tetap di-restock", async () => {
    const f = await seed("apps", A);
    expect(f.sql.prepare("SELECT order_kind FROM orders WHERE code=?").get(A)).toEqual({ order_kind: "apps" });
    await transitionPendingOrder(A, "dibatalkan", null, ITEMS);
    expect(stocks(f)).toEqual({ product: 52, variant: 52 });
  });

  it("cancel kedua kalinya ditolak guard (tidak restock dobel)", async () => {
    const f = await seed("apps", A);
    await transitionPendingOrder(A, "dibatalkan", null, ITEMS);
    await expect(transitionPendingOrder(A, "dibatalkan", null, ITEMS)).rejects.toThrow();
    expect(stocks(f)).toEqual({ product: 52, variant: 52 });
  });
});
