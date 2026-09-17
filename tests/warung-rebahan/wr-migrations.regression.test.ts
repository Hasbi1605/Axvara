import { createRequire } from "node:module";
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { isExcluded } from "@/lib/warung-rebahan/sync";
import { createWrOrderLink } from "@/lib/warung-rebahan/order";

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

/**
 * Simulasi DB production pra-0027: schema.sql TANPA blok/tambahan WR, lalu
 * jalankan migrasi 0027 → 0028 → 0029 berurutan seperti wrangler.
 * Strip memakai string eksak (bukan regex) agar tidak meninggalkan koma.
 */
const STRIP_SNIPPETS = [
  `  -- Warung Rebahan H2H (migrasi 0027): sumber katalog + tautan produk WR.
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'warung_rebahan')),
  wr_product_id TEXT,
  wr_auto_managed INTEGER NOT NULL DEFAULT 0,
`,
  `  -- Warung Rebahan H2H (migrasi 0029): item milik pipeline WR (bukan manual
  -- palsu) — diselesaikan via wr_order_links, dilewati processItem generik.
  wr_link_id INTEGER REFERENCES wr_order_links(id) ON DELETE SET NULL,
`,
  `  -- Warung Rebahan H2H (migrasi 0027): tautan varian WR + auto-managed.
  wr_variant_id TEXT,
  wr_auto_managed INTEGER NOT NULL DEFAULT 0,
`,
  `  -- Migrasi 0033: toggle email wajib per produk (untuk non-WR masa depan).
  -- Varian WR tipe Invite/Link otomatis butuh email tanpa toggle ini.
  require_email INTEGER NOT NULL DEFAULT 0
    CHECK (require_email IN (0, 1)),
  `,
  // CATATAN: blok min_qty (migrasi 0034) hidup di tabel product_variants
  // (SEBELUM cut marker), jadi legacySchema pra-WR memang mengandungnya dan
  // WAJIB di-strip agar migrasi 0034 bisa jalan seperti di prod lama.
  `  -- Migrasi 0034: minimum pembelian per varian (mode generik, milik admin).
  -- Default 1 = tanpa perubahan perilaku. GSuite dikunci 50 via UPDATE di
  -- migrasi; sync WR tidak pernah menulis kolom ini. Label pembeli:
  -- "Min. N pembelian" bila N > 1.
  min_qty INTEGER NOT NULL DEFAULT 1
    CHECK (min_qty >= 1),

  `,
  `  -- Migrasi 0033: email pembeli tersimpan (alur email_for:) untuk produk
  -- Invite/Link WR + require_email. Ditanya sekali, dipakai ulang.
  buyer_email TEXT DEFAULT NULL,
`,
  `CREATE INDEX IF NOT EXISTS idx_products_source ON products(source) WHERE source = 'warung_rebahan';
CREATE INDEX IF NOT EXISTS idx_products_wr_id ON products(wr_product_id) WHERE wr_product_id IS NOT NULL;
`,
  `CREATE INDEX IF NOT EXISTS idx_variants_wr_id ON product_variants(wr_variant_id) WHERE wr_variant_id IS NOT NULL;
`,
  `CREATE INDEX IF NOT EXISTS idx_fulfillment_items_wr_link
  ON fulfillment_items(wr_link_id) WHERE wr_link_id IS NOT NULL;
`,
];

function createPreWrDatabase() {
  const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
  const cutMarker = "-- Warung Rebahan H2H (migrasi 0027 Ralph:";
  const cutAt = schema.indexOf(cutMarker);
  if (cutAt < 0) throw new Error("WR block marker not found in schema.sql");
  let legacySchema = schema.slice(0, cutAt);
  for (const snippet of STRIP_SNIPPETS) {
    if (!legacySchema.includes(snippet)) throw new Error(`strip snippet missing: ${snippet.slice(0, 60)}`);
    legacySchema = legacySchema.replace(snippet, "");
  }
  const sql = new DatabaseSync(":memory:");
  sql.exec(legacySchema);
  sql.exec("DELETE FROM product_variants; DELETE FROM products;");
  return sql;
}

