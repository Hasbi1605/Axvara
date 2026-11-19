// Angka "terjual" pembeli untuk produk anggota grup = jumlah sold_count semua
// anggota (termasuk nonaktif/arsip). Nilai tersimpan tidak pernah diubah.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

const auth = vi.hoisted(() => ({ admin: false as boolean }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)) }));

let f: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  auth.admin = false;
  f = createD1Fixture();
  f.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock,source,is_active,sold_count) VALUES
      (1,'Winner','winner',10000,5,'manual',1,1),
      (2,'Sibling','sibling',10000,5,'manual',1,92),
      (3,'Arsip','arsip',10000,5,'manual',0,58),
      (4,'Solo','solo',10000,5,'manual',1,7);
    INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,manual_cost) VALUES
      (1,'A','A',10000,5,1,4000),(2,'B','B',10000,5,1,5000),(3,'C','C',10000,5,1,6000),(4,'D','D',10000,5,1,7000);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES(1,'G',1);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1),(1,3,2);
    UPDATE products SET archived_at='2026-11-01' WHERE id=3;
  `);
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); });

const list = async (url: string) => {
  const { GET } = await import("@/app/api/products/route");
  const res = await GET(new NextRequest(url));
  expect(res.status).toBe(200);
  return (await res.json() as { products: Array<{ id: string; soldCount: number; groupSoldCount?: number }> }).products;
};

describe("terjual grup", () => {
  it("katalog publik: winner = total grup, produk tanpa grup tetap", async () => {
    const rows = await list("http://localhost/api/products?active=1");
    expect(rows.find((r) => r.id === "1")?.soldCount).toBe(151);
    expect(rows.find((r) => r.id === "4")?.soldCount).toBe(7);
    expect(rows.find((r) => r.id === "1")?.groupSoldCount).toBeUndefined();
  });

  it("admin: soldCount sendiri + groupSoldCount", async () => {
    auth.admin = true;
    const rows = await list("http://localhost/api/products");
    expect(rows.find((r) => r.id === "1")).toMatchObject({ soldCount: 1, groupSoldCount: 151 });
    expect(rows.find((r) => r.id === "4")?.soldCount).toBe(7);
    expect(rows.find((r) => r.id === "4")?.groupSoldCount).toBeUndefined();
  });

  it("getProductDetail memakai total grup", async () => {
    const { getProductDetail } = await import("@/lib/catalog");
    expect((await getProductDetail("winner"))?.sold_count).toBe(151);
    expect((await getProductDetail("solo"))?.sold_count).toBe(7);
  });

  it("katalog Telegram memakai total grup", async () => {
    const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
    const rows = await readTelegramCatalog();
    expect(rows.find((r) => r.id === 1)?.sold_count).toBe(151);
    expect(rows.find((r) => r.id === 4)?.sold_count).toBe(7);
  });

  it("nilai tersimpan tidak berubah", async () => {
    await list("http://localhost/api/products?active=1");
    const stored = f.sql.prepare("SELECT id, sold_count FROM products ORDER BY id").all();
    expect(stored.map((r) => Number(r.sold_count))).toEqual([1, 92, 58, 7]);
  });
});
