import { afterEach, describe, expect, it, vi } from "vitest";

const games = vi.hoisted(() => vi.fn(async () => ({})));
const pedia = vi.hoisted(() => vi.fn(async () => ({})));
const paidMail = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/games/dispatch", () => ({ processGamesPaidOrders: games }));
vi.mock("@/lib/pedia/dispatch", () => ({ processPediaPaidOrders: pedia }));
vi.mock("@/lib/games/notify", () => ({ notifyGamesPaid: paidMail }));

afterEach(() => { games.mockClear(); pedia.mockClear(); paidMail.mockReset().mockResolvedValue(true); });

describe("schedulePaidFulfillment", () => {
  it("routes order_kind 'games' to the Games dispatcher only", async () => {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-G-1", "games");
    expect(games).toHaveBeenCalledTimes(1);
    expect(paidMail).toHaveBeenCalledExactlyOnceWith(expect.any(Object), "AXV-G-1");
    expect(pedia).not.toHaveBeenCalled();
  });
  it("keeps routing 'pedia' to Pedia", async () => {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-P-1", "pedia");
    expect(pedia).toHaveBeenCalledTimes(1);
    expect(games).not.toHaveBeenCalled();
    expect(paidMail).not.toHaveBeenCalled();
  });
  it("still dispatches paid Games if buyer email throws", async () => {
    paidMail.mockRejectedValueOnce(new Error("fixture email down"));
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXG-20991231-00F17004", "games");
    expect(games).toHaveBeenCalledTimes(1);
    expect(pedia).not.toHaveBeenCalled();
  });
});
