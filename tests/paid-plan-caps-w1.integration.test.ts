import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { KLIKQRIS_BACKGROUND_LIMIT } from "@/lib/payments/klikqris-reconcile";
import {
  claimSekalipayGatewayPoll,
  NOWPAYMENTS_BACKGROUND_LIMIT,
  NOWPAYMENTS_LATE_LIMIT,
  NOWPAYMENTS_LATE_RECHECK_MS,
  SEKALIPAY_GATEWAY_BACKGROUND_LIMIT,
  SEKALIPAY_GATEWAY_LATE_LIMIT,
  SEKALIPAY_GATEWAY_POLL_COOLDOWN_SECONDS,
} from "@/lib/payments/payment-view";
import { SEKALIPAY_GATEWAY_STALE_LIMIT } from "@/lib/payments/sekalipay-gateway";
import { claimNowpaymentsPollReconcile, NOWPAYMENTS_POLL_RECONCILE_MS } from "@/lib/payments/nowpayments";
import { CRYPTO_MARKET_MEMO_MS, CRYPTO_REFRESH_AFTER_MS } from "@/lib/payments/market-snapshot";
import { SUPPLIER_BALANCE_CHECK_INTERVAL_MS } from "@/lib/supplier-balance-alert";
import {
  ACCESS_PIN_BATCH_DEFAULT,
  ACCESS_PIN_BATCH_MAX,
  ACCESS_PIN_PACE_MS,
  credentialAccessEmailStatement,
  processCredentialAccessEmails,
} from "@/lib/orders/access-email";
import { RETRY_LIMIT as PEDIA_NOTIFY_RETRY_LIMIT } from "@/lib/pedia/notify-retry";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("W1 Paid-plan cap lifts & external-limit guards", () => {
  it("A2/A3/A4/A7/A8 exported constants reflect Paid-plan values while keeping safety limits", () => {
    expect(KLIKQRIS_BACKGROUND_LIMIT).toBe(20);
    expect(NOWPAYMENTS_BACKGROUND_LIMIT).toBe(20);
    expect(NOWPAYMENTS_LATE_LIMIT).toBe(20);
    expect(NOWPAYMENTS_LATE_RECHECK_MS).toBe(6 * 60 * 60_000);
    // Sekalipay gateway live cap stays inside global 20/min admission budget
    expect(SEKALIPAY_GATEWAY_BACKGROUND_LIMIT).toBe(12);
    expect(SEKALIPAY_GATEWAY_LATE_LIMIT).toBe(4);
    expect(SEKALIPAY_GATEWAY_STALE_LIMIT).toBe(5);
    expect(SEKALIPAY_GATEWAY_POLL_COOLDOWN_SECONDS).toBe(20);
    expect(NOWPAYMENTS_POLL_RECONCILE_MS).toBe(20_000);
    expect(ACCESS_PIN_BATCH_DEFAULT).toBe(15);
    expect(ACCESS_PIN_BATCH_MAX).toBe(20);
    expect(ACCESS_PIN_PACE_MS).toBe(1_000);
    expect(PEDIA_NOTIFY_RETRY_LIMIT).toBe(6);
    expect(CRYPTO_REFRESH_AFTER_MS).toBe(10 * 60_000);
    expect(CRYPTO_MARKET_MEMO_MS).toBe(15_000);
    expect(SUPPLIER_BALANCE_CHECK_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("A3: Sekalipay gateway and NOWPayments poll claims use 20s live cooldown and preserve 6h late rule", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "s");
      await insertTestProduct(fx.sql);
      const gwCode = "AXV-20261119-GWPOLL01";
      const npCode = "AXV-20261119-NPPOLL01";
      insertTestOrder(fx.sql, gwCode, { channel: "web" });
      insertTestOrder(fx.sql, npCode, { channel: "web" });
      fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,expires_at)
        VALUES(?,'sekalipay_gateway','merchant',?,'m',10000,'pending',datetime('now','+15 minutes'))`).run(gwCode, gwCode);
      fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,provider_payment_id,merchant_id,requested_amount,status,expires_at)
        VALUES(?,'nowpayments','api',?,'np-1','m',10000,'pending',datetime('now','+15 minutes'))`).run(npCode, npCode);

      const db = createDatabaseAccess(fx.db);
      expect(await claimSekalipayGatewayPoll(gwCode, false, db)).toBe(true);
      // Within 20s cooldown -> rejected
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-10 seconds') WHERE order_code=?").run(gwCode);
      expect(await claimSekalipayGatewayPoll(gwCode, false, db)).toBe(false);
      // Past 20s cooldown -> allowed
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-21 seconds') WHERE order_code=?").run(gwCode);
      expect(await claimSekalipayGatewayPoll(gwCode, false, db)).toBe(true);
      // Late check still obeys 6h (-21600s) rule
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-1 hour') WHERE order_code=?").run(gwCode);
      expect(await claimSekalipayGatewayPoll(gwCode, true, db)).toBe(false);
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-7 hours') WHERE order_code=?").run(gwCode);
      expect(await claimSekalipayGatewayPoll(gwCode, true, db)).toBe(true);

      // NOWPayments 20s cooldown
      expect(await claimNowpaymentsPollReconcile(npCode)).toBe(true);
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-10 seconds') WHERE order_code=?").run(npCode);
      expect(await claimNowpaymentsPollReconcile(npCode)).toBe(false);
      fx.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-21 seconds') WHERE order_code=?").run(npCode);
      expect(await claimNowpaymentsPollReconcile(npCode)).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("A4: processCredentialAccessEmails drains >2 emails in one tick and paces consecutive Resend calls at 1s", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("ORDER_ACCESS_SECRET", "fixture-pin-secret");
      vi.stubEnv("RESEND_API_KEY", "re_fixture");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
      await insertTestProduct(fx.sql);
      const { encryptSecret } = await import("@/lib/fulfillment/crypto");
      const enc = await encryptSecret("CRED-FIXTURE");
      const db = createDatabaseAccess(fx.db);

      for (let i = 1; i <= 5; i++) {
        const code = `AXV-20261119-PIN0000${i}`;
        insertTestOrder(fx.sql, code, { channel: "web", status: "lunas" });
        fx.sql.prepare("UPDATE orders SET payment_status='paid', customer_email=?, buyer_access_version=1, buyer_access_format='pin6' WHERE code=?")
          .run(`buyer${i}@example.test`, code);
        fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,fulfillment_mode,status,delivered_ciphertext,delivered_iv) VALUES(?,0,1,1,'unique','delivered',?,?)")
          .run(code, enc.ciphertext, enc.iv);
        await fx.db.batch([credentialAccessEmailStatement(fx.db, code)]);
      }

      const sleeps: number[] = [];
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "res_ok" })));
      const out = await processCredentialAccessEmails(db, 15, undefined, {
        paceMs: 1_000,
        sleepImpl: async (ms) => { sleeps.push(ms); },
      });
      expect(out).toEqual({ sent: 5, failed: 0 });
      // 4 inter-email pauses for 5 sequential sends (<=1 req/s sustained for Resend)
      expect(sleeps).toEqual([1_000, 1_000, 1_000, 1_000]);
    } finally {
      fx.close();
    }
  });

  it("A5: interactive admin publish/orders routes use unmetered createDatabaseAccess (no 40-statement cap)", () => {
    const routes = [
      "src/app/api/admin/aivault/orders/route.ts",
      "src/app/api/admin/aivault/publish/route.ts",
      "src/app/api/admin/mirai/orders/route.ts",
      "src/app/api/admin/mirai/publish/route.ts",
      "src/app/api/admin/storebat/orders/route.ts",
      "src/app/api/admin/storebat/publish/route.ts",
      "src/app/api/admin/tunvn/orders/route.ts",
    ];
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toContain("createBudgetedDatabase");
      expect(src, file).toContain("createDatabaseAccess");
    }
  });

  it("A8: cron/lite wr_orders and sk_orders check WR/SK balance every 10 minutes, and pedia_orders checks IndoSMM every 5 minutes", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "false");
      vi.stubEnv("SEKALIPAY_API_KEY", "k");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");

      let wrCalls = 0, skCalls = 0, pediaCalls = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.includes("/indosmm/balance")) { pediaCalls++; return Response.json({ balance: "300000", currency: "IDR" }); }
        if (s.includes("/v1/balance")) { skCalls++; return Response.json({ data: { balance: 400000 } }); }
        if (s.includes("/balance")) { wrCalls++; return Response.json({ success: true, data: { balance: 500000, currency: "IDR" } }); }
        return Response.json({ success: true, data: [] });
      }));

      const { POST } = await import("@/app/api/cron/lite/route");
      const call = async (job: string) => {
        const res = await POST(new NextRequest(`http://localhost/api/cron/lite?job=${job}`, {
          method: "POST", headers: { authorization: "Bearer s" },
        }));
        return res.json() as Promise<Record<string, unknown>>;
      };

      expect(await call("wr_orders")).toMatchObject({ ok: true, wr_saldo_balance: 500000 });
      expect(await call("wr_orders")).not.toHaveProperty("wr_saldo_balance");
      expect(wrCalls).toBe(1);
      // Backdate > 10 minutes -> checks again
      fx.sql.exec("UPDATE wr_saldo_log SET created_at=datetime('now','-11 minutes')");
      expect(await call("wr_orders")).toMatchObject({ ok: true, wr_saldo_balance: 500000 });
      expect(wrCalls).toBe(2);

      expect(await call("sk_orders")).toMatchObject({ ok: true, sk_saldo_balance: 400000 });
      expect(await call("sk_orders")).not.toHaveProperty("sk_saldo_balance");
      expect(skCalls).toBe(1);
      fx.sql.exec("UPDATE sk_saldo_log SET created_at=datetime('now','-11 minutes')");
      expect(await call("sk_orders")).toMatchObject({ ok: true, sk_saldo_balance: 400000 });
      expect(skCalls).toBe(2);

      expect(await call("pedia_orders")).toMatchObject({ ok: true, indosmm_balance: 300000 });
      expect(await call("pedia_orders")).not.toHaveProperty("indosmm_balance");
      expect(pediaCalls).toBe(1);
      // 4 minutes ago -> still throttled; 6 minutes ago -> checks again
      fx.sql.exec("UPDATE store_settings SET value=datetime('now','-4 minutes') WHERE key='pedia_indosmm_balance_checked_at'");
      expect(await call("pedia_orders")).not.toHaveProperty("indosmm_balance");
      expect(pediaCalls).toBe(1);
      fx.sql.exec("UPDATE store_settings SET value=datetime('now','-6 minutes') WHERE key='pedia_indosmm_balance_checked_at'");
      expect(await call("pedia_orders")).toMatchObject({ ok: true, indosmm_balance: 300000 });
      expect(pediaCalls).toBe(2);
    } finally {
      fx.close();
    }
  });
});
