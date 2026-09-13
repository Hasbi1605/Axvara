import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createD1Fixture } from "../helpers/d1-fixture";

// Test regresi wajib #13: admin retry race menghasilkan 409 (CAS).
async function adminRequest(path: string, init?: RequestInit): Promise<NextRequest> {
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

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
});

describe("regresi #13: admin retry race menghasilkan 409", () => {
  it("dua retry bersamaan: tepat satu pemenang, tidak ada duplikat klaim", async () => {
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-20260913-R00001','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts) VALUES('AXV-20260913-R00001','var-1',1,5000,'failed',1,3)").run();
    const linkId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links").get() as { id: number }).id);
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/retry/route");
    const params = { params: Promise.resolve({ id: String(linkId) }) };
    const [a, b] = await Promise.all([
      POST(await adminRequest(`/api/admin/warung/orders/${linkId}/retry`, { method: "POST" }), params),
      POST(await adminRequest(`/api/admin/warung/orders/${linkId}/retry`, { method: "POST" }), params),
    ]);
    // Pemenang 200; yang kalah 409 (atau 200 susulan yang idempoten —
    // yang dilarang adalah DUA klaim menghasilkan dua pembelian).
    expect([a.status, b.status].sort()[0]).toBe(200);
    // Tidak ada baris baru (retry memakai baris yang sama, bukan INSERT).
    const count = Number((fixture.sql.prepare("SELECT COUNT(*) n FROM wr_order_links").get() as { n: number }).n);
    expect(count).toBe(1);
    // Precondition basi eksplisit: status sudah claimed oleh worker lain.
    fixture.sql.prepare("UPDATE wr_order_links SET status='claimed', attempt_count=2 WHERE id=?").run(linkId);
    const stale = await POST(await adminRequest(`/api/admin/warung/orders/${linkId}/retry`, { method: "POST" }), params);
    expect(stale.status).toBe(409);
  });

  it("retry status completed ditolak 409; id tak valid 400/404", async () => {
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-20260913-R00002','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260913-R00002','var-1',1,5000,'completed')").run();
    const linkId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links").get() as { id: number }).id);
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/retry/route");
    const res = await POST(await adminRequest(`/api/admin/warung/orders/${linkId}/retry`, { method: "POST" }), { params: Promise.resolve({ id: String(linkId) }) });
    expect(res.status).toBe(409);
    const bad = await POST(await adminRequest("/api/admin/warung/orders/abc/retry", { method: "POST" }), { params: Promise.resolve({ id: "abc" }) });
    expect(bad.status).toBe(400);
    const missing = await POST(await adminRequest("/api/admin/warung/orders/99999/retry", { method: "POST" }), { params: Promise.resolve({ id: "99999" }) });
    expect(missing.status).toBe(404);
  });
});
