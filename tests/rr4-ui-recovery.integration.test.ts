import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

const ADMIN = { email: "admin@axvara.tech", secret: "rr4-ui-secret-0123456789abcd", hash: "e".repeat(64) };

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  process.env.ADMIN_EMAIL = ADMIN.email;
  process.env.ADMIN_JWT_SECRET = ADMIN.secret;
  process.env.ADMIN_PASSWORD_SHA256 = ADMIN.hash;
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const CODE = "AXV-20260908-RR4UI001";

async function authCookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken(ADMIN.email);
  const idle = await createIdleToken(sid);
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
}

async function seedAllDeliveredButOrderStuck() {
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,fulfillment_status,variant_id,variant_snapshot,admin_note)
    VALUES (?,?,?, ?,10000,'seabank','lunas','paid','web','manual_required',1,?,
     ?)`)
    .run(CODE, "Review lokal", "628000000000", JSON.stringify([{ product_id: 1, variant_id: 1, name: "Produk dummy", price: 10000, qty: 1 }]),
      JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }),
      " [handover item 0 oleh admin@axvara.tech 2026-09-08T00:00:00.000Z]");
  fixture.sql.prepare(`INSERT INTO fulfillment_items
    (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
    VALUES(?,0,1,1,1,'manual','web','628000000000','delivered',1,datetime('now'))`).run(CODE);
  fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,variant_id,sales_channel,status,attempt_count,next_attempt_at)
    VALUES(?,1,'web','retry',1,datetime('now','-1 minute'))`).run(CODE);
}

function get(path: string, cookie: string) {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie } }) as unknown as import("next/server").NextRequest;
}
function post(path: string, cookie: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

// Backend untuk skenario UI review: item delivered semua, order/job belum konsisten.
describe("RR4-03 UI recovery backend contract (proxy-tested handler)", () => {
  it("GET handover menunjukkan item delivered + order manual_required (state seperti proxy review)", async () => {
    await seedAllDeliveredButOrderStuck();
    const cookie = await authCookie();
    const { GET } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await GET(get(`/api/admin/orders/${CODE}/handover`, cookie), { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(200);
    const body = await res.json() as { items: { status: string }[]; order: { fulfillment_status: string } };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("delivered");
    expect(body.order.fulfillment_status).toBe("manual_required");
  });

  it("POST pemulihan saat semua delivered: backend pulih + 200 dan state konsisten", async () => {
    await seedAllDeliveredButOrderStuck();
    const cookie = await authCookie();
    const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await POST(post(`/api/admin/orders/${CODE}/handover`, cookie, { item_index: 0 }), { params: Promise.resolve({ code: CODE }) });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, item_status: "delivered", fulfillment_status: "delivered" });
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(CODE)?.fulfillment_status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code=?").get(CODE)?.status).toBe("delivered");
    // Fakta audit tetap satu (stamp stabil, bukan handover kedua).
    const notes = String(fixture.sql.prepare("SELECT admin_note FROM orders WHERE code=?").get(CODE)?.admin_note ?? "");
    expect((notes.match(/handover item 0/g) ?? []).length).toBe(1);
  });

  it("POST pemulihan saat storage gagal: 409 jujur (bukan toast sukses palsu)", async () => {
    await seedAllDeliveredButOrderStuck();
    const cookie = await authCookie();
    fixture.control.fail = (q) => q.includes("UPDATE orders SET fulfillment_status=");
    const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await POST(post(`/api/admin/orders/${CODE}/handover`, cookie, { item_index: 0 }), { params: Promise.resolve({ code: CODE }) });
    fixture.control.fail = null;
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("handover_recovery_pending");
    // Setelah pulih, POST ulang 200 + konsisten.
    const retry = await POST(post(`/api/admin/orders/${CODE}/handover`, cookie, { item_index: 0 }), { params: Promise.resolve({ code: CODE }) });
    expect(retry.status).toBe(200);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(CODE)?.fulfillment_status).toBe("delivered");
  });
});
