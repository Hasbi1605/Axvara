// tests/characterization/cron-lite-gaps.test.ts — T4b characterization for 3A.
//
// Locks CURRENT behavior of three cron/lite gaps before the split into
// src/lib/cron/lite/jobs/* (roadmap Fase 1 T4b; REV-T4T6 checks 11–13).
// Test-only: never touches src/, drizzle/, scripts/, docs/. No real network.
// Asserts observable behavior (status, JSON keys/order, markers, DB state).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/lite/route";
import { QueryBudgetExceeded } from "@/lib/db-access";
import { createD1Fixture } from "../helpers/d1-fixture";

const mocks = vi.hoisted(() => ({
  games: vi.fn(), gamesCatalog: vi.fn(), pairs: vi.fn(), promo: vi.fn(), summary: vi.fn(),
  klik: vi.fn(), now: vi.fn(), gateway: vi.fn(), staleGateway: vi.fn(),
  wr: vi.fn(), sk: vi.fn(), pedia: vi.fn(), telegram: vi.fn(), wa: vi.fn(),
  qrisExpiry: vi.fn(), cleanup: vi.fn(), tgWebhook: vi.fn(),
  jaspay: vi.fn(), fx: vi.fn(), queue: vi.fn(), broadcast: vi.fn(),
  invoice: vi.fn(), wrBlocked: vi.fn(), wrMissing: vi.fn(), wrStuck: vi.fn(),
  jaspayRecovery: vi.fn(), skAging: vi.fn(), skBlocked: vi.fn(),
  skMissing: vi.fn(), skStuck: vi.fn(), skExhausted: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/games/dispatch", () => ({ processGamesPaidOrders: mocks.games }));
vi.mock("@/lib/games/sk-catalog-sync", () => ({ syncGamesSkCatalog: mocks.gamesCatalog }));
vi.mock("@/lib/supplier-pairs", () => ({ decideDirtyWinners: mocks.pairs }));
vi.mock("@/lib/telegram/promo-broadcast", () => ({ enqueueDueTelegramPromo: mocks.promo }));
vi.mock("@/lib/telegram/daily-admin-summary", () => ({ sendDueDailyAdminSummary: mocks.summary }));
vi.mock("@/lib/payments/klikqris-reconcile", () => ({ reconcileDueKlikQrisPayments: mocks.klik }));
vi.mock("@/lib/payments/payment-view", () => ({
  reconcileDueNowpaymentsPayments: mocks.now, reconcileLateKnownNowpaymentsPayments: async () => ({ late_checked: 0 }),
  reconcileDueSekalipayGatewayPayments: mocks.gateway,
}));
vi.mock("@/lib/payments/sekalipay-gateway", () => ({ reconcileStaleSekalipayGatewayPayments: mocks.staleGateway }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mocks.fx }));
vi.mock("@/lib/warung-rebahan/order", () => ({
  recoverStaleClaims: mocks.wr, reconcileBlockedBalance: mocks.wrBlocked, reconcileMissingWrLinks: mocks.wrMissing,
  reconcileStuckWrOrders: mocks.wrStuck, reconcileJaspayAmbiguous: mocks.jaspayRecovery,
}));
vi.mock("@/lib/warung-rebahan/deliver", () => ({ requeueOrphanCredentialDeliveries: async () => 0, processDueCredentialDeliveries: async () => ({ delivered: 0 }) }));
vi.mock("@/lib/sekalipay/order", () => ({
  recoverStaleSkClaims: mocks.sk, alertAgingSkOrders: mocks.skAging, reconcileBlockedSkBalance: mocks.skBlocked,
  reconcileMissingSkLinks: mocks.skMissing, reconcileStuckSkOrders: mocks.skStuck, settleExhaustedSkRetries: mocks.skExhausted,
  processSkPendingOrders: async () => ({ processed: 0, succeeded: 0 }),
}));
vi.mock("@/lib/orders/supplier-refresh", () => ({ refreshDueSupplierOrder: () => Promise.resolve({ refreshed: false }), maybeRefreshSupplierOrder: async () => ({ refreshed: false }) }));
vi.mock("@/lib/pedia/dispatch", () => ({ processPediaPaidOrders: mocks.pedia }));
vi.mock("@/lib/telegram/order-notifications", () => ({ retryPendingTelegramNotifications: mocks.telegram }));
vi.mock("@/lib/telegram/invoice-retry", () => ({ retryInvoicePendingTelegramInvoices: mocks.invoice }));
vi.mock("@/lib/whatsapp/outbox", () => ({ processDueWhatsAppOutbox: mocks.wa }));
vi.mock("@/lib/payments/qris-expiry-notifications", () => ({ sendQrisExpiryNotifications: mocks.qrisExpiry }));
vi.mock("@/lib/payments/market-snapshot-refresh", () => ({ refreshCryptoMarketSnapshot: async () => ({ status: "not_due" }) }));
vi.mock("@/lib/maintenance-cleanup", () => ({ runMaintenanceCleanup: mocks.cleanup }));
vi.mock("@/lib/telegram/webhook-guard", () => ({ guardTelegramWebhook: mocks.tgWebhook }));
vi.mock("@/lib/warung-rebahan/sync", async (original) => {
  const actual = await original<typeof import("@/lib/warung-rebahan/sync")>();
  return { ...actual, syncJaspayCatalog: async () => ({ synced: 0, errors: [] }) };
});
vi.mock("@/lib/aivault/client", () => ({ isAivaultConfigured: () => true, isAivaultSyncEnabled: () => true }));
vi.mock("@/lib/mirai/client", () => ({ isMiraiConfigured: () => true, isMiraiSyncEnabled: () => true }));
vi.mock("@/lib/storebat/client", () => ({ isStorebatConfigured: () => true, isStorebatSyncEnabled: () => true }));
vi.mock("@/lib/tunvn/client", () => ({ isTunvnConfigured: () => true, isTunvnSyncEnabled: () => true }));
vi.mock("@/lib/aivault/catalog", () => ({ publishAivaultCatalog: async () => ({ ok: true }) }));
vi.mock("@/lib/mirai/catalog", () => ({ publishMiraiCatalog: async () => ({ ok: true }) }));
vi.mock("@/lib/storebat/catalog", () => ({ publishStorebatCatalog: async () => ({ ok: true }) }));
vi.mock("@/lib/tunvn/catalog", () => ({ publishTunvnCatalog: async () => ({ ok: true }) }));
vi.mock("@/lib/broadcasts/queue", () => ({ isBroadcastQueueActive: mocks.queue, BROADCAST_BACKSTOP_GRACE_MS: 1234 }));
vi.mock("@/lib/broadcasts/worker", () => ({ processBroadcasts: mocks.broadcast }));

let fx: ReturnType<typeof createD1Fixture>;
const marker = (job: string) => `cron_lite_${job}_ok_at`;
const setting = (key: string) => fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)?.value;

beforeEach(() => {
  vi.resetAllMocks();
  fx = createD1Fixture();
  for (const [key, value] of Object.entries({
    CRON_SECRET: "fixture", TELEGRAM_BOT_TOKEN: "", WHATSAPP_ENABLED: "false", TELEGRAM_BOT_ENABLED: "false",
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in T4b fixture"); }));
  mocks.klik.mockResolvedValue({ payments_checked: 0, payments_failed: 0 });
  mocks.now.mockResolvedValue({ payments_checked: 0, payments_confirmed: 0, payments_failed: 0 });
  mocks.gateway.mockResolvedValue({ gateway_checked: 0 });
  mocks.staleGateway.mockResolvedValue({ gateway_stale_checked: 0 });
  for (const noop of [mocks.wr, mocks.sk, mocks.wrBlocked, mocks.wrStuck, mocks.skAging, mocks.skBlocked, mocks.skStuck, mocks.skExhausted]) noop.mockResolvedValue(0);
  for (const missing of [mocks.wrMissing, mocks.skMissing]) missing.mockResolvedValue({ orders: 0, links: 0 });
  mocks.jaspayRecovery.mockResolvedValue({ exactRef: 0, polled: 0 });
  mocks.refresh.mockResolvedValue({ refreshed: 0 });
  mocks.cleanup.mockResolvedValue({ whatsapp_rows_cleaned: 0 });
  mocks.telegram.mockResolvedValue(0);
  mocks.invoice.mockResolvedValue(0);
  mocks.wa.mockResolvedValue({ sent: 0 });
  mocks.qrisExpiry.mockResolvedValue({ sent: 0 });
  mocks.fx.mockResolvedValue({ rateText: "16000" });
  mocks.queue.mockResolvedValue(false);
  mocks.promo.mockResolvedValue({ due: false, enqueued: false });
  mocks.summary.mockResolvedValue({ due: false, sent: false });
});
afterEach(() => { fx.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const run = (job: string) => POST(new NextRequest(`https://fixture.test/api/cron/lite?job=${job}`, {
  method: "POST", headers: { authorization: "Bearer fixture" },
})).then(async (response) => ({ status: response.status, body: await response.json() as Record<string, unknown> }));

describe("T4b games_catalog drain asymmetry", () => {
  it("success assigns the payload verbatim, never drains pairs, and still writes the ok marker", async () => {
    // Pin: unlike the 4 supplier catalog jobs, games_catalog has NO
    // drainDirtyGroupsIfBudget call (route.ts:259-266) — but the generic
    // completion tail still stamps cron_lite_games_catalog_ok_at.
    mocks.gamesCatalog.mockResolvedValue({ ok: true, synced: 3, skipped: 1 });
    mocks.pairs.mockResolvedValue({ decided: 2, changed: 1 });
    expect(await run("games_catalog")).toEqual({
      status: 200, body: { ok: true, job: "games_catalog", synced: 3, skipped: 1 },
    });
    expect(mocks.gamesCatalog).toHaveBeenCalledOnce();
    expect(mocks.pairs).not.toHaveBeenCalled();
    expect(setting(marker("games_catalog"))).toBeTruthy();
  });

  it("explicit ok:false answers 503 with the payload and no marker", async () => {
    mocks.gamesCatalog.mockResolvedValue({ ok: false, error: "fixture" });
    expect(await run("games_catalog")).toMatchObject({ status: 503, body: { ok: false, error: "fixture" } });
    expect(mocks.pairs).not.toHaveBeenCalled();
    expect(setting(marker("games_catalog"))).toBeUndefined();
  });

  it("unchanged-shaped success still assigns verbatim and writes the marker (no unchanged carve-out)", async () => {
    // The storebat carve-out (`!("unchanged" in synced)`) does not exist here:
    // whatever the payload says is assigned, and the marker is written.
    mocks.gamesCatalog.mockResolvedValue({ ok: true, unchanged: true });
    expect(await run("games_catalog")).toEqual({
      status: 200, body: { ok: true, job: "games_catalog", unchanged: true },
    });
    expect(mocks.pairs).not.toHaveBeenCalled();
    expect(setting(marker("games_catalog"))).toBeTruthy();
  });
});

describe("T4b drainDirtyGroupsIfBudget failure isolation", () => {
  it("a non-budget drain failure is swallowed: main result and ok marker survive", async () => {
    // The Lite catalog wrapper catches everything except
    // QueryBudgetExceeded — a plain failure leaves no pairs keys but the job
    // result stays ok:true and the completion marker is still stamped.
    mocks.pairs.mockRejectedValue(new Error("fixture pairs failure"));
    const out = await run("aivault_catalog");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, job: "aivault_catalog" });
    expect(out.body).not.toHaveProperty("pairs_decided");
    expect(setting(marker("aivault_catalog"))).toBeTruthy();
  });

  it("QueryBudgetExceeded from the drain propagates as a successful yield (budget_exhausted, marker written)", async () => {
    mocks.pairs.mockRejectedValue(new QueryBudgetExceeded());
    const out = await run("aivault_catalog");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, job: "aivault_catalog", budget_exhausted: true });
    expect(out.body).not.toHaveProperty("pairs_decided");
    expect(setting(marker("aivault_catalog"))).toBeTruthy();
  });

  it("drain success assigns pair counts and stamps the marker", async () => {
    mocks.pairs.mockResolvedValue({ decided: 2, changed: 1 });
    const out = await run("tunvn_catalog");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, job: "tunvn_catalog", pairs_decided: 2, pairs_changed: 1 });
    expect(setting(marker("tunvn_catalog"))).toBeTruthy();
  });

  it("cleanup propagates an ordinary drain failure to the route instead of stamping success", async () => {
    mocks.cleanup.mockResolvedValue({});
    mocks.pairs.mockRejectedValue(new Error("fixture cleanup drain failure"));
    expect(await run("cleanup")).toMatchObject({ status: 500, body: { ok: false } });
    expect(mocks.pairs).toHaveBeenCalledOnce();
    expect(setting(marker("cleanup"))).toBeUndefined();
  });
});

