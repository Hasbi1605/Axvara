import { gopaySettlement, seedLegacyDanaInvoice } from "./helpers/qris-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createGopayQrisInvoice } from "@/lib/payments/qris";
const ctx = vi.hoisted(() => ({ send: vi.fn(async () => undefined), paid: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => ({ email: "fixture@example.test" }) }));
vi.mock("@/lib/analytics/funnel", () => ({ trackPaidOrder: ctx.paid }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => ({ env: { ORDER_FULFILLMENT_QUEUE: { send: ctx.send } }, ctx: { waitUntil: vi.fn() } }) }));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn(async () => ({ ok: true })) }));
let f: ReturnType<typeof createD1Fixture>;
const code = "AXV-20261118-ENTRY001";
const req = (body: unknown, headers = {}) => new NextRequest("https://fixture/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(async () => {
  f = createD1Fixture(); stubFulfillmentKey(); await insertTestProduct(f.sql, "manual", 1);
  ctx.send.mockClear(); ctx.paid.mockClear();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false"); vi.stubEnv("TELEGRAM_BOT_TOKEN", ""); vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true"); vi.stubEnv("GOPAY_POLLER_SECRET", "fixture");
  const qr = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304"; vi.stubEnv("GOPAY_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fixture forbids network"); }));
  insertTestOrder(f.sql, code, { channel: "web" });
  f.sql.prepare("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')").run();
});
afterEach(() => { f.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
for (const action of ["admin_paid", "admin_paid_qris", "gopay", "admin_retry_match", "admin_confirm_match", "admin_proof"] as const) {
  it(`${action}: only the durable winner enqueues and emits paid; replay does neither`, async () => {
    let invoke: () => Promise<Response>;
    if (action === "admin_proof") {
      f.sql.prepare(`INSERT INTO payment_proofs(order_code,conversation_id,member_id,external_message_id,claimed_method,r2_key,content_type,byte_size,sha256)
        VALUES(?,'fixture','fixture','fixture','SEABANK','fixture','image/png',1,'fixture')`).run(code);
      const { POST } = await import("@/app/api/admin/proofs/[id]/route");
      invoke = () => POST(req({ action: "approve" }), { params: Promise.resolve({ id: "1" }) });
    } else if (action === "admin_paid" || action === "admin_paid_qris") {
      if (action === "admin_paid_qris") seedLegacyDanaInvoice(f.sql, code, 10000);
      else f.sql.prepare("UPDATE orders SET payment_method='seabank' WHERE code=?").run(code);
      const { PATCH } = await import("@/app/api/admin/orders/[code]/route");
      invoke = () => PATCH(req({ status: "lunas", ...(action === "admin_paid_qris" ? { action: "paid_qris", admin_note: "Fixture mutasi masuk diverifikasi" } : {}) }), { params: Promise.resolve({ code }) });
    } else {
      if (action === "gopay") {
        const invoice = await createGopayQrisInvoice(code, 10000);
        const { POST } = await import("@/app/api/webhook/gopay/route");
        invoke = () => POST(gopaySettlement(code, invoice.payableAmount, "fixture", "fixture"));
      } else {
        const invoice = seedLegacyDanaInvoice(f.sql, code, 10000);
        f.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,provider,status) VALUES('fixture','fixture',?,'dana','received')").run(invoice.payableAmount);
        const { POST } = await import("@/app/api/admin/payments/events/route");
        invoke = () => POST(req({ event_id: 1, action: action === "admin_retry_match" ? "retry_match" : "confirm_match", verified: true, order_code: code, review_note: "Fixture mutasi masuk diverifikasi" }));
      }
    }
    expect((await invoke()).status).toBe(200);
    await invoke();
    expect(ctx.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "order_paid", orderCode: code, source: action, mode: "active" }));
    expect(ctx.paid).toHaveBeenCalledTimes(1);
  });
}
it("supporting QRIS proof never settles, enqueues or emits paid", async () => {
  f.sql.prepare(`INSERT INTO payment_proofs(order_code,conversation_id,member_id,external_message_id,claimed_method,r2_key,content_type,byte_size,sha256)
    VALUES(?,'fixture','fixture','fixture','QRIS','fixture','image/png',1,'fixture')`).run(code);
  const { POST } = await import("@/app/api/admin/proofs/[id]/route");
  expect(await (await POST(req({ action: "approve" }), { params: Promise.resolve({ id: "1" }) })).json()).toMatchObject({ payment_updated: false });
  expect(ctx.send).not.toHaveBeenCalled(); expect(ctx.paid).not.toHaveBeenCalled();
  expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(code)?.status).toBe("pending");
});
