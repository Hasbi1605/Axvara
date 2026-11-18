import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
  retry: vi.fn(async () => true),
  process: vi.fn(async () => 1),
  status: "completed",
  allowed: true,
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: async () => m.allowed ? { id: 1 } : null }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: m.ensure }));
vi.mock("@/lib/aivault/orders", () => ({
  retryAivaultOrder: m.retry, processAivaultOrders: m.process,
  createAivaultOrderLinks: async () => 0, AIVAULT_RETRYABLE_SQL: "1=1",
}));
vi.mock("@/lib/db-access", () => ({
  unwrapD1: () => null,
  createDatabaseAccess: () => ({ d1: null, queryFirst: async () => null }),
  createBudgetedDatabase: () => ({ access: { queryFirst: async (sql: string) => sql.startsWith("SELECT *")
    ? { id: 7, order_code: "AXV-AV-1" } : { status: m.status, last_error: null } } }),
}));
vi.mock("@/lib/db", () => ({ queryFirst: async () => ({ code: "AXV-AV-1", status: "lunas", payment_status: "paid", items: "[]" }) }));
vi.mock("@/lib/tunvn/orders", () => ({ createTunvnOrderLinks: async () => 0, processTunvnOrders: async () => 0 }));
vi.mock("@/lib/fulfillment/delivery/inventory-binding", () => ({ ensureFulfillmentItems: async () => [] }));
vi.mock("@/lib/warung-rebahan/client", () => ({ isWrAutoOrderEnabled: () => false }));
vi.mock("@/lib/sekalipay/client", () => ({ isSkAutoOrderEnabled: () => false }));
vi.mock("@/lib/warung-rebahan/order", () => ({}));
vi.mock("@/lib/sekalipay/order", () => ({}));

afterEach(() => {
  m.ensure.mockReset().mockResolvedValue(true); m.retry.mockReset().mockResolvedValue(true);
  m.process.mockReset().mockResolvedValue(1); m.status = "completed"; m.allowed = true;
});
const retry = async () => (await import("@/app/api/admin/aivault/orders/route")).POST(new NextRequest("https://axvara.test/api/admin/aivault/orders", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 7, action: "retry" }),
}));

it("runs buyer delivery again after the paid AIVault purchase settles, not just concurrently", async () => {
  m.process.mockImplementationOnce(async () => {
    await Promise.resolve();
    expect(m.ensure).toHaveBeenCalledTimes(1);
    return 1;
  });
  await (await import("@/lib/payments/paid-fulfillment")).schedulePaidFulfillment("AXV-AV-1", "apps");
  expect(m.process).toHaveBeenCalledWith(undefined, { orderCode: "AXV-AV-1" });
  expect(m.ensure).toHaveBeenCalledTimes(2);
});
it("keeps one generic delivery pass when there is no AIVault work", async () => {
  m.process.mockResolvedValueOnce(0);
  await (await import("@/lib/payments/paid-fulfillment")).schedulePaidFulfillment("AXV-AV-1", "apps");
  expect(m.ensure).toHaveBeenCalledTimes(1);
});
it("delivers completed admin retry inline", async () => {
  expect((await retry()).status).toBe(200);
  expect(m.ensure).toHaveBeenCalledWith("AXV-AV-1");
});
it.each(["processing", "needs_admin"])("does not deliver a %s retry", async status => {
  m.status = status;
  expect((await retry()).status).toBe(200);
  expect(m.ensure).not.toHaveBeenCalled();
});
it("leaves failed delivery to the existing durable retry without repeating the purchase", async () => {
  m.ensure.mockRejectedValueOnce(new Error("mail unavailable"));
  expect((await retry()).status).toBe(200);
  expect(m.retry).toHaveBeenCalledTimes(1);
});
it("does not dispatch or deliver unauthorized or unsafe retries", async () => {
  m.allowed = false;
  expect((await retry()).status).toBe(401);
  expect(m.retry).not.toHaveBeenCalled();
  m.allowed = true; m.retry.mockResolvedValueOnce(false);
  expect((await retry()).status).toBe(409);
  expect(m.ensure).not.toHaveBeenCalled();
});
