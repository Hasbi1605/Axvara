import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/operations/route";
import { QueryBudgetExceeded } from "@/lib/db-access";
import { createD1Fixture } from "../helpers/d1-fixture";

const mocks = vi.hoisted(() => ({ telegram: vi.fn(), wrSync: vi.fn(), skSync: vi.fn(), pairs: vi.fn(), wrWatchdog: vi.fn() }));
vi.mock("@/lib/telegram/order-notifications", async original => ({
  ...await original<typeof import("@/lib/telegram/order-notifications")>(),
  retryPendingTelegramNotifications: mocks.telegram,
  sendPendingOrderReminders: async () => 5,
}));
vi.mock("@/lib/telegram/invoice-retry", () => ({ retryInvoicePendingTelegramInvoices: async () => 4 }));
vi.mock("@/lib/payments/qris-expiry-notifications", async original => ({
  ...await original<typeof import("@/lib/payments/qris-expiry-notifications")>(),
  sendQrisExpiryNotifications: async () => ({ sent: 1 }),
}));
vi.mock("@/lib/whatsapp/outbox", () => ({
  processDueWhatsAppOutbox: async () => ({ sent: 1, dead: 1, recovered: 2, claimErrors: 3, paused: 4 }),
}));
vi.mock("@/lib/orders/access-email", () => ({ processCredentialAccessEmails: async () => ({ sent: 2, failed: 1 }) }));
vi.mock("@/lib/warung-rebahan/sync", () => ({
  WR_SYNC_PRODUCTS_PER_RUN: 48, syncProducts: mocks.wrSync,
  syncJaspayCatalog: async () => ({ synced: 5, rejected: 1, errors: [] }),
}));
vi.mock("@/lib/warung-rebahan/order", () => ({
  WR_SYNC_STALE_ALERT_MINUTES: 90, alertStaleWrSync: mocks.wrWatchdog, refreshStaleWrSyncContext: async () => {},
  recoverStaleClaims: async () => 0, reconcileBlockedBalance: async () => 0,
  reconcileMissingWrLinks: async () => ({ links: 1 }), retryFailedWrOrders: async () => 0,
  processWrPendingOrders: async () => ({ processed: 4, succeeded: 3, blocked: 1, reconciled: 2 }),
  reconcileStuckWrOrders: async () => 3, reconcileFreshWrLinks: async () => 1,
  repairUnboundCompletedWrLinks: async () => 2, reconcileJaspayAmbiguous: async () => ({ exactRef: 1, polled: 2 }),
  alertAgingWrOrders: async () => 3,
}));
vi.mock("@/lib/warung-rebahan/deliver", () => ({
  requeueOrphanCredentialDeliveries: async () => 2,
  processDueCredentialDeliveries: async () => ({ processed: 3, delivered: 2, recovered: 1 }),
}));
vi.mock("@/lib/warung-rebahan/saldo", () => ({ checkAndLogSaldo: async () => ({ balance: 1500, isLow: true }) }));
vi.mock("@/lib/sekalipay/sync", () => ({ SK_SYNC_PRODUCTS_PER_RUN: 24, syncSkProducts: mocks.skSync }));
vi.mock("@/lib/sekalipay/order", () => ({
  recoverStaleSkClaims: async () => 0, reconcileBlockedSkBalance: async () => 0,
  reconcileMissingSkLinks: async () => ({ links: 2 }), retryFailedSkOrders: async () => 0,
  processSkPendingOrders: async () => ({ processed: 3, succeeded: 3 }),
  reconcileStuckSkOrders: async () => 2, reconcileFreshSkOrders: async () => 1,
}));
vi.mock("@/lib/sekalipay/deliver", () => ({ reconcilePendingSkCredentialEmails: async () => 4 }));
vi.mock("@/lib/sekalipay/saldo", () => ({ checkAndLogSkSaldo: async () => ({ balance: 75_000, isLow: false }) }));
vi.mock("@/lib/supplier-pairs", () => ({ decideAllWinners: mocks.pairs }));

