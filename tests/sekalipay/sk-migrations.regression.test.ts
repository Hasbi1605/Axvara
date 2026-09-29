import { createRequire } from "node:module";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...p: unknown[]) => unknown;
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      all: (...p: unknown[]) => Record<string, unknown>[];
    };
    close: () => void;
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("migrasi 0049 Sekalipay di DB production lama", () => {
  function createPreSkDatabase() {
    const full = fs.readFileSync("drizzle/schema.sql", "utf8");
    const cutMarker = "-- Sekalipay supplier kedua (migrasi 0049): mirror";
    const cutAt = full.indexOf(cutMarker);
    if (cutAt < 0) throw new Error("SK block marker not found in schema.sql");
    const dashIdx = full.lastIndexOf("-- ───", cutAt);
    let legacy = full.slice(0, dashIdx);
    // Kembalikan CHECK lama manual/warung_rebahan saja.
    legacy = legacy.split("CHECK (source IN ('manual', 'warung_rebahan', 'sekalipay'))")
      .join("CHECK (source IN ('manual', 'warung_rebahan'))");
    const strips = [
      "  -- Sekalipay supplier kedua (migrasi 0049): tautan produk SK + auto-managed.\n  sk_product_id TEXT,\n  sk_auto_managed INTEGER NOT NULL DEFAULT 0,\n",
      "  -- Sekalipay (migrasi 0049): item milik pipeline SK (bukan manual palsu) —\n  -- diselesaikan via sk_order_links, dilewati processItem generik (pola WR).\n  sk_link_id INTEGER REFERENCES sk_order_links(id) ON DELETE SET NULL,\n",
      "  -- Sekalipay (migrasi 0049): tautan varian SK + auto-managed.\n  sk_variant_id TEXT,\n  sk_auto_managed INTEGER NOT NULL DEFAULT 0,\n",
      "CREATE INDEX IF NOT EXISTS idx_variants_sk_id ON product_variants(sk_variant_id) WHERE sk_variant_id IS NOT NULL;\nCREATE INDEX IF NOT EXISTS idx_products_sk_id ON products(sk_product_id) WHERE sk_product_id IS NOT NULL;\n",
      "CREATE INDEX IF NOT EXISTS idx_products_source_sk ON products(source) WHERE source = 'sekalipay';\n",
      "CREATE INDEX IF NOT EXISTS idx_fulfillment_items_sk_link\n  ON fulfillment_items(sk_link_id) WHERE sk_link_id IS NOT NULL;\n",
    ];
    for (const s of strips) {
      if (!legacy.includes(s)) throw new Error(`strip snippet missing: ${s.slice(0, 60)}`);
      legacy = legacy.replace(s, "");
    }
    const sql = new DatabaseSync(":memory:");
    sql.exec(legacy);
    return sql;
  }

  it("kolom SK belum ada sebelum 0049; tabel SK dibuat migrasi", () => {
    const sql = createPreSkDatabase();
    try {
      const cols = sql.prepare("PRAGMA table_info(products)").all() as { name: string }[];
      expect(cols.map((c) => c.name)).not.toContain("sk_product_id");
      sql.exec(fs.readFileSync("drizzle/migrations/0049_sekalipay_supplier.sql", "utf8"));
      const after = sql.prepare("PRAGMA table_info(products)").all() as { name: string }[];
      expect(after.map((c) => c.name)).toContain("sk_product_id");
      const tables = sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sk_%' ORDER BY name").all() as { name: string }[];
      expect(tables.map((t) => t.name)).toEqual([
        "sk_order_links", "sk_products", "sk_saldo_log", "sk_sync_log", "sk_sync_state", "sk_webhook_events",
      ]);
    } finally {
      sql.close();
    }
  });

  it("CHECK status sk_order_links menolak nilai liar; UNIQUE idempotency ditegakkan", () => {
    const sql = createPreSkDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0049_sekalipay_supplier.sql", "utf8"));
      sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-S','B','628','[]',100,'qris','lunas','paid')").run();
      sql.prepare("INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status) VALUES('AXV-S','101',1,5000,'pending')").run();
      sql.prepare("INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status) VALUES('AXV-S','102',1,100,'blocked_balance')").run();
      expect(() => sql.prepare("INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status) VALUES('AXV-S','103',1,100,'bogus')").run()).toThrow();
      sql.prepare("UPDATE sk_order_links SET idempotency_key='sk:AXV-S:101:1' WHERE sk_variant_id='101'").run();
      expect(() => sql.prepare("INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,idempotency_key) VALUES('AXV-S','101',1,5000,'pending','sk:AXV-S:101:1')").run()).toThrow();
    } finally {
      sql.close();
    }
  });
});

describe("regresi: bootstrap schema.sql mendukung seluruh operasi SK", () => {
  it("tanpa migrasi manual: kolom + registry + link + sync-state jalan", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Netflix Premium (SK)','netflix-premium-sk',15000,10,'sekalipay','9',1)").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed) VALUES(1,1,'SK-101','1 Bulan',15000,10,'manual','101',1)").run();
      fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('101','9','Netflix','1 Bulan',10000,10,'auto',1,1,15000)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at) VALUES('AXV-20260930-SK0001','B','628',?,15000,'qris','lunas','paid','web',datetime('now'))")
        .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "Netflix (SK)", price: 15000, qty: 1 }]));
      fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count) VALUES('AXV-20260930-SK0001',0,1,1,1,'manual','web','queued',0)").run();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const { createSkOrderLink } = await import("@/lib/sekalipay/order");
      const db = createDatabaseAccess(fx.db);
      expect(await createSkOrderLink("AXV-20260930-SK0001", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(1);
      const link = fx.sql.prepare("SELECT status, idempotency_key FROM sk_order_links").get() as { status: string; idempotency_key: string };
      expect(link.status).toBe("pending");
      expect(link.idempotency_key).toBe("sk:AXV-20260930-SK0001:101:1");
      // Sync state + webhook log.
      fx.sql.prepare("UPDATE sk_sync_state SET value='3' WHERE key='products_cursor'").run();
      expect((fx.sql.prepare("SELECT value v FROM sk_sync_state WHERE key='products_cursor'").get() as { v: string }).v).toBe("3");
      fx.sql.prepare("INSERT INTO sk_webhook_events(sk_invoice,event,applied,result) VALUES('SPY-1','completed',1,'ok')").run();
    } finally {
      fx.close();
      vi.unstubAllEnvs();
    }
  });
});
