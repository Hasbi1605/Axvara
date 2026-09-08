import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

const ADMIN = { email: "admin@axvara.tech", secret: "handover-secret-0123456789", hash: "c".repeat(64) };

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  process.env.ADMIN_EMAIL = ADMIN.email;
  process.env.ADMIN_JWT_SECRET = ADMIN.secret;
  process.env.ADMIN_PASSWORD_SHA256 = ADMIN.hash;
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); });

async function authCookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken(ADMIN.email);
  const idle = await createIdleToken(sid);
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
}

async function paidWebOrder(code: string) {
  await insertTestProduct(fixture.sql, "manual", 2);
  const items = [
    { product_id: 1, variant_id: 1, name: "Manual item 1", price: 10000, qty: 1 },
    { product_id: 1, variant_id: 2, name: "Manual item 2", price: 10000, qty: 1 },
  ];
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,20000,'qris','lunas','paid','web',1,?)`)
    .run(code, "Buyer", "628000000000", JSON.stringify(items),
      JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }, { variant_id: 2, fulfillment_mode: "manual" }] }));
}

async function handover(code: string, item_index: number, cookie: string, note?: string) {
  const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
  return POST(
    new NextRequest(`http://localhost/api/admin/orders/${code}/handover`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ item_index, note }),
    }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ code }) },
  );
}

// R3/D: pesanan lunas → manual_required → admin menyerahkan item → delivered.
describe("R3 manual handover completes the order", () => {
  it("paid mixed order waits, then handover delivers item and order", async () => {
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
    await paidWebOrder("AXV-20260908-HO000001");
    await ensureFulfillmentForPaidOrder("AXV-20260908-HO000001");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-HO000001'").get()?.fulfillment_status)
      .toBe("manual_required");
    const cookie = await authCookie();
    // Serahkan kedua item satu per satu; order delivered hanya setelah
    // SELURUH item diserahkan (campuran selesai bertahap).
    const first = await handover("AXV-20260908-HO000001", 0, cookie, "item 1 diserahkan via WA");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, item_status: "delivered", fulfillment_status: "manual_required" });
    const res = await handover("AXV-20260908-HO000001", 1, cookie, "diserahkan via WA");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, item_status: "delivered", fulfillment_status: "delivered" });
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260908-HO000001' ORDER BY item_index").all().map((r) => r.status))
      .toEqual(["delivered", "delivered"]);
    // Jejak audit tercatat di admin_note.
    expect(String(fixture.sql.prepare("SELECT admin_note FROM orders WHERE code='AXV-20260908-HO000001'").get()?.admin_note ?? ""))
      .toContain("handover");
  });

  it("rejects unauthenticated handover", async () => {
    await paidWebOrder("AXV-20260908-HO000002");
    const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await POST(
      new NextRequest(`http://localhost/api/admin/orders/AXV-20260908-HO000002/handover`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_index: 0 }),
      }) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ code: "AXV-20260908-HO000002" }) },
    );
    expect(res.status).toBe(401);
  });

  it("rejects mismatched order/item and double-click is idempotent", async () => {
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
    await paidWebOrder("AXV-20260908-HO000003");
    await ensureFulfillmentForPaidOrder("AXV-20260908-HO000003");
    const cookie = await authCookie();
    const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
    const missing = await POST(
      new NextRequest(`http://localhost/api/admin/orders/AXV-20260908-HO000003/handover`, {
        method: "POST", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ item_index: 9 }),
      }) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ code: "AXV-20260908-HO000003" }) },
    );
    expect(missing.status).toBe(404);
    const first = await handover("AXV-20260908-HO000003", 1, cookie);
    expect(first.status).toBe(200);
    const { sendMessage } = await import("@/lib/telegram/api");
    (sendMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
    const second = await handover("AXV-20260908-HO000003", 1, cookie);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, item_status: "delivered" });
    // Klik dua kali tidak menggandakan pengiriman.
    expect(sendMessage as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("storage failure never reports false completion", async () => {
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
    await paidWebOrder("AXV-20260908-HO000004");
    await ensureFulfillmentForPaidOrder("AXV-20260908-HO000004");
    const cookie = await authCookie();
    // Gagalkan tulis handover: baca validasi lolos (fail hanya untuk UPDATE
    // ... delivered ...), tulis gagal → 500, item tetap manual_required.
    fixture.control.fail = (q) => q.includes("SET status='delivered'");
    const res = await handover("AXV-20260908-HO000004", 0, cookie);
    fixture.control.fail = null;
    expect(res.status).toBe(500);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260908-HO000004' AND item_index=0").get()?.status)
      .toBe("manual_required");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-HO000004'").get()?.fulfillment_status)
      .toBe("manual_required");
  });
});
