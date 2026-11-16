// Compatibility callers must retain durable invalidation and race protection
// after the pair model moves to N-member product groups.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDatabaseAccess, createBudgetedDatabase } from "@/lib/db-access";
import { decideAllWinners, decideDirtyWinners } from "@/lib/supplier-pairs";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => true, rateLimit: () => true, rateLimitKey: () => "fixture" }));

describe("durable product group queue through legacy callers", () => {
  let f: ReturnType<typeof createD1Fixture>;
  beforeEach(() => {
    f = createD1Fixture();
    f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,sk_product_id) VALUES
        (1,'WR','wr',15000,10,'warung_rebahan','wr-p',NULL),(2,'SK','sk',15000,5,'manual',NULL,'sk-p');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,wr_variant_id,sk_variant_id) VALUES
        (1,1,'WR','WR',15000,10,'wr-a',NULL),(2,2,'SK','SK',15000,5,NULL,'sk-a');
      INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('wr-p','WR',1);
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,wr_delivery_class)
        VALUES('wr-a','wr-p','WR',5000,10,'restock');
      INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock)
        VALUES('sk-a','sk-p','SK','SK',4000,5);
      INSERT INTO product_groups(id,name,prefer_margin) VALUES(99,'WR/SK',2000);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(99,1,0),(99,2,1);
    `);
  });
  afterEach(() => { f.close(); vi.restoreAllMocks(); });
  const row = () => f.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=99").get();
  const dirty = () => f.sql.prepare("SELECT version,pending FROM product_group_dirty WHERE group_id=99").get();

  it("OFF only invalidates on change; targeted ON/OFF recomputes without changing supplier stock", async () => {
    const db = createDatabaseAccess(f.db);
    await decideDirtyWinners(db);
    const previous = dirty();
    f.sql.exec("UPDATE products SET is_active=1 WHERE id=2");
    expect(dirty()).toEqual(previous);
    f.sql.exec("UPDATE products SET is_active=0 WHERE id=2");
    expect(dirty()?.version).not.toBe(previous?.version);
    expect(await decideDirtyWinners(db, 99999)).toEqual({ decided: 0, changed: 0 });
    expect(await decideDirtyWinners(db, 2)).toEqual({ decided: 1, changed: 1 });
    expect(row()?.winner_product_id).toBe(1);
    f.sql.exec("UPDATE products SET is_active=1 WHERE id=2");
    await decideDirtyWinners(db, 2);
    expect(row()?.winner_product_id).toBe(2);
    expect(f.sql.prepare("SELECT sk_stock FROM sk_products").get()?.sk_stock).toBe(5);
  });

  it("admin toggle refreshes GET admin/public and /api/catalog before returning", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const { GET } = await import("@/app/api/products/route");
    const { listActiveProducts } = await import("@/lib/catalog");
    f.sql.exec("UPDATE wr_variants SET wr_price=1000");
    await decideDirtyWinners(createDatabaseAccess(f.db));
    expect(row()?.winner_product_id).toBe(1);
    const response = await PUT(new NextRequest("http://localhost/api/products/1", { method: "PUT", headers: { "content-type": "application/json" }, body: '{"isActive":false}' }), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(200);
    const admin = await (await GET(new NextRequest("http://localhost/api/products"))).json();
    expect(admin.products.find((p: { id: string }) => p.id === "1")).toMatchObject({ isActive: false, liveStatus: "off" });
    expect(admin.products.find((p: { id: string }) => p.id === "2")).toMatchObject({ isActive: true, liveStatus: "live" });
    const catalog = await (await GET(new NextRequest("http://localhost/api/products?active=1"))).json();
    expect(catalog.products.map((p: { id: string }) => p.id)).toEqual(["2"]);
    expect((await listActiveProducts()).map(p => p.id)).toEqual([2]);
    expect(f.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(10);
  });

  it("failed refresh after admin save keeps durable pending work", async () => {
    const { PUT } = await import("@/app/api/products/[id]/route");
    const db = createDatabaseAccess(f.db);
    await decideDirtyWinners(db);
    f.control.fail = q => q.startsWith("UPDATE product_groups");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await PUT(new NextRequest("http://localhost/api/products/2", { method: "PUT", headers: { "content-type": "application/json" }, body: '{"isActive":false}' }), { params: Promise.resolve({ id: "2" }) })).status).toBe(200);
    expect(dirty()?.pending).toBe(1);
    f.control.fail = null;
    await decideDirtyWinners(db);
    expect(row()?.winner_product_id).toBe(1);
  });

  it("archiving the winner promotes the active counterpart", async () => {
    const { DELETE } = await import("@/app/api/products/[id]/route");
    await decideDirtyWinners(createDatabaseAccess(f.db));
    expect((await DELETE(new NextRequest("http://localhost/api/products/2", { method: "DELETE" }), { params: Promise.resolve({ id: "2" }) })).status).toBe(200);
    expect(row()?.winner_product_id).toBe(1);
  });

  it("clean ticks skip statistics; preference and variant deletion remain durable", async () => {
    const db = createDatabaseAccess(f.db);
    await decideDirtyWinners(db);
    expect(await decideDirtyWinners(db)).toEqual({ decided: 0, changed: 0 });
    f.sql.exec("UPDATE product_variants SET stock=stock");
    expect(await decideDirtyWinners(db)).toEqual({ decided: 0, changed: 0 });
    f.sql.exec("UPDATE product_groups SET prefer_product_id=1 WHERE id=99");
    await decideDirtyWinners(db);
    expect(row()?.winner_product_id).toBe(1);
    f.sql.exec("DELETE FROM product_variants WHERE product_id=1");
    await decideDirtyWinners(db);
    expect(row()?.winner_product_id).toBe(2);
  });

  it("limits the queue to ten WHOLE groups, never ten member rows", async () => {
    for (let i = 0; i < 12; i++) f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock) VALUES(${100+i*2},'A','a${i}',1,0),(${101+i*2},'B','b${i}',1,0);
      INSERT INTO product_groups(id,name) VALUES(${100+i},'G${i}');
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(${100+i},${100+i*2},0),(${100+i},${101+i*2},1);
    `);
    const db = createDatabaseAccess(f.db);
    expect((await decideDirtyWinners(db)).decided).toBe(10);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_dirty WHERE pending=1").get()?.n).toBe(3);
    expect((await decideDirtyWinners(db)).decided).toBe(3);
    expect((await decideDirtyWinners(db)).decided).toBe(0);
  });

  it("failed SELECT/write propagates and budget exhaustion leaves work pending", async () => {
    const db = createDatabaseAccess(f.db);
    f.control.fail = q => q.includes("AS st_stock");
    await expect(decideDirtyWinners(db)).rejects.toThrow("Injected");
    f.control.fail = q => q.startsWith("UPDATE product_groups");
    await expect(decideDirtyWinners(db)).rejects.toThrow("Injected");
    expect(dirty()?.pending).toBe(1);
    f.control.fail = null;
    expect(await decideDirtyWinners(createBudgetedDatabase(3, 1, f.db).access)).toEqual({ decided: 0, changed: 0 });
    expect(await decideDirtyWinners(db)).toEqual({ decided: 1, changed: 1 });
  });

  it.each(["source race", "already acknowledged", "full sweep"])("stale decision/ack cannot win a %s", async mode => {
    const base = createDatabaseAccess(f.db);
    await decideDirtyWinners(base);
    f.sql.exec("UPDATE wr_variants SET wr_price=1000");
    const racing = { ...base, queryAll: async (q: string, ...params: unknown[]) => {
      const rows = await base.queryAll(q, ...params);
      if (mode === "already acknowledged") await decideDirtyWinners(base);
      f.sql.exec("UPDATE wr_variants SET wr_price=8000");
      if (mode === "full sweep") await decideDirtyWinners(base);
      return rows;
    } };
    const result = await (mode === "full sweep" ? decideAllWinners(racing) : decideDirtyWinners(racing));
    expect(result.changed).toBe(0);
    expect(dirty()?.pending).toBe(mode === "full sweep" ? 0 : 1);
    await decideDirtyWinners(base);
    expect(row()?.winner_product_id).toBe(2);
    expect(dirty()?.pending).toBe(0);
    expect(dirty()?.version).toBeTypeOf("string");
  });

  it("one statistics SELECT for the full sweep; unchanged decisions do not write", async () => {
    const db = createDatabaseAccess(f.db);
    const query = vi.spyOn(db, "queryAll");
    const write = vi.spyOn(db, "execRun");
    await decideAllWinners(db);
    expect(query).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    write.mockClear();
    expect(await decideAllWinners(db)).toEqual({ decided: 1, changed: 0 });
    expect(write).not.toHaveBeenCalled();
  });
});
