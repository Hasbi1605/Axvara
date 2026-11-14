import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { decideOneWinner, decideAllWinners, decideDirtyWinners, loserProductIds, type PairRow } from "@/lib/supplier-pairs";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => true, rateLimit: () => true, rateLimitKey: () => "fixture" }));

function seedPairProducts(fx: ReturnType<typeof createD1Fixture>) {
  // Tanpa category_id (kolom nullable; fixture categories tidak di-seed —
  // pola sama dengan sk-sync-order/wr sync tests).
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id) VALUES(1,'Netflix Premium','netflix-premium',24000,10,'warung_rebahan','wr-nf')").run();
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,sk_product_id) VALUES(2,'Netflix','netflix-sk',15000,5,'manual','14')").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(1,1,'WR-A','Private',15000,10,'manual','wr-a'),(2,1,'WR-B','Sharing',9000,0,'manual','wr-b')").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id) VALUES(3,2,'SK-31','1P2U',18500,5,'manual','31')").run();
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id,last_synced_at) VALUES('wr-nf','Netflix Premium',1,datetime('now'))").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class) VALUES('wr-a','wr-nf','Private',5000,10,1,15000,'restock'),('wr-b','wr-nf','Sharing',3000,0,2,9000,'restock')").run();
  fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_category,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price) VALUES('31','14','Netflix','Aplikasi Premium','1P2U',4000,3,'auto',2,3,18500)").run();
}

function pair(over: Partial<PairRow> = {}): PairRow {
  return { id: 1, wr_product_id: 1, sk_product_id: 2, winner: null, prefer: "auto", prefer_margin: 2000, decided_at: null, reason: null, ...over };
}

