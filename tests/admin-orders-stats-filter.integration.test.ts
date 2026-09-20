// Butir 4 (disetujui owner 2026-09-20): kartu metrik Pesanan WAJIB memakai
// filter yang sama dengan daftarnya. Sebelumnya query stats berjalan tanpa
// WHERE, sehingga memfilter ke "Pending" tetap menampilkan "Total pesanan 26"
// — kartu dan daftar di layar yang sama bercerita beda.
//
// Ini test integrasi (bukan grep) supaya juga menangkap salah-bind: fixture
// D1 melempar bila jumlah `?` tidak sama dengan jumlah value.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { GET as listOrders } from "@/app/api/admin/orders/route";

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql);
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  // 2 pending + 1 lunas: angka "total" berubah nyata begitu filter dipakai.
  insertTestOrder(fixture.sql, "AXV-P1", { status: "pending" });
  insertTestOrder(fixture.sql, "AXV-P2", { status: "pending" });
  insertTestOrder(fixture.sql, "AXV-L1", { status: "lunas" });
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); });

async function fetchOrders(query: string) {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  const request = new NextRequest(`https://axvara.tech/api/admin/orders?${query}`, {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  });
  const response = await listOrders(request);
  if (response.status !== 200) { const t = await response.text(); throw new Error(`HTTP ${response.status}: ${t.slice(0, 200)}`); }
  return await response.json() as {
    orders: unknown[];
    stats: { total: number; pending: number; paid: number; revenue: number };
    counts: { channels: Record<string, number> };
  };
}

describe("stats kartu Pesanan", () => {
  it("tanpa filter menghitung seluruh pesanan", async () => {
    const data = await fetchOrders("page=1&limit=8");
    expect(data.stats.total).toBe(3);
    expect(data.stats.pending).toBe(2);
    expect(data.stats.paid).toBe(1);
  });

  it("dengan filter status, kartu ikut menyempit bersama daftar", async () => {
    const data = await fetchOrders("page=1&limit=8&status=lunas");
    // Daftar dan kartu harus setuju: 1 pesanan lunas.
    expect(data.orders).toHaveLength(1);
    expect(data.stats.total).toBe(1);
    expect(data.stats.paid).toBe(1);
    expect(data.stats.pending).toBe(0);
  });

  it("filter pending menyisakan 2 dan bukan total seluruh toko", async () => {
    const data = await fetchOrders("page=1&limit=8&status=pending");
    expect(data.orders).toHaveLength(2);
    expect(data.stats.total).toBe(2);
  });

  it("counts kanal tetap global karena tab kanal adalah pemilih", async () => {
    // "Semua" dihitung dari counts ini, jadi ia TIDAK boleh ikut terfilter —
    // kalau ikut, tab kanal akan menampilkan 0 dan tak bisa dipakai kembali.
    const data = await fetchOrders("page=1&limit=8&status=lunas");
    const channelTotal = Object.values(data.counts.channels).reduce((a, b) => a + b, 0);
    expect(channelTotal).toBe(3);
  });
});
