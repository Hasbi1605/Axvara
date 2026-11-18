import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { JASPAY_LEGACY_PRODUCTS } from "@/lib/warung-rebahan/new-sales";
import {
  decideAllGroups,
  decideDirtyGroups,
  decideGroupFromStats,
  loserProductIds,
  notLoserProductSql,
  listProductGroups,
  winnerForLoserProduct,
  type GroupMemberStats,
} from "@/lib/product-groups";

const member = (over: Partial<GroupMemberStats>): GroupMemberStats => ({
  productId: 1, name: "Produk", slug: "produk", image: null, supplier: "SK", position: 0,
  exists: true, isActive: true, archived: false, stock: 5, modal: 10000, ...over,
});

describe("decideGroupFromStats — aturan grup lintas supplier", () => {
  const group = { preferProductId: null, preferMargin: 2000 };

  it("manual live selalu menang walau supplier jauh lebih murah", () => {
    const out = decideGroupFromStats(group, [
      member({ productId: 1, name: "Manual", supplier: "Manual", stock: 2, modal: 90000 }),
      member({ productId: 2, name: "Murah", supplier: "SK", stock: 99, modal: 1000 }),
    ]);
    expect(out.winnerProductId).toBe(1);
    expect(out.reason).toBe("Manual live (Manual #1)");
  });

  it("beberapa manual live: stok dulu (∞ tertinggi), lalu modal", () => {
    const out = decideGroupFromStats(group, [
      member({ productId: 1, name: "M1", supplier: "Manual", stock: 5, modal: 1000 }),
      member({ productId: 2, name: "M2", supplier: "Manual", stock: -1, modal: 9000 }),
      member({ productId: 3, name: "M3", supplier: "Manual", stock: 5, modal: 500 }),
    ]);
    expect(out.winnerProductId).toBe(2);
  });

  it("manual habis → supplier bersaing; stok dulu", () => {
    const out = decideGroupFromStats(group, [
      member({ productId: 1, name: "Manual", supplier: "Manual", stock: 0, modal: 1 }),
      member({ productId: 2, name: "WR", supplier: "WR", stock: 0, modal: 1 }),
      member({ productId: 3, name: "SK", supplier: "SK", stock: 7, modal: 9000 }),
    ]);
    expect(out.winnerProductId).toBe(3);
    expect(out.reason).toContain("modal/30 hari");
  });

  it("modal per 30 hari memakai nilai yang sudah dinormalisasi (Surfshark 7 hari vs 1 bulan)", () => {
    // WR 7 hari Rp3.500 = Rp15.000/30hari; SK 1 bulan Rp8.350.
    const out = decideGroupFromStats(group, [
      member({ productId: 1, name: "WR", supplier: "WR", stock: 9, modal: 15000 }),
      member({ productId: 2, name: "SK", supplier: "SK", stock: 9, modal: 8350 }),
    ]);
    expect(out.winnerProductId).toBe(2);
    expect(out.reason).toBe("modal/30 hari SK Rp8.350 < WR Rp15.000");
  });

  it("prefer admin menang bila selisih ≤ margin; modal menang bila selisih besar", () => {
    const members = [
      member({ productId: 1, name: "Prefer", supplier: "WR", stock: 5, modal: 10000 }),
      member({ productId: 2, name: "Murah", supplier: "SK", stock: 5, modal: 8500 }),
    ];
    expect(decideGroupFromStats({ preferProductId: 1, preferMargin: 2000 }, members).winnerProductId).toBe(1);
    expect(decideGroupFromStats({ preferProductId: 1, preferMargin: 500 }, members).winnerProductId).toBe(2);
  });

  it("semua habis → wakil prefer aktif, lalu manual aktif, lalu position", () => {
    const soldout = [
      member({ productId: 3, name: "SK", supplier: "SK", stock: 0, modal: null }),
      member({ productId: 5, name: "Manual", supplier: "Manual", stock: 0, modal: 1000 }),
      member({ productId: 7, name: "WR", supplier: "WR", stock: 0, modal: 2000 }),
    ];
    expect(decideGroupFromStats({ preferProductId: 7, preferMargin: 0 }, soldout).winnerProductId).toBe(7);
    expect(decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, soldout).winnerProductId).toBe(5);
    expect(decideGroupFromStats({ preferProductId: 99, preferMargin: 0 }, soldout).winnerProductId).toBe(5);
    const noManual = soldout.filter((m) => m.supplier !== "Manual");
    expect(decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, noManual).winnerProductId).toBe(3);
  });

  it("nonaktif/arsip tidak menahan anggota aktif; stok -1 ditulis ∞", () => {
    const out = decideGroupFromStats(group, [
      member({ productId: 1, name: "Off", supplier: "Manual", isActive: false, stock: 99 }),
      member({ productId: 2, name: "Arsip", supplier: "SK", archived: true, stock: 99 }),
      member({ productId: 3, name: "WR", supplier: "WR", stock: -1, modal: 5000 }),
    ]);
    expect(out.winnerProductId).toBe(3);
    const exhausted = decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, [
      member({ productId: 1, name: "Off", isActive: false }),
      member({ productId: 2, name: "WR", supplier: "WR", stock: -1, modal: null }),
    ]);
    expect(exhausted.winnerProductId).toBe(2);
    expect(exhausted.reason).toContain("stok ∞");
    const allSold = decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, [
      member({ productId: 2, name: "WR", supplier: "WR", stock: 0, modal: null }),
    ]);
    expect(allSold.reason).toContain("stok 0");
    const noMembers = decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, [
      member({ productId: 1, isActive: false }),
    ]);
    expect(noMembers).toEqual({ winnerProductId: null, reason: "semua anggota nonaktif manual" });
  });

  it("nonaktif/arsip tidak pernah winner/wakil, prefer nonaktif diabaikan", () => {
    // Manual nonaktif + supplier aktif → supplier menang.
    const out = decideGroupFromStats({ preferProductId: null, preferMargin: 0 }, [
      member({ productId: 1, name: "Manual off", supplier: "Manual", isActive: false, stock: 9, modal: 1 }),
      member({ productId: 2, name: "SK", supplier: "SK", stock: 4, modal: 9000 }),
    ]);
    expect(out.winnerProductId).toBe(2);
    // Prefer menunjuk anggota nonaktif → diabaikan.
    const preferInactive = decideGroupFromStats({ preferProductId: 1, preferMargin: 1_000_000 }, [
      member({ productId: 1, name: "Manual off", supplier: "Manual", isActive: false, stock: 9, modal: 1 }),
      member({ productId: 2, name: "SK", supplier: "SK", stock: 4, modal: 9000 }),
    ]);
    expect(preferInactive.winnerProductId).toBe(2);
    // Satu-satunya anggota aktif berstok 0 → wakil (bukan anggota nonaktif).
    const soleZero = decideGroupFromStats({ preferProductId: 1, preferMargin: 1_000_000 }, [
      member({ productId: 1, name: "Manual off", isActive: false, stock: 9 }),
      member({ productId: 3, name: "Habis", supplier: "WR", stock: 0, modal: 5000 }),
    ]);
    expect(soleZero.winnerProductId).toBe(3);
    expect(soleZero.reason).toContain("stok 0");
    // Semua nonaktif/arsip → NULL.
    expect(decideGroupFromStats({ preferProductId: 1, preferMargin: 0 }, [
      member({ productId: 1, isActive: false }), member({ productId: 2, archived: true }),
    ])).toEqual({ winnerProductId: null, reason: "semua anggota nonaktif manual" });
  });

  it("modal tak terbaca tidak boleh memilih prefer yang stoknya habis", () => {
    const out = decideGroupFromStats({ preferProductId: 1, preferMargin: 2000 }, [
      member({ productId: 1, stock: 0, modal: null }),
      member({ productId: 2, stock: -1, modal: null }),
    ]);
    expect(out.winnerProductId).toBe(2);
    expect(out.reason).toContain("stok ∞");
  });
});

