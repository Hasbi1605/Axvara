// tests/pedia-b2-purge-migrations.test.ts — paket B2: 0119 purge ProviderSMM
// + 0120 reaktivasi terkurasi IndoSMM. Dataset sengaja berbentuk produksi.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

const PURGE = fs.readFileSync("drizzle/migrations/0119_pedia_providersmm_purge.sql", "utf8");
const REACTIVATE = fs.readFileSync("drizzle/migrations/0120_pedia_indosmm_reactivate.sql", "utf8");

function seedProdShape() {
  const fx = createD1Fixture();
  const db = fx.sql;
  db.exec(`
    INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
      VALUES
        (1,'psmm-9001','instagram','followers','profile','Auto product','[100,250]',10,1,'auto'),
        (2,'legacy-curated','instagram','likes','post','Curated psmm only','[100]',1,0,'curated'),
        (3,'followers-instagram','instagram','followers','profile','Mixed product','[100]',1,1,'curated');
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,package_prices_json)
      VALUES
        (1,1,'standar','providersmm',9001,'G2',60,2000,0,1,'{"100":5000}'),
        (2,2,'standar','providersmm',9002,'G2',60,2000,0,0,'{"100":5000}'),
        (3,3,'standar','providersmm',9003,'G3',20,1000,0,1,'{"100":2000}'),
        (4,3,'hemat','indosmm',574,'G3',20,1000,30,1,'{"100":3000}'),
        (5,3,'premium','providersmm',9004,'G3',20,1000,0,1,'{"100":2000}');
    INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
      VALUES ('providersmm',9001,'psmm svc','IG','Default',1000,10,1000,1),
             ('providersmm',9002,'psmm svc','IG','Default',1000,10,1000,1),
             ('providersmm',9003,'psmm svc','IG','Default',1000,10,1000,1),
             ('providersmm',9004,'psmm svc','IG','Default',1000,10,1000,1),
             ('indosmm',574,'indo svc','IG','Default',1000,10,1000,1);
    INSERT INTO pedia_service_stats(supplier,service_id,orders_7d) VALUES ('providersmm',9001,1),('indosmm',574,9);
    INSERT INTO pedia_supplier_balance_log(supplier,balance) VALUES ('providersmm',1000),('indosmm',2000);
  `);
  // Guarded legacy order (expired, never paid, never dispatched) + dependents.
  db.exec(`
    INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,order_kind)
      VALUES ('AXP-GUARDED','pedia:g','x','6281234567890','a@b.com','[]',1000,'qris','kadaluarsa','expired','pedia');
    INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status)
      VALUES ('AXP-GUARDED',3,5,'{}','x','x',100,10,1000,'providersmm',9004,1000,'expired');
    INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,status,requested_amount,payable_amount)
      VALUES ('AXP-GUARDED','gopay','static','AXP-GUARDED','m','expired',1000,1169);
    INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status)
      VALUES ('email:pedia-paid:AXP-GUARDED','AXP-GUARDED','email','failed');
    INSERT INTO checkout_claims(quote_id,claim_token,created_at_ms) VALUES ('pedia:g','t',1);
    INSERT INTO pedia_credits(code_hash,code_hint,email,amount,remaining,source_order_code,source_kind,expires_at)
      VALUES ('h','X','a@b.com',100,100,'AXP-GUARDED','partial','2099-01-01');
  `);
  // Unguarded provider row: paid/completed and already dispatched → must survive.
  db.exec(`
    INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,paid_at,order_kind)
      VALUES ('AXP-KEEP','pedia:k','x','6281234567890','a@b.com','[]',5000,'qris','lunas','paid',datetime('now'),'pedia');
    INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id)
      VALUES ('AXP-KEEP',3,3,'{}','x','x',100,50,5000,'providersmm',9003,1000,'completed','UPSTREAM-1');
  `);
  db.exec(`
    INSERT INTO store_settings(key,value) VALUES
      ('pedia_pending:9001','t'),('pedia_psmm_desc_snapshot','{}'),('pedia_psmm_desc_last_at','x'),
      ('pedia_managed_pending','[]'),('pedia_diff_last_at','x'),('pedia_diff_last_change_at','x'),
      ('pedia_balance_alert_at','0|1'),('pedia_balance_checked_at','x'),
      ('pedia_indosmm_diff_last_at','x'),('pedia_indosmm_diff_last_change_at','x'),
      ('pedia_indosmm_balance_alert_at','0|1'),('pedia_indosmm_balance_checked_at','x'),
      ('pedia_service_stats_refreshed_at','x');
  `);
  return fx;
}

