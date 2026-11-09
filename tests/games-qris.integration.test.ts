import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { calculateCrc16, createActiveQrisInvoice } from "@/lib/payments/dana-qris";

const mocks = vi.hoisted(() => ({ paid: vi.fn(async () => undefined) }));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: mocks.paid }));
vi.mock("@/lib/payments/gopay-wake", () => ({ scheduleGopayWake: vi.fn() }));

let fixture: ReturnType<typeof createD1Fixture>;
const CODE = "AXG-20261109-QRIS0001", SECRET = "fixture-qris-secret", MERCHANT = "G111111111";
const QR = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI53033605802ID6304";

beforeEach(() => {
  fixture = createD1Fixture();
  mocks.paid.mockClear();
  for (const name of ["DANA_QRIS_ENABLED", "GOPAY_QRIS_ENABLED", "KLIKQRIS_ENABLED"]) vi.stubEnv(name, "true");
  vi.stubEnv("DANA_STATIC_QRIS", QR + calculateCrc16(QR));
  vi.stubEnv("GOPAY_STATIC_QRIS", QR + calculateCrc16(QR));
  vi.stubEnv("DANA_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("GOPAY_POLLER_SECRET", SECRET);
  vi.stubEnv("KLIKQRIS_API_KEY", "fixture-key");
  vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network"); }));
  fixture.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,
    payment_status,sales_channel,order_kind,expires_at,buyer_access_version,buyer_access_format)
    VALUES(?,'Buyer','6281234567890','buyer@example.com','[]',11000,'qris','pending','pending','web','games',datetime('now','+15 minutes'),0,'code26')`).run(CODE);
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`https://axvara.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});

describe("Games paid QRIS routes dispatch only Games", () => {
  it.each(["dana", "gopay", "klikqris"])("%s callback schedules Games once, without Market outbox", async provider => {
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", provider);
    const details = {
      order_id: CODE, id_merchant: "123", amount: 11000, total_amount: 11101,
      signature: "fixture-signature-0123456789", qris_url: "https://klikqris.com/storage/fixture.png",
      expired_at: new Date(Date.now() + 900_000).toISOString(), status: "PENDING", paid_at: new Date().toISOString(),
    };
    if (provider === "klikqris") vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, data: details })));
    const invoice = await createActiveQrisInvoice(CODE, 11000);
    let hook: () => Promise<Response>;
    if (provider === "dana") {
      const { POST } = await import("@/app/api/webhook/dana/route");
      hook = () => POST(request("/api/webhook/dana", { amount: invoice.payableAmount, event_id: "fixture-dana-games" }, { "x-webhook-secret": SECRET }));
    } else if (provider === "gopay") {
      const { POST } = await import("@/app/api/webhook/gopay/route");
      const raw = JSON.stringify({ amount: invoice.payableAmount, order_code: CODE, event_id: "gopay-poller:fixture-games",
        payment: { id: "fixture-games" }, merchant_id: MERCHANT, currency: "IDR", transaction_status: "settlement", paid_at: new Date().toISOString() });
      hook = () => POST(request("/api/webhook/gopay", raw, { "x-poller-secret": SECRET, "x-poller-signature": createHmac("sha256", SECRET).update(raw).digest("hex") }));
    } else {
      const { POST } = await import("@/app/api/payments/klikqris/callback/route");
      details.status = "PAID";
      hook = () => POST(request("/api/payments/klikqris/callback", details));
    }
    const first = await hook();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "paid" });
    expect(mocks.paid).toHaveBeenCalledExactlyOnceWith(CODE, "games");
    expect(fixture.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(CODE))
      .toEqual({ status: "lunas", payment_status: "paid" });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM fulfillment_jobs").get()).toEqual({ n: 0 });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM wr_order_links").get()).toEqual({ n: 0 });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM sk_order_links").get()).toEqual({ n: 0 });
    expect((await hook()).status).toBe(200);
    expect(mocks.paid).toHaveBeenCalledTimes(1);
  });

  it("serves an AXG QR image through the shared QRIS route", async () => {
    vi.stubEnv("QRIS_ACTIVE_PROVIDER", "dana");
    await createActiveQrisInvoice(CODE, 11000);
    const { GET } = await import("@/app/api/payments/qris/[code]/image/route");
    const response = await GET(new NextRequest(`https://axvara.test/api/payments/qris/${CODE}/image`), { params: Promise.resolve({ code: CODE }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
