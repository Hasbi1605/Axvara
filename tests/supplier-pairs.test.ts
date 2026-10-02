import { describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { decideOneWinner, decideAllWinners, loserProductIds, type PairRow } from "@/lib/supplier-pairs";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";

function seedPairProducts(fx: ReturnType<typeof createD1Fixture>) {
  // Tanpa category_id (kolom nullable; fixture categories tidak di-seed —
  // pola sama dengan sk-sync-order/wr sync tests).
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id) VALUES(1,'Netflix Premium','netflix-premium',24000,10,'warung_rebahan','wr-nf')").run();
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id) VALUES(2,'Netflix','netflix-sk',15000,5,'manual','14')").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(1,1,'WR-A','Private',15000,10,'manual','wr-a'),(2,1,'WR-B','Sharing',9000,0,'manual','wr-b')").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id) VALUES(3,2,'SK-31','1P2U',18500,5,'manual','31')").run();
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id,last_synced_at) VALUES('wr-nf','Netflix Premium',1,datetime('now'))").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price) VALUES('wr-a','wr-nf','Private',5000,10,1,15000),('wr-b','wr-nf','Sharing',3000,0,2,9000)").run();
  fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('31','14','Netflix','Aplikasi Premium','1P2U',4000,3,'auto',2,3,18500)").run();
}

function pair(over: Partial<PairRow> = {}): PairRow {
  return { id: 1, wr_product_id: 1, sk_product_id: 2, winner: null, prefer: "auto", prefer_margin: 2000, decided_at: null, reason: null, ...over };
}

describe("decideOneWinner: stok dulu, modal kemudian", () => {
  it("yang berstok menang walau modal lebih mahal", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      // SK habis → WR menang (modal WR 5000 > SK 4000 tidak relevan).
      fx.sql.prepare("UPDATE product_variants SET stock=0 WHERE id=3").run();
      fx.sql.prepare("UPDATE sk_products SET sk_stock=0 WHERE sk_variant_id='31'").run();
      const db = createDatabaseAccess(fx.db);
      const r = await decideOneWinner(pair(), db);
      expect(r.winner).toBe("WR");
      expect(r.reason).toContain("SK habis");
    } finally { fx.close(); }
  });

  it("dua berstok → modal termurah menang", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      const db = createDatabaseAccess(fx.db);
      const r = await decideOneWinner(pair(), db);
      // WR modal 5000 (varian berstok) vs SK modal 4000 → SK menang.
      expect(r.winner).toBe("SK");
      expect(r.reason).toContain("4000");
    } finally { fx.close(); }
  });

  it("prefer admin mengalahkan selisih kecil, takluk pada selisih besar", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      const db = createDatabaseAccess(fx.db);
      // Selisih 1000 ≤ margin 2000 → prefer WR menang walau modal kalah.
      const r1 = await decideOneWinner(pair({ prefer: "WR", prefer_margin: 2000 }), db);
      expect(r1.winner).toBe("WR");
      expect(r1.reason).toContain("prefer WR");
      // Selisih 1000 > margin 500 → modal tetap menang (SK).
      const r2 = await decideOneWinner(pair({ prefer: "WR", prefer_margin: 500 }), db);
      expect(r2.winner).toBe("SK");
    } finally { fx.close(); }
  });

  it("dua-duanya habis → NULL (disembunyikan dua-duanya)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      fx.sql.prepare("UPDATE product_variants SET stock=0").run();
      fx.sql.prepare("UPDATE sk_products SET sk_stock=0 WHERE sk_variant_id='31'").run();
      fx.sql.prepare("UPDATE wr_variants SET wr_stock=0").run();
      const db = createDatabaseAccess(fx.db);
      const r = await decideOneWinner(pair(), db);
      expect(r.winner).toBeNull();
    } finally { fx.close(); }
  });

  it("pasangan yatim → NULL tanpa throw", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      const db = createDatabaseAccess(fx.db);
      const r = await decideOneWinner(pair({ wr_product_id: 9999 }), db);
      expect(r.winner).toBeNull();
      expect(r.reason).toBe("pasangan_yatim");
    } finally { fx.close(); }
  });
});

describe("decideAllWinners + loserProductIds", () => {
  it("menulis winner + reason, pecundang terdaftar", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      // Fixture schema.sql sudah seed 33 pasangan (id 1..33): pakai id 99 baru.
      fx.sql.prepare("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id) VALUES(99,1,2)").run();
      const db = createDatabaseAccess(fx.db);
      const out = await decideAllWinners(db);
      expect(out.decided).toBeGreaterThanOrEqual(1);
      const row = fx.sql.prepare("SELECT winner, reason, decided_at FROM supplier_pairs WHERE id=99").get() as Record<string, unknown>;
      expect(row.winner).toBe("SK");
      expect(String(row.reason)).toContain("4000");
      expect(row.decided_at).toBeTruthy();
      const losers = await loserProductIds(createDatabaseAccess(fx.db));
      expect(losers.has(1)).toBe(true);
      expect(losers.has(2)).toBe(false);
    } finally { fx.close(); }
  });
});
