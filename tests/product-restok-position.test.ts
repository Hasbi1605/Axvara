import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { sortProductsForDisplay } from "@/lib/product-order";
import { createProductGroup, addGroupMember, decideGroup } from "@/lib/product-groups";

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)),
}));

let f: ReturnType<typeof createD1Fixture>;

const reorderReq = (body: unknown) =>
  new NextRequest("http://localhost/api/products/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const putReq = (id: number, body: unknown) =>
  new NextRequest(`http://localhost/api/products/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function callReorder(body: unknown) {
  const { POST } = await import("@/app/api/products/reorder/route");
  return POST(reorderReq(body));
}

async function callPut(id: number, body: unknown) {
  const { PUT } = await import("@/app/api/products/[id]/route");
  return PUT(putReq(id, body), { params: Promise.resolve({ id: String(id) }) });
}

function getSortOrder(id: number): number {
  const row = f.sql.prepare("SELECT sort_order FROM products WHERE id=?").get(id) as { sort_order: number };
  return Number(row.sort_order);
}

function getCatAndSort(id: number): { category_id: number | null; sort_order: number } {
  return f.sql.prepare("SELECT category_id, sort_order FROM products WHERE id=?").get(id) as {
    category_id: number | null;
    sort_order: number;
  };
}

beforeEach(() => {
  auth.admin = true;
  clearRateLimitBucketsForTest();
  f = createD1Fixture();
  f.sql.exec(`
    DELETE FROM categories;
    INSERT INTO categories(id,name,slug,sort_order) VALUES
      (1,'AI','ai',10),
      (2,'Streaming','streaming',20);
  `);
});

afterEach(() => {
  f.close();
  vi.unstubAllEnvs();
});

describe("invarian slot urutan produk (slot tetap lintas stok dan grup)", () => {
  it("reorder saat produk X habis tidak menggeser slot relatif X; setelah X restok ia kembali ke posisi semula", async () => {
    // 5 produk di kategori AI: P1(10), P2(20), P3/X(30, habis), P4(40), P5(50)
    f.sql.exec(`
      INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
        (1,1,'P1','p1',10000,5,1,10),
        (2,1,'P2','p2',10000,5,1,20),
        (3,1,'X SoldOut','x-sold',10000,0,1,30),
        (4,1,'P4','p4',10000,5,1,40),
        (5,1,'P5','p5',10000,5,1,50);
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES
        (1,'S1','1B',10000,5,1),
        (2,'S2','1B',10000,5,1),
        (3,'S3','1B',10000,0,1),
        (4,'S4','1B',10000,5,1),
        (5,'S5','1B',10000,5,1);
    `);

    // Geser P5 (live ke-4) ke posisi live 2 (sebelum P2).
    const res1 = await callReorder({ productId: 5, targetPosition: 2 });
    expect(res1.status).toBe(200);
    // Urutan intent sekarang: P1(10), P5(20), P2(30), X(40), P4(50) — X tetap di antara P2 dan P4!
    expect(getSortOrder(1)).toBe(10);
    expect(getSortOrder(5)).toBe(20);
    expect(getSortOrder(2)).toBe(30);
    expect(getSortOrder(3)).toBe(40);
    expect(getSortOrder(4)).toBe(50);

    // Geser P1 (+1 -> sesudah P5) sementara X masih habis:
    // slot X tidak berubah relatif terhadap P2 dan P4.
    const res2 = await callReorder({ productId: 1, direction: 1 });
    expect(res2.status).toBe(200);
    expect(getSortOrder(5)).toBe(10);
    expect(getSortOrder(1)).toBe(20);
    expect(getSortOrder(2)).toBe(30);
    expect(getSortOrder(3)).toBe(40);
    expect(getSortOrder(4)).toBe(50);

    // X restok: sortProductsForDisplay menempatkan X tepat di antara P2 dan P4 (posisi 4, bukan ekor!)
    f.sql.exec("UPDATE products SET stock=5 WHERE id=3; UPDATE product_variants SET stock=5 WHERE product_id=3");
    const rows = f.sql.prepare("SELECT id, is_active, stock, sort_order FROM products").all() as {
      id: number; is_active: number; stock: number; sort_order: number;
    }[];
    expect(sortProductsForDisplay(rows).map((p) => p.id)).toEqual([5, 1, 2, 3, 4]);
  });

  it("grup: reorder winner memberi sort_order sama ke semua anggota; pindah pemenang menjaga posisi tampil", async () => {
    // Kategori AI: P1(10), Grup(P2 winner=20, P3 loser=20), P4(30)
    f.sql.exec(`
      INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
        (1,1,'P1','p1',10000,5,1,10),
        (2,1,'G-WR','g-wr',10000,5,1,20),
        (3,1,'G-SK','g-sk',10000,5,1,20),
        (4,1,'P4','p4',10000,5,1,30);
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,manual_cost) VALUES
        (1,'V1','1B',10000,5,1,5000),
        (2,'V2','1B',10000,5,1,3000),
        (3,'V3','1B',10000,5,1,6000),
        (4,'V4','1B',10000,5,1,5000);
      INSERT INTO product_groups(id,name,winner_product_id) VALUES (1,'Spotify',2);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES (1,2,0),(1,3,1);
    `);

    // Geser P4 (live #3) ke posisi #1, sehingga Grup menjadi #3 (key 30).
    // Atau geser winner #2 ke posisi #3 (+1 -> melewati P4).
    const res = await callReorder({ productId: 2, direction: 1 });
    expect(res.status).toBe(200);
    // P1=10, P4=20, dan KEDUA anggota grup (2 & 3) mendapat key yang sama = 30!
    expect(getSortOrder(1)).toBe(10);
    expect(getSortOrder(4)).toBe(20);
    expect(getSortOrder(2)).toBe(30);
    expect(getSortOrder(3)).toBe(30);

    // Sekarang geser winner #2 ke posisi #1!
    const resTop = await callReorder({ productId: 2, targetPosition: 1 });
    expect(resTop.status).toBe(200);
    expect(getSortOrder(2)).toBe(10);
    expect(getSortOrder(3)).toBe(10);
    expect(getSortOrder(1)).toBe(20);
    expect(getSortOrder(4)).toBe(30);

    // Pemenang grup berpindah dari #2 ke #3 (mis. #2 habis stok)
    f.sql.exec("UPDATE products SET stock=0 WHERE id=2; UPDATE product_variants SET stock=0 WHERE product_id=2");
    const db = createDatabaseAccess(f.db);
    const decision = await decideGroup(1, db);
    expect(decision.winnerProductId).toBe(3);

    // Katalog publik (non-loser, aktif) menampilkan #3 di posisi #1 (key 10), bukan di ekor!
    const visible = f.sql.prepare(`
      SELECT p.id, p.is_active, p.stock, p.sort_order FROM products p
      WHERE p.is_active=1 AND p.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM product_group_members gm
          JOIN product_groups g ON g.id=gm.group_id
          WHERE gm.product_id=p.id AND g.winner_product_id IS NOT NULL AND g.winner_product_id<>gm.product_id
        )
    `).all() as { id: number; is_active: number; stock: number; sort_order: number }[];
    expect(sortProductsForDisplay(visible).map((p) => p.id)).toEqual([3, 1, 4]);
  });

  it("targetPosition hanya menghitung unit live (abaikan pecundang/habis/nonaktif), non-live -> 409, clamping bekerja", async () => {
    // 10=L1, 20=Loser(Grup dg L1), 30=SoldOut, 40=Off, 50=L2, 60=L3
    f.sql.exec(`
      INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
        (1,1,'L1','l1',10000,5,1,10),
        (2,1,'G-Loser','g-loser',10000,5,1,10),
        (3,1,'SoldOut','soldout',10000,0,1,30),
        (4,1,'Off','off',10000,5,0,40),
        (5,1,'L2','l2',10000,5,1,50),
        (6,1,'L3','l3',10000,5,1,60);
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES
        (1,'V1','1B',10000,5,1),
        (2,'V2','1B',10000,5,1),
        (3,'V3','1B',10000,0,1),
        (4,'V4','1B',10000,5,1),
        (5,'V5','1B',10000,5,1),
        (6,'V6','1B',10000,5,1);
      INSERT INTO product_groups(id,name,winner_product_id) VALUES (1,'G',1);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES (1,1,0),(1,2,1);
    `);

    // Target non-live (loser, soldout, off) -> 409
    for (const nonLiveId of [2, 3, 4]) {
      const r = await callReorder({ productId: nonLiveId, direction: -1 });
      expect(r.status).toBe(409);
      expect((await r.json() as { error: string }).error).toBe("Produk tidak tampil di toko; atur urutan dari tab Live.");
    }

    // Batas direction pada live pertama/terakhir -> 409
    expect((await callReorder({ productId: 1, direction: -1 })).status).toBe(409);
    expect((await callReorder({ productId: 6, direction: 1 })).status).toBe(409);

    // L3 (live ke-3) pindah ke targetPosition=2 (live ke-2 = sebelum L2)
    const rMove = await callReorder({ productId: 6, targetPosition: 2 });
    expect(rMove.status).toBe(200);
    const bodyMove = await rMove.json() as { clamped: boolean };
    expect(bodyMove.clamped).toBe(false);
    // Intent order: [G(1,2)=10, SoldOut(3)=20, Off(4)=30, L3(6)=40, L2(5)=50]
    expect(getSortOrder(1)).toBe(10);
    expect(getSortOrder(2)).toBe(10);
    expect(getSortOrder(3)).toBe(20);
    expect(getSortOrder(4)).toBe(30);
    expect(getSortOrder(6)).toBe(40);
    expect(getSortOrder(5)).toBe(50);

    // L1 pindah ke targetPosition=99 -> dijepit ke 3 (akhir live, sesudah L2) dengan clamped=true
    const rClamp = await callReorder({ productId: 1, targetPosition: 99 });
    expect(rClamp.status).toBe(200);
    const bodyClamp = await rClamp.json() as { clamped: boolean };
    expect(bodyClamp.clamped).toBe(true);
    // Intent order: [SoldOut(3)=10, Off(4)=20, L3(6)=30, L2(5)=40, G(1,2)=50]
    expect(getSortOrder(3)).toBe(10);
    expect(getSortOrder(4)).toBe(20);
    expect(getSortOrder(6)).toBe(30);
    expect(getSortOrder(5)).toBe(40);
    expect(getSortOrder(1)).toBe(50);
    expect(getSortOrder(2)).toBe(50);
  });

  it("ganti kategori via PUT /api/products/[id] menempatkan di ekor kategori baru, mengabaikan sortOrder payload, dan menyebar ke seluruh anggota grup", async () => {
    f.sql.exec(`
      INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
        (1,1,'G-A','g-a',10000,5,1,10),
        (2,1,'G-B','g-b',10000,5,1,10),
        (3,2,'S1','s1',10000,5,1,40),
        (4,2,'S2','s2',10000,5,1,70),
        (5,2,'S-Arsip','s-arsip',10000,5,0,500),
        (6,1,'Solo','solo',10000,5,1,20);
      UPDATE products SET archived_at='2026-11-01' WHERE id=5;
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES
        (1,'V1','1B',10000,5,1),
        (2,'V2','1B',10000,5,1),
        (3,'V3','1B',10000,5,1),
        (4,'V4','1B',10000,5,1),
        (6,'V6','1B',10000,5,1);
      INSERT INTO product_groups(id,name,winner_product_id) VALUES (1,'Grup',1);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES (1,1,0),(1,2,1);
    `);

    // Kategori unchanged -> sort_order tidak diubah otomatis ke ekor.
    const resSame = await callPut(6, { categorySlug: "ai", sortOrder: 25 });
    expect(resSame.status).toBe(200);
    expect(getCatAndSort(6)).toEqual({ category_id: 1, sort_order: 20 + 5 });

    // Pindah produk #1 (anggota grup) ke kategori 'streaming' (id=2).
    // Produk non-archived max di streaming = 70 (abaikan #5 yang archived=500),
    // abaikan sortOrder: 5 di payload -> target sort_order = 80 untuk #1 DAN #2!
    const resMove = await callPut(1, { categorySlug: "streaming", sortOrder: 5 });
    expect(resMove.status).toBe(200);
    expect(getCatAndSort(1)).toEqual({ category_id: 2, sort_order: 80 });
    expect(getCatAndSort(2)).toEqual({ category_id: 2, sort_order: 80 });

    // Kategori baru kosong -> sort_order = 10
    f.sql.exec("INSERT INTO categories(id,name,slug,sort_order) VALUES (3,'Kosong','kosong',30)");
    const resEmpty = await callPut(6, { categorySlug: "kosong", sortOrder: 999 });
    expect(resEmpty.status).toBe(200);
    expect(getCatAndSort(6)).toEqual({ category_id: 3, sort_order: 10 });
  });

  it("createProductGroup dan addGroupMember menyinkronkan category_id + sort_order anggota ke anchor", async () => {
    f.sql.exec(`
      INSERT INTO products(id,category_id,name,slug,price,stock,is_active,sort_order) VALUES
        (1,1,'Mahal','mahal',10000,5,1,10),
        (2,2,'Murah','murah',10000,5,1,90),
        (3,2,'Ketiga','ketiga',10000,5,1,150),
        (4,1,'Off1','off1',10000,5,0,25),
        (5,2,'Off2','off2',10000,5,0,85);
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,manual_cost) VALUES
        (1,'V1','1B',10000,5,1,8000),
        (2,'V2','1B',10000,5,1,3000),
        (3,'V3','1B',10000,5,1,1000),
        (4,'V4','1B',10000,5,1,1000),
        (5,'V5','1B',10000,5,1,1000);
    `);

    const db = createDatabaseAccess(f.db);

    // 1. createProductGroup dengan winner (#2 murah: cat=2, sort=90) -> #1 ikut ke (2, 90)
    const g1 = await createProductGroup({ name: "Grup Winner", productIds: [1, 2] }, db);
    expect(g1.winner_product_id).toBe(2);
    expect(getCatAndSort(1)).toEqual({ category_id: 2, sort_order: 90 });
    expect(getCatAndSort(2)).toEqual({ category_id: 2, sort_order: 90 });

    // Ubah anchor ke (1, 45) supaya terlihat saat addGroupMember
    f.sql.exec("UPDATE products SET category_id=1, sort_order=45 WHERE id IN (1,2)");
    // 2. addGroupMember: #3 sebelumnya (2, 150) harus mengadopsi anchor (#2: 1, 45) SEBELUM decideGroup
    // meskipun #3 langsung menjadi winner baru!
    const g1After = await addGroupMember(g1.id, 3, db);
    expect(g1After.winner_product_id).toBe(3);
    expect(getCatAndSort(3)).toEqual({ category_id: 1, sort_order: 45 });

    // 3. createProductGroup ketika semua anggota off (winner = null) -> anchor = position terkecil (#4: 1, 25)
    const g2 = await createProductGroup({ name: "Grup Off", productIds: [4, 5] }, db);
    expect(g2.winner_product_id).toBeNull();
    expect(getCatAndSort(4)).toEqual({ category_id: 1, sort_order: 25 });
    expect(getCatAndSort(5)).toEqual({ category_id: 1, sort_order: 25 });
  });
});
