import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const auth = vi.hoisted(() => ({ admin: true as boolean }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => (auth.admin ? { email: "fixture@example.test" } : null)) }));

let f: ReturnType<typeof createD1Fixture>;

const req = (method: string, body?: unknown) => new NextRequest("http://localhost/api/admin/product-groups", {
  method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const route = () => import("@/app/api/admin/product-groups/route");
const idRoute = () => import("@/app/api/admin/product-groups/[id]/route");
const membersRoute = () => import("@/app/api/admin/product-groups/[id]/members/route");
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(() => {
  auth.admin = true;
  clearRateLimitBucketsForTest();
  f = createD1Fixture();
  f.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock,source,is_active) VALUES
      (1,'Produk A','a',10000,5,'manual',1),
      (2,'Produk B','b',10000,5,'manual',1),
      (3,'Produk C','c',10000,5,'manual',1),
      (4,'Produk D','d',10000,5,'manual',1),
      (5,'Arsip','arsip',10000,5,'manual',1);
    UPDATE products SET is_active=0, archived_at='2026-11-01' WHERE id=5;
    INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,manual_cost) VALUES
      (1,'A','A',10000,5,1,4000),(2,'B','B',10000,5,1,5000),(3,'C','C',10000,5,1,6000),(4,'D','D',10000,5,1,7000);
  `);
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); });

describe("API grup produk", () => {
  it("GET kosong, POST membuat grup + keputusan, produk sudah digrup → 409 group_id", async () => {
    const { GET, POST } = await route();
    const empty = await (await GET(req("GET"))).json() as { groups: unknown[] };
    expect(empty.groups).toEqual([]);

    const created = await POST(req("POST", { name: "Grup A/B", product_ids: [1, 2] }));
    expect(created.status).toBe(201);
    const body = await created.json() as { group: { id: number; name: string; winner_product_id: number; members: { product_id: number }[] } };
    expect(body.group).toMatchObject({ name: "Grup A/B", winner_product_id: 1 });
    expect(body.group.members.map((m) => m.product_id)).toEqual([1, 2]);

    const dup = await POST(req("POST", { name: "Lain", product_ids: [2, 3] }));
    expect(dup.status).toBe(409);
    expect((await dup.json() as { error: string; group_id?: number })).toMatchObject({ error: "already_grouped", group_id: body.group.id });
  });

  it("validasi nama/ukuran/produk arsip + 401", async () => {
    const { POST } = await route();
    expect((await POST(req("POST", { name: "  ", product_ids: [1, 2] }))).status).toBe(400);
    expect((await POST(req("POST", { name: "x".repeat(121), product_ids: [1, 2] }))).status).toBe(400);
    expect((await POST(req("POST", { name: "Satu", product_ids: [1] }))).status).toBe(400);
    expect((await POST(req("POST", { name: "Dup", product_ids: [1, 1] }))).status).toBe(400);
    expect((await POST(req("POST", { name: "Arsip", product_ids: [5, 2] }))).status).toBe(400);
    auth.admin = false;
    expect((await POST(req("POST", { name: "No auth", product_ids: [1, 2] }))).status).toBe(401);
  });

  it("PATCH prefer/margin, tambah/hapus anggota, auto-delete <2, DELETE grup", async () => {
    const { POST } = await route();
    const { PATCH, DELETE } = await idRoute();
    const { POST: ADD, DELETE: REMOVE } = await membersRoute();
    const created = await (await POST(req("POST", { name: "Grup", product_ids: [1, 2] }))).json() as { group: { id: number } };
    const id = created.group.id;

    const badPrefer = await PATCH(req("PATCH", { prefer_product_id: 3 }), params(id));
    expect(badPrefer.status).toBe(400);
    expect((await badPrefer.json() as { error: string }).error).toBe("invalid_prefer");
    expect((await PATCH(req("PATCH", { prefer_margin: 1_000_001 }), params(id))).status).toBe(400);
    const patched = await PATCH(req("PATCH", { name: "Grup Baru", prefer_product_id: 2, prefer_margin: 0 }), params(id));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ group: { name: "Grup Baru", prefer_product_id: 2, prefer_margin: 0 } });

    expect((await ADD(req("POST", { product_id: 3 }), params(id))).status).toBe(201);
    const afterAdd = await (await ADD(req("POST", { product_id: 4 }), params(id))).json() as { group: { members: { product_id: number }[] } };
    expect(afterAdd.group.members.map((m) => m.product_id)).toEqual([1, 2, 3, 4]);
    expect((await ADD(req("POST", { product_id: 3 }), params(id))).status).toBe(409);

    const removeUrl = `http://localhost/api/admin/product-groups/${id}/members?product_id=4`;
    expect((await REMOVE(new NextRequest(removeUrl, { method: "DELETE" }), params(id))).status).toBe(200);
    expect((await REMOVE(new NextRequest(removeUrl, { method: "DELETE" }), params(id))).status).toBe(404);
    // Turun ke 2 anggota (tetap ada), lalu 1 anggota → grup dihapus otomatis.
    const removeOne = (productId: number) => new NextRequest(`http://localhost/api/admin/product-groups/${id}/members?product_id=${productId}`, { method: "DELETE" });
    expect(await (await REMOVE(removeOne(1), params(id))).json()).toMatchObject({ group: { id } });
    expect(await (await REMOVE(removeOne(2), params(id))).json()).toEqual({ ok: true, deleted: true });
    expect((await DELETE(req("DELETE"), params(id))).status).toBe(404);
  });

  it("DELETE grup dan POST decide", async () => {
    const { POST } = await route();
    const { DELETE } = await idRoute();
    const decide = await import("@/app/api/admin/product-groups/decide/route");
    const created = await (await POST(req("POST", { name: "Grup", product_ids: [1, 2] }))).json() as { group: { id: number } };
    expect((await DELETE(req("DELETE"), params(created.group.id))).status).toBe(200);
    expect((await (await route().then((m) => m.GET(req("GET")))).json() as { groups: unknown[] }).groups).toEqual([]);
    const out = await decide.POST(req("POST"));
    expect(out.status).toBe(200);
    expect(await out.json()).toMatchObject({ decided: 0, changed: 0 });
  });

  it("all methods require auth; body bytes and JSON numeric types are bounded", async () => {
    const { GET, POST } = await route();
    const { PATCH, DELETE } = await idRoute();
    const members = await membersRoute();
    const decide = await import("@/app/api/admin/product-groups/decide/route");
    auth.admin = false;
    for (const response of [await GET(req("GET")), await POST(req("POST", {})), await PATCH(req("PATCH", {}), params(1)), await DELETE(req("DELETE"), params(1)), await members.POST(req("POST", {}), params(1)), await members.DELETE(req("DELETE"), params(1)), await decide.POST(req("POST"))]) expect(response.status).toBe(401);
    auth.admin = true;
    expect((await POST(req("POST", { name: "x".repeat(2100), product_ids: [1,2] }))).status).toBe(413);
    expect((await POST(req("POST", { name: "Invalid", product_ids: [true,2] }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { prefer_margin: null }), params(1))).status).toBe(400);
    expect((await members.POST(req("POST", { product_id: "1" }), params(1))).status).toBe(400);
  });

  it("creating overlapping groups concurrently is 201/409, never an orphan group", async () => {
    const { POST } = await route();
    const responses = await Promise.all([
      POST(req("POST", { name: "A/B", product_ids: [1,2] })),
      POST(req("POST", { name: "B/C", product_ids: [2,3] })),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201,409]);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_groups").get()?.n).toBe(1);
    expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_members").get()?.n).toBe(2);
  });

  it("a failed member INSERT rolls back the entire creation", async () => {
    const { POST } = await route();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.control.fail = (q,p) => q.startsWith("INSERT INTO product_group_members") && p[0] === 2;
    try {
      expect((await POST(req("POST", { name: "Rollback", product_ids: [1,2] }))).status).toBe(500);
      expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_groups").get()?.n).toBe(0);
      expect(f.sql.prepare("SELECT COUNT(*) AS n FROM product_group_members").get()?.n).toBe(0);
    } finally { log.mockRestore(); }
  });

  it("removing the preferred member clears its preference while retaining the group", async () => {
    const { POST } = await route();
    const { PATCH } = await idRoute();
    const { DELETE } = await membersRoute();
    const { group } = await (await POST(req("POST", { name: "A/B/C", product_ids: [1,2,3] }))).json();
    await PATCH(req("PATCH", { prefer_product_id: 2 }), params(group.id));
    const removed = await DELETE(new NextRequest(`http://localhost/api/admin/product-groups/${group.id}/members?product_id=2`, { method: "DELETE" }), params(group.id));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ group: { prefer_product_id: null } });
  });
});