describe("migrasi WR berurutan di DB production lama", () => {
  it("0027: seed Canva/Gemini excluded; 0028: seed dihapus, registry dibuka", async () => {
    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      const seeds = sql.prepare("SELECT pattern FROM wr_exclusions ORDER BY pattern").all() as { pattern: string }[];
      expect(seeds.map((s) => s.pattern).sort()).toEqual(["%canva%", "%gemini%"]);
      sql.exec(fs.readFileSync("drizzle/migrations/0028_unexclude_canva_gemini.sql", "utf8"));
      expect((sql.prepare("SELECT COUNT(*) n FROM wr_exclusions").get() as { n: number }).n).toBe(0);
    } finally {
      sql.close();
    }
  });

  it("0029: rebuild mempertahankan link lama + backfill key + status baru", async () => {
    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      sql.exec(fs.readFileSync("drizzle/migrations/0028_unexclude_canva_gemini.sql", "utf8"));
      sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-M','B','628','[]',100,'qris','lunas','paid')").run();
      sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-1',1,5000,'completed')").run();
      sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-1',1,5000,'failed')").run();
      sql.exec(fs.readFileSync("drizzle/migrations/0029_wr_exactly_once.sql", "utf8"));
      const links = sql.prepare("SELECT id,status,idempotency_key FROM wr_order_links ORDER BY id").all() as { id: number; status: string; idempotency_key: string | null }[];
      // Link terminal benar TIDAK dihapus; tertua dapat key.
      expect(links.length).toBe(2);
      expect(links[0].idempotency_key).toBe("wr:AXV-M:var-1:1");
      expect(links[1].idempotency_key).toBeNull();
      // Status baru diterima CHECK.
      sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-2',1,100,'claimed')").run();
      sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-3',1,100,'submitted')").run();
      sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-4',1,100,'blocked_balance')").run();
      // Status liar tetap ditolak.
      expect(() => sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-M','var-5',1,100,'bogus')").run()).toThrow();
      // UNIQUE idempotency ditegakkan.
      expect(() => sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,idempotency_key) VALUES('AXV-M','var-1',1,5000,'pending','wr:AXV-M:var-1:1')").run()).toThrow();
    } finally {
      sql.close();
    }
  });

  it("0031: trigger manual/cron tercatat; baris lama default manual", async () => {
    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      sql.exec(fs.readFileSync("drizzle/migrations/0031_wr_sync_trigger.sql", "utf8"));
      // Baris lama (pra-0031) otomatis manual.
      sql.prepare("INSERT INTO wr_sync_log(sync_type,status,products_synced) VALUES('products','success',12)").run();
      // Cron menandai dirinya; manual eksplisit juga valid.
      sql.prepare("INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger) VALUES('products','success',48,'cron')").run();
      sql.prepare("INSERT INTO wr_sync_log(sync_type,status,products_synced,trigger) VALUES('products','success',48,'manual')").run();
      const rows = sql.prepare("SELECT trigger FROM wr_sync_log ORDER BY id").all() as { trigger: string }[];
      expect(rows.map((r) => r.trigger)).toEqual(["manual", "cron", "manual"]);
      // Nilai liar ditolak.
      expect(() => sql.prepare("INSERT INTO wr_sync_log(sync_type,status,trigger) VALUES('products','success','otomatis')").run()).toThrow();
    } finally {
      sql.close();
    }
  });

  it("0032: kelas pengiriman restock/MBO + seed screenshot + CHECK", async () => {
    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      sql.exec(fs.readFileSync("drizzle/migrations/0032_wr_delivery_class.sql", "utf8"));
      // FK wr_variants → wr_products: induk dulu.
      sql.prepare(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('p-old','Produk Lama'),('p-new','Netflix Premium'),('p-bad','X')`).run();
      // Baris lama default NULL (belum dikunci → label pembeli = Dikirim admin).
      sql.prepare(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price)
        VALUES('v-old','p-old','Produk Lama',5000)`).run();
      sql.prepare(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class,wr_delivery_source)
        VALUES('v-new','p-new','Netflix Premium Anti Limit',8000,'restock','screenshot')`).run();
      const old = sql.prepare(`SELECT wr_delivery_class c FROM wr_variants WHERE wr_variant_id='v-old'`).get() as { c: string | null };
      expect(old.c).toBeNull();
      // Nilai liar ditolak CHECK.
      expect(() => sql.prepare(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class)
        VALUES('v-bad','p-bad','X',100,'instan')`).run()).toThrow();
      // Seed screenshot tidak menimpa kunci manual (rerun ALTER akan gagal
      // duplicate column — wajar SQLite; jalur CI aman karena Wrangler
      // mencatat migrasi. Uji keterjagaan via UPDATE guard, bukan rerun file).
      sql.prepare(`UPDATE wr_variants SET wr_delivery_class='made_by_order', wr_delivery_source='admin' WHERE wr_variant_id='v-old'`).run();
      sql.prepare(`UPDATE wr_variants SET wr_delivery_class='restock', wr_delivery_source='screenshot'
        WHERE wr_delivery_class IS NULL AND (wr_variant_name LIKE '%Netflix%')`).run();
      const kept = sql.prepare(`SELECT wr_delivery_class c, wr_delivery_source s FROM wr_variants WHERE wr_variant_id='v-old'`).get() as { c: string; s: string };
      expect(kept.c).toBe("made_by_order");
      expect(kept.s).toBe("admin");
    } finally {
      sql.close();
    }
  });

  it("0033: require_email default 0 + buyer_email telegram; CHECK menolak >1", async () => {    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      sql.exec(fs.readFileSync("drizzle/migrations/0033_product_require_email.sql", "utf8"));
      sql.prepare(`INSERT INTO products(name,slug,price) VALUES('Ebook','ebook',5000)`).run();
      const p = sql.prepare(`SELECT require_email r FROM products WHERE slug='ebook'`).get() as { r: number };
      expect(Number(p.r)).toBe(0);
      sql.prepare(`UPDATE products SET require_email=1 WHERE slug='ebook'`).run();
      expect(() => sql.prepare(`UPDATE products SET require_email=2 WHERE slug='ebook'`).run()).toThrow();
      sql.prepare(`INSERT INTO telegram_users(user_id,chat_id,buyer_email) VALUES('u1','c1','a@b.id')`).run();
      const u = sql.prepare(`SELECT buyer_email e FROM telegram_users WHERE user_id='u1'`).get() as { e: string };
      expect(u.e).toBe("a@b.id");
    } finally {
      sql.close();
    }
  });

  it("0034: min_qty default 1 + GSuite 50 + CHECK menolak 0", async () => {
    const sql = createPreWrDatabase();
    try {
      sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
      sql.exec(fs.readFileSync("drizzle/migrations/0034_variant_min_qty.sql", "utf8"));
      // Default 1 untuk varian biasa.
      const ebook = sql.prepare(`INSERT INTO products(name,slug,price) VALUES('Ebook','ebook',5000)`).run() as unknown as { lastInsertRowid: number };
      const ebookId = Number((ebook as unknown as { lastInsertRowid: number }).lastInsertRowid ?? 1);
      sql.prepare(`INSERT INTO product_variants(product_id,sku,label,price) VALUES(?,'EB-1','Standar',5000)`).run(ebookId);
      const p = sql.prepare(`SELECT min_qty m FROM product_variants WHERE sku='EB-1'`).get() as { m: number };
      expect(Number(p.m)).toBe(1);
      // GSuite otomatis 50 via UPDATE migrasi (slug cocok).
      const gs = sql.prepare(`INSERT INTO products(name,slug,price) VALUES('GSuite Basic','gsuite-basic',10000)`).run() as unknown as { lastInsertRowid: number };
      const gsId = Number((gs as unknown as { lastInsertRowid: number }).lastInsertRowid ?? 2);
      sql.prepare(`INSERT INTO product_variants(product_id,sku,label,price) VALUES(?,'GS-1','Basic',10000)`).run(gsId);
      // UPDATE migrasi sudah jalan sebelum INSERT di atas (migrasi sekali jalan),
      // jadi simulasikan rerun parsial: UPDATE WHERE min_qty=1 tetap aman.
      sql.exec(`UPDATE product_variants SET min_qty=50, updated_at=datetime('now')
        WHERE min_qty=1 AND product_id IN (SELECT id FROM products WHERE slug LIKE '%gsuite%')`);
      const g = sql.prepare(`SELECT min_qty m FROM product_variants WHERE sku='GS-1'`).get() as { m: number };
      expect(Number(g.m)).toBe(50);
      // CHECK menolak 0.
      expect(() => sql.prepare(`UPDATE product_variants SET min_qty=0 WHERE sku='EB-1'`).run()).toThrow();
    } finally {
      sql.close();
    }
  });
});

