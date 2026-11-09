import { afterEach, describe, expect, it, vi } from "vitest";

const games = vi.hoisted(() => vi.fn(async () => ({})));
const pedia = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/games/dispatch", () => ({ processGamesPaidOrders: games }));
vi.mock("@/lib/pedia/dispatch", () => ({ processPediaPaidOrders: pedia }));

afterEach(() => { games.mockClear(); pedia.mockClear(); });

describe("schedulePaidFulfillment", () => {
  it("routes order_kind 'games' to the Games dispatcher only", async () => {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-G-1", "games");
    expect(games).toHaveBeenCalledTimes(1);
    expect(pedia).not.toHaveBeenCalled();
  });
  it("keeps routing 'pedia' to Pedia", async () => {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment("AXV-P-1", "pedia");
    expect(pedia).toHaveBeenCalledTimes(1);
    expect(games).not.toHaveBeenCalled();
  });
});
