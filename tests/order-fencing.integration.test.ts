import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); });

// R4: stock DEC dan INSERT order tanpa atomicity — crash di antaranya = stok
// hilang tanpa order (kebocoran), retry = DEC ganda (oversell).
describe("R4 order-creation fencing and compensation", () => {
  it("failed invoice setup fence never cancels a paid order", async () => {
    // Kontrak fence pada kedua jalur pembuatan order Telegram (cart +
    // variant): pembatalan kompensasi hanya bila order masih pending &
    // unpaid. Buktikan sumbernya memuat fence.
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/api/telegram/webhook/route.ts", "utf8") as string;
    const fences = src.match(/stillPending/g) ?? [];
    // Dua jalur (cart + variant) masing-masing punya fence sendiri.
    expect(fences.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain(`String(fence.payment_status) !== "paid"`);
    expect(src).toContain("invoice_setup_failed");
  });

  it("reconciler fence: settled delivered order without job row is NOT resurrected", async () => {
    const { reconcileMissingFulfillmentJobs } = await import("@/lib/fulfillment/deliver");
    await insertTestProduct(fixture.sql, "manual", 2);
    const items = [
      { product_id: 1, variant_id: 1, name: "M1", price: 10000, qty: 1 },
      { product_id: 1, variant_id: 2, name: "M2", price: 10000, qty: 1 },
    ];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-R40001','Buyer','628',?,20000,'qris','lunas','paid','web','delivered',1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [] }));
    for (const [index, variant] of [1, 2].entries()) {
      fixture.sql.prepare(`INSERT INTO fulfillment_items
        (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
        VALUES('AXV-20260908-R40001',?,1,?,1,'manual','web','628','delivered',1,datetime('now'))`)
        .run(index, variant);
    }
    // Baris job hilang (dihapus manual / crash historis) — reconciler TIDAK
    // boleh membuat job baru yang mengirim ulang.
    const { sendMessage } = await import("@/lib/telegram/api");
    (sendMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
    const healed = await reconcileMissingFulfillmentJobs(8);
    expect(healed).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='AXV-20260908-R40001'").get()?.n).toBe(0);
    expect(sendMessage as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("reconciler still heals a genuinely orphaned paid order", async () => {
    const { reconcileMissingFulfillmentJobs } = await import("@/lib/fulfillment/deliver");
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-R40002','Buyer','628',?,10000,'qris','lunas','paid','web','queued',1,?)`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "M", price: 10000, qty: 1 }]),
        JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }));
    const healed = await reconcileMissingFulfillmentJobs(8);
    expect(healed).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs WHERE order_code='AXV-20260908-R40002'").get()?.n).toBe(1);
  });

  it("stale worker returning with failure cannot reopen a delivered parent", async () => {
    // Wajib R4: tahan worker A saat kirim → lease A kedaluwarsa → worker B
    // menyelesaikan pekerjaan → lanjutkan worker A (membawa kegagalan).
    // Item, job, dan order harus TETAP delivered.
    const { ensureFulfillmentItems, createFulfillmentJob, processJob, claimJob } =
      await import("@/lib/fulfillment/deliver");
    await insertTestProduct(fixture.sql, "shared", 1);
    const items = [{ product_id: 1, variant_id: 1, name: "F", price: 10000, qty: 1 }];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-R40003','Buyer','628',?,10000,'qris','lunas','paid','telegram','12345','12345','queued',1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "shared" }] }));
    const order = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-R40003'").get()!;
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("AXV-20260908-R40003", null, "shared", 1, "telegram");
    const jobId = Number(fixture.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code='AXV-20260908-R40003'").get()?.id);
    // Worker A mengklaim (lease A), lalu lease-nya dibiarkan kedaluwarsa.
    const claimA = await claimJob(jobId);
    expect(claimA).not.toBeNull();
    const leaseA = String(claimA?.locked_until ?? "");
    fixture.sql.prepare("UPDATE fulfillment_jobs SET locked_until='2020-01-01T00:00:00.000Z' WHERE id=?").run(jobId);
    fixture.sql.prepare("UPDATE fulfillment_items SET locked_until='2020-01-01T00:00:00.000Z' WHERE order_code='AXV-20260908-R40003'").run();
    // Worker B: recovery + selesaikan penuh.
    const { releaseStaleJobs } = await import("@/lib/fulfillment/deliver");
    await releaseStaleJobs();
    const product = fixture.sql.prepare("SELECT * FROM products WHERE id=1").get()!;
    const freshOrder = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-R40003'").get()!;
    expect(await processJob(jobId, freshOrder, product)).toBe(true);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE id=?").get(jobId)?.status).toBe("delivered");
    // Worker A kembali membawa kegagalan dengan lease basi → dibuang.
    const { scheduleRetryFenced } = await import("@/lib/fulfillment/deliver");
    await scheduleRetryFenced(jobId, "stale worker A failure", leaseA);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE id=?").get(jobId)?.status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260908-R40003'").get()?.status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-R40003'").get()?.fulfillment_status).toBe("delivered");
  });
});
