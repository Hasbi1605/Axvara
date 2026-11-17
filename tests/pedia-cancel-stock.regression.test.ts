// tests/pedia-cancel-stock.regression.test.ts — Pedia tidak pernah mereservasi stok
// Market; cancel/expiry Pedia (buyer, admin, cron, webhook) TIDAK boleh menambah
// products/product_variants dari orders.items (product_id = pedia_products id).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { incrementSoldCountForOrder, transitionPendingOrder } from "@/lib/db/orders-transition";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); });

const A = "AXV-20261107-STOCK001";
const P = "AXP-20261107-STOCK001";
// Satu item tanpa varian (restock products) + satu item bervarian (restock product_variants),
// keduanya memakai id numerik 1 seperti kasus nyata Pedia (pedia_products id 1).
const ITEMS = [{ product_id: 1, qty: 2 }, { product_id: 1, variant_id: 1, qty: 2 }];

async function seed(orderKind: "apps" | "pedia" | "games", code: string) {
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

describe("cron expiry/stale initializing: isolasi stok Market", () => {
  for (const kind of ["apps", "pedia", "games"] as const) {
    it.each(["pending", "initializing"] as const)(`${kind} %s: transisi ledger tanpa restock lintas katalog`, async (transactionStatus) => {
      const code = `${kind}-stock-${transactionStatus}`;
      const f = await seed(kind, code);
      f.sql.exec("UPDATE products SET sold_count=7; UPDATE orders SET expires_at=datetime('now','-1 minute')");
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,status,requested_amount,payable_amount,expires_at,created_at)
        VALUES(?,'gopay','static',?,'fixture',?,10000,10001,datetime('now','-1 minute'),datetime('now','-10 minutes'))`)
        .run(code, code, transactionStatus);
      vi.stubEnv("CRON_SECRET", "fixture");
      const { POST } = await import("@/app/api/cron/lite/route");
      const { NextRequest } = await import("next/server");
      const call = () => POST(new NextRequest("https://fixture.test/api/cron/lite?job=expiry", {
        method: "POST", headers: { authorization: "Bearer fixture" },
      }));
      const response = await call();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(transactionStatus === "pending" ? { expired_payments: 1 } : { stale_initializing: 1 });
      expect(status(f, code)).toMatchObject(transactionStatus === "pending"
        ? { status: "kadaluarsa", payment_status: "expired" }
        : { status: "dibatalkan", payment_status: "failed" });
      expect(f.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get(code)?.status)
        .toBe(transactionStatus === "pending" ? "expired" : "failed");
      const stock = kind === "apps" ? 52 : 50;
      expect(stocks(f)).toEqual({ product: stock, variant: stock });
      expect(f.sql.prepare("SELECT sold_count FROM products WHERE id=1").get()?.sold_count).toBe(7);
      expect((await call()).status).toBe(200);
      expect(stocks(f)).toEqual({ product: stock, variant: stock });
    });
  }

  it.each(["pedia", "games"] as const)("%s tidak menambah sold_count Market lewat helper bersama", async kind => {
    const f = await seed(kind, `${kind}-sold`);
    await incrementSoldCountForOrder(`${kind}-sold`, f.db);
    expect(f.sql.prepare("SELECT sold_count FROM products WHERE id=1").get()?.sold_count).toBe(0);
  });

  it("Games dengan items=[] aktual tetap expiry tanpa mutasi stok", async () => {
    const f = await seed("games", "games-empty");
    f.sql.exec("UPDATE orders SET items='[]'");
    const { transitionPendingPaymentOrder } = await import("@/lib/db/orders-transition");
    f.sql.exec(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,status,requested_amount,payable_amount)
      VALUES('games-empty','gopay','static','games-empty','fixture','pending',10000,10001)`);
    expect(await transitionPendingPaymentOrder({ orderCode: "games-empty", expectedTransactionStatus: "pending", transactionStatus: "expired", orderStatus: "kadaluarsa", paymentStatus: "expired", items: [] }, f.db)).toBe(true);
    expect(stocks(f)).toEqual({ product: 50, variant: 50 });
  });
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