describe("product groups — DB & invalidation", () => {
  let f: ReturnType<typeof createD1Fixture>;
  beforeEach(() => {
    f = createD1Fixture();
    f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,source,is_active,wr_product_id,sk_product_id) VALUES
        (1,'Manual S&K','manual',20000,5,'manual',1,NULL,NULL),
        (2,'WR Jaspay','wr',20000,9,'warung_rebahan',1,'p1',NULL),
        (3,'SK Premium','sk',20000,9,'manual',1,NULL,'sp1');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,duration_value,duration_unit,manual_cost,wr_variant_id,sk_variant_id) VALUES
        (11,1,'MAN','Manual',20000,5,1,NULL,NULL,5000,NULL,NULL),
        (12,2,'WR','WR',20000,9,1,7,'day',0,'w1',NULL),
        (13,3,'SK','SK',20000,9,1,1,'month',0,NULL,'s1');
      INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('p1','WR',2);
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,wr_delivery_class,axvara_variant_id) VALUES('w1','p1','WR',3500,9,'restock',12);
      INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,axvara_variant_id) VALUES('s1','sp1','SK','SK',8350,9,13);
      INSERT INTO product_groups(id,name,prefer_margin) VALUES(1,'Grup Uji',2000);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1),(1,3,2);
    `);
  });
  afterEach(() => f.close());

  it("manual live menang; setelah manual habis SK 1 bulan mengalahkan WR 7 hari", async () => {
    const db = createDatabaseAccess(f.db);
    const first = await decideAllGroups(db);
    expect(first.decided).toBe(1);
    let row = f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get() as { winner_product_id: number; reason?: string };
    expect(row.winner_product_id).toBe(1);

    f.sql.exec("UPDATE product_variants SET stock=0 WHERE id=11");
    await decideDirtyGroups(db);
    row = f.sql.prepare("SELECT winner_product_id,reason FROM product_groups WHERE id=1").get() as { winner_product_id: number; reason: string };
    expect(row.winner_product_id).toBe(3);
    expect(row.reason).toContain("modal/30 hari SK Rp8.350 < WR Rp15.000");
  });

  it("loser ids/SQL/winner redirect mengikuti winner_product_id", async () => {
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    const losers = await loserProductIds(db);
    expect([...losers].sort()).toEqual([2, 3]);
    const visible = f.sql.prepare(`SELECT p.id FROM products p WHERE ${notLoserProductSql("p")} ORDER BY id`).all() as { id: number }[];
    expect(visible.map((r) => r.id)).toEqual([1]);
    expect(await winnerForLoserProduct(2, db)).toBe(1);
    expect(await winnerForLoserProduct(1, db)).toBeNull();
  });

  it.each([
    [0, 9, 9, 9, 2, 0, 9],
    [9, 9, 0, 9, 3, 9, 0],
    [-1, 3, 9, 9, 3, 3, 9],
    [3, -1, 0, 9, 3, 3, 0],
    [-1, -1, 9, 9, 3, -1, 9],
    [9, 9, -1, 3, 3, 9, 3],
    [0, 9, 3, -1, 2, 0, 3],
  ])("two suppliers cap local/mirror: SK %s/%s WR %s/%s", async (localSk, mirrorSk, localWr, mirrorWr, winner, skStock, wrStock) => {
    f.sql.exec("DELETE FROM product_group_members WHERE product_id=1");
    f.sql.prepare("UPDATE product_variants SET stock=? WHERE id=13").run(localSk);
    f.sql.prepare("UPDATE sk_products SET sk_stock=? WHERE sk_variant_id='s1'").run(mirrorSk);
    f.sql.prepare("UPDATE product_variants SET stock=? WHERE id=12").run(localWr);
    f.sql.prepare("UPDATE wr_variants SET wr_stock=? WHERE wr_variant_id='w1'").run(mirrorWr);
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    const [group] = await listProductGroups(db);
    expect(group.winner_product_id).toBe(winner);
    expect(group.members.find(m => m.product_id === 3)?.stock).toBe(skStock);
    expect(group.members.find(m => m.product_id === 2)?.stock).toBe(wrStock);
  });

  it.each(["sk_products", "wr_variants"])("inactive %s cannot hold a stocked supplier", async table => {
    f.sql.exec(`DELETE FROM product_group_members WHERE product_id=1; UPDATE ${table} SET is_active=0`);
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    const [group] = await listProductGroups(db);
    expect(group.winner_product_id).toBe(table === "sk_products" ? 2 : 3);
  });

  it("grup tanpa winner tidak menyembunyikan anggota", async () => {
    f.sql.exec("UPDATE product_group_members SET product_id=10 WHERE product_id=1; INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(10,'Off','off',1,0,0)");
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()?.winner_product_id).toBe(3);
    f.sql.exec("UPDATE products SET is_active=0 WHERE id IN (2,3,10)");
    await decideAllGroups(db);
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()?.winner_product_id).toBeNull();
    expect([...(await loserProductIds(db))]).toEqual([]);
  });

  it("trigger menandai dirty saat stok berubah dan ack hanya versi yang diproses", async () => {
    const db = createDatabaseAccess(f.db);
    f.sql.exec("UPDATE product_group_dirty SET pending=0");
    f.sql.exec("UPDATE product_variants SET stock=-1 WHERE id=13");
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=1").get()?.pending).toBe(1);
    const out = await decideDirtyGroups(db);
    expect(out.decided).toBe(1);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_dirty WHERE pending=1").get()?.n).toBe(0);
  });

  it.each([
    [7, "day", 3500, 15000], [1, "month", 8350, 8350], [1, "year", 36500, 3000],
    [1, "lifetime", 12000, 12000], [null, "custom", 12000, 12000], [null, null, 0, 0],
  ])("normalisasi SQL %s %s; manual cost 0 sah", async (duration, unit, cost, expected) => {
    f.sql.prepare("UPDATE product_variants SET duration_value=?,duration_unit=?,manual_cost=? WHERE id=11").run(duration, unit, cost);
    const [group] = await listProductGroups(createDatabaseAccess(f.db));
    expect(group.members[0].modal_per_30d).toBe(expected);
  });

  it("WR MBO yang tergantikan Jaspay dikeluarkan dan decided_at diteruskan ke admin", async () => {
    f.sql.exec("UPDATE product_variants SET stock=0 WHERE id=11; UPDATE wr_variants SET wr_delivery_class='made_by_order'; UPDATE sk_products SET sk_stock=0");
    f.sql.exec(`UPDATE products SET wr_product_id='${JASPAY_LEGACY_PRODUCTS.scribd}' WHERE id=2`);
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    const [group] = await listProductGroups(db);
    expect(group.members[1]).toMatchObject({ stock: 0, live: false, modal_per_30d: null });
    expect(group.decided_at).toBe(f.sql.prepare("SELECT decided_at FROM product_groups WHERE id=1").get()?.decided_at);
    expect(group.decided_at).toBeTypeOf("string");
  });

  it("WR MBO tanpa pengganti Jaspay tetap bersaing (stok & modal terbaca)", async () => {
    f.sql.exec("UPDATE product_variants SET stock=0 WHERE id=11; UPDATE wr_variants SET wr_delivery_class='made_by_order'; UPDATE sk_products SET sk_stock=0");
    const db = createDatabaseAccess(f.db);
    await decideAllGroups(db);
    const [group] = await listProductGroups(db);
    expect(group.members[1]).toMatchObject({ product_id: 2, stock: 9, live: true });
    expect(group.winner_product_id).toBe(2);
  });

  it("modal akun TUNVN, Buff, AIVault memakai sumber sendiri dan fallback FX", async () => {
    f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,tunvn_family,aivault_family) VALUES
        (4,'TUNVN','tunvn',1,2,'gpt',NULL),(5,'Buff','buff',1,-1,'muse',NULL),(6,'AV','av',1,2,NULL,'gemini');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,tunvn_source_product_id,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_fx_idr_per_usdt,aivault_service_id) VALUES
        (14,4,'TUNVN-100','T',1,2,100,NULL,NULL,NULL,NULL),
        (15,5,'TUNVN-BUFF-1B','B',1,-1,NULL,1,0.5,18000,NULL),
        (16,6,'AV-gemini','AV',1,2,NULL,NULL,NULL,NULL,'gemini');
      INSERT INTO tunvn_products(supplier_product_id,name,price_usdt) VALUES(100,'T',1);
      INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json) VALUES('gemini','AV',2,'[]');
      INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_effective_at) VALUES(1,'16000','2026-11-16');
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,4,3),(1,5,4),(1,6,5);
    `);
    const db = createDatabaseAccess(f.db);
    const [group] = await listProductGroups(db);
    expect(group.members.slice(3).map(m => [m.supplier, m.modal_per_30d])).toEqual([["TUNVN",16000],["TUNVN",9000],["AIVault",32000]]);
    await decideDirtyGroups(db);
    f.sql.exec("UPDATE tunvn_products SET price_usdt=2 WHERE supplier_product_id=100");
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=1").get()?.pending).toBe(1);
    const [updated] = await listProductGroups(db);
    expect(updated.members[3].modal_per_30d).toBe(32000);
  });

  it("modal Mirai memakai mirai_cost_usdt x frozen/current FX", async () => {
    f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,mirai_family) VALUES(7,'Mirai GPT','api-gpt-token-mr',1,-1,'gpt');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt) VALUES
        (17,7,'MR-GPT_10M','10M Token · 1 Hari',5600,-1,'GPT_10M',0.5,20000);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,7,3);
    `);
    const db = createDatabaseAccess(f.db);
    const [group] = await listProductGroups(db);
    expect(group.members[3]).toMatchObject({ supplier: "Mirai", modal_per_30d: 10000 });
    await decideDirtyGroups(db);
    f.sql.exec("UPDATE product_variants SET mirai_cost_usdt=0.25 WHERE id=17");
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=1").get()?.pending).toBe(1);
    const [updated] = await listProductGroups(db);
    expect(updated.members[3].modal_per_30d).toBe(5000);
  });

  it("Manual unique tanpa kredensial atau di bawah minimum tidak mengalahkan supplier", async () => {
    const db = createDatabaseAccess(f.db);
    f.sql.exec("UPDATE product_variants SET fulfillment_mode='unique',stock=-1 WHERE id=11");
    await decideDirtyGroups(db);
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()?.winner_product_id).toBe(3);
    f.sql.exec("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,11,'fixture','fixture','fixture')");
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=1").get()?.pending).toBe(1);
    await decideDirtyGroups(db);
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()?.winner_product_id).toBe(1);
    f.sql.exec("UPDATE product_variants SET min_qty=2 WHERE id=11");
    await decideDirtyGroups(db);
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()?.winner_product_id).toBe(3);
  });

  it("orphan legacy groups are acknowledged, not stuck at the front of the queue", async () => {
    f.sql.exec("INSERT INTO product_groups(id,name,winner_product_id) VALUES(2,'Orphan',999); INSERT INTO product_group_dirty(group_id,version) VALUES(2,'orphan')");
    await decideDirtyGroups(createDatabaseAccess(f.db));
    expect(f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=2").get()?.winner_product_id).toBeNull();
    expect(f.sql.prepare("SELECT pending FROM product_group_dirty WHERE group_id=2").get()?.pending).toBe(0);
  });
});
