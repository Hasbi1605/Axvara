import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => true));
const mockQueryFirst = vi.hoisted(() => vi.fn());
const mockCreateTunvnOrderLinks = vi.hoisted(() => vi.fn(async () => 0));
const mockProcessTunvnOrders = vi.hoisted(() => vi.fn(async () => 0));
const mockCreateAivaultOrderLinks = vi.hoisted(() => vi.fn(async () => 0));
const mockProcessAivaultOrders = vi.hoisted(() => vi.fn(async () => 0));
const mockCreateStorebatOrderLinks = vi.hoisted(() => vi.fn(async () => 0));
const mockProcessStorebatOrders = vi.hoisted(() => vi.fn(async () => 0));
const mockCreateMiraiOrderLinks = vi.hoisted(() => vi.fn(async () => 1));
const mockProcessMiraiOrders = vi.hoisted(() => vi.fn(async () => 1));
const mockRetryMiraiOrder = vi.hoisted(() => vi.fn(async () => true));
const mockEnsureFulfillmentItems = vi.hoisted(() => vi.fn(async () => []));
const mockEnsureFulfillmentForPaidOrder = vi.hoisted(() => vi.fn(async () => ({ ok: true, count: 1, mode: "automatic", emailSent: true })));
const mockDecryptSecret = vi.hoisted(() => vi.fn(async () => "{}"));
const mockDbAccess = vi.hoisted(() => ({
  queryFirst: vi.fn(),
  queryAll: vi.fn(async () => []),
  runQuery: vi.fn(async () => ({ meta: { changes: 0 } })),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/db", () => ({ queryFirst: mockQueryFirst, queryAll: vi.fn(async () => []), runQuery: vi.fn(async () => ({})) }));
vi.mock("@/lib/db-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-access")>("@/lib/db-access");
  return {
    ...actual,
    createDatabaseAccess: () => mockDbAccess,
    createBudgetedDatabase: () => ({ access: mockDbAccess, stats: () => ({ statements: 0, rowsRead: 0, rowsWritten: 0 }) }),
  };
});
vi.mock("@/lib/tunvn/orders", () => ({ createTunvnOrderLinks: mockCreateTunvnOrderLinks, processTunvnOrders: mockProcessTunvnOrders }));
vi.mock("@/lib/aivault/orders", () => ({ createAivaultOrderLinks: mockCreateAivaultOrderLinks, processAivaultOrders: mockProcessAivaultOrders }));
vi.mock("@/lib/storebat/orders", () => ({ createStorebatOrderLinks: mockCreateStorebatOrderLinks, processStorebatOrders: mockProcessStorebatOrders }));
vi.mock("@/lib/mirai/orders", () => ({
  MIRAI_RETRYABLE_SQL: "status IN ('pending','needs_admin')",
  createMiraiOrderLinks: mockCreateMiraiOrderLinks,
  processMiraiOrders: mockProcessMiraiOrders,
  retryMiraiOrder: mockRetryMiraiOrder,
}));
vi.mock("@/lib/fulfillment/delivery/inventory-binding", () => ({ ensureFulfillmentItems: mockEnsureFulfillmentItems }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: mockEnsureFulfillmentForPaidOrder }));
vi.mock("@/lib/fulfillment/crypto", () => ({ decryptSecret: mockDecryptSecret }));
vi.mock("@/lib/warung-rebahan/client", () => ({ isWrAutoOrderEnabled: () => false }));
vi.mock("@/lib/sekalipay/client", () => ({ isSkAutoOrderEnabled: () => false }));
vi.mock("@/lib/payments/order-queue", () => ({
  routeFulfillment: async (_e: unknown, fallback: () => Promise<unknown>) => { await fallback(); },
}));

import { schedulePaidFulfillment } from "@/lib/payments/paid-fulfillment";
import { POST as miraiOrderAction } from "@/app/api/admin/mirai/orders/route";

describe("Mirai immediate credential delivery & admin retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(true);
    mockQueryFirst.mockResolvedValue({ code: "ORD-MR-1", status: "lunas", payment_status: "paid" });
    mockCreateMiraiOrderLinks.mockResolvedValue(1);
    mockProcessMiraiOrders.mockResolvedValue(1);
    mockRetryMiraiOrder.mockResolvedValue(true);
    mockEnsureFulfillmentForPaidOrder.mockResolvedValue({ ok: true, count: 1, mode: "automatic", emailSent: true });
  });

  it("re-runs fulfillment delivery on paid path immediately after processMiraiOrders settles", async () => {
    await schedulePaidFulfillment("ORD-MR-1", "apps", "payment");
    expect(mockCreateMiraiOrderLinks).toHaveBeenCalledWith("ORD-MR-1");
    expect(mockEnsureFulfillmentItems).toHaveBeenCalledTimes(1);
    expect(mockProcessMiraiOrders).toHaveBeenCalledWith(undefined, { orderCode: "ORD-MR-1", deadlineMs: Infinity });
    expect(mockEnsureFulfillmentForPaidOrder).toHaveBeenCalledTimes(2);
    expect(mockEnsureFulfillmentForPaidOrder).toHaveBeenCalledWith("ORD-MR-1");
  });

  it("runs only the single generic delivery pass when processMiraiOrders reports 0 settled", async () => {
    mockProcessMiraiOrders.mockResolvedValueOnce(0);
    await schedulePaidFulfillment("ORD-MR-1", "apps", "payment");
    expect(mockProcessMiraiOrders).toHaveBeenCalledTimes(1);
    expect(mockEnsureFulfillmentForPaidOrder).toHaveBeenCalledTimes(1);
  });

  it("admin retry triggers fulfillment delivery when completed, skips when needs_admin/processing, and survives delivery failure", async () => {
    mockDbAccess.queryFirst
      .mockResolvedValueOnce({ id: 7, order_code: "ORD-MR-7" })
      .mockResolvedValueOnce({ status: "completed", last_error: null });

    const req = () =>
      new NextRequest("http://localhost/api/admin/mirai/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 7, action: "retry" }),
      });

    const okRes = await miraiOrderAction(req());
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true, link: { status: "completed", last_error: null } });
    expect(mockEnsureFulfillmentForPaidOrder).toHaveBeenCalled();

    vi.clearAllMocks();
    mockDbAccess.queryFirst
      .mockResolvedValueOnce({ id: 7, order_code: "ORD-MR-7" })
      .mockResolvedValueOnce({ status: "needs_admin", last_error: "redeem_pending" });
    const pendingRes = await miraiOrderAction(req());
    expect(pendingRes.status).toBe(200);
    expect(mockEnsureFulfillmentForPaidOrder).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockDbAccess.queryFirst
      .mockResolvedValueOnce({ id: 7, order_code: "ORD-MR-7" })
      .mockResolvedValueOnce({ status: "completed", last_error: null });
    mockEnsureFulfillmentForPaidOrder.mockRejectedValueOnce(new Error("smtp_down"));
    const deferredRes = await miraiOrderAction(req());
    expect([200, 503]).toContain(deferredRes.status);
  });
});
