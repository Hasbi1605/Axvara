// Batal mandiri pembeli (2026-10-11, keputusan owner): `POST
// /api/orders/[code]/cancel` — pembeli web membatalkan sendiri dengan
// verifikasi kode + kontak WA/email checkout (pola lookup), stok kembali detik
// itu juga tanpa menunggu expiry/admin. Guard anti-enumerasi + anti-race sama
// dengan jalur admin/Telegram.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";

let fixture: ReturnType<typeof createD1Fixture>;
const CODE = "AXV-20261011-CANCEL01";
const WA = "6281234567890";
const EMAIL = "buyer@example.test";

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-secret");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function checkout() {
  await createChannelOrderAtomic({
    orderCode: CODE,
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1,
    customerName: "Fixture", customerWa: WA, customerEmail: EMAIL, salesChannel: "web",
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required",
  });
  await createDanaQrisInvoice(CODE, 10000);
}

async function cancel(contact: unknown) {
  const { POST } = await import("@/app/api/orders/[code]/cancel/route");
  const res = await POST(
    new NextRequest(`http://localhost/api/orders/${CODE}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contact }),
    }),
    { params: Promise.resolve({ code: CODE }) },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

const orderRow = () => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(CODE)!;
const stock = () => (fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number }).stock;

describe("batal mandiri pembeli", () => {
  it("kontak WA benar: pending → dibatalkan + stok kembali 1", async () => {
    await checkout();
    expect(stock()).toBe(99);
    const res = await cancel(WA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, code: CODE, status: "dibatalkan" });
    expect(orderRow().status).toBe("dibatalkan");
    expect(stock()).toBe(100);
  });

  it("kontak email benar (beda huruf) juga diterima", async () => {
    await checkout();
    const res = await cancel("BUYER@EXAMPLE.TEST");
    expect(res.status).toBe(200);
    expect(orderRow().status).toBe("dibatalkan");
    expect(stock()).toBe(100);
  });

  it("kontak salah → 404 generik, order tetap pending, stok tetap terkunci", async () => {
    await checkout();
    const res = await cancel("6289999999999");
    expect(res.status).toBe(404);
    expect(orderRow().status).toBe("pending");
    expect(stock()).toBe(99);
  });

  it("kode salah → 404 generik juga (anti-oracle)", async () => {
    await checkout();
    const { POST } = await import("@/app/api/orders/[code]/cancel/route");
    const res = await POST(
      new NextRequest("http://localhost/api/orders/AXV-20261011-NOPE0000/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact: WA }),
      }),
      { params: Promise.resolve({ code: "AXV-20261011-NOPE0000" }) },
    );
    expect(res.status).toBe(404);
  });

  it("order lunas tidak bisa dibatalkan (409), stok tidak menggelembung", async () => {
    await checkout();
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(CODE);
    const res = await cancel(WA);
    expect(res.status).toBe(409);
    expect(stock()).toBe(99);
  });

  it("batal ganda idempoten-jujur: kedua → 409, stok tetap 100 (tidak ganda)", async () => {
    await checkout();
    expect((await cancel(WA)).status).toBe(200);
    const second = await cancel(WA);
    expect(second.status).toBe(409);
    expect(stock()).toBe(100);
  });

  it("tanpa kontak → 400", async () => {
    await checkout();
    const res = await cancel("");
    expect(res.status).toBe(400);
    expect(orderRow().status).toBe("pending");
  });
});