describe("T4b WR/SK diff applyOnly under an exhausted statement budget", () => {
  it("WR applyOnly starved mid-apply: budget yields, partial writes stay atomic per product, no sync log, diff markers still written", async () => {
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { syncProducts } = await import("@/lib/warung-rebahan/sync");
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const products = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `prod-${String(i).padStart(3, "0")}`, name: `Fixture ${i}`, category: "Productivity",
      description: `Product ${i}`,
      variants: [{ id: `var-${String(i).padStart(3, "0")}`, name: `Variant ${i}`, price: 5000, stock: 10, duration: "7 Hari", warranty: "7 Hari", type: "Private", terms: null, delivery_terms: null }],
    }));
    // Tiny budget WITHOUT the +800 catalog hook (plain access shaped like a
    // starved route db): admission stops the product loop early.
    const capped = createBudgetedDatabase(8, 2, fx.db);
    const plain = { ...capped.access } as typeof capped.access & { raiseCeilingForCatalogSync?: unknown };
    delete plain.raiseCeilingForCatalogSync;
    const result = await syncProducts(plain, async () => { throw new Error("diff must not fetch"); }, {
      trigger: "cron", applyOnly: { products: products(6), removedVariantIds: [] },
    });
    expect(result.budgetYielded).toBe(true);
    expect(result.synced).toBeLessThan(6);
    expect(result.errors).toEqual([]);
    // No full-sweep log rows and cursor left at seed 0 (diff path never
    // writes *_sync_log nor the cursor — pinned while starving, not just on
    // success).
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_sync_log").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key='products_cursor'").get()?.value).toBe("0");
    expect(fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key='diff_last_at'").get()?.value).toBeTruthy();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_products").get()?.n).toBe(result.synced);
  });

  it("SK applyOnly starved mid-apply: budget yields, no sync log, diff markers still written", async () => {
    const { createBudgetedDatabase } = await import("@/lib/db-access");
    const { syncSkProducts } = await import("@/lib/sekalipay/sync");
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
      categoryName: "Aplikasi Premium", productId: 900 + i, productName: `Fixture ${i}`, productImage: null,
      variant: {
        id: 8000 + i, sku: `SK-${i}`, name: `Variant ${i}`, price: 5000, stock: 7,
        order_process: "auto" as const, h2h_provider: null, provider_meta: null,
        required_fields: null, validation: null, updated_at: null,
      },
    }));
    const capped = createBudgetedDatabase(8, 2, fx.db);
    const plain = { ...capped.access } as typeof capped.access & { raiseCeilingForCatalogSync?: unknown };
    delete plain.raiseCeilingForCatalogSync;
    const result = await syncSkProducts(plain, undefined, {
      trigger: "cron", applyOnly: { rows: rows(6), removedVariantIds: [] },
    });
    expect(result.budgetYielded).toBe(true);
    expect(result.synced).toBeLessThan(6);
    expect(result.errors).toEqual([]);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM sk_sync_log").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT value FROM sk_sync_state WHERE key='products_cursor'").get()?.value).toBe("0");
    expect(fx.sql.prepare("SELECT value FROM sk_sync_state WHERE key='diff_last_at'").get()?.value).toBeTruthy();
  });

  it("supplier-sync route POST surfaces the same no-log contract on success", async () => {
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "t4b-sync");
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const { POST: supplierSync } = await import("@/app/api/supplier-sync/route");
    const body = {
      supplier: "wr", removed_variant_ids: [],
      products: [{
        id: "wrp-t4b", name: "T4b WR", category: "Musik", description: "desc",
        variants: [{ id: "wrv-t4b", name: "1 Bulan", price: 10000, duration: "1 Bulan", type: "sharing", warranty: "Full", stock: 4 }],
      }],
    };
    const response = await supplierSync(new NextRequest("https://fixture.test/api/supplier-sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-supplier-sync-token": "t4b-sync" },
      body: JSON.stringify(body),
    }) as never);
    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ ok: true, synced: 1 });
    expect(payload).not.toHaveProperty("budgetYielded");
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_sync_log").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key='diff_last_at'").get()?.value).toBeTruthy();
  });
});
