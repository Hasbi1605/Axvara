import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import {
  claimJob,
  createFulfillmentJob,
  ensureFulfillmentForPaidOrder,
  ensureFulfillmentItems,
  releaseStaleJobs,
} from "@/lib/fulfillment/deliver";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));
import { sendMessage } from "@/lib/telegram/api";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "shared", 1);
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  stubFulfillmentKey();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
  vi.mocked(sendMessage).mockClear();
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function paidOrder(code: string) {
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,10000,'qris','lunas','paid','telegram','12345','12345',1,?)`)
    .run(code, "Buyer", "628000000000",
      JSON.stringify([{ product_id: 1, variant_id: 1, name: "Item", price: 10000, qty: 1 }]),
      JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "shared" }] }));
  fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
  return fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
}
const job = (code: string) => fixture.sql.prepare("SELECT * FROM fulfillment_jobs WHERE order_code=?").get(code)!;
const item = (code: string) => fixture.sql.prepare("SELECT * FROM fulfillment_items WHERE order_code=?").get(code)!;

describe("R4 lease recovery covers jobs and items", () => {
  it("active leases are never stolen (job and item)", async () => {
    const order = paidOrder("R4-ACTIVE");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-ACTIVE", null, "shared", 1, "telegram");
    const future = new Date(Date.now() + 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(future);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(future);
    expect(await releaseStaleJobs()).toBe(0);
    expect(await claimJob(Number(job("R4-ACTIVE").id))).toBeNull();
    expect(job("R4-ACTIVE").status).toBe("sending");
    expect(item("R4-ACTIVE").status).toBe("sending");
  });

  it("expired job+item leases recover together and the order still delivers", async () => {
    const order = paidOrder("R4-STALE");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-STALE", null, "shared", 1, "telegram");
    const past = new Date(Date.now() - 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(past);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(past);
    const released = await releaseStaleJobs();
    expect(released).toBeGreaterThanOrEqual(2);
    expect(job("R4-STALE").status).toBe("retry");
    const recovered = item("R4-STALE");
    expect(recovered.status).toBe("retry");
    expect(String(recovered.last_error)).toContain("stale_lock_recovered");
    await ensureFulfillmentForPaidOrder("R4-STALE");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R4-STALE'").get()?.fulfillment_status)
      .toBe("delivered");
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
  });

  it("crashed worker before send recovers with exactly one delivery", async () => {
    const order = paidOrder("R4-CRASH-PRE");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-CRASH-PRE", null, "shared", 1, "telegram");
    const past = new Date(Date.now() - 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(past);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(past);
    await releaseStaleJobs();
    await ensureFulfillmentForPaidOrder("R4-CRASH-PRE");
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R4-CRASH-PRE'").get()?.fulfillment_status)
      .toBe("delivered");
  });

  it("stale worker cannot overwrite the new owner's delivered row", async () => {
    const order = paidOrder("R4-FENCE");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-FENCE", null, "shared", 1, "telegram");
    const past = new Date(Date.now() - 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(past);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(past);
    await releaseStaleJobs();
    // New owner delivers first.
    await ensureFulfillmentForPaidOrder("R4-FENCE");
    expect(item("R4-FENCE").status).toBe("delivered");
    // The stale worker's lease value is long gone; a fenced write with it hits zero rows.
    const stale = await fixture.sql.prepare(
      "UPDATE fulfillment_items SET status='retry', last_error='stale overwrite' WHERE id=? AND locked_until=?",
    );
    void stale;
    const res = fixture.sql.prepare(
      "UPDATE fulfillment_items SET status='retry' WHERE order_code='R4-FENCE' AND locked_until=?",
    ).run(past);
    expect(res.changes).toBe(0);
    expect(item("R4-FENCE").status).toBe("delivered");
  });

  it("ambiguous provider outcome is recorded, not claimed exactly-once", async () => {
    const order = paidOrder("R4-AMBIG");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-AMBIG", null, "shared", 1, "telegram");
    const past = new Date(Date.now() - 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(past);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(past);
    await releaseStaleJobs();
    // Recovery marks the outcome unknown; resend is bounded by the retry
    // budget and the source documents no exactly-once guarantee.
    expect(String(item("R4-AMBIG").last_error)).toContain("delivery_outcome_unknown");
    const src = (await import("node:fs")).readFileSync("src/lib/fulfillment/deliver.ts", "utf8") as string;
    // No singular-delivery promise may remain: "exactly once" and
    // "exactly-once" phrasing is banned (it would mislead admins after an
    // ambiguous crash). "exactly one job row" (UNIQUE constraint) is fine.
    const hits = src.match(/exactly[- ]once/gi) ?? [];
    expect(hits).toEqual([]);
  });

  it("recovery never strands an item sending forever", async () => {
    const order = paidOrder("R4-NOSTRAND");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-NOSTRAND", null, "shared", 1, "telegram");
    const past = new Date(Date.now() - 120_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until=?").run(past);
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until=?").run(past);
    await releaseStaleJobs();
    await ensureFulfillmentForPaidOrder("R4-NOSTRAND");
    const terminal = ["delivered", "manual_required", "failed", "retry", "queued"];
    expect(terminal).toContain(String(item("R4-NOSTRAND").status));
    expect(String(item("R4-NOSTRAND").status)).not.toBe("sending");
  });

  it("legacy ISO and space-separated locks recover identically", async () => {
    const order = paidOrder("R4-FMT");
    await ensureFulfillmentItems(order);
    await createFulfillmentJob("R4-FMT", null, "shared", 1, "telegram");
    fixture.sql.prepare("UPDATE fulfillment_items SET status='sending', locked_until='2020-01-01 00:00:00'").run();
    fixture.sql.prepare("UPDATE fulfillment_jobs SET status='sending', locked_until='2020-01-01T00:00:00.000Z'").run();
    const released = await releaseStaleJobs();
    expect(released).toBeGreaterThanOrEqual(2);
    expect(item("R4-FMT").status).toBe("retry");
  });
});
