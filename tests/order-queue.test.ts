import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { schedulePaidFulfillment } from "@/lib/payments/paid-fulfillment";
import { routeFulfillment } from "@/lib/payments/order-queue";
import { createD1Fixture } from "./helpers/d1-fixture";

const context = vi.hoisted(() => ({ send: vi.fn(), tasks: [] as Promise<unknown>[] }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => ({
  env: { ORDER_FULFILLMENT_QUEUE: { send: context.send } }, ctx: { waitUntil: (task: Promise<unknown>) => context.tasks.push(task) },
}) }));
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture(); context.tasks = []; context.send.mockReset().mockResolvedValue(undefined);
  fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES(?,'fixture','6280','[]',10000,'qris','lunas','paid')").run("AXV-20261118-QUEUE001");
});
afterEach(async () => { await Promise.all(context.tasks); fixture.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
const event = { kind: "order_paid" as const, orderCode: "AXV-20261118-QUEUE001", orderKind: "apps" as const, source: "klikqris" };
function mode(value: string) { fixture.sql.prepare("INSERT OR REPLACE INTO store_settings(key,value) VALUES('queue_fulfillment_mode',?)").run(value); }

describe("winner-only queue routing", () => {
  it.each(["off", "shadow", "active"])("metered payment cron %s never starts an unmetered fulfillment tree", async value => {
    mode(value); const db = createBudgetedDatabase(40, 0, fixture.db);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await schedulePaidFulfillment(event.orderCode, "apps", "sekalipay_gateway", "order_paid", undefined, db.access);
    expect(db.used).toBe(1); expect(context.tasks).toHaveLength(0);
    expect(context.send).toHaveBeenCalledTimes(value === "off" ? 0 : 1);
    expect(log.mock.calls.some(([line]) => String(line).includes('"outcome":"cron_deferred"'))).toBe(value !== "active");
  });
  it("active supplier message is not enqueued for an unpaid order", async () => {
    mode("active"); fixture.sql.prepare("UPDATE orders SET status='pending',payment_status='pending'").run();
    const run = vi.fn(async () => undefined);
    await routeFulfillment({ ...event, kind: "supplier_settled" }, run);
    expect(context.send).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
  });
  for (const kind of ["order_paid", "supplier_settled"] as const) {
    for (const [value, sends, runs, messageMode] of [
      ["off", 0, 1, ""], ["shadow", 1, 1, "shadow"], ["active", 1, 0, "active"],
      ["canary:apps", 1, 0, "active"], ["canary:games", 0, 1, ""], ["invalid", 0, 1, ""],
    ] as const) {
      it(`${kind} ${value}: queue=${sends}, old executor=${runs}`, async () => {
        mode(value);
        const run = vi.fn(async () => undefined);
        await routeFulfillment({ ...event, kind }, run);
        expect(context.send).toHaveBeenCalledTimes(sends);
        expect(run).toHaveBeenCalledTimes(runs);
        if (sends) expect(context.send).toHaveBeenCalledWith({ ...event, kind, v: 1, enqueuedAt: expect.any(Number), mode: messageMode });
      });
    }
    it(`${kind}: send error explicitly falls back once`, async () => {
      mode("active"); context.send.mockRejectedValueOnce(new Error("ambiguous binding send"));
      const run = vi.fn(async () => undefined);
      await routeFulfillment({ ...event, kind }, run);
      expect(context.send).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledTimes(1);
    });
  }
  it("absent setting/read failure is off", async () => {
    fixture.control.fail = query => query.includes("queue_fulfillment_mode");
    const run = vi.fn(async () => undefined);
    await routeFulfillment(event, run);
    expect(context.send).not.toHaveBeenCalled(); expect(run).toHaveBeenCalledTimes(1);
  });
  it("shares the 30s memo across new database wrappers then rolls back to off", async () => {
    vi.useFakeTimers(); mode("active");
    const run = vi.fn(async () => undefined);
    const before = fixture.control.queries;
    await routeFulfillment(event, run, createDatabaseAccess());
    mode("off");
    await routeFulfillment(event, run, createDatabaseAccess());
    expect(fixture.control.queries - before).toBe(1);
    vi.advanceTimersByTime(30_001);
    await routeFulfillment(event, run, createDatabaseAccess());
    expect(context.send).toHaveBeenCalledTimes(2); expect(run).toHaveBeenCalledTimes(1);
  });
});