describe("durable dirty pair queue", () => {
  function setup() {
    const fx=createD1Fixture(); seedPairProducts(fx);
    fx.sql.exec("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id) VALUES(99,1,2); DELETE FROM supplier_pair_dirty WHERE pair_id<>99");
    return fx;
  }
  it("manual OFF invalidates only on change; targeted drain promotes the active side and ON restores normal pricing", async () => {
    const fx=setup();
    try {
      const db=createDatabaseAccess(fx.db);
      await decideDirtyWinners(db);
      const previous=fx.sql.prepare("SELECT version FROM supplier_pair_dirty WHERE pair_id=99").get()?.version;
      fx.sql.exec("UPDATE products SET is_active=1 WHERE id=2");
      expect(fx.sql.prepare("SELECT version,pending FROM supplier_pair_dirty WHERE pair_id=99").get()).toEqual({version:previous,pending:0});
      fx.sql.exec("UPDATE products SET is_active=0 WHERE id=2");
      expect(fx.sql.prepare("SELECT version FROM supplier_pair_dirty WHERE pair_id=99").get()?.version).not.toBe(previous);
      expect(await decideDirtyWinners(db, 99999)).toEqual({decided:0,changed:0});
      expect(await decideDirtyWinners(db, 2)).toEqual({decided:1,changed:1});
      expect(fx.sql.prepare("SELECT winner,reason FROM supplier_pairs WHERE id=99").get()).toEqual({winner:"WR",reason:"SK nonaktif manual"});
      fx.sql.exec("UPDATE products SET is_active=1 WHERE id=2");
      await decideDirtyWinners(db, 2);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
    } finally { fx.close(); }
  });
  it("migration queues a stale decision even when WR was already OFF before the trigger existed", async () => {
    const fx=setup();
    try {
      fx.sql.exec("DROP TRIGGER pair_dirty_product_active_update; UPDATE products SET is_active=0 WHERE id=1; UPDATE supplier_pairs SET winner='WR' WHERE id=99; UPDATE supplier_pair_dirty SET pending=0");
      const old=fx.sql.prepare("SELECT version FROM supplier_pair_dirty WHERE pair_id=99").get()?.version;
      fx.sql.exec(readFileSync("drizzle/migrations/0078_supplier_pair_manual_active.sql","utf8"));
      expect(fx.sql.prepare("SELECT version FROM supplier_pair_dirty WHERE pair_id=99").get()?.version).not.toBe(old);
      await decideDirtyWinners(createDatabaseAccess(fx.db),1);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
    } finally { fx.close(); }
  });
  it("admin toggle refreshes the winner before GET admin/public and does not mutate supplier stock", async () => {
    const fx=setup();
    try {
      const { PUT }=await import("@/app/api/products/[id]/route");
      const { GET }=await import("@/app/api/products/route");
      fx.sql.exec("UPDATE wr_variants SET wr_price=1000; UPDATE supplier_pairs SET prefer='WR' WHERE id=99");
      await decideDirtyWinners(createDatabaseAccess(fx.db));
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("WR");
      const request=new NextRequest("http://localhost/api/products/1", {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({isActive:false})});
      expect((await PUT(request,{params:Promise.resolve({id:"1"})})).status).toBe(200);
      const admin=await (await GET(new NextRequest("http://localhost/api/products"))).json();
      expect(admin.products.find((p:{id:string})=>p.id==="1")).toMatchObject({isActive:false,liveStatus:"off"});
      expect(admin.products.find((p:{id:string})=>p.id==="2")).toMatchObject({isActive:true,liveStatus:"live"});
      const publicBody=await (await GET(new NextRequest("http://localhost/api/products?active=1"))).json();
      expect(publicBody.products.map((p:{id:string})=>p.id)).toEqual(["2"]);
      expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(10);
      expect(fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='wr-a'").get()?.wr_stock).toBe(10);
    } finally { fx.close(); }
  });
  it("a pair refresh failure after a successful admin save leaves durable work for cron", async () => {
    const fx=setup();
    try {
      const { PUT }=await import("@/app/api/products/[id]/route");
      await decideDirtyWinners(createDatabaseAccess(fx.db));
      fx.control.fail=q=>q.startsWith("UPDATE supplier_pairs");
      const log=vi.spyOn(console,"error").mockImplementation(()=>{});
      try {
        expect((await PUT(new NextRequest("http://localhost/api/products/2",{method:"PUT",headers:{"content-type":"application/json"},body:'{"isActive":false}'}),{params:Promise.resolve({id:"2"})})).status).toBe(200);
        expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=2").get()?.is_active).toBe(0);
        expect(fx.sql.prepare("SELECT pending FROM supplier_pair_dirty WHERE pair_id=99").get()?.pending).toBe(1);
      } finally { log.mockRestore(); }
      fx.control.fail=null;
      await decideDirtyWinners(createDatabaseAccess(fx.db));
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("WR");
    } finally { fx.close(); }
  });
  it("archiving the winning product promotes its active counterpart immediately", async () => {
    const fx=setup();
    try {
      const { DELETE }=await import("@/app/api/products/[id]/route");
      await decideDirtyWinners(createDatabaseAccess(fx.db));
      expect((await DELETE(new NextRequest("http://localhost/api/products/2",{method:"DELETE"}),{params:Promise.resolve({id:"2"})})).status).toBe(200);
      expect(fx.sql.prepare("SELECT winner,reason FROM supplier_pairs WHERE id=99").get()).toEqual({winner:"WR",reason:"SK nonaktif manual"});
      expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=2").get()?.is_active).toBe(0);
    } finally { fx.close(); }
  });
  it("processes only dirty pairs and clean ticks do not compute pair statistics", async () => {
    const fx=setup();
    try {
      const db=createDatabaseAccess(fx.db);
      expect(await decideDirtyWinners(db)).toEqual({decided:1,changed:1});
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
      expect(await decideDirtyWinners(db)).toEqual({decided:0,changed:0});
      fx.sql.exec("UPDATE product_variants SET stock=stock WHERE id=3");
      expect(await decideDirtyWinners(db)).toEqual({decided:0,changed:0});
      fx.sql.exec("UPDATE sk_products SET sk_price=9000 WHERE sk_variant_id='31'");
      expect(await decideDirtyWinners(db)).toEqual({decided:1,changed:1});
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("WR");
    } finally {fx.close();}
  });
  it("bounds a drain to ten pairs and leaves the remaining work pending", async () => {
    const fx=setup();
    try {
      for(let i=0;i<12;i++) fx.sql.prepare("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id) VALUES(?,?,?)").run(100+i,1000+i,2000+i);
      const db=createDatabaseAccess(fx.db);
      expect((await decideDirtyWinners(db)).decided).toBe(10);
      expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM supplier_pair_dirty WHERE pending=1").get()?.n).toBe(3);
      expect((await decideDirtyWinners(db)).decided).toBe(3);
      expect((await decideDirtyWinners(db)).decided).toBe(0);
    } finally {fx.close();}
  });
  it("a failed write is retained for the next invocation", async () => {
    const fx=setup();
    try {
      fx.control.fail=q=>q.startsWith("UPDATE supplier_pairs");
      await expect(decideDirtyWinners(createDatabaseAccess(fx.db))).rejects.toThrow();
      expect(fx.sql.prepare("SELECT pair_id FROM supplier_pair_dirty WHERE pair_id=99").get()).toBeTruthy();
      fx.control.fail=null;
      expect(await decideDirtyWinners(createDatabaseAccess(fx.db))).toEqual({decided:1,changed:1});
    } finally {fx.close();}
  });
  it("a concurrent source change prevents stale winner writes and stale acks", async () => {
    const fx=setup();
    try {
      const base=createDatabaseAccess(fx.db);
      await decideDirtyWinners(base);
      fx.sql.exec("UPDATE wr_variants SET wr_price=1000 WHERE wr_variant_id='wr-a'");
      const racing={...base,queryAll:async(q:string,...params:unknown[])=>{
        const rows=await base.queryAll(q,...params);
        fx.sql.exec("UPDATE wr_variants SET wr_price=8000 WHERE wr_variant_id='wr-a'");
        return rows;
      }};
      await decideDirtyWinners(racing);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
      expect(fx.sql.prepare("SELECT pair_id FROM supplier_pair_dirty WHERE pair_id=99").get()).toBeTruthy();
      await decideDirtyWinners(base);
      expect(fx.sql.prepare("SELECT pending FROM supplier_pair_dirty WHERE pair_id=99").get()?.pending).toBe(0);
    } finally {fx.close();}
  });
  it("variant deletes and admin preferences are durable invalidations", async () => {
    const fx=setup();
    try {
      const db=createDatabaseAccess(fx.db); await decideDirtyWinners(db);
      fx.sql.exec("UPDATE supplier_pairs SET prefer='WR',prefer_margin=2000 WHERE id=99");
      await decideDirtyWinners(db);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("WR");
      fx.sql.exec("DELETE FROM product_variants WHERE product_id=1");
      await decideDirtyWinners(db);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
    } finally {fx.close();}
  });
  it("retains versions after ack so an old worker cannot consume a later change", async () => {
    const fx=setup();
    try {
      const base=createDatabaseAccess(fx.db);
      await decideDirtyWinners(base);
      fx.sql.exec("UPDATE wr_variants SET wr_price=1000 WHERE wr_variant_id='wr-a'");
      const racing={...base,queryAll:async(q:string,...params:unknown[])=>{
        const rows=await base.queryAll(q,...params);
        await decideDirtyWinners(base); // Another worker writes WR and acks.
        fx.sql.exec("UPDATE wr_variants SET wr_price=8000 WHERE wr_variant_id='wr-a'");
        return rows;
      }};
      await decideDirtyWinners(racing);
      expect(fx.sql.prepare("SELECT pending FROM supplier_pair_dirty WHERE pair_id=99").get()?.pending).toBe(1);
      await decideDirtyWinners(base);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
    } finally {fx.close();}
  });
  it("a full sweep cannot overwrite a newer source change already processed by a diff", async () => {
    const fx=setup();
    try {
      const base=createDatabaseAccess(fx.db);
      await decideDirtyWinners(base);
      fx.sql.exec("UPDATE wr_variants SET wr_price=1000 WHERE wr_variant_id='wr-a'");
      const racing={...base,queryAll:async(q:string,...params:unknown[])=>{
        const rows=await base.queryAll(q,...params);
        fx.sql.exec("UPDATE wr_variants SET wr_price=8000 WHERE wr_variant_id='wr-a'");
        await decideDirtyWinners(base);
        return rows;
      }};
      await decideAllWinners(racing);
      expect(fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get()?.winner).toBe("SK");
      expect(fx.sql.prepare("SELECT pending FROM supplier_pair_dirty WHERE pair_id=99").get()?.pending).toBe(0);
    } finally {fx.close();}
  });
});

describe("decideOneWinner: stok dulu, modal kemudian", () => {
  it.each([
    [0,1,"SK","WR nonaktif manual"],
    [1,0,"WR","SK nonaktif manual"],
    [0,0,null,"dua-duanya nonaktif manual"],
  ])("activation WR=%s SK=%s overrides price/preference without enabling either product", async(wr,sk,winner,reason)=>{
    const fx=createD1Fixture();
    try {
      seedPairProducts(fx);
      fx.sql.prepare("UPDATE products SET is_active=? WHERE id=1").run(wr);
      fx.sql.prepare("UPDATE products SET is_active=? WHERE id=2").run(sk);
      // Even an out-of-stock active side must remain the sole representative.
      fx.sql.exec("UPDATE product_variants SET stock=0");
      expect(await decideOneWinner(pair({prefer:wr===0?"WR":"SK"}),createDatabaseAccess(fx.db))).toEqual({winner,reason});
      expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=1").get()?.is_active).toBe(wr);
      expect(fx.sql.prepare("SELECT is_active FROM products WHERE id=2").get()?.is_active).toBe(sk);
    } finally { fx.close(); }
  });
  it("keeps unlimited stock purchasable in the combined stock aggregate", async () => {
    const fx = createD1Fixture();
    try {
      seedPairProducts(fx);
      fx.sql.exec("UPDATE product_variants SET stock=-1 WHERE id=1; UPDATE product_variants SET stock=0 WHERE id=3");
      const result = await decideOneWinner(pair(), createDatabaseAccess(fx.db));
      expect(result.winner).toBe("WR");
      expect(result.reason).toContain(String(Number.MAX_SAFE_INTEGER));
    } finally { fx.close(); }
  });

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

  it("dua-duanya habis → NULL, tapi SK tetap pecundang (WR = wakil 1 kartu, Opsi B 2026-10-02)", async () => {
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
      // Opsi B: winner None bukan berarti dua-duanya tampil — sisi SK
      // disembunyikan, WR tampil sebagai wakil (1 barang = 1 kartu).
      // decideOneWinner tidak menulis DB; simulasikan baris None tersimpan.
      fx.sql.prepare("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id,winner) VALUES(50,1,2,NULL)").run();
      const losers = await loserProductIds(db);
      expect(losers.has(2), "SK disembunyikan saat None").toBe(true);
      expect(losers.has(1), "WR tampil sebagai wakil saat None").toBe(false);
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

  it("1 SELECT agregat untuk semua pasangan + UPDATE hanya baris berubah (insiden 1102 2026-10-10)", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      seedPairProducts(fx);
      fx.sql.prepare("INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id) VALUES(99,1,2)").run();
      const base = createDatabaseAccess(fx.db);
      await decideAllWinners(base); // putaran pertama menulis keputusan
      const calls = { read: 0, write: 0 };
      const counted = {
        ...base,
        queryAll: (q: string, ...p: unknown[]) => { calls.read++; return base.queryAll(q, ...p); },
        queryFirst: (q: string, ...p: unknown[]) => { calls.read++; return base.queryFirst(q, ...p); },
        execRun: (q: string, ...p: unknown[]) => { calls.write++; return base.execRun(q, ...p); },
      };
      const out = await decideAllWinners(counted);
      expect(out.decided).toBeGreaterThanOrEqual(34);
      expect(calls.read, "satu SELECT, bukan ±9 query per pasangan").toBe(1);
      expect(calls.write, "tanpa perubahan = tanpa UPDATE").toBe(0);
      // Stok SK habis → hanya pasangan 99 yang berubah → tepat 1 UPDATE.
      fx.sql.prepare("UPDATE product_variants SET stock=0 WHERE id=3").run();
      fx.sql.prepare("UPDATE sk_products SET sk_stock=0 WHERE sk_variant_id='31'").run();
      calls.write = 0;
      const out2 = await decideAllWinners(counted);
      expect(out2.changed).toBeGreaterThanOrEqual(1);
      const row = fx.sql.prepare("SELECT winner FROM supplier_pairs WHERE id=99").get() as Record<string, unknown>;
      expect(row.winner).toBe("WR");
      expect(calls.write).toBeGreaterThanOrEqual(1);
      expect(calls.write).toBeLessThan(5);
    } finally { fx.close(); }
  });
});
