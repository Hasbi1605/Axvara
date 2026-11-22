import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/lite/route";
import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { KLIKQRIS_POLL_HEALTH_KEY, TG_WEBHOOK_HEALTH_KEY, WA_GATEWAY_HEALTH_KEY } from "@/lib/service-health";
import { createD1Fixture } from "../helpers/d1-fixture";

const mocks = vi.hoisted(() => ({
  wr: vi.fn(), sk: vi.fn(), pedia: vi.fn(), telegram: vi.fn(), wa: vi.fn(), qrisExpiry: vi.fn(), cleanup: vi.fn(), klik: vi.fn(), now: vi.fn(),
  gateway: vi.fn(), staleGateway: vi.fn(), wrBlocked: vi.fn(), wrMissing: vi.fn(), wrStuck: vi.fn(), jaspayRecovery: vi.fn(),
  skAging: vi.fn(), skBlocked: vi.fn(), skMissing: vi.fn(), skStuck: vi.fn(), skExhausted: vi.fn(), refresh: vi.fn(),
  invoice: vi.fn(), tgWebhook: vi.fn(), games: vi.fn(), gamesCatalog: vi.fn(), jaspay: vi.fn(), pairs: vi.fn(), promo: vi.fn(), summary: vi.fn(),
  publish: { aivault: vi.fn(), mirai: vi.fn(), storebat: vi.fn(), tunvn: vi.fn() }, fx: vi.fn(), queue: vi.fn(), broadcast: vi.fn(),
}));
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
vi.mock("@/lib/orders/supplier-refresh", () => ({ refreshDueSupplierOrders: mocks.refresh }));
vi.mock("@/lib/pedia/dispatch", () => ({ processPediaPaidOrders: mocks.pedia }));
vi.mock("@/lib/telegram/order-notifications", () => ({ retryPendingTelegramNotifications: mocks.telegram }));
vi.mock("@/lib/telegram/invoice-retry", () => ({ retryInvoicePendingTelegramInvoices: mocks.invoice }));
vi.mock("@/lib/whatsapp/outbox", () => ({ processDueWhatsAppOutbox: mocks.wa }));
vi.mock("@/lib/payments/qris-expiry-notifications", () => ({ sendQrisExpiryNotifications: mocks.qrisExpiry }));
vi.mock("@/lib/payments/klikqris-reconcile", () => ({ reconcileDueKlikQrisPayments: mocks.klik }));
vi.mock("@/lib/payments/payment-view", () => ({ reconcileDueNowpaymentsPayments: mocks.now, reconcileLateKnownNowpaymentsPayments: async () => ({ late_checked: 0 }), reconcileDueSekalipayGatewayPayments: mocks.gateway }));
vi.mock("@/lib/payments/sekalipay-gateway", () => ({ reconcileStaleSekalipayGatewayPayments: mocks.staleGateway }));
vi.mock("@/lib/payments/market-snapshot-refresh", () => ({ refreshCryptoMarketSnapshot: async () => ({ status: "not_due" }) }));
vi.mock("@/lib/maintenance-cleanup", () => ({ runMaintenanceCleanup: mocks.cleanup }));
vi.mock("@/lib/telegram/webhook-guard", () => ({ guardTelegramWebhook: mocks.tgWebhook }));
vi.mock("@/lib/games/dispatch", () => ({ processGamesPaidOrders: mocks.games }));
vi.mock("@/lib/games/sk-catalog-sync", () => ({ syncGamesSkCatalog: mocks.gamesCatalog }));
vi.mock("@/lib/warung-rebahan/sync", () => ({ syncJaspayCatalog: mocks.jaspay }));
vi.mock("@/lib/aivault/client", () => ({ isAivaultConfigured: () => true, isAivaultSyncEnabled: () => true }));
vi.mock("@/lib/mirai/client", () => ({ isMiraiConfigured: () => true, isMiraiSyncEnabled: () => true }));
vi.mock("@/lib/storebat/client", () => ({ isStorebatConfigured: () => true, isStorebatSyncEnabled: () => true }));
vi.mock("@/lib/tunvn/client", () => ({ isTunvnConfigured: () => true, isTunvnSyncEnabled: () => true }));
vi.mock("@/lib/aivault/catalog", () => ({ publishAivaultCatalog: mocks.publish.aivault }));
vi.mock("@/lib/mirai/catalog", () => ({ publishMiraiCatalog: mocks.publish.mirai }));
vi.mock("@/lib/storebat/catalog", () => ({ publishStorebatCatalog: mocks.publish.storebat }));
vi.mock("@/lib/tunvn/catalog", () => ({ publishTunvnCatalog: mocks.publish.tunvn }));
vi.mock("@/lib/payments/market-snapshot", () => ({ loadCurrentFxSnapshot: mocks.fx }));
vi.mock("@/lib/supplier-pairs", () => ({ decideDirtyWinners: mocks.pairs }));
vi.mock("@/lib/telegram/promo-broadcast", () => ({ enqueueDueTelegramPromo: mocks.promo }));
vi.mock("@/lib/telegram/daily-admin-summary", () => ({ sendDueDailyAdminSummary: mocks.summary }));
vi.mock("@/lib/broadcasts/queue", () => ({ isBroadcastQueueActive: mocks.queue, BROADCAST_BACKSTOP_GRACE_MS: 1234 }));
vi.mock("@/lib/broadcasts/worker", () => ({ processBroadcasts: mocks.broadcast }));

