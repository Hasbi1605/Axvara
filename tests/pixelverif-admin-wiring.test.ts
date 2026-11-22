import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => true));
const mockPublishPixelverifCatalog = vi.hoisted(() => vi.fn(async () => ({ ok: true, mirrored: 2, idr_per_usd: 16000 })));
const mockFetchPixelverifCredits = vi.hoisted(() => vi.fn());
const mockLoadCurrentFxSnapshot = vi.hoisted(() => vi.fn<() => Promise<{ rateText: string; fetchedAt: string; stale: boolean } | null>>(async () => ({ rateText: "16000", fetchedAt: "2026-11-18T00:00:00Z", stale: false })));
const mockDecryptSecret = vi.hoisted(() => vi.fn(async () => ""));
const mockBumpCatalogRevision = vi.hoisted(() => vi.fn(async () => {}));
const mockDbState = vi.hoisted(() => ({
  queryFirst: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(),
  queryAll: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>[]>>(async () => []),
  execRun: vi.fn(async () => ({ changes: 1 })),
  d1Batch: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  syncKv: new Map<string, string>(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/catalog-cache", () => ({ bumpCatalogRevision: mockBumpCatalogRevision }));
vi.mock("@/lib/fulfillment/crypto", () => ({ decryptSecret: mockDecryptSecret }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mockLoadCurrentFxSnapshot }));
vi.mock("@/lib/pixelverif/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pixelverif/catalog")>("@/lib/pixelverif/catalog");
  return { ...actual, publishPixelverifCatalog: mockPublishPixelverifCatalog };
});
vi.mock("@/lib/pixelverif/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pixelverif/client")>("@/lib/pixelverif/client");
  return { ...actual, fetchPixelverifCredits: mockFetchPixelverifCredits };
});
vi.mock("@/lib/db-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-access")>("@/lib/db-access");
  const access = {
    d1: { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }), batch: mockDbState.d1Batch },
    queryFirst: mockDbState.queryFirst,
    queryAll: mockDbState.queryAll,
    execRun: mockDbState.execRun,
    canSpend: () => true,
  };
  return { ...actual, createDatabaseAccess: () => access, createBudgetedDatabase: () => ({ access, stats: () => ({ statements: 0 }) }) };
});

import { GET as getPixelverifProducts } from "@/app/api/admin/pixelverif/products/route";
import { GET as getPixelverifBalance } from "@/app/api/admin/pixelverif/balance/route";
import { POST as postPixelverifPublish } from "@/app/api/admin/pixelverif/publish/route";
import { GET as getPixelverifOrders } from "@/app/api/admin/pixelverif/orders/route";
import { SUPPLIERS } from "@/components/admin/supplier-admin-data";

describe("Pixel Verification admin wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(true);
    mockDbState.syncKv.clear();
    mockDbState.queryAll.mockResolvedValue([]);
    mockDbState.queryFirst.mockResolvedValue(null);
  });

  it("requires admin on all routes", async () => {
    mockRequireAdmin.mockResolvedValueOnce(false);
    const res = await getPixelverifProducts(new NextRequest("http://localhost/api/admin/pixelverif/products"));
    expect(res.status).toBe(401);

    mockRequireAdmin.mockResolvedValueOnce(false);
    const res2 = await getPixelverifBalance(new NextRequest("http://localhost/api/admin/pixelverif/balance"));
    expect(res2.status).toBe(401);

    mockRequireAdmin.mockResolvedValueOnce(false);
    const res3 = await postPixelverifPublish(new NextRequest("http://localhost/api/admin/pixelverif/publish", { method: "POST", body: "{}" }));
    expect(res3.status).toBe(401);

    mockRequireAdmin.mockResolvedValueOnce(false);
    const res4 = await getPixelverifOrders(new NextRequest("http://localhost/api/admin/pixelverif/orders"));
    expect(res4.status).toBe(401);
  });

  it("panel registry contains pixelverif", () => {
    expect(SUPPLIERS.pixelverif).toBeDefined();
    expect(SUPPLIERS.pixelverif.name).toBe("Pixel Verification");
  });

  it("publish returns fx_unavailable when snapshot missing", async () => {
    mockLoadCurrentFxSnapshot.mockResolvedValueOnce(null);
    const res = await postPixelverifPublish(new NextRequest("http://localhost/api/admin/pixelverif/publish", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("fx_unavailable");
  });

  it("balance returns credits when ok and 503 when not configured", async () => {
    mockFetchPixelverifCredits.mockResolvedValueOnce({ kind: "ok", status: 200, json: {}, data: { credits_remaining: 5 } });
    const ok = await getPixelverifBalance(new NextRequest("http://localhost/api/admin/pixelverif/balance"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).credits_remaining).toBe(5);

    mockFetchPixelverifCredits.mockResolvedValueOnce({ kind: "config", reason: "not_configured" });
    const cfg = await getPixelverifBalance(new NextRequest("http://localhost/api/admin/pixelverif/balance"));
    expect(cfg.status).toBe(503);
  });
});
