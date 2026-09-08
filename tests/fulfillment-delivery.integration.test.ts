import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import {
  allItemsDelivered,
  allItemsSettled,
  ensureFulfillmentForPaidOrder,
  ensureFulfillmentItems,
  processJob,
} from "@/lib/fulfillment/deliver";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));
import { sendMessage } from "@/lib/telegram/api";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  stubFulfillmentKey();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
  vi.mocked(sendMessage).mockClear();
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function orderWith(code: string, modes: string[], channel = "telegram") {
  await insertTestProduct(fixture.sql, modes[0], modes.length);
  for (let i = 1; i < modes.length; i++) {
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode=? WHERE id=?").run(modes[i], i + 1);
  }
  const items = modes.map((_, i) => ({ product_id: 1, variant_id: i + 1, name: `Item ${i + 1}`, price: 10000, qty: 1 }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,20000,'qris','lunas','paid',?,'12345','12345',1,?)`)
    .run(code, "Buyer", "628000000000", JSON.stringify(items), channel,
      JSON.stringify({ lines: modes.map((m, i) => ({ variant_id: i + 1, fulfillment_mode: m })) }));
  fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
}
const orderStatus = (code: string) =>
  fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(code)?.fulfillment_status;
const itemStatuses = (code: string) =>
  fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code=? ORDER BY item_index").all(code).map((r) => r.status);

describe("R2 aggregate delivery is never premature", () => {
  it("all-manual aggregates to manual_required, never delivered, with zero sends", async () => {
    await orderWith("R2-MANUAL", ["manual"]);
    await ensureFulfillmentForPaidOrder("R2-MANUAL");
    expect(orderStatus("R2-MANUAL")).toBe("manual_required");
    expect(itemStatuses("R2-MANUAL")).toEqual(["manual_required"]);
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
  });

  it("mixed shared+manual delivers exactly one credential and settles delivered", async () => {
    await orderWith("R2-MIX", ["shared", "manual"]);
    await ensureFulfillmentForPaidOrder("R2-MIX");
    expect(orderStatus("R2-MIX")).toBe("delivered");
    expect(itemStatuses("R2-MIX")).toEqual(["delivered", "manual_required"]);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  it("partial materialization never settles the aggregate", async () => {
    await orderWith("R2-PARTIAL", ["shared", "shared"]);
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status)
      VALUES('R2-PARTIAL',0,1,1,1,'shared','telegram','12345','queued')`).run();
    fixture.sql.prepare("INSERT INTO fulfillment_jobs(order_code,variant_id,sales_channel,status) VALUES('R2-PARTIAL',1,'telegram','queued')").run();
    const order = fixture.sql.prepare("SELECT * FROM orders WHERE code='R2-PARTIAL'").get()!;
    const product = fixture.sql.prepare("SELECT * FROM products WHERE id=1").get()!;
    await processJob(1, order, product);
    expect(orderStatus("R2-PARTIAL")).not.toBe("delivered");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='R2-PARTIAL'").get()?.n).toBe(1);
  });

  it("a failed second item keeps the aggregate open and retries only that item", async () => {
    await orderWith("R2-FAIL", ["shared", "shared"]);
    fixture.sql.prepare("UPDATE product_variants SET shared_secret_ciphertext=NULL, shared_secret_iv=NULL WHERE id=2").run();
    await ensureFulfillmentForPaidOrder("R2-FAIL");
    expect(orderStatus("R2-FAIL")).toBe("retry");
    expect(itemStatuses("R2-FAIL")).toEqual(["delivered", "retry"]);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    // Fix the secret, retry: only item 2 ships now.
    const { encryptSecret } = await import("@/lib/fulfillment/crypto");
    const fixed = await encryptSecret("FIXED-2");
    fixture.sql.prepare("UPDATE product_variants SET shared_secret_ciphertext=?, shared_secret_iv=? WHERE id=2")
      .run(fixed.ciphertext, fixed.iv);
    vi.mocked(sendMessage).mockClear();
    await ensureFulfillmentForPaidOrder("R2-FAIL");
    expect(orderStatus("R2-FAIL")).toBe("delivered");
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  it("materialization failure does not settle the order", async () => {
    await orderWith("R2-NOROWS", ["shared"]);
    fixture.control.fail = (q) => q.includes("INSERT") && q.includes("fulfillment_items");
    await expect(ensureFulfillmentItems(
      fixture.sql.prepare("SELECT * FROM orders WHERE code='R2-NOROWS'").get()!,
    )).rejects.toThrow();
    fixture.control.fail = null;
    expect(orderStatus("R2-NOROWS")).toBe("not_required");
  });

  it("allItemsDelivered distinguishes handover-wait from real delivery", () => {
    expect(allItemsSettled([{ status: "manual_required" }])).toBe(true);
    expect(allItemsDelivered([{ status: "manual_required" }])).toBe(false);
    expect(allItemsDelivered([{ status: "delivered" }, { status: "manual_required" }])).toBe(true);
    expect(allItemsDelivered([{ status: "delivered" }, { status: "retry" }])).toBe(false);
  });
});
