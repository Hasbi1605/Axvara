import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => true));
const mockFetchMiraiBalance = vi.hoisted(() => vi.fn());
const mockPublishMiraiCatalog = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, mirrored: 3, idr_per_usd: 16000, idr_per_usdt: 16000 })),
);
const mockLoadCurrentFxSnapshot = vi.hoisted(() =>
  vi.fn<() => Promise<{ rateText: string; fetchedAt: string; stale: boolean } | null>>(async () => ({
    rateText: "16000",
    fetchedAt: "2026-11-18T00:00:00Z",
    stale: false,
  })),
);
const mockDecryptSecret = vi.hoisted(() => vi.fn(async () => ""));
const mockBumpCatalogRevision = vi.hoisted(() => vi.fn(async () => {}));
const mockDbState = vi.hoisted(() => ({
  queryFirst: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(),
  queryAll: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>[]>>(async () => []),
  runQuery: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ meta: { changes: 1 } })),
  d1Batch: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  syncKv: new Map<string, string>(),
}));

vi.mock("@/lib/auth", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/catalog-cache", () => ({ bumpCatalogRevision: mockBumpCatalogRevision }));
vi.mock("@/lib/fulfillment/crypto", () => ({ decryptSecret: mockDecryptSecret }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mockLoadCurrentFxSnapshot }));
vi.mock("@/lib/mirai/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mirai/catalog")>("@/lib/mirai/catalog");
  return { ...actual, publishMiraiCatalog: mockPublishMiraiCatalog };
});
vi.mock("@/lib/mirai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mirai/client")>("@/lib/mirai/client");
  return { ...actual, fetchMiraiBalance: mockFetchMiraiBalance };
});
vi.mock("@/lib/sync-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync-status")>("@/lib/sync-status");
  return {
    ...actual,
    getSyncValues: vi.fn(async () => new Map(mockDbState.syncKv)),
  };
});
vi.mock("@/lib/db-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-access")>("@/lib/db-access");
  const access = {
    d1: {
      prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
      batch: mockDbState.d1Batch,
    },
    queryFirst: mockDbState.queryFirst,
    queryAll: mockDbState.queryAll,
    runQuery: mockDbState.runQuery,
  };
  return {
    ...actual,
    createDatabaseAccess: () => access,
    createBudgetedDatabase: () => ({ access, stats: () => ({ statements: 0, rowsRead: 0, rowsWritten: 0 }) }),
  };
});

import { GET as getMiraiBalance } from "@/app/api/admin/mirai/balance/route";
import { GET as getMiraiProducts } from "@/app/api/admin/mirai/products/route";
import { PATCH as patchMiraiProduct } from "@/app/api/admin/mirai/products/[id]/route";
import { POST as postMiraiPublish } from "@/app/api/admin/mirai/publish/route";
import { GET as getMiraiOrders, POST as postMiraiOrders } from "@/app/api/admin/mirai/orders/route";
import { withoutPrivateBuyerData } from "@/lib/buyer-fields";
import { reportTables } from "@/lib/reports/export";
import type { SelectedReport } from "@/lib/dashboard-report";
import { EXPENSE_CATEGORIES } from "@/lib/finance/types";

