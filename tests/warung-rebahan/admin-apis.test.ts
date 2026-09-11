import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;

async function adminRequest(path: string, init?: RequestInit): Promise<Request> {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { NextRequest } = await import("next/server");
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-secret-admin-warung");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  const headers = new Headers(init?.headers);
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  const { signal: _signal, ...rest } = init ?? {};
  void _signal;
  return new NextRequest(`http://localhost${path}`, { ...rest, headers });
}

beforeEach(async () => {
  const fs = await import("node:fs");
  fixture = createD1Fixture();
  fixture.sql.exec(fs.readFileSync("drizzle/migrations/0027_warung_rebahan.sql", "utf8"));
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
});

describe("admin WR APIs auth & validation", () => {
  it("menolak tanpa sesi admin (401)", async () => {
    const { GET } = await import("@/app/api/admin/warung/sync-log/route");
    const res = await GET(new Request("http://localhost/api/admin/warung/sync-log") as never);
    expect(res.status).toBe(401);
  });

  it("exclusions: tambah + validasi + duplikat 409 + hapus", async () => {
    const { GET, POST, DELETE } = await import("@/app/api/admin/warung/exclusions/route");
    const list1 = await (await GET(await adminRequest("/api/admin/warung/exclusions") as never)).json() as { exclusions: { pattern: string }[] };
    expect(list1.exclusions.map((e) => e.pattern)).toContain("%canva%");

    const bad = await POST(await adminRequest("/api/admin/warung/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "x" }),
    }) as never);
    expect(bad.status).toBe(400);

    const created = await POST(await adminRequest("/api/admin/warung/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "netflix", reason: "uji" }),
    }) as never);
    expect(created.status).toBe(201);

    const dup = await POST(await adminRequest("/api/admin/warung/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern: "%netflix%" }),
    }) as never);
    expect(dup.status).toBe(409);

    const list2 = await (await GET(await adminRequest("/api/admin/warung/exclusions") as never)).json() as { exclusions: { id: number; pattern: string }[] };
    const added = list2.exclusions.find((e) => e.pattern === "%netflix%");
    expect(added).toBeTruthy();
    const del = await DELETE(await adminRequest(`/api/admin/warung/exclusions?id=${added!.id}`, { method: "DELETE" }) as never);
    expect(del.status).toBe(200);
    const missing = await DELETE(await adminRequest("/api/admin/warung/exclusions?id=99999", { method: "DELETE" }) as never);
    expect(missing.status).toBe(404);
  });

  it("markup: 404 varian tak dikenal + validasi + update harga", async () => {
    const { GET, PUT } = await import("@/app/api/admin/warung/markup/route");
    const notFound = await PUT(await adminRequest("/api/admin/warung/markup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wr_variant_id: "tak-ada", markup_percent: 50, markup_fixed: 0 }),
    }) as never);
    expect(notFound.status).toBe(404);

    const invalid = await PUT(await adminRequest("/api/admin/warung/markup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wr_variant_id: "tak-ada", markup_percent: 9999, markup_fixed: 0 }),
    }) as never);
    expect(invalid.status).toBe(400);

    fixture.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'P','p',10000,10)").run();
    fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(1,1,'WR-X','V',15000,5,'manual','var-x')").run();
    fixture.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-x','P',1)").run();
    fixture.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price) VALUES('var-x','prod-x','V',10000,5,1,15000)").run();

    const updated = await PUT(await adminRequest("/api/admin/warung/markup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wr_variant_id: "var-x", markup_percent: 50, markup_fixed: 0 }),
    }) as never);
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { sell_price: number };
    expect(body.sell_price).toBe(15000);

    const list = await (await GET(await adminRequest("/api/admin/warung/markup") as never)).json() as { variants: unknown[] };
    expect(list.variants.length).toBe(1);
  });

  it("orders list menyembunyikan ciphertext akun", async () => {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260911-WR0002','B','6280','[]',7500,'qris','lunas','paid','web')`).run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,wr_account_details,wr_account_iv) VALUES('AXV-20260911-WR0002','v',1,5000,'completed','CIPHERTEXT-RAHASIA','IV')").run();
    const { GET } = await import("@/app/api/admin/warung/orders/route");
    const res = await GET(await adminRequest("/api/admin/warung/orders") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: { wr_account_details: string }[] };
    expect(body.orders.length).toBe(1);
    expect(body.orders[0].wr_account_details).toBe("(encrypted)");
  });

  it("retry menolak status completed + id tak valid", async () => {
    fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260911-WR0003','B','6280','[]',7500,'qris','lunas','paid','web')`).run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260911-WR0003','v',1,5000,'completed')").run();
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/retry/route");
    const bad = await POST(await adminRequest("/api/admin/warung/orders/abc/retry", { method: "POST" }) as never, { params: Promise.resolve({ id: "abc" }) });
    expect(bad.status).toBe(400);
    const done = await POST(await adminRequest("/api/admin/warung/orders/1/retry", { method: "POST" }) as never, { params: Promise.resolve({ id: "1" }) });
    expect(done.status).toBe(409);
  });
});