const CLOCK = "2026-11-21T12:00:00Z";
let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CLOCK));
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const [key, value] of Object.entries({
    CRON_SECRET: "fixture", AUTO_FULFILLMENT_ENABLED: "false", TELEGRAM_BOT_ENABLED: "false", TELEGRAM_BOT_TOKEN: "",
    WHATSAPP_ENABLED: "false", WHATSAPP_GATEWAY_URL: "", RESEND_API_KEY: "",
    WARUNG_REBAHAN_ENABLED: "false", WARUNG_REBAHAN_AUTO_ORDER_ENABLED: "false", WARUNG_REBAHAN_SYNC_ENABLED: "true",
    SEKALIPAY_ENABLED: "false", SEKALIPAY_AUTO_ORDER_ENABLED: "false", SEKALIPAY_SYNC_ENABLED: "true",
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call in operations fixture"); }));
  mocks.telegram.mockResolvedValue({ created: 1, paid: 2, paidAdmin: 3, paidAdminWeb: 4 });
  mocks.wrSync.mockResolvedValue({ synced: 8, budgetYielded: false, errors: [] });
  mocks.wrWatchdog.mockResolvedValue(1);
  mocks.skSync.mockResolvedValue({ synced: 7, budgetYielded: false, errors: [] });
  mocks.pairs.mockResolvedValue({ decided: 3, changed: 1 });
});
afterEach(() => {
  fx.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const setting = (key: string) => fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)?.value;
function enable(supplier: "WARUNG_REBAHAN" | "SEKALIPAY") {
  vi.stubEnv(`${supplier}_ENABLED`, "true");
  vi.stubEnv(`${supplier}_AUTO_ORDER_ENABLED`, "true");
}

function seedNotify() {
  // SQLite's clock is independent of the frozen JS clock. Only queue
  // predicates evaluated in SQLite use relative dates in the seed.
  fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,expires_at,paid_at)
      VALUES('notice','Fixture','628000000000','buyer@fixture.test','[]',10000,'qris','pending','pending',datetime('now','+30 minutes'),NULL),
        ('paid','Fixture','628000000000',NULL,'[]',10000,'qris','lunas','paid',NULL,datetime('now'));
    INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,expires_at)
      VALUES('notice','gopay','dynamic','FIXTURE-INVOICE','fixture',10000,'pending',datetime('now','-5 minutes'));
    INSERT INTO whatsapp_outbox(idempotency_key,destination,payload) VALUES('fixture-wa','fixture','{}');
    INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status) VALUES('email:credential_access:paid:v1','paid','email','failed');`);
}

// Literal goldens share the ordered skeleton and tail. Each case compares the
// complete JSON and its top-level key sequence, including absent keys.
const SKELETON = {
  stale_initializing: 0, expired_payments: 0, repaired_legacy_expiry: 0,
  due_jobs_processed: 0, fulfillment_items_backfilled: 0, fulfillment_orphans_healed: 0,
  stale_locks_released: 0, expired_manual_whatsapp_orders: 0,
  telegram_order_notifications_retried: 0, telegram_paid_notifications_retried: 0,
  telegram_paid_admin_notifications_retried: 0, telegram_invoice_retried: 0,
  telegram_pending_reminders_sent: 0,
  whatsapp_outbox_sent: 0, whatsapp_outbox_dead: 0, whatsapp_outbox_recovered: 0,
  whatsapp_outbox_claim_errors: 0, whatsapp_outbox_paused: 0, whatsapp_rows_cleaned: 0,
  wr_products_synced: 0, wr_sync_skipped: null, wr_last_sync_at: null,
  wr_orders_processed: 0, wr_orders_succeeded: 0, wr_saldo_balance: null, wr_saldo_low: false,
  sk_products_synced: 0, sk_sync_skipped: null, sk_last_sync_at: null,
  sk_orders_processed: 0, sk_orders_succeeded: 0, sk_saldo_balance: null, sk_saldo_low: false,
};
const TAIL = {
  query_budget_limit: 300,
  query_budget_note: "submitted_statements_including_batch_members",
  run_duration_ms: 0,
  run_deadline_ms: 45_000,
};

const cases: {
  name: string; query: string; expected: Record<string, unknown>; status?: number; seed?: () => void; verify?: () => void;
}[] = [
  { name: "expiry", query: "?phase=expiry", expected: {
    ok: true, ...SKELETON, phase: "expiry", query_budget_used: 3, ...TAIL,
  } },
  { name: "fulfillment", query: "?phase=fulfillment", expected: {
    ok: true, ...SKELETON, phase: "fulfillment", fulfillment_aggregates_repaired: 0, query_budget_used: 6, ...TAIL,
  } },
  { name: "notify (QRIS, Telegram, WA and PIN)", query: "?phase=notify", seed: seedNotify, expected: {
    ok: true, ...SKELETON, telegram_order_notifications_retried: 1, telegram_paid_notifications_retried: 2,
    telegram_paid_admin_notifications_retried: 3, telegram_invoice_retried: 4, telegram_pending_reminders_sent: 5,
    whatsapp_outbox_sent: 1, whatsapp_outbox_dead: 1, whatsapp_outbox_recovered: 2, whatsapp_outbox_claim_errors: 3, whatsapp_outbox_paused: 4,
    phase: "notify", qris_expiry_notifications: 1, telegram_paid_admin_web_notifications_retried: 4,
    checkout_pin_emails_sent: 2, checkout_pin_emails_failed: 1, query_budget_used: 3, ...TAIL,
  } },
  { name: "cleanup removes one stale WA inbox row", query: "?phase=cleanup", seed: () => {
    fx.sql.exec("INSERT INTO whatsapp_inbox_events(external_message_id,created_at) VALUES('old',datetime('now','-8 days')),('keep',datetime('now'))");
  }, expected: {
    // The bounded Pixel input purge adds exactly one statement to maintenance.
    ok: true, ...SKELETON, whatsapp_rows_cleaned: 1, phase: "cleanup", query_budget_used: 20, ...TAIL,
  }, verify: () => {
    expect(setting("maintenance_cleanup_at")).toBeTruthy();
    expect(fx.sql.prepare("SELECT external_message_id FROM whatsapp_inbox_events").all()).toEqual([{ external_message_id: "keep" }]);
  } },
  { name: "cleanup interval", query: "?phase=cleanup", seed: () => {
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('maintenance_cleanup_at',?)").run(CLOCK);
  }, expected: {
    ok: true, ...SKELETON, phase: "cleanup", cleanup_skipped: "interval", query_budget_used: 3, ...TAIL,
  }, verify: () => expect(setting("maintenance_cleanup_at")).toBe(CLOCK) },
  { name: "WR disabled", query: "?phase=warung_rebahan", expected: {
    ok: true, ...SKELETON, wr_sync_skipped: "disabled", phase: "warung_rebahan", query_budget_used: 5, ...TAIL,
  } },
  { name: "SK disabled", query: "?phase=sekalipay", expected: {
    ok: true, ...SKELETON, sk_sync_skipped: "disabled", phase: "sekalipay", query_budget_used: 2, ...TAIL,
  } },
  { name: "WR orders and deliveries", query: "?phase=warung_rebahan&part=orders", seed: () => {
    enable("WARUNG_REBAHAN");
    fx.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status)
      VALUES('wr','Fixture','628000000000','[]',10000,'qris','lunas','paid');
      INSERT INTO wr_order_links(order_code,wr_variant_id,wr_cost,wr_order_id,status,request_sent_at)
      VALUES('wr','fixture',5000,'FIXTURE-INVOICE','processing',datetime('now','-5 minutes'));`);
  }, expected: {
    ok: true, ...SKELETON, wr_sync_skipped: "part_orders", wr_orders_processed: 4, wr_orders_succeeded: 3, wr_saldo_balance: 1500, wr_saldo_low: true,
    phase: "warung_rebahan", part: "orders", wr_final_settlement: { deferred: 0, pending: 0, reasons: {}, settled: 0 },
    wr_orphan_links_healed: 1, wr_orders_blocked: 1,
    wr_orders_reconciled: 6, wr_orders_reconciled_fresh: 1, wr_links_repaired: 2, wr_jaspay_exact_ref: 1, wr_jaspay_polled: 2,
    wr_orders_aging_alerted: 3, wr_credentials_requeued: 2, wr_deliveries_processed: 3,
    wr_deliveries_delivered: 2, wr_deliveries_lease_recovered: 1, query_budget_used: 12, ...TAIL,
    deferred: ["warung_rebahan"], note: "partial_run_more_pending",
  }, verify: () => expect(mocks.wrSync).not.toHaveBeenCalled() },
  { name: "WR continued sweep reports resume, Jaspay and bounded errors", query: "?phase=warung_rebahan&part=sync&continue=1", seed: () => {
    enable("WARUNG_REBAHAN");
    fx.sql.exec(`INSERT INTO wr_sync_log(sync_type,status,created_at) VALUES('products','partial','2026-11-21 11:59:00');
      INSERT INTO wr_sync_state(key,value) VALUES('products_cursor','3') ON CONFLICT(key) DO UPDATE SET value='3';`);
    mocks.wrSync.mockResolvedValue({ synced: 4, budgetYielded: true, errors: ["first", "second", "third", "omitted"] });
  }, expected: {
    ok: true, ...SKELETON, wr_products_synced: 4, wr_sync_skipped: "attempted_failed", wr_last_sync_at: "2026-11-21 11:59:00",
    phase: "warung_rebahan", part: "sync", wr_sync_resume: true, wr_jaspay_synced: 5,
    wr_jaspay_rejected: 1, more: true, wr_sync_errors: ["first", "second", "third"], query_budget_used: 8, ...TAIL,
    deferred: ["warung_rebahan"], note: "partial_run_more_pending",
  }, verify: () => {
    expect(mocks.wrWatchdog).not.toHaveBeenCalled();
    expect(mocks.wrSync).toHaveBeenCalledExactlyOnceWith(expect.anything(), undefined,
      expect.objectContaining({ trigger: "cron", useProxySlices: true, timeBudgetMs: 37_000 }));
  } },
  { name: "WR first sync reports a stale-sweep watchdog before publishing", query: "?phase=warung_rebahan&part=sync", seed: () => {
    enable("WARUNG_REBAHAN");
    fx.sql.exec("INSERT INTO wr_sync_log(sync_type,status,created_at) VALUES('products','success','2026-11-21 09:00:00')");
  }, expected: {
    ok: true, ...SKELETON, wr_products_synced: 8, wr_last_sync_at: "2026-11-21 09:00:00",
    phase: "warung_rebahan", part: "sync", wr_sync_stale_alerted: 1, wr_jaspay_synced: 5, wr_jaspay_rejected: 1,
    query_budget_used: 11, ...TAIL,
  }, verify: () => expect(mocks.wrWatchdog).toHaveBeenCalledExactlyOnceWith("2026-11-21 09:00:00", "pre_phase", expect.anything()) },
  { name: "SK combined orders, sync and pairs", query: "?phase=sekalipay", seed: () => enable("SEKALIPAY"), expected: {
    ok: true, ...SKELETON, sk_products_synced: 7, sk_orders_processed: 3, sk_orders_succeeded: 3, sk_saldo_balance: 75_000,
    phase: "sekalipay", sk_orphan_links_healed: 2, sk_orders_reconciled: 2, sk_orders_reconciled_fresh: 1,
    sk_credential_emails_sent: 4, pairs_decided: 3, pairs_changed: 1, query_budget_used: 8, ...TAIL,
  } },
  { name: "SK sync continuation defers without draining pairs", query: "?phase=sekalipay&part=sync&continue=1", seed: () => {
    enable("SEKALIPAY");
    mocks.skSync.mockResolvedValue({ synced: 2, budgetYielded: true, errors: ["first", "second", "third", "omitted"] });
  }, expected: {
    ok: true, ...SKELETON, sk_products_synced: 2, sk_sync_skipped: "attempted_failed", phase: "sekalipay", part: "sync",
    more: true, sk_sync_errors: ["first", "second", "third"], query_budget_used: 7, ...TAIL,
    deferred: ["sekalipay"], note: "partial_run_more_pending",
  }, verify: () => expect(mocks.pairs).not.toHaveBeenCalled() },
  { name: "SK sync-only finishes and drains pairs", query: "?phase=sekalipay&part=sync", seed: () => enable("SEKALIPAY"), expected: {
    ok: true, ...SKELETON, sk_products_synced: 7, phase: "sekalipay", part: "sync", pairs_decided: 3, pairs_changed: 1,
    query_budget_used: 7, ...TAIL,
  } },
  { name: "rotation persists its next phase and deferred order without stamping last-ok", query: "", expected: {
    ok: true, ...SKELETON, wr_sync_skipped: "disabled", fulfillment_aggregates_repaired: 0, query_budget_used: 33, ...TAIL,
    deferred: ["notify", "cleanup"], note: "partial_run_more_pending",
  }, verify: () => {
    expect(setting("cron_phase")).toBe("fulfillment");
    expect(setting("cron_deferred")).toBe('["notify","cleanup"]');
  } },
  { name: "notify deadline defers later lanes but completes the tail", query: "?phase=notify", seed: () => {
    seedNotify();
    mocks.telegram.mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.parse(CLOCK) + 42_000));
      return { created: 1, paid: 2, paidAdmin: 3, paidAdminWeb: 4 };
    });
  }, expected: {
    ok: true, ...SKELETON, telegram_order_notifications_retried: 1, telegram_paid_notifications_retried: 2,
    telegram_paid_admin_notifications_retried: 3, phase: "notify", qris_expiry_notifications: 1,
    telegram_paid_admin_web_notifications_retried: 4, query_budget_used: 3, ...TAIL, run_duration_ms: 42_000,
    deferred: ["notify"], note: "partial_run_more_pending",
  } },
  { name: "unexpected notify failure returns partial results without the tail", query: "?phase=notify", status: 500, seed: () => {
    seedNotify();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.telegram.mockRejectedValue(new Error("fixture notify failure"));
  }, expected: { ...SKELETON, phase: "notify", qris_expiry_notifications: 1, error: "partial_failure" } },
];

