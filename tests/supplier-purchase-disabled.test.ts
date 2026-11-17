import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  createWrOrderLink,
  createWrOrderLinksForOrder,
  processWrPendingOrders,
  reconcileBlockedBalance,
  reconcileMissingWrLinks,
  recoverJaspayByExactRef,
} from "@/lib/warung-rebahan/order";
import {
  createSkOrderLink,
  createSkOrderLinksForOrder,
  processSkPendingOrders,
  reconcileBlockedSkBalance,
  reconcileMissingSkLinks,
} from "@/lib/sekalipay/order";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("supplier_purchase_disabled=1 uniform gate across WR & SK", () => {
  function seedWr(disabledCode: string, normalCode: string) {
    stubFulfillmentKey();
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "fixture-wr-key");
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
    const fx = createD1Fixture();
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed)
      VALUES (1,'CapCut Pro','capcut-pro',7500,10,'warung_rebahan','prod-capcut',1),
             (2,'Zoom Jaspay','zoom-jaspay',15000,-1,'warung_rebahan','jaspay:zoom',1);
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed)
      VALUES (1,1,'WR-VAR1','Pro 7 Hari',7500,10,'manual','var-1',1),
             (2,2,'WR-JSP1','Zoom 14 Hari',15000,-1,'manual','jaspay:zoom:14d',1);
      INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id)
      VALUES ('prod-capcut','CapCut Pro',1),
             ('jaspay:zoom','Zoom Jaspay',2);
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_max_quantity)
      VALUES ('var-1','prod-capcut','Pro 7 Hari',5000,10,1,7500,'restock','api',NULL),
             ('jaspay:zoom:14d','jaspay:zoom','Zoom 14 Hari',10000,-1,2,15000,'restock','api',5);
    `);
    const items = JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro", price: 7500, qty: 1 }]);
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,supplier_purchase_disabled) VALUES(?,'Buyer','628',?,7500,'qris','lunas','paid','web',datetime('now'),1)`).run(disabledCode, items);
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,supplier_purchase_disabled) VALUES(?,'Buyer','628',?,7500,'qris','lunas','paid','web',datetime('now'),0)`).run(normalCode, items);
    return fx;
  }

  it("WR: order supplier_purchase_disabled=1 tidak membuat link, tidak dispatch/revive/exact-ref POST, order normal tetap dispatch", async () => {
    const disabledCode = "AXV-20261118-WRDIS001";
    const normalCode = "AXV-20261118-WRNRM001";
    const fx = seedWr(disabledCode, normalCode);
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (init?.method === "POST") posts.push({ url: target, body: JSON.parse(String(init.body)) });
      if (target.endsWith("/balance")) return Response.json({ success: true, data: { balance: 100000, currency: "IDR" } });
      if (target.endsWith("/order")) return Response.json({ success: true, data: { order_id: "RBHN-OK-1", current_balance: 95000 } });
      if (target.endsWith("/jaspay/order")) return Response.json({ success: true, data: { invoice: "JSP-OK-1", status: "processing" } });
      return Response.json({ success: true, data: [] });
    }));
    try {
      const db = createDatabaseAccess(fx.db);
      expect(await createWrOrderLink(disabledCode, [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
      expect(await createWrOrderLinksForOrder(disabledCode, db)).toBe(0);
      expect(await reconcileMissingWrLinks(db)).toEqual({ orders: 1, links: 1 });
      expect(fx.sql.prepare("SELECT order_code FROM wr_order_links").all()).toEqual([{ order_code: normalCode }]);

      // Even if a legacy/pre-existing pending link or blocked_balance or submitted Jaspay link exists on disabled order,
      // dispatch/revive/exact-ref MUST NOT touch it or POST to WR.
      fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
        VALUES(?,'var-1',1,5000,'pending',0,3,datetime('now','-1 minute'),?)`).run(disabledCode, `wr:${disabledCode}:var-1:1`);
      fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
        VALUES(?,'var-1',1,5000,'blocked_balance',0,3,datetime('now','-1 minute'),?)`).run(disabledCode, `wr:${disabledCode}:var-1:blocked`);
      const jspRes = fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,request_sent_at,next_attempt_at,idempotency_key)
        VALUES(?,'jaspay:zoom:14d',1,10000,'submitted',1,3,datetime('now','-5 minutes'),datetime('now','-1 minute'),?)`).run(disabledCode, `wr:${disabledCode}:jaspay:zoom:14d:1`);

      expect(await reconcileBlockedBalance(db)).toBe(0);
      expect(await recoverJaspayByExactRef(Number(jspRes.lastInsertRowid), db)).toBe(false);
      const processed = await processWrPendingOrders(db, { skipOrphanProbe: true });
      expect(processed).toMatchObject({ processed: 1, succeeded: 1 });
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toContain("/order");
      expect(posts[0].url).not.toContain("/jaspay/order");
      expect(fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links WHERE order_code=? ORDER BY id ASC").all(disabledCode)).toEqual([
        { status: "pending", wr_order_id: null },
        { status: "blocked_balance", wr_order_id: null },
        { status: "submitted", wr_order_id: null },
      ]);
      expect(fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links WHERE order_code=?").get(normalCode)).toEqual({
        status: "processing",
        wr_order_id: "RBHN-OK-1",
      });
    } finally {
      fx.close();
    }
  });

  it("SK: order supplier_purchase_disabled=1 tidak membuat link, tidak dispatch/revive POST, order normal tetap dispatch", async () => {
    stubFulfillmentKey();
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_API_KEY", "fixture-sk-key");
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
    const fx = createD1Fixture();
    const disabledCode = "AXV-20261118-SKDIS001";
    const normalCode = "AXV-20261118-SKNRM001";
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Netflix SK','netflix-sk',15000,10,'manual','9',1);
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed) VALUES(1,1,'SK-101','1 Bulan',15000,10,'manual','101',1);
      INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('101','9','Netflix','1 Bulan',10000,10,'auto',1,1,15000);
    `);
    const items = JSON.stringify([{ product_id: 1, variant_id: 1, name: "Netflix SK", price: 15000, qty: 1 }]);
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,supplier_purchase_disabled) VALUES(?,'Buyer','628',?,15000,'qris','lunas','paid','web',datetime('now'),1)`).run(disabledCode, items);
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at,supplier_purchase_disabled) VALUES(?,'Buyer','628',?,15000,'qris','lunas','paid','web',datetime('now'),0)`).run(normalCode, items);

    const trxPosts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/v1/item/101")) return Response.json({ data: { id: 101, price: 10000, stock: 10, order_process: "auto", status: "on" } });
      if (target.endsWith("/v1/balance")) return Response.json({ data: { balance: 100000 } });
      if (init?.method === "POST" && target.endsWith("/v1/trx")) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        trxPosts.push(body);
        return Response.json({ data: { invoice: "SK-INV-OK1", ref_id: body.ref_id, status: "pending" } });
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }));

    try {
      const db = createDatabaseAccess(fx.db);
      expect(await createSkOrderLink(disabledCode, [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
      expect(await createSkOrderLinksForOrder(disabledCode, db)).toBe(0);
      expect(await reconcileMissingSkLinks(db)).toEqual({ orders: 1, links: 1 });
      expect(fx.sql.prepare("SELECT order_code FROM sk_order_links").all()).toEqual([{ order_code: normalCode }]);

      fx.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
        VALUES(?,'101',1,10000,'pending',0,3,datetime('now','-1 minute'),?)`).run(disabledCode, `sk:${disabledCode}:101:1`);
      fx.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
        VALUES(?,'101',1,10000,'blocked_balance',0,3,datetime('now','-1 minute'),?)`).run(disabledCode, `sk:${disabledCode}:101:blocked`);

      expect(await reconcileBlockedSkBalance(db)).toBe(0);
      const processed = await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(processed).toMatchObject({ processed: 1, succeeded: 1 });
      expect(trxPosts).toHaveLength(1);
      expect(trxPosts[0].ref_id).toBe(`sk:${normalCode}:101:1`);
      expect(fx.sql.prepare("SELECT status, sk_invoice FROM sk_order_links WHERE order_code=? ORDER BY id ASC").all(disabledCode)).toEqual([
        { status: "pending", sk_invoice: null },
        { status: "blocked_balance", sk_invoice: null },
      ]);
      expect(fx.sql.prepare("SELECT status, sk_invoice FROM sk_order_links WHERE order_code=?").get(normalCode)).toEqual({
        status: "processing",
        sk_invoice: "SK-INV-OK1",
      });
    } finally {
      fx.close();
    }
  });
});