let fx: ReturnType<typeof createD1Fixture>;
const marker = (job: string) => `cron_lite_${job}_ok_at`;
const setting = (key: string) => fx.sql.prepare("SELECT value,updated_at FROM store_settings WHERE key=?").get(key);
const beforeFailure = { value: "prior-success", updated_at: "2020-01-01 00:00:00" };
function prime(key: string) {
  fx.sql.prepare("INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,?)").run(key, beforeFailure.value, beforeFailure.updated_at);
}

beforeEach(() => {
  vi.resetAllMocks();
  fx = createD1Fixture();
  for (const [key, value] of Object.entries({
    CRON_SECRET: "fixture", WARUNG_REBAHAN_ENABLED: "true", WARUNG_REBAHAN_AUTO_ORDER_ENABLED: "true", WARUNG_REBAHAN_API_KEY: "",
    SEKALIPAY_ENABLED: "true", SEKALIPAY_AUTO_ORDER_ENABLED: "true", SEKALIPAY_API_KEY: "", WHATSAPP_ENABLED: "false", TELEGRAM_BOT_ENABLED: "false",
    PEDIA_PROXY_URL: "", RESEND_API_KEY: "", TELEGRAM_BOT_TOKEN: "",
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in cron fixture"); }));
  mocks.klik.mockResolvedValue({ payments_checked: 0, payments_failed: 0 });
  mocks.now.mockResolvedValue({ payments_checked: 0, payments_failed: 0, payments_confirmed: 0 });
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
  mocks.pairs.mockResolvedValue({ decided: 2, changed: 1 });
  mocks.fx.mockResolvedValue({ rateText: "16000" });
  mocks.promo.mockResolvedValue({ due: false, enqueued: false });
  mocks.summary.mockResolvedValue({ due: false, sent: false });
});
afterEach(() => { fx.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function run(job: string) {
  const response = await POST(new NextRequest(`https://fixture.test/api/cron/lite?job=${job}`, { method: "POST", headers: { authorization: "Bearer fixture" } }));
  return { status: response.status, body: await response.json() };
}

describe("T4 lite completion marker", () => {
  it("stores KlikQRIS and Telegram samples independently of their completion markers", async () => {
    mocks.klik.mockResolvedValue({ payments_checked: 2, payments_failed: 1 });
    mocks.tgWebhook.mockResolvedValue({ status: "mismatch", pending_update_count: 7 });
    expect((await run("payments")).status).toBe(503);
    expect((await run("tg_webhook")).status).toBe(503);
    expect(setting(KLIKQRIS_POLL_HEALTH_KEY)?.value).toBe("1");
    expect(setting(TG_WEBHOOK_HEALTH_KEY)?.value).toBe('{"error":"mismatch","pending":7}');
  });

  it.each([new Error("fixture write failure"), new QueryBudgetExceeded()])("logs and swallows a health write failure: %s", async error => {
    mocks.tgWebhook.mockResolvedValue({ status: "healthy", pending_update_count: 0 });
    prime(TG_WEBHOOK_HEALTH_KEY);
    const prepare = fx.db.prepare;
    fx.db.prepare = sql => {
      if (sql.includes("ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")) throw error;
      return prepare(sql);
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await run("tg_webhook")).toMatchObject({ status: 200, body: { status: "healthy" } });
      expect(setting(TG_WEBHOOK_HEALTH_KEY)).toEqual(beforeFailure);
      expect(warn).toHaveBeenCalledExactlyOnceWith("[cron-health] sample_write_failed", TG_WEBHOOK_HEALTH_KEY);
      expect(setting(marker("tg_webhook"))?.value).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["payments", "nowpayments", mocks.now], ["payments", "sekalipay_gateway", mocks.gateway], ["payments", "sekalipay_gateway_stale", mocks.staleGateway],
    ["wr_orders", "stale_claims", mocks.wr], ["wr_orders", "blocked_balance", mocks.wrBlocked], ["wr_orders", "missing_links", mocks.wrMissing],
    ["wr_orders", "supplier_refresh", mocks.refresh], ["wr_orders", "stuck_links", mocks.wrStuck], ["wr_orders", "jaspay_recovery", mocks.jaspayRecovery],
    ["sk_orders", "aging_alert", mocks.skAging], ["sk_orders", "stale_claims", mocks.sk], ["sk_orders", "blocked_balance", mocks.skBlocked],
    ["sk_orders", "exhausted_retries", mocks.skExhausted], ["sk_orders", "missing_links", mocks.skMissing],
    ["sk_orders", "supplier_refresh", mocks.refresh], ["sk_orders", "stuck_links", mocks.skStuck],
    ["pedia_orders", "dispatch", mocks.pedia], ["notify_a", "telegram_retry", mocks.telegram], ["notify_b", "whatsapp_outbox", mocks.wa],
    ["notify", "telegram_retry", mocks.telegram], ["notify", "whatsapp_outbox", mocks.wa],
    ["cleanup", "maintenance_cleanup", mocks.cleanup],
  ] as const)("%s core failure in %s leaves its previous completion marker intact", async (job, subjob, fail) => {
    prime(marker(job));
    fail.mockRejectedValue(new Error("fixture failure"));
    expect(await run(job)).toMatchObject({ status: 503, body: { ok: false, failed_subjobs: [subjob] } });
    expect(setting(marker(job))).toEqual(beforeFailure);
  });

  it("WR queue lookup failure is monitored rather than advancing the marker", async () => {
    fx.sql.exec("DROP TABLE wr_order_links");
    expect(await run("wr_orders")).toMatchObject({ status: 503, body: { ok: false, failed_subjobs: ["final_settlement", "due_lookup"] } });
    expect(mocks.wrStuck).toHaveBeenCalledOnce();
    expect(setting(marker("wr_orders"))).toBeUndefined();
  });

  it.each(["notify_b", "notify"])("%s surfaces unresolved cleanup failure but still services the WA lane", async job => {
    prime("cleanup_recovery_last_error");
    expect(await run(job)).toMatchObject({ status: 503, body: { ok: false, failed_subjobs: ["maintenance_cleanup"], whatsapp_outbox: { sent: 0 } } });
    expect(setting(marker(job))).toBeUndefined();
  });

  it.each([
    ["payments", mocks.klik, { payments_checked: 1, payments_failed: 1 }],
    ["payments", mocks.now, { payments_checked: 1, payments_confirmed: 0, payments_failed: 1 }],
    ["tg_webhook", mocks.tgWebhook, { status: "mismatch", error: "fixture" }],
    ["games_orders", mocks.games, { error: "fixture" }], ["games_catalog", mocks.gamesCatalog, { ok: false }],
    ["jaspay_catalog", mocks.jaspay, { errors: ["fixture"] }],
  ] as const)("%s early 503 does not create a marker", async (job, stub, result) => {
    stub.mockResolvedValue(result);
    expect(await run(job)).toMatchObject({ status: 503, body: { ok: false } });
    expect(setting(marker(job))).toBeUndefined();
  });

  it("generic failure returns 500 without a marker; QueryBudgetExceeded is a successful yield", async () => {
    mocks.klik.mockRejectedValueOnce(new Error("fixture failure")).mockRejectedValueOnce(new QueryBudgetExceeded());
    expect(await run("payments")).toMatchObject({ status: 500, body: { ok: false } });
    expect(setting(marker("payments"))).toBeUndefined();
    expect(await run("payments")).toMatchObject({ status: 200, body: { ok: true, budget_exhausted: true } });
    expect(setting(marker("payments"))?.value).toBeTruthy();
  });

  it("soft invoice error still writes notify_a marker; sibling core work proceeds", async () => {
    mocks.invoice.mockRejectedValue(new Error("fixture invoice"));
    expect(await run("notify_a")).toMatchObject({ status: 200, body: { invoice_retry_error: "fixture invoice", telegram_retry: 0 } });
    expect(setting(marker("notify_a"))?.value).toBeTruthy();
  });

  it("soft QRIS expiry error still writes notify_b marker", async () => {
    mocks.qrisExpiry.mockRejectedValue(new Error("fixture expiry notice"));
    expect(await run("notify_b")).toMatchObject({ status: 200, body: { qris_expiry_notices_error: "fixture expiry notice", whatsapp_outbox: { sent: 0 } } });
    expect(setting(marker("notify_b"))?.value).toBeTruthy();
  });
});

describe.each(["aivault", "tunvn", "mirai", "storebat"] as const)("T4 %s catalog", supplier => {
  const publish = mocks.publish[supplier];
  it.each([undefined, true, false])("dirty-group drain with unchanged=%s", async unchanged => {
    const reply = { ok: true, ...(unchanged === undefined ? {} : { unchanged }) };
    publish.mockResolvedValue(reply);
    const job = `${supplier}_catalog`;
    const drain = supplier !== "storebat" || unchanged === undefined;
    expect(await run(job)).toEqual({ status: 200, body: { job, ...reply, ...(drain ? { pairs_decided: 2, pairs_changed: 1 } : {}) } });
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.anything(), 16_000, { force: false });
    expect(mocks.pairs).toHaveBeenCalledTimes(Number(drain));
    expect(setting(marker(job))?.value).toBeTruthy();
  });

  it("explicit ok:false returns 503 without drain or marker on the current baseline", async () => {
    const job = `${supplier}_catalog`;
    publish.mockResolvedValue({ ok: false, error: "fixture" });
    expect(await run(job)).toEqual({ status: 503, body: { ok: false, job, error: "fixture" } });
    expect(publish).toHaveBeenCalledOnce();
    expect(mocks.pairs).not.toHaveBeenCalled();
    expect(setting(marker(job))).toBeUndefined();
  });

  it("missing FX returns 503 before publish or marker", async () => {
    const job = `${supplier}_catalog`;
    mocks.fx.mockResolvedValue(null);
    expect(await run(job)).toEqual({ status: 503, body: { ok: false, job, error: "fx_unavailable" } });
    expect(publish).not.toHaveBeenCalled();
    expect(setting(marker(job))).toBeUndefined();
  });
});

// T4 (iii) text describes a difference not present in the current route.
it.todo("BUG? TUNVN/AIVault catalog explicit ok:false exits 503 instead of continuing as the roadmap describes");

describe("T4 WhatsApp sampling and promo backstop", () => {
  it.each([
    [{ connected: true, promoBot: { configured: true, connected: true } }, "true"],
    [{ connected: true, promoBot: { configured: true, blocked: true } }, "blocked"],
    [{ connected: true, promoBot: { configured: true, connected: false } }, "false"],
    [{ connected: true, promoBot: { configured: true } }, "unknown"],
  ])("samples %j as %s, skips fresh samples and resamples at five minutes", async (health, value) => {
    vi.stubEnv("WHATSAPP_ENABLED", "true");
    vi.stubEnv("WHATSAPP_GATEWAY_URL", " https://wa.fixture.test/// ");
    const fetch = vi.fn(async () => Response.json(health));
    vi.stubGlobal("fetch", fetch);
    expect((await run("cleanup")).status).toBe(200);
    expect(setting(WA_GATEWAY_HEALTH_KEY)?.value).toBe(value);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://wa.fixture.test/health", expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
    const initial = setting(WA_GATEWAY_HEALTH_KEY);
    await run("cleanup");
    expect(fetch).toHaveBeenCalledOnce();
    expect(setting(WA_GATEWAY_HEALTH_KEY)).toEqual(initial);
    fx.sql.prepare("UPDATE store_settings SET updated_at=datetime('now','-5 minutes') WHERE key=?").run(WA_GATEWAY_HEALTH_KEY);
    await run("cleanup");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(setting(WA_GATEWAY_HEALTH_KEY)?.value).toBe(value);
  });

  it.each([false, true])("broadcast budget is independent, cap 400−4 and grace active=%s", async active => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-21T12:00:00Z");
    vi.setSystemTime(start);
    let outer: DatabaseAccess | undefined;
    mocks.promo.mockImplementation(async (db: DatabaseAccess) => {
      outer = db;
      await db.queryFirst("SELECT 1");
      vi.setSystemTime(new Date(start.getTime() + 2500));
      return { due: true, enqueued: true, queuedMessages: 2 };
    });
    mocks.queue.mockImplementation(async (db: DatabaseAccess) => { await db.queryFirst("SELECT 1"); return active; });
    mocks.broadcast.mockImplementation(async (db: DatabaseAccess) => {
      expect(db).not.toBe(outer);
      expect(db.canSpend(395)).toBe(true);
      expect(db.canSpend(396)).toBe(false);
      await Promise.all(Array.from({ length: 395 }, () => db.queryFirst("SELECT 1")));
      expect(db.canSpend(1)).toBe(false);
      await expect(db.queryFirst("SELECT 1")).rejects.toBeInstanceOf(QueryBudgetExceeded);
      expect(outer?.canSpend(297)).toBe(true);
      return { processed: 4 };
    });
    expect(await run("promo")).toMatchObject({ status: 200, body: { broadcasts: { processed: 4 }, promo_due: true, promo_queued_messages: 2 } });
    expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 150, 37_500, { queueGraceMs: active ? 1234 : 0 });
    expect(setting(marker("promo"))?.value).toBeTruthy();
  });

  it("the broadcast worker does not start when its wall-time envelope is exhausted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-21T12:00:00Z");
    vi.setSystemTime(start);
    mocks.queue.mockImplementation(async () => { vi.setSystemTime(new Date(start.getTime() + 40_000)); return true; });
    expect(await run("promo")).toMatchObject({ status: 200, body: { broadcasts: null } });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
