// POST /api/pedia/orders/[code]/cancel — batal mandiri pembeli Pedia.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { POST as createOrder } from "@/app/api/pedia/orders/route";
import { POST as cancelRoute } from "@/app/api/pedia/orders/[code]/cancel/route";
import { GET as statusRoute } from "@/app/api/pedia/orders/[code]/route";
import * as qris from "@/lib/payments/dana-qris";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const WA = "081234567890", EMAIL = "a@b.com";

async function seedOrder() {
  clearRateLimitBucketsForTest();
  vi.stubEnv("PEDIA_ENABLED", "true"); vi.stubEnv("PEDIA_ORDERS_ENABLED", "true"); vi.stubEnv("ADMIN_JWT_SECRET", "pedia-cancel-test-secret");
  const f = createD1Fixture(); fixtures.push(f);
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES(1,'followers-instagram','instagram','followers','profile','Followers','[100]',1,1,'auto');
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,managed) VALUES(1,1,'standar','providersmm',1,'G3',0,1000,1,'auto');
    INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('providersmm',1,'Private','Private','Default',10000,1,1000,1);`);
  vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount + 1, uniqueCode: 1, qrisPayload: "test", qrisUrl: "/qr.png", expires_at: "2099-01-01", expiresAt: "2099-01-01", isExisting: false }) as never);
  const desc = JSON.stringify({ fetched_at: "2026-11-12T10:00:00.000Z", source_url: "https://providersmm.id/services", entries: { "1": { status: "ok", text: "Syarat resmi berlaku." } } });
  f.sql.prepare("INSERT INTO store_settings(key,value,updated_at) VALUES('pedia_psmm_desc_snapshot',?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(desc);
  f.sql.prepare("INSERT INTO store_settings(key,value,updated_at) VALUES('pedia_psmm_desc_last_at','2026-11-12T10:00:00.000Z',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  f.sql.prepare("UPDATE pedia_tiers SET managed_snapshot_at=? WHERE managed='auto' AND supplier='providersmm'").run('2026-11-12T10:00:00.000Z');
  const target = "https://www.instagram.com/buyer/";
  const quote = (await createPediaQuoteToken({ product_id: 1, tier_id: 1, quantity: 150, target_raw: target, target_normalized: target, unit_price: 2500 / 150, total: 2500, credit_code_hash: null, credit_used: 0, supplier: "providersmm", supplier_service_id: 1, supplier_rate_snapshot: 10000, refill_days: 0, min_profit_rp: 1000, terms_version: "2026-11-12T10:00:00.000Z" } as never)).token;
  const res = await createOrder(new Request("http://x/api/pedia/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote_token: quote, customer_wa: WA, customer_email: EMAIL }) }) as never);
  expect(res.status).toBe(201);
  const code = String(f.sql.prepare("SELECT code FROM orders").get()?.code);
  return { f, code };
}
const cancel = (code: string, contact: unknown) => cancelRoute(
  new NextRequest(`http://localhost/api/pedia/orders/${code}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact }) }),
  { params: Promise.resolve({ code }) },
);
const row = (f: ReturnType<typeof createD1Fixture>, code: string) => f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(code) as { status: string; payment_status: string };

describe("Pedia batal mandiri pembeli", () => {
  it("kontak WA benar: pending menjadi dibatalkan, jawaban tanpa data sensitif", async () => {
    const { f, code } = await seedOrder();
    const res = await cancel(code, WA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, code, status: "dibatalkan" });
    expect(row(f, code).status).toBe("dibatalkan");
  });
  it("kontak email berbeda huruf juga diterima", async () => {
    const { f, code } = await seedOrder();
    expect((await cancel(code, "A@B.COM")).status).toBe(200);
    expect(row(f, code).status).toBe("dibatalkan");
  });
  it("kontak salah: balasan generik, order tetap pending", async () => {
    const { f, code } = await seedOrder();
    const res = await cancel(code, "6289999999999");
    expect([403, 404]).toContain(res.status);
    expect(row(f, code).status).toBe("pending");
  });
  it("tanpa kontak 400, kode tidak valid 400, kode tidak ada 404", async () => {
    const { f, code } = await seedOrder();
    expect((await cancel(code, "")).status).toBe(400);
    expect((await cancel("BUKAN-KODE", WA)).status).toBe(400);
    expect((await cancel("AXP-20260101-ZZZZZZZZ", WA)).status).toBe(404);
    expect(row(f, code).status).toBe("pending");
  });
  it("order Market (bukan pedia) tidak bisa dibatalkan lewat endpoint ini", async () => {
    const { f, code } = await seedOrder();
    f.sql.prepare("UPDATE orders SET order_kind='apps' WHERE code=?").run(code);
    expect((await cancel(code, WA)).status).toBe(404);
    expect(row(f, code).status).toBe("pending");
  });
  it("order lunas: 409 dan tetap lunas", async () => {
    const { f, code } = await seedOrder();
    f.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(code);
    expect((await cancel(code, WA)).status).toBe(409);
    expect(row(f, code)).toEqual({ status: "lunas", payment_status: "paid" });
  });
  it("batal ganda: kedua 409, status tidak berubah lagi", async () => {
    const { f, code } = await seedOrder();
    expect((await cancel(code, WA)).status).toBe(200);
    expect((await cancel(code, WA)).status).toBe(409);
    expect(row(f, code).status).toBe("dibatalkan");
  });
  it("item ditutup oleh expiry yang sudah ada dan target bisa dipesan lagi", async () => {
    const { f, code } = await seedOrder();
    await cancel(code, WA);
    const { expirePediaCheckouts } = await import("@/lib/pedia/expire");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    await expirePediaCheckouts(createDatabaseAccess(f.db));
    expect(f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(code)?.status).toBe("expired");
  });
  it("GET status membedakan batal pembeli dari kedaluwarsa biasa", async () => {
    const { code } = await seedOrder();
    await cancel(code, WA);
    const get = () => statusRoute(new NextRequest(`http://localhost/api/pedia/orders/${code}`, { headers: { "x-order-contact": WA } }), { params: Promise.resolve({ code }) });
    const body = await (await get()).json();
    expect(body.order.status).toBe("expired");
    expect(body.order.buyer_canceled).toBe(true);
  });
  it("rate limit 10 per menit per IP", async () => {
    const { code } = await seedOrder();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await cancel(code, "")).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
