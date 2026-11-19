import { afterEach, describe, expect, it, vi } from "vitest";

// Regression 16 Nov 2026 (AXV-20261116-F04356BC): admin Retry bought from
// TUNVN at 14:22:46 but buyer delivery waited for the cron fulfillment tick
// (14:24:30). A completed purchase must trigger delivery immediately.
const m = vi.hoisted(() => ({
  ensure: vi.fn(async () => true),
  retry: vi.fn(async () => true),
  process: vi.fn(async () => 1),
  linkStatus: "completed",
  order: { code: "AXV-T-1", status: "lunas", payment_status: "paid", items: "[]" } as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: m.ensure }));
vi.mock("@/lib/tunvn/orders", () => ({
  retryTunvnOrder: m.retry,
  processTunvnOrders: m.process,
  createTunvnOrderLinks: vi.fn(async () => 0),
  TUNVN_RETRYABLE_SQL: "1=1",
}));
vi.mock("@/lib/db-access", () => ({
  unwrapD1: () => null,
  createDatabaseAccess: () => ({
    d1: null,
    queryFirst: vi.fn(async (sql: string) => {
      if (!sql.includes("tunvn_order_links")) return null;
      return sql.startsWith("SELECT * FROM")
        ? { id: 7, order_code: "AXV-T-1", status: "needs_admin" }
        : { status: m.linkStatus, last_error: null };
    }),
  }),
}));
vi.mock("@/lib/db", () => ({ queryFirst: vi.fn(async () => m.order) }));
vi.mock("@/lib/aivault/orders", () => ({ createAivaultOrderLinks: vi.fn(async () => 0), processAivaultOrders: vi.fn(async () => 0) }));
vi.mock("@/lib/fulfillment/delivery/inventory-binding", () => ({ ensureFulfillmentItems: vi.fn(async () => []) }));
vi.mock("@/lib/warung-rebahan/client", () => ({ isWrAutoOrderEnabled: () => false }));
vi.mock("@/lib/sekalipay/client", () => ({ isSkAutoOrderEnabled: () => false }));
vi.mock("@/lib/warung-rebahan/order", () => ({}));
vi.mock("@/lib/sekalipay/order", () => ({}));

const post = async () => {
  const { POST } = await import("@/app/api/admin/tunvn/orders/route");
  const { NextRequest } = await import("next/server");
  return POST(new NextRequest("https://axvara.test/api/admin/tunvn/orders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 7, action: "retry" }),
  }));
};

afterEach(() => { m.ensure.mockClear(); m.retry.mockClear(); m.process.mockClear(); m.linkStatus = "completed"; m.process.mockResolvedValue(1); });

describe("TUNVN immediate buyer delivery", () => {
  it("admin retry that completes the purchase delivers to the buyer in the same request", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.ensure).toHaveBeenCalledWith("AXV-T-1");
  });

  it("admin retry that does not complete leaves delivery to cron", async () => {
    m.linkStatus = "needs_admin";
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.ensure).not.toHaveBeenCalled();
  });

  it("paid flow re-runs delivery after the TUNVN purchase settles", async () => {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-T-1", "apps");
    // Once for the generic pass, once after the TUNVN link was processed.
    expect(m.ensure).toHaveBeenCalledTimes(2);
  });

  it("paid flow without a TUNVN link to process keeps a single delivery pass", async () => {
    m.process.mockResolvedValue(0);
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-T-1", "apps");
    expect(m.ensure).toHaveBeenCalledTimes(1);
  });
  it("legacy no-deadline pass still starts supplier work while generic delivery is pending", async () => {
    let finish!: () => void;
    m.ensure.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
    m.process.mockResolvedValue(0);
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    const task = schedulePaidFulfillment("AXV-T-1", "apps");
    try { await vi.waitFor(() => expect(m.process).toHaveBeenCalledTimes(1)); }
    finally { finish?.(); await task; }
  });
});
