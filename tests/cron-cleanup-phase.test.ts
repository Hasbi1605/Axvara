import { describe, expect, it, vi } from "vitest";
import { run } from "@/lib/cron/phases/cleanup";
import type { OperationsContext } from "@/lib/cron/operations-context";

const cleanup = vi.hoisted(() => vi.fn(async () => ({ whatsapp_rows_cleaned: 3 })));
vi.mock("@/lib/maintenance-cleanup", () => ({ runMaintenanceCleanup: cleanup }));

function ctx(opts: { waiting?: boolean; fits?: boolean; deferred?: string[] } = {}) {
  const results: Record<string, unknown> = {};
  const deferredOut = (opts.deferred ?? []) as OperationsContext["deferredOut"];
  const database = {};
  const context = {
    budget: { fits: (n: number) => (opts.fits ?? true) && n <= 10 },
    database,
    results,
    deferredOut,
    counts: {
      pendingJobs: opts.waiting ? 1 : 0,
      pendingNotify: 0,
      waWorkPending: 0,
      pendingExpiryAny: 0,
    },
  } as unknown as OperationsContext;
  return { context, results, deferredOut, database };
}

describe("operations cleanup phase gate", () => {
  it("defers without work when a wait signal is present, without duplicating", async () => {
    cleanup.mockClear();
    const { context, results, deferredOut } = ctx({ waiting: true, deferred: ["cleanup"] });
    await run(context);
    expect(cleanup).not.toHaveBeenCalled();
    expect(results).toEqual({});
    expect(deferredOut).toEqual(["cleanup"]);
  });

  it("defers when budget headroom is below the exact 10 cost", async () => {
    cleanup.mockClear();
    const { context, deferredOut } = ctx({ fits: false });
    await run(context);
    expect(cleanup).not.toHaveBeenCalled();
    expect(deferredOut).toEqual(["cleanup"]);
  });

  it("runs at exactly eligible headroom and mutates results in order", async () => {
    cleanup.mockClear();
    const { context, results, deferredOut, database } = ctx();
    await run(context);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith(database);
    expect(results).toEqual({ whatsapp_rows_cleaned: 3 });
    expect(deferredOut).toEqual([]);
  });
});
