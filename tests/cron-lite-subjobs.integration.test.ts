import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/payments/payment-view");
  vi.doUnmock("@/lib/payments/klikqris-reconcile");
  vi.doUnmock("@/lib/pedia/dispatch");
  vi.doUnmock("@/lib/telegram/order-notifications");
  vi.doUnmock("@/lib/telegram/invoice-retry");
  vi.doUnmock("@/lib/whatsapp/outbox");
  vi.doUnmock("@/lib/whatsapp/promo-digest");
  vi.doUnmock("@/lib/product-copy/review-alert");
  vi.doUnmock("@/lib/payments/market-snapshot-refresh");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function callLite(job: string) {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest(`http://localhost/api/cron/lite?job=${job}`, {
      method: "POST",
      headers: { authorization: "Bearer s" },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("/api/cron/lite A3-6 core vs optional subjobs and budget yield", () => {
  it("payments: core NOWPayments pass exception still runs Sekalipay pass and returns 503 without ok heartbeat", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      let gatewayRan = false;
      vi.doMock("@/lib/payments/klikqris-reconcile", () => ({
        reconcileDueKlikQrisPayments: vi.fn(async () => ({ payments_checked: 0, payments_confirmed: 0, payments_failed: 0 })),
      }));
      vi.doMock("@/lib/payments/payment-view", () => ({
        reconcileDueNowpaymentsPayments: vi.fn(async () => { throw new Error("nowp_boom"); }),
        reconcileLateKnownNowpaymentsPayments: vi.fn(async () => ({ late_checked: 0, late_manual_review: 0 })),
        reconcileDueSekalipayGatewayPayments: vi.fn(async () => {
          gatewayRan = true;
          return { gateway_checked: 1, gateway_late_checked: 0 };
        }),
      }));

      const res = await callLite("payments");
      expect(gatewayRan).toBe(true);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        ok: false,
        job: "payments",
        nowpayments_error: "pass_failed",
        gateway_checked: 1,
        failed_subjobs: ["nowpayments"],
      });
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_payments_ok_at'").get()).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("payments: core Sekalipay gateway pass exception returns 503 with failed_subjobs", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.doMock("@/lib/payments/klikqris-reconcile", () => ({
        reconcileDueKlikQrisPayments: vi.fn(async () => ({ payments_checked: 0, payments_confirmed: 0, payments_failed: 0 })),
      }));
      vi.doMock("@/lib/payments/payment-view", () => ({
        reconcileDueNowpaymentsPayments: vi.fn(async () => ({ payments_checked: 1, payments_confirmed: 0, payments_failed: 0, manual_review: 0 })),
        reconcileLateKnownNowpaymentsPayments: vi.fn(async () => ({ late_checked: 0, late_manual_review: 0 })),
        reconcileDueSekalipayGatewayPayments: vi.fn(async () => { throw new Error("skg_boom"); }),
      }));

      const res = await callLite("payments");
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        ok: false,
        gateway_error: "pass_failed",
        failed_subjobs: ["sekalipay_gateway"],
      });
    } finally {
      fx.close();
    }
  });

  it("pedia_orders: core dispatch exception continues to remaining work and returns 503", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ balance: "200000", currency: "IDR" })));
      vi.doMock("@/lib/pedia/dispatch", () => ({
        processPediaPaidOrders: vi.fn(async () => { throw new Error("dispatch_down"); }),
      }));

      const res = await callLite("pedia_orders");
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        ok: false,
        job: "pedia_orders",
        dispatch_error: "dispatch_down",
        indosmm_balance: 200000,
        failed_subjobs: ["dispatch"],
      });
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='cron_lite_pedia_orders_ok_at'").get()).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("notify_a: core telegram_retry exception still runs invoice_retry and returns 503", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      let invoiceRan = false;
      vi.doMock("@/lib/telegram/order-notifications", () => ({
        retryPendingTelegramNotifications: vi.fn(async () => { throw new Error("tg_down"); }),
        sendPendingOrderReminders: vi.fn(async () => ({})),
      }));
      vi.doMock("@/lib/telegram/invoice-retry", () => ({
        retryInvoicePendingTelegramInvoices: vi.fn(async () => {
          invoiceRan = true;
          return { retried: 0 };
        }),
      }));

      const res = await callLite("notify_a");
      expect(invoiceRan).toBe(true);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        ok: false,
        telegram_retry_error: "tg_down",
        invoice_retry: { retried: 0 },
        failed_subjobs: ["telegram_retry"],
      });
    } finally {
      fx.close();
    }
  });

  it("notify_b: core whatsapp_outbox exception returns 503, while optional subjob exception returns 200", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      // 1) Core whatsapp_outbox throws -> 503
      vi.doMock("@/lib/whatsapp/outbox", () => ({
        processDueWhatsAppOutbox: vi.fn(async () => { throw new Error("wa_boom"); }),
      }));
      const coreFail = await callLite("notify_b");
      expect(coreFail.status).toBe(503);
      expect(coreFail.body).toMatchObject({
        ok: false,
        whatsapp_outbox_error: "wa_boom",
        failed_subjobs: ["whatsapp_outbox"],
      });

      // 2) Optional whatsapp_promo throws while whatsapp_outbox succeeds -> 200
      vi.resetModules();
      vi.doUnmock("@/lib/whatsapp/outbox");
      vi.doMock("@/lib/whatsapp/promo-digest", () => ({
        enqueueWhatsAppPromo: vi.fn(async () => { throw new Error("promo_optional_err"); }),
      }));
      const optFail = await callLite("notify_b");
      expect(optFail.status).toBe(200);
      expect(optFail.body).toMatchObject({
        ok: true,
        job: "notify_b",
        whatsapp_promo_error: "promo_optional_err",
      });
    } finally {
      fx.close();
    }
  });

  it("cleanup: optional copy-review and crypto refresh exceptions return 200 and record error", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.doMock("@/lib/product-copy/review-alert", () => ({
        checkCopyReviewChanges: vi.fn(async () => { throw new Error("copy_boom"); }),
      }));
      vi.doMock("@/lib/payments/market-snapshot-refresh", () => ({
        refreshCryptoMarketSnapshot: vi.fn(async () => { throw new Error("market_boom"); }),
      }));

      const res = await callLite("cleanup");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        job: "cleanup",
        copy_review: { checked: false, error: "check_failed" },
        crypto_market: "error",
      });
    } finally {
      fx.close();
    }
  });

  it("cleanup: hourly maintenance and a full group drain cannot starve the watchdog", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("STOREBAT_SYNC_ENABLED", "true");
      vi.stubEnv("STOREBAT_API_KEY", "fixture-only");
      vi.stubEnv("STOREBAT_BASE_URL", "https://supplier.test");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const copyReview = vi.fn(async (db: { queryFirst: (sql: string) => Promise<unknown> }) => {
        for (let i = 0; i < 4; i++) await db.queryFirst("SELECT 1");
        return { checked: true };
      });
      vi.doMock("@/lib/product-copy/review-alert", () => ({ checkCopyReviewChanges: copyReview }));
      for (let id = 1; id <= 10; id++) {
        fx.sql.prepare("INSERT INTO product_groups(id,name) VALUES(?,?)").run(id, `group ${id}`);
        fx.sql.prepare("INSERT INTO product_group_dirty(group_id,version,pending) VALUES(?,1,1)").run(id);
      }
      const res = await callLite("cleanup");
      expect(res).toMatchObject({ status: 200, body: {
        pairs_decided: 10, copy_review: { checked: true }, staleness: { checked: true, sources: expect.arrayContaining(["storebat"]) },
      } });
      const keys = fx.sql.prepare("SELECT key FROM store_settings WHERE key IN ('maintenance_cleanup_at','sync_stale_state_storebat') ORDER BY key").all();
      expect(keys).toEqual([{ key: "maintenance_cleanup_at" }, { key: "sync_stale_state_storebat" }]);
    } finally {
      fx.close();
    }
  });

  it("QueryBudgetExceeded inside a core subjob returns 200 budget_exhausted (yield is not a failure)", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.doMock("@/lib/telegram/order-notifications", () => ({
        retryPendingTelegramNotifications: vi.fn(async (_limit: number, _only: unknown, db: { queryFirst: (q: string) => Promise<unknown> }) => {
          for (let i = 0; i < 305; i++) await db.queryFirst("SELECT 1");
          return {};
        }),
        sendPendingOrderReminders: vi.fn(async () => ({})),
      }));

      const res = await callLite("notify_a");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        job: "notify_a",
        budget_exhausted: true,
      });
    } finally {
      fx.close();
    }
  });
});
