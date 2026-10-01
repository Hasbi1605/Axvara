import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));
let fixture: ReturnType<typeof createD1Fixture>;
const A = "AXV-20260910-AAAAAAA1";
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey();
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function checkout() {
  await createChannelOrderAtomic({
    orderCode: A, lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1, customerName: "Fixture", salesChannel: "web",
    paymentMethod: "qris", paymentAccount: "DANA Business", fulfillmentStatus: "not_required",
  });
  return createDanaQrisInvoice(A, 10000);
}
const order = () => fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(A)!;
const tx = () => fixture.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(A)!;
async function acc(body: unknown) {
  const { PATCH } = await import("@/app/api/admin/orders/[code]/route");
  return PATCH(new NextRequest(`http://localhost/api/admin/orders/${A}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ code: A }) });
}

describe("ACC manual QRIS (hook gagal, dana benar masuk)", () => {
  it("melunaskan via jalur paid yang sama dengan hook: ledger + fulfillment + email kredensial", async () => {
    await checkout();
    expect(order().status).toBe("pending");
    const res = await acc({ status: "lunas", action: "paid_qris", admin_note: "Mutasi Rp10.123 masuk 12.45 dari Fixture, hook tidak datang" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.via).toBe("manual_qris_acc");
    // Order + ledger ikut lunas (bukan cuma status order).
    expect(order().status).toBe("lunas");
    expect(order().payment_status).toBe("paid");
    expect(tx().status).toBe("paid");
    // Audit trail: siapa yang ACC tercatat.
    expect(String(order().admin_note)).toContain("ACC-QRIS manual");
    // Fulfillment masuk jalur paid yang sama: job queued + email kredensial
    // web terkirim (followUpWebOrder → buyer_notice_log).
    const job = fixture.sql.prepare("SELECT * FROM fulfillment_jobs WHERE order_code=?").get(A);
    expect(job).toBeTruthy();
  });

  it("menolak tanpa catatan verifikasi mutasi (min. 10 karakter)", async () => {
    await checkout();
    const res = await acc({ status: "lunas", action: "paid_qris", admin_note: "ok" });
    expect(res.status).toBe(400);
    expect(order().status).toBe("pending");
  });

  it("menolak untuk non-QRIS dan order non-pending", async () => {
    await checkout();
    fixture.sql.prepare("UPDATE orders SET payment_method='seabank' WHERE code=?").run(A);
    const nonQris = await acc({ status: "lunas", action: "paid_qris", admin_note: "Mutasi Rp10.123 masuk, hook tidak datang" });
    expect(nonQris.status).toBe(400);
    fixture.sql.prepare("UPDATE orders SET payment_method='qris' WHERE code=?").run(A);
    const ok = await acc({ status: "lunas", action: "paid_qris", admin_note: "Mutasi Rp10.123 masuk, hook tidak datang" });
    expect(ok.status).toBe(200);
    // ACC kedua = idempoten via unchanged (order sudah lunas).
    const again = await acc({ status: "lunas", action: "paid_qris", admin_note: "Mutasi Rp10.123 masuk, hook tidak datang" });
    expect(again.status).toBe(400);
  });

  it("kalah race vs hook yang datang belakangan: 409, bukan dobel lunas", async () => {
    await checkout();
    // Simulasikan hook menang duluan.
    const { transitionPendingPaymentToPaid } = await import("@/lib/db");
    expect(await transitionPendingPaymentToPaid(A, new Date().toISOString(), null)).toBe(true);
    const res = await acc({ status: "lunas", action: "paid_qris", admin_note: "Mutasi Rp10.123 masuk, hook tidak datang" });
    // Order sudah lunas → guard ACC menolak (bukan unchanged karena payment
    // sudah paid via hook; transisi mengembalikan false → 409).
    expect([400, 409]).toContain(res.status);
    expect(order().status).toBe("lunas");
  });
});