it.each(cases)("T4 operations golden: $name", async ({ query, expected, status = 200, seed, verify }) => {
  seed?.();
  const response = await POST(new NextRequest(`https://fixture.test/api/cron/operations${query}`, {
    method: "POST", headers: { authorization: "Bearer fixture" },
  }));
  const actual = await response.json();
  expect(response.status).toBe(status);
  expect(actual).toEqual(expected);
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  expect(setting("cron_last_hit_at")).toBeTruthy();
  if (query && status === 200) expect(setting("cron_last_ok_at")).toBeTruthy();
  else expect(setting("cron_last_ok_at")).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  verify?.();
});

it.each(["", "&part=sync", "&part=orders"])("SK drain failure stays best-effort, with no drain for orders-only (%s)", async part => {
  enable("SEKALIPAY");
  mocks.pairs.mockRejectedValue(new QueryBudgetExceeded());
  const res = await POST(new NextRequest(`https://fixture.test/api/cron/operations?phase=sekalipay${part}`, {
    method: "POST", headers: { authorization: "Bearer fixture" },
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body).not.toHaveProperty("pairs_decided");
  expect(body).not.toHaveProperty("pairs_changed");
  expect(body).not.toHaveProperty("deferred");
  expect(setting("cron_last_ok_at")).toBeTruthy();
  expect(mocks.pairs).toHaveBeenCalledTimes(part === "&part=orders" ? 0 : 1);
});

it("T4 goldens cover all 33 skeleton and 40 assigned results keys, plus response envelope keys", () => {
  const keys = new Set(cases.flatMap(({ expected }) => Object.keys(expected)));
  expect(Object.keys(SKELETON)).toHaveLength(33);
  // `ok`, `note`, `error` are response envelope fields, not results writes.
  expect([...keys].filter(key => !Object.hasOwn(SKELETON, key)).sort()).toEqual([
    "checkout_pin_emails_failed", "checkout_pin_emails_sent", "cleanup_skipped", "deferred", "error",
    "fulfillment_aggregates_repaired", "more", "note", "ok", "pairs_changed", "pairs_decided", "part", "phase",
    "qris_expiry_notifications", "query_budget_limit", "query_budget_note", "query_budget_used", "run_deadline_ms", "run_duration_ms",
    "sk_credential_emails_sent", "sk_orders_reconciled", "sk_orders_reconciled_fresh", "sk_orphan_links_healed", "sk_sync_errors",
    "telegram_paid_admin_web_notifications_retried", "wr_credentials_requeued", "wr_deliveries_delivered", "wr_deliveries_lease_recovered",
    "wr_deliveries_processed", "wr_final_settlement", "wr_jaspay_exact_ref", "wr_jaspay_polled", "wr_jaspay_rejected", "wr_jaspay_synced", "wr_links_repaired",
    "wr_orders_aging_alerted", "wr_orders_blocked", "wr_orders_reconciled", "wr_orders_reconciled_fresh", "wr_orphan_links_healed",
    "wr_sync_errors", "wr_sync_resume", "wr_sync_stale_alerted",
  ]);
  expect(keys.size).toBe(73 + 3);
});