describe("Mirai admin API routes & shared contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(true);
    mockDbState.syncKv.clear();
  });

  it("GET /api/admin/mirai/balance exposes USDT only and rejects unauthorized/failure", async () => {
    mockRequireAdmin.mockResolvedValueOnce(false);
    const unauth = await getMiraiBalance(new NextRequest("http://localhost/api/admin/mirai/balance"));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("Cache-Control")).toBe("private, no-store");

    mockFetchMiraiBalance.mockResolvedValueOnce({ kind: "config" });
    expect((await getMiraiBalance(new NextRequest("http://localhost/api/admin/mirai/balance"))).status).toBe(503);

    mockFetchMiraiBalance.mockResolvedValueOnce({ kind: "http", status: 500 });
    expect((await getMiraiBalance(new NextRequest("http://localhost/api/admin/mirai/balance"))).status).toBe(502);

    mockFetchMiraiBalance.mockResolvedValueOnce({ kind: "ok", balance_vnd: 325000 });
    const okRes = await getMiraiBalance(new NextRequest("http://localhost/api/admin/mirai/balance"));
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body).toEqual({ ok: true, balance: 12.5, currency: "USDT" });
    expect(JSON.stringify(body)).not.toMatch(/vnd/i);
  });

  it("GET /api/admin/mirai/products exposes package_code, cost_usdt, fx_idr_per_usdt without VND", async () => {
    mockDbState.syncKv.set("mirai_catalog_success_at", "2026-11-18T10:00:00Z");
    mockDbState.syncKv.set("mirai_catalog_last_error", "");
    mockDbState.queryAll.mockResolvedValueOnce([
      {
        package_code: "claude_pro_10m",
        group_key: "claude",
        name: "Claude Pro 10M",
        quota_tokens: 10000000,
        duration_seconds: 2592000,
        cost_usdt: 2,
        min_quantity: 1,
        max_quantity: 5,
        unlimited: 0,
        remaining_today: 50,
        stock: 50,
        disappeared: 0,
        markup_percent: 25,
        admin_price_idr: null,
        fx_idr_per_usdt: 16000,
        axvara_product_id: 11,
        product_name: "Claude Pro",
        product_active: 1,
        product_archived: 0,
        variant_id: 21,
        sku: "MR-claude_pro_10m",
        label: "10M Tokens",
        variant_price: 40000,
        variant_active: 1,
        last_seen_at: "2026-11-18T10:00:00Z",
        family: "claude",
      },
    ]);

    const res = await getMiraiProducts(new NextRequest("http://localhost/api/admin/mirai/products"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.items[0]).toMatchObject({
      package_code: "claude_pro_10m",
      cost_usdt: 2,
      fx_idr_per_usdt: 16000,
    });
    expect(JSON.stringify(body)).not.toMatch(/vnd/i);
  });

  it("PATCH /api/admin/mirai/products/[id] validates package_code, body, archive, and updates FX price", async () => {
    const badId = await patchMiraiProduct(
      new NextRequest("http://localhost/api/admin/mirai/products/bad%20id", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      }),
      { params: Promise.resolve({ id: "bad id" }) },
    );
    expect(badId.status).toBe(400);

    const badBody = await patchMiraiProduct(
      new NextRequest("http://localhost/api/admin/mirai/products/claude_pro_10m", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unknown: 1 }),
      }),
      { params: Promise.resolve({ id: "claude_pro_10m" }) },
    );
    expect(badBody.status).toBe(400);

    mockDbState.queryFirst.mockResolvedValueOnce({
      id: 21,
      product_id: 11,
      is_active: 0,
      archived_at: "2026-11-18T00:00:00Z",
      mirai_package_code: "claude_pro_10m",
      mirai_cost_usdt: 2,
      mirai_fx_idr_per_usdt: 16000,
      mirai_markup_percent: 25,
      mirai_admin_price_idr: null,
    });
    const archived = await patchMiraiProduct(
      new NextRequest("http://localhost/api/admin/mirai/products/claude_pro_10m", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      }),
      { params: Promise.resolve({ id: "claude_pro_10m" }) },
    );
    expect(archived.status).toBe(409);

    mockDbState.queryFirst.mockResolvedValueOnce({
      id: 21,
      product_id: 11,
      is_active: 1,
      archived_at: null,
      mirai_package_code: "claude_pro_10m",
      mirai_cost_usdt: 2,
      mirai_fx_idr_per_usdt: 16000,
      mirai_markup_percent: 25,
      mirai_admin_price_idr: null,
    });
    mockDbState.d1Batch.mockResolvedValueOnce([{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    const okPatch = await patchMiraiProduct(
      new NextRequest("http://localhost/api/admin/mirai/products/claude_pro_10m", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markup_percent: 50, admin_price_idr: 55000, is_active: true }),
      }),
      { params: Promise.resolve({ id: "claude_pro_10m" }) },
    );
    expect(okPatch.status).toBe(200);
    expect(await okPatch.json()).toEqual({ ok: true });
    expect(mockBumpCatalogRevision).toHaveBeenCalledTimes(1);
  });

  it("POST /api/admin/mirai/publish validates empty object body, FX, and exposes idr_per_usdt", async () => {
    const bad = await postMiraiPublish(
      new NextRequest("http://localhost/api/admin/mirai/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extra: 1 }),
      }),
    );
    expect(bad.status).toBe(400);

    mockLoadCurrentFxSnapshot.mockResolvedValueOnce(null);
    const noFx = await postMiraiPublish(
      new NextRequest("http://localhost/api/admin/mirai/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(noFx.status).toBe(503);

    const ok = await postMiraiPublish(
      new NextRequest("http://localhost/api/admin/mirai/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, mirrored: 3, idr_per_usd: 16000, idr_per_usdt: 16000 });
  });

  it("GET & POST(reveal) /api/admin/mirai/orders strip VND and raw provider error text", async () => {
    mockDbState.queryAll.mockResolvedValueOnce([
      {
        id: 1,
        order_code: "ORD-M1",
        item_index: 0,
        package_code: "claude_pro_10m",
        quantity: 2,
        cost_usdt: 4,
        fx_idr_per_usdt: 16000,
        external_order_id: "EXT-1",
        idempotency_key: "IDEM-1",
        provider_order_code: "MR-99",
        status: "completed",
        attempt_count: 1,
        request_sent_at: "2026-11-18T10:00:00Z",
        last_error: null,
        completed_at: "2026-11-18T10:00:05Z",
        receipt_json: JSON.stringify({
          received: 2,
          requested: 2,
          status: "completed",
          amount_vnd: 104000,
          unit_price_vnd: 52000,
        }),
        has_receipt: 1,
        can_retry: 0,
      },
    ]);
    const listRes = await getMiraiOrders(new NextRequest("http://localhost/api/admin/mirai/orders"));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items[0].package_code).toBe("claude_pro_10m");
    expect(listBody.items[0].receipt_json).not.toMatch(/vnd/i);
    expect(JSON.parse(listBody.items[0].receipt_json)).toMatchObject({
      received: 2,
      requested: 2,
      status: "completed",
      amount_usdt: 4,
      unit_cost_usdt: 2,
    });

    mockDbState.queryFirst.mockResolvedValueOnce({
      id: 1,
      order_code: "ORD-M1",
      package_code: "claude_pro_10m",
      quantity: 2,
      cost_usdt: 4,
      external_order_id: "EXT-1",
      provider_order_code: "MR-99",
      status: "completed",
      last_error: "raw_internal_secret_err",
      completed_at: "2026-11-18T10:00:05Z",
      receipt_ciphertext: "cipher",
      receipt_iv: "iv",
    });
    mockDecryptSecret.mockResolvedValueOnce(
      JSON.stringify({
        success: true,
        data: {
          order_code: "MR-99",
          external_order_id: "EXT-1",
          package_code: "claude_pro_10m",
          quantity: 2,
          status: "completed",
          created_at: "2026-11-18T10:00:00Z",
          completed_at: "2026-11-18T10:00:05Z",
          redeem_codes: ["CODE-1", "CODE-2"],
          unit_price_vnd: 52000,
          amount_vnd: 104000,
          balance_before: 500000,
          balance_after: 396000,
        },
      }),
    );

    const revealOk = await postMiraiOrders(
      new NextRequest("http://localhost/api/admin/mirai/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 1, action: "reveal" }),
      }),
    );
    expect(revealOk.status).toBe(200);
    const revealBody = await revealOk.json();
    expect(revealBody.ok).toBe(true);
    expect(revealBody.receipt).not.toMatch(/vnd|balance_before|balance_after|raw_internal/i);
    expect(JSON.parse(revealBody.receipt)).toEqual({
      order_code: "MR-99",
      external_order_id: "EXT-1",
      package_code: "claude_pro_10m",
      quantity: 2,
      status: "completed",
      created_at: "2026-11-18T10:00:00Z",
      completed_at: "2026-11-18T10:00:05Z",
      redeem_codes: ["CODE-1", "CODE-2"],
      unit_cost_usdt: 2,
      amount_usdt: 4,
    });

    // Error receipt fallback also hides raw provider error text and VND fields
    mockDbState.queryFirst.mockResolvedValueOnce({
      id: 2,
      order_code: "ORD-M2",
      package_code: "claude_pro_10m",
      quantity: 1,
      cost_usdt: 2,
      external_order_id: "EXT-2",
      provider_order_code: null,
      status: "needs_admin",
      last_error: "http_409",
      completed_at: null,
      receipt_ciphertext: "cipher2",
      receipt_iv: "iv2",
    });
    mockDecryptSecret.mockResolvedValueOnce(
      JSON.stringify({ success: false, message: "Internal stack trace: VND 52000 insufficient balance", balance_before: 1000 }),
    );
    const revealErr = await postMiraiOrders(
      new NextRequest("http://localhost/api/admin/mirai/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: 2, action: "reveal" }),
      }),
    );
    expect(revealErr.status).toBe(200);
    const revealErrBody = await revealErr.json();
    expect(revealErrBody.receipt).not.toMatch(/stack trace|vnd|balance_before|insufficient balance/i);
    expect(JSON.parse(revealErrBody.receipt)).toMatchObject({
      external_order_id: "EXT-2",
      package_code: "claude_pro_10m",
      quantity: 1,
      status: "needs_admin",
      error: "http_409",
    });
  });

  it("redacts mirai_eligibility in public buyer data and includes Mirai in reportTables", () => {
    expect(withoutPrivateBuyerData([{ email: "a@b.c", mirai_eligibility: { items: [{ variant_id: 1, item_index: 0, package_code: "p1", cost_usdt: 2, fx_idr_per_usdt: 16000 }] } }])).toEqual([{ email: "a@b.c" }]);

    const zeroCat = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as SelectedReport["expenses_by_category"];
    const fakeReport: SelectedReport = {
      from: "2026-11-12",
      to: "2026-11-18",
      timezone: "Asia/Jakarta",
      generated_at: "2026-11-18T10:00:00Z",
      orders: 1,
      revenue: 50000,
      cost: 32000,
      profit: 18000,
      payment_fees: 0,
      refund_expenses: 0,
      operational_expenses: 0,
      net_profit: 18000,
      unique_code_bonus: 0,
      expenses_by_category: zeroCat,
      estimated_orders: 0,
      estimated_order_codes: [],
      series: [],
      suppliers: {
        wr: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        sk: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        manual: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        pedia: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        games: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        tunvn: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        aivault: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        storebat: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        mirai: { orders: 1, revenue: 50000, cost: 32000, profit: 18000 },
      },
      channels: {
        web: { orders: 1, revenue: 50000, cost: 32000, profit: 18000 },
        telegram: { orders: 0, revenue: 0, cost: 0, profit: 0 },
        whatsapp: { orders: 0, revenue: 0, cost: 0, profit: 0 },
      },
      top_products: [],
    };
    const tables = reportTables(fakeReport);
    expect(tables[2]?.rows.some((row) => row[0] === "Mirai" && row[1] === 1 && row[4] === 18000)).toBe(true);
  });
});