const count = (fx: ReturnType<typeof createD1Fixture>, sql: string) => Number(fx.sql.prepare(sql).get()?.n ?? 0);

describe("0119 purge ProviderSMM", () => {
  it("removes guarded legacy orders with dependents, keeps unguarded rows, never touches IndoSMM", () => {
    const fx = seedProdShape();
    try {
      fx.sql.exec(PURGE);
      expect(fx.sql.prepare("SELECT code FROM orders").all()).toEqual([{ code: "AXP-KEEP" }]);
      expect(count(fx, "SELECT COUNT(*) n FROM pedia_order_items WHERE order_code='AXP-GUARDED'")).toBe(0);
      expect(count(fx, "SELECT COUNT(*) n FROM payment_transactions WHERE order_code='AXP-GUARDED'")).toBe(0);
      expect(count(fx, "SELECT COUNT(*) n FROM payment_invoice_history WHERE order_code='AXP-GUARDED'")).toBe(0);
      expect(count(fx, "SELECT COUNT(*) n FROM buyer_notice_log WHERE order_code='AXP-GUARDED'")).toBe(0);
      expect(count(fx, "SELECT COUNT(*) n FROM checkout_claims WHERE quote_id='pedia:g'")).toBe(0);
      expect(count(fx, "SELECT COUNT(*) n FROM pedia_credits WHERE source_order_code='AXP-GUARDED'")).toBe(0);
      // Unguarded provider item keeps its order/tier/product.
      expect(fx.sql.prepare("SELECT supplier,status FROM pedia_order_items").all()).toEqual([{ supplier: "providersmm", status: "completed" }]);
      expect(fx.sql.prepare("SELECT id FROM pedia_tiers ORDER BY id").all()).toEqual([{ id: 3 }, { id: 4 }]);
      // psmm-only products gone; mixed product keeps its IndoSMM tier.
      expect(fx.sql.prepare("SELECT id FROM pedia_products ORDER BY id").all()).toEqual([{ id: 3 }]);
      expect(fx.sql.prepare("SELECT supplier FROM pedia_supplier_services ORDER BY supplier").all()).toEqual([{ supplier: "indosmm" }]);
      expect(fx.sql.prepare("SELECT supplier FROM pedia_service_stats").all()).toEqual([{ supplier: "indosmm" }]);
      expect(fx.sql.prepare("SELECT supplier FROM pedia_supplier_balance_log").all()).toEqual([{ supplier: "indosmm" }]);
      const keys = fx.sql.prepare("SELECT key FROM store_settings WHERE key LIKE 'pedia_%' ORDER BY key").all().map((r) => String(r.key));
      expect(keys).toEqual([
        "pedia_indosmm_balance_alert_at", "pedia_indosmm_balance_checked_at",
        "pedia_indosmm_diff_last_at", "pedia_indosmm_diff_last_change_at",
        "pedia_service_stats_refreshed_at",
      ]);
      expect(fx.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(fx.sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_psmm_purge_%'").all()).toEqual([]);
    } finally { fx.close(); }
  });

  it("keeps a mixed ProviderSMM/IndoSMM expired order and its tier/product", () => {
    const fx = seedProdShape();
    try {
      // Schema produksi 1:1 (UNIQUE order_code); tabel dibangun ulang tanpa
      // constraint itu hanya untuk menguji aturan "SEMUA item harus cocok".
      fx.sql.exec(`
        CREATE TABLE _poi AS SELECT * FROM pedia_order_items;
        DROP TABLE pedia_order_items;
        ALTER TABLE _poi RENAME TO pedia_order_items;
        INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,order_kind)
          VALUES ('AXP-MIX','pedia:mix','x','6281234567890','a@b.com','[]',3000,'qris','kadaluarsa','expired','pedia');
        INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status)
          VALUES ('AXP-MIX',3,5,'{}','x','x',100,10,1000,'providersmm',9004,1000,'expired'),
                 ('AXP-MIX',3,4,'{}','x','x',100,20,2000,'indosmm',574,1000,'queued');
      `);
      fx.sql.exec(PURGE);
      expect(fx.sql.prepare("SELECT code FROM orders ORDER BY code").all()).toEqual([{ code: "AXP-KEEP" }, { code: "AXP-MIX" }]);
      expect(count(fx, "SELECT COUNT(*) n FROM pedia_order_items WHERE order_code='AXP-MIX'")).toBe(2);
      expect(fx.sql.prepare("SELECT id FROM pedia_tiers ORDER BY id").all()).toEqual([{ id: 3 }, { id: 4 }, { id: 5 }]);
      expect(fx.sql.prepare("SELECT id FROM pedia_products ORDER BY id").all()).toEqual([{ id: 3 }]);
      expect(fx.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { fx.close(); }
  });

  it("is idempotent: a replay changes nothing", () => {
    const fx = seedProdShape();
    try {
      fx.sql.exec(PURGE);
      const snapshot = () => ({
        orders: fx.sql.prepare("SELECT code FROM orders ORDER BY code").all(),
        items: fx.sql.prepare("SELECT order_code FROM pedia_order_items ORDER BY id").all(),
        tiers: fx.sql.prepare("SELECT id FROM pedia_tiers ORDER BY id").all(),
        products: fx.sql.prepare("SELECT id FROM pedia_products ORDER BY id").all(),
        settings: fx.sql.prepare("SELECT key,value FROM store_settings WHERE key LIKE 'pedia_%' ORDER BY key").all(),
      });
      const before = JSON.stringify(snapshot());
      fx.sql.exec(PURGE);
      expect(JSON.stringify(snapshot())).toBe(before);
      expect(fx.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { fx.close(); }
  });
});

describe("0120 curated IndoSMM reactivation", () => {
  it("activates only listed, still-inactive curated rows and is idempotent", () => {
    const listed = Number(/IN \((\d+),/.exec(REACTIVATE)?.[1]);
    expect(Number.isSafeInteger(listed) && listed > 0).toBe(true);
    const fx = createD1Fixture();
    try {
      fx.sql.exec(`
        INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
          VALUES (1,'listed','instagram','followers','profile','Listed','[100]',1,0,'curated'),
                 (2,'unlisted','instagram','likes','post','Unlisted','[100]',1,0,'curated'),
                 (3,'retired','instagram','views','post','Retired','[100]',1,1,'curated');
        INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,auto_disabled_reason)
          VALUES (${listed},1,'standar','indosmm',574,'G3',20,1000,0,'margin'),
                 (999901,2,'standar','indosmm',574,'G3',20,1000,0,NULL),
                 (999902,3,'standar','providersmm',9001,'G3',20,1000,0,NULL),
                 (999903,3,'standar','indosmm',574,'G3',20,1000,1,NULL);
      `);
      fx.sql.exec(REACTIVATE);
      const row = (id: number) => fx.sql.prepare("SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE id=?").get(id);
      expect(row(listed)).toEqual({ is_active: 1, auto_disabled_reason: null });
      expect(row(999901)).toMatchObject({ is_active: 0 });
      expect(row(999902)).toMatchObject({ is_active: 0 });
      expect(row(999903)).toMatchObject({ is_active: 1 });
      const before = JSON.stringify(fx.sql.prepare("SELECT id,is_active,auto_disabled_reason,updated_at FROM pedia_tiers ORDER BY id").all());
      fx.sql.exec(REACTIVATE);
      expect(JSON.stringify(fx.sql.prepare("SELECT id,is_active,auto_disabled_reason,updated_at FROM pedia_tiers ORDER BY id").all())).toBe(before);
      expect(fx.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { fx.close(); }
  });
});