describe("regresi #14: bootstrap schema.sql mendukung seluruh operasi WR", () => {
  it("tanpa migrasi manual: link + sync-state + token + webhook log jalan", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      // Exclusion kosong (tanpa Canva/Gemini).
      expect((fx.sql.prepare("SELECT COUNT(*) n FROM wr_exclusions").get() as { n: number }).n).toBe(0);
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(1,'CapCut Pro','capcut-pro',7500,10,'warung_rebahan','prod-capcut',1)").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed) VALUES(1,1,'WR-V1','Pro',7500,10,'manual','var-1',1)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at) VALUES('AXV-20260913-B00001','B','628',?,7500,'qris','lunas','paid','web',datetime('now'))")
        .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut", price: 7500, qty: 1 }]));
      fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count) VALUES('AXV-20260913-B00001',0,1,1,1,'manual','web','queued',0)").run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      // Link dengan idempotency (kolom 0029 ada di schema).
      expect(await createWrOrderLink("AXV-20260913-B00001", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(1);
      const link = fx.sql.prepare("SELECT status, idempotency_key, delivery_status FROM wr_order_links").get() as { status: string; idempotency_key: string; delivery_status: string };
      expect(link.idempotency_key).toBe("wr:AXV-20260913-B00001:var-1:1");
      // Sync state + token + webhook log.
      fx.sql.prepare("UPDATE wr_sync_state SET value='3' WHERE key='products_cursor'").run();
      expect((fx.sql.prepare("SELECT value v FROM wr_sync_state WHERE key='products_cursor'").get() as { v: string }).v).toBe("3");
      fx.sql.prepare("INSERT INTO wr_credential_tokens(order_code,token_hash) VALUES('AXV-20260913-B00001','" + "a".repeat(64) + "')").run();
      fx.sql.prepare("INSERT INTO wr_webhook_events(wr_order_id,event,applied,result) VALUES('ORD-X','completed',1,'ok')").run();
      // isExcluded jalan (tabel kosong → false).
      expect((await isExcluded("Canva Premium", db)).excluded).toBe(false);
    } finally {
      fx.close();
      vi.unstubAllEnvs();
    }
  });
});
