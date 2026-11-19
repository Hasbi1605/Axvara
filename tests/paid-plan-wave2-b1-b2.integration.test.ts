import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import {
  createTunvnOrderLinks,
  processTunvnOrders,
  TUNVN_ORDERS_PER_RUN,
} from "@/lib/tunvn/orders";
import {
  createAivaultOrderLinks,
  processAivaultOrders,
  AIVAULT_ORDERS_PER_RUN,
} from "@/lib/aivault/orders";
import {
  processStorebatOrders,
  STOREBAT_ORDERS_PER_RUN,
} from "@/lib/storebat/orders";
import {
  processMiraiOrders,
  MIRAI_ORDERS_PER_RUN,
} from "@/lib/mirai/orders";
import {
  CRON_PHASE_CONCURRENCY,
  runOperationsTick,
  type CronEnv,
} from "../mcp-worker/src/cron";
import { syntheticResponse } from "./helpers/synthetic-response";

vi.mock("@/lib/notify-buyer", () => ({
  notifyBuyerBuffCompleted: vi.fn(async () => true),
  notifyBuyerTunvnProcessing: vi.fn(async () => true),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Wave 2 B1: multi-link supplier order processing & batch link creation", () => {
  it("TUNVN: batch-inserts all eligible lines, drains up to 8 links/tick alongside processing Buff without starvation, honors deadline/429/reconcileId", async () => {
    const f = createD1Fixture();
    try {
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "tv-fixture");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      stubFulfillmentKey();

      f.sql.exec(`
        INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode) VALUES
          (1,'ChatGPT TV','chatgpt-tv',20000,10,1,'manual','manual'),
          (2,'Muse Buff','muse-ai-1-miliar-token',3000,-1,1,'manual','manual');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,tunvn_source_product_id,tunvn_buff_quantity_b,buyer_field_key,max_qty) VALUES
          (1,1,'TUNVN-86','1 Bulan',20000,10,'manual',1,86,NULL,NULL,NULL),
          (2,2,'TUNVN-BUFF-1B','1B Token',3000,-1,'manual',1,NULL,1,'muse_invite_code',30);
        INSERT INTO tunvn_products(supplier_product_id,name,price_vnd,price_usdt,stock,fx_idr_per_usdt) VALUES(86,'ChatGPT',50000,1.0,100,16000);
      `);

      const accountItem = () => ({
        product_id: 1, variant_id: 1, name: "ChatGPT", price: 20000, qty: 1, fulfillment_mode: "manual",
        tunvn_eligibility: { version: 1, kind: "account", source_product_id: 86, source_variant_id: 1, source_unit_b: null, quantity: 1, cost_usdt: 1.0 },
      });
      const buffItem = () => ({
        product_id: 2, variant_id: 2, name: "Muse", price: 3000, qty: 1, fulfillment_mode: "manual",
        buyer_field_key: "muse_invite_code", max_qty: 30, buyer_fields: { muse_invite_code: "Ab12Cd" },
        tunvn_eligibility: { version: 1, kind: "buff", source_product_id: null, source_variant_id: 2, source_unit_b: 1, quantity: 1, cost_usdt: 0.2 },
      });
      const manualItem = () => ({ product_id: 1, variant_id: 1, name: "Manual", price: 1000, qty: 1 });

      // 1) Batch-insert all eligible lines (skipping non-eligible manual line) in one invocation
      insertTestOrder(f.sql, "AXV-20261119-TVMULTI1", { status: "lunas", channel: "web", items: [accountItem(), manualItem(), buffItem(), accountItem()] });
      const created = await createTunvnOrderLinks("AXV-20261119-TVMULTI1", createDatabaseAccess(f.db));
      expect(created).toBe(3);
      expect(f.sql.prepare("SELECT item_index,kind FROM tunvn_order_links WHERE order_code='AXV-20261119-TVMULTI1' ORDER BY item_index").all()).toEqual([
        { item_index: 0, kind: "account" },
        { item_index: 2, kind: "buff" },
        { item_index: 3, kind: "account" },
      ]);

      // 2) Create 7 more single-item orders -> total 10 due links (1 processing Buff + 9 pending)
      for (let i = 2; i <= 8; i++) {
        insertTestOrder(f.sql, `AXV-20261119-TVMULT0${i}`, { status: "lunas", channel: "web", items: [accountItem()] });
      }
      // Make link index 2 (Buff) already processing so we verify it doesn't starve pending accounts
      f.sql.exec(`UPDATE tunvn_order_links SET next_attempt_at=datetime('now','-1 minute')`);
      f.sql.exec(`UPDATE tunvn_order_links SET status='processing',provider_batch_id='BUFF_INFLIGHT',next_attempt_at=datetime('now','-2 minutes') WHERE order_code='AXV-20261119-TVMULTI1' AND item_index=2`);

      let buySeq = 0;
      let statusPollCount = 0;
      let force429 = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/products") return Response.json({ success: true, products: [{ id: 86, name: "ChatGPT", price_vnd: 50000, price_usdt: 1.0, stock: 100 }] });
        if (path === "/api/balance") return Response.json({ success: true, balance_vnd: 0, balance_usdt: 500 });
        if (path.startsWith("/api/buff/status")) {
          statusPollCount++;
          return Response.json({ success: true, batch_id: "BUFF_INFLIGHT", is_done: false, orders: [{ invite_code: "Ab12Cd", quantity_b: 1, currency: "usdt", order_code: "TB1", status: "pending" }] });
        }
        if (path === "/api/buy") {
          buySeq++;
          if (force429) return new Response(JSON.stringify({ success: false }), { status: 429 });
          return Response.json({ success: true, order: { order_group: `GRP-${buySeq}`, quantity: 1, total_items: 1, total_price: 1.0, currency: "usdt" }, items: [`cred-${buySeq}`] });
        }
        throw new Error(`unexpected ${path}`);
      }));

      // Paid 300-statement budget processes 8 links in one tick (1 Buff poll + 7 account buys), leaving 2 pending for next tick
      expect(TUNVN_ORDERS_PER_RUN).toBe(8);
      const budget = createBudgetedDatabase(300, 2, f.db);
      const processed1 = await processTunvnOrders(budget.access);
      expect(processed1).toBe(8);
      expect(statusPollCount).toBe(1);
      expect(buySeq).toBe(7);
      expect(budget.used).toBeLessThanOrEqual(298);
      const remainingBefore2 = Number(f.sql.prepare("SELECT COUNT(*) n FROM tunvn_order_links WHERE status='pending'").get()?.n);
      expect(remainingBefore2).toBe(2);

      // 3) Deadline stops before starting any new link (and never touches request_sent_at)
      const beforeDeadlineBuys = buySeq;
      expect(await processTunvnOrders(createDatabaseAccess(f.db), { deadlineMs: Date.now() - 1 })).toBe(0);
      expect(buySeq).toBe(beforeDeadlineBuys);

      // 4) reconcileId strictly processes only 1 link, leaving the 2 pending accounts untouched
      const buffLinkId = Number(f.sql.prepare("SELECT id FROM tunvn_order_links WHERE provider_batch_id='BUFF_INFLIGHT'").get()?.id);
      expect(await processTunvnOrders(createDatabaseAccess(f.db), { reconcileId: buffLinkId })).toBe(1);
      expect(statusPollCount).toBe(2);
      expect(buySeq).toBe(beforeDeadlineBuys);

      // 5) HTTP 429 stops the loop after the rate-limited link instead of hammering the 2nd remaining pending link
      force429 = true;
      expect(await processTunvnOrders(createDatabaseAccess(f.db))).toBe(1);
      expect(buySeq).toBe(beforeDeadlineBuys + 1);
      const stillPending = Number(f.sql.prepare("SELECT COUNT(*) n FROM tunvn_order_links WHERE status='pending' AND request_sent_at IS NULL").get()?.n);
      expect(stillPending).toBe(1);
    } finally {
      f.close();
    }
  });

  it("AIVault: batch-inserts all eligible lines, drains multiple links in one Paid tick, honors deadline & 429 stop-loop", async () => {
    const f = createD1Fixture();
    try {
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "av-fixture");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");
      stubFulfillmentKey();

      const sid = "service_gemini_plus_6m";
      f.sql.exec(`
        INSERT INTO products(id,name,slug,price,stock,aivault_family) VALUES(1,'Gemini','gemini-av',13500,10,'gemini');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,aivault_service_id) VALUES(1,1,'AV-${sid}','6M',13500,10,'manual','${sid}');
        INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,fx_idr_per_usd) VALUES('${sid}','Gemini',10,0.5,'[]',16000);
      `);
      const avItem = () => ({ product_id: 1, variant_id: 1, name: "Gemini", price: 13500, qty: 1, aivault_eligibility: { version: 1, service_id: sid, source_variant_id: 1, quantity: 1, cost_usd: 0.5 } });

      insertTestOrder(f.sql, "AXV-20261119-AVM00001", { status: "lunas", channel: "web", items: [avItem(), avItem(), avItem()] });
      expect(await createAivaultOrderLinks("AXV-20261119-AVM00001", createDatabaseAccess(f.db))).toBe(3);

      insertTestOrder(f.sql, "AXV-20261119-AVM00002", { status: "lunas", channel: "web", items: [avItem(), avItem()] });

      let buySeq = 0;
      let fail429After = 99;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/quote")) return Response.json({ service_id: sid, quantity: 1, currency: "USD", stock: 10, sufficient_balance: true, pricing: { unit_price: 0.5, final_total: 0.5 } });
        if (init?.method === "POST") {
          buySeq++;
          const body = JSON.parse(String(init.body)) as { external_order_id: string };
          if (buySeq > fail429After) return new Response("rate limited", { status: 429 });
          return Response.json({ success: true, order_id: `AV_${buySeq}`, external_order_id: body.external_order_id, service_id: sid, quantity: 1, total_cost: 0.5, currency: "USD", products: [`av-secret-${buySeq}`] }, { status: 201 });
        }
        throw new Error(`unexpected ${path}`);
      }));

      expect(AIVAULT_ORDERS_PER_RUN).toBe(8);
      const budget = createBudgetedDatabase(300, 2, f.db);
      expect(await processAivaultOrders(budget.access)).toBe(5);
      expect(buySeq).toBe(5);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM aivault_order_links WHERE status='completed'").get()?.n)).toBe(5);

      // 429 stops loop after the first hit on 2 new pending orders
      insertTestOrder(f.sql, "AXV-20261119-AVM00003", { status: "lunas", channel: "web", items: [avItem(), avItem()] });
      fail429After = buySeq;
      expect(await processAivaultOrders(createDatabaseAccess(f.db))).toBe(1);
      expect(buySeq).toBe(6);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM aivault_order_links WHERE order_code='AXV-20261119-AVM00003' AND request_sent_at IS NULL").get()?.n)).toBe(1);
    } finally {
      f.close();
    }
  });

  it("StoreBat: drains multiple links across orders in one Paid tick and stops cleanly on 429", async () => {
    const f = createD1Fixture();
    try {
      vi.stubEnv("STOREBAT_ENABLED", "true");
      vi.stubEnv("STOREBAT_SYNC_ENABLED", "true");
      vi.stubEnv("STOREBAT_API_KEY", "sb-fixture");
      vi.stubEnv("STOREBAT_BASE_URL", "https://storebat.test/api/reseller");
      stubFulfillmentKey();

      f.sql.exec(`
        INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,storebat_family) VALUES(1,'Gemini SB','gemini-sb',15000,10,1,'manual','manual','gemini');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id) VALUES(1,1,'SB-121','1M',15000,10,'manual',1,121);
        INSERT INTO storebat_products(id,name,price_usd,pricing_type,price_tiers_json,delivery_type,stock,last_seen_at,api_test,disappeared) VALUES(121,'Gemini',0.5,'fixed','[]','supplier_api',10,datetime('now'),0,0);
      `);
      const sbItem = () => ({
        product_id: 1, variant_id: 1, name: "Gemini", price: 15000, qty: 1,
        storebat_eligibility: { version: 1, kind: "product", product_id: 121, sku: "SB-121", family: "gemini", source_variant_id: 1, quantity: 1, cost_usd: 0.5, fx_idr_per_usd: 16000 },
      });

      insertTestOrder(f.sql, "AXV-20261119-SBM00001", { status: "lunas", channel: "web", items: [sbItem(), sbItem()] });
      insertTestOrder(f.sql, "AXV-20261119-SBM00002", { status: "lunas", channel: "web", items: [sbItem(), sbItem()] });

      let buySeq = 0;
      let rateLimitQuotes = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const p = new URL(String(url)).pathname;
        if (p.endsWith("/quote")) {
          if (rateLimitQuotes) return new Response("too many", { status: 429, headers: { "retry-after": "60" } });
          return Response.json({ success: true, quote: { product_id: 121, quantity: 1, unit_price: 0.5, total: 0.5, stock: 10, delivery_type: "supplier_api" }, wallet_balance: 50 });
        }
        if (p.endsWith("/orders") && init?.method === "POST") {
          buySeq++;
          const body = JSON.parse(String(init.body)) as { idempotency_key: string; customer_reference: string };
          return Response.json({
            success: true,
            order: { id: 100 + buySeq, product_id: 121, quantity: 1, amount_usd: 0.5, status: "COMPLETED", delivery_type: "supplier_api", idempotency_key: body.idempotency_key, customer_reference: body.customer_reference, items: [{ account_data: `sb-acc-${buySeq}` }] },
          });
        }
        throw new Error(`unexpected ${p}`);
      }));

      expect(STOREBAT_ORDERS_PER_RUN).toBe(8);
      const budget = createBudgetedDatabase(300, 2, f.db);
      expect(await processStorebatOrders(budget.access)).toBe(4);
      expect(buySeq).toBe(4);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM storebat_order_links WHERE status='completed'").get()?.n)).toBe(4);

      // Quote 429 stops loop after 1st link on a 2-link order
      insertTestOrder(f.sql, "AXV-20261119-SBM00003", { status: "lunas", channel: "web", items: [sbItem(), sbItem()] });
      rateLimitQuotes = true;
      expect(await processStorebatOrders(createDatabaseAccess(f.db))).toBe(1);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM storebat_order_links WHERE order_code='AXV-20261119-SBM00003' AND last_error='quote_rate_limited'").get()?.n)).toBe(1);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM storebat_order_links WHERE order_code='AXV-20261119-SBM00003' AND last_error IS NULL").get()?.n)).toBe(1);
    } finally {
      f.close();
    }
  });

  it("Mirai: drains multiple links across orders in one Paid tick and stops cleanly on 429", async () => {
    const f = createD1Fixture();
    try {
      vi.stubEnv("MIRAI_ENABLED", "true");
      vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
      vi.stubEnv("MIRAI_API_KEY", "mr-fixture");
      vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");
      stubFulfillmentKey();

      const pkgCode = "FULL_100M";
      f.sql.exec(`
        INSERT INTO products(id,name,slug,price,stock,is_active,source,fulfillment_mode,mirai_family) VALUES(1,'Mirai Token','mirai-tok',25000,-1,1,'manual','manual','full');
        INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,mirai_package_code,mirai_cost_usdt,mirai_fx_idr_per_usdt) VALUES(1,1,'MR-${pkgCode}','100M',25000,-1,'manual',1,'${pkgCode}',2.923077,16000);
        INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,min_quantity,max_quantity,unlimited,remaining_today,axvara_product_id,fx_idr_per_usdt) VALUES('${pkgCode}','full','Full 100M',100000000,259200,76000,2.923077,1,10000,1,0,1,16000);
      `);
      const mrItem = () => ({
        product_id: 1, variant_id: 1, name: "Mirai", price: 25000, qty: 1,
        mirai_eligibility: { version: 1, package_code: pkgCode, mirai_family: "full", sku: `MR-${pkgCode}`, source_variant_id: 1, quantity: 1, cost_usdt: Math.round((76000 / 26000) * 1_000_000) / 1_000_000 },
      });

      insertTestOrder(f.sql, "AXV-20261119-MRM00001", { status: "lunas", channel: "web", items: [mrItem(), mrItem()] });
      insertTestOrder(f.sql, "AXV-20261119-MRM00002", { status: "lunas", channel: "web", items: [mrItem(), mrItem()] });

      let buySeq = 0;
      let rateLimitBuy = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const p = new URL(String(url)).pathname;
        if (p.endsWith("/packages")) {
          return Response.json({
            success: true,
            data: [{
              code: pkgCode, group: "full", name: "Full 100M", quota_tokens: 100000000, duration_seconds: 259200,
              reseller_price_vnd: 76000, retail_price_vnd: 80000, discount_bps: 500, min_quantity: 1, max_quantity: 10000,
              preset_quantities: [1], models: ["claude-opus-5"], unlimited: true, remaining_today: 0, custom_quantity: true,
            }],
          });
        }
        if (p.endsWith("/balance")) return Response.json({ success: true, data: { balance_vnd: 10_000_000, tier: "Silver", discount_bps: 500 } });
        if (p.endsWith("/orders") && init?.method === "POST") {
          buySeq++;
          if (rateLimitBuy) return new Response("rate limited", { status: 429, headers: { "retry-after": "60" } });
          const body = JSON.parse(String(init.body)) as { external_order_id: string };
          return Response.json({
            success: true,
            data: {
              order_code: `MRO-${buySeq}`,
              external_order_id: body.external_order_id,
              package_code: pkgCode,
              quantity: 1,
              unit_price_vnd: 76000,
              amount_vnd: 76000,
              status: "fulfilled",
              redeem_code: `REDEEM-MIRAI-${buySeq}`,
              redeem_codes: [`REDEEM-MIRAI-${buySeq}`],
            },
          });
        }
        throw new Error(`unexpected ${p}`);
      }));

      expect(MIRAI_ORDERS_PER_RUN).toBe(8);
      const budget = createBudgetedDatabase(300, 2, f.db);
      expect(await processMiraiOrders(budget.access)).toBe(4);
      expect(buySeq).toBe(4);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM mirai_order_links WHERE status='completed'").get()?.n)).toBe(4);

      // 429 on POST stops loop cleanly on a 2-link order
      insertTestOrder(f.sql, "AXV-20261119-MRM00003", { status: "lunas", channel: "web", items: [mrItem(), mrItem()] });
      rateLimitBuy = true;
      expect(await processMiraiOrders(createDatabaseAccess(f.db))).toBe(1);
      expect(buySeq).toBe(5);
      expect(Number(f.sql.prepare("SELECT COUNT(*) n FROM mirai_order_links WHERE order_code='AXV-20261119-MRM00003' AND request_sent_at IS NULL").get()?.n)).toBe(1);
    } finally {
      f.close();
    }
  });
});

describe("Wave 2 B2: phased parallel cron, non-blocking probes, and notify_b PIN priority", () => {
  it("runs independent lite steps concurrently up to CRON_PHASE_CONCURRENCY=4, keeps heavy sequential, and isolates slow suppliers", async () => {
    expect(CRON_PHASE_CONCURRENCY).toBe(4);
    const env: CronEnv = { AXVARA_API_ORIGIN: "https://origin.test", AXVARA_CRON_SECRET: "secret" };
    let active = 0;
    let maxLiteActive = 0;
    let maxHeavyActive = 0;
    let maxCoreActive = 0;
    const coreOrder: string[] = [];
    let releaseWr!: () => void;
    const wrBlocked = new Promise<void>((r) => { releaseWr = r; });
    const completedInOrders: string[] = [];

    const fetchFn = vi.fn(async (url: string) => {
      const synth = syntheticResponse(url);
      if (synth) return synth;
      const u = new URL(url);
      const isHeavy = u.pathname === "/api/cron/operations";
      const job = u.searchParams.get("job") ?? u.searchParams.get("phase") ?? "publish";
      active++;
      const isCore = !isHeavy && ["payments", "expiry", "fulfillment"].includes(job);
      if (isCore) { maxCoreActive = Math.max(maxCoreActive, active); coreOrder.push(job); }
      if (isHeavy) maxHeavyActive = Math.max(maxHeavyActive, active);
      else maxLiteActive = Math.max(maxLiteActive, active);
      try {
        if (job === "wr_orders") {
          await wrBlocked;
        } else {
          // Small microtask yield so parallel peers overlap
          await new Promise((r) => setTimeout(r, 10));
          if (job.endsWith("_orders")) {
            completedInOrders.push(job);
            // Release wr_orders once sibling supplier jobs prove they weren't blocked by wr_orders
            if (completedInOrders.length >= 3) releaseWr();
          }
        }
        return Response.json({ more: false });
      } finally {
        active--;
      }
    });

    const report = await runOperationsTick(env, Date.UTC(2026, 10, 19, 14, 0), fetchFn, async () => {});
    expect(report.failures).toEqual([]);
    // Real parallelism in lite phases, strictly bounded at 4 (safe under Workers 6-connection cap)
    expect(maxLiteActive).toBe(CRON_PHASE_CONCURRENCY);
    // Hourly heavy /api/cron/operations steps remain sequential (shared phase state)
    expect(maxHeavyActive).toBe(1);
    // core stays sequential: payments reconcile must finish before expiry can
    // expire a pending order that was paid right at its deadline.
    expect(maxCoreActive).toBe(1);
    expect(coreOrder).toEqual(["payments", "expiry", "fulfillment"]);
    // Sibling suppliers finished while wr_orders was still stalled
    expect(completedInOrders.length).toBeGreaterThanOrEqual(3);
  });

  it("notify_b runs checkout_pin_emails BEFORE whatsapp_outbox so WA anti-ban sleeps never starve PIN emails", async () => {
    vi.resetModules();
    const order: string[] = [];
    vi.stubEnv("CRON_SECRET", "s");
    vi.doMock("@/lib/whatsapp/promo-digest", () => ({ enqueueWhatsAppPromo: vi.fn(async () => ({ enqueued: 0 })) }));
    vi.doMock("@/lib/whatsapp/promo-bot", () => ({ enqueueWhatsAppPromoBot: vi.fn(async () => ({ enqueued: 0 })) }));
    vi.doMock("@/lib/payments/qris-expiry-notifications", () => ({ sendQrisExpiryNotifications: vi.fn(async () => ({ sent: 0, whatsappQueued: 0 })) }));
    vi.doMock("@/lib/telegram/order-notifications", () => ({ sendPendingOrderReminders: vi.fn(async () => 0) }));
    vi.doMock("@/lib/orders/access-email", () => ({
      processCredentialAccessEmails: vi.fn(async () => {
        order.push("checkout_pin_emails");
        return { sent: 2, failed: 0 };
      }),
    }));
    vi.doMock("@/lib/whatsapp/outbox", () => ({
      processDueWhatsAppOutbox: vi.fn(async () => {
        order.push("whatsapp_outbox");
        return { sent: 4, dead: 0 };
      }),
    }));

    const fx = createD1Fixture();
    try {
      const { POST } = await import("@/app/api/cron/lite/route");
      const res = await POST(new NextRequest("http://localhost/api/cron/lite?job=notify_b", {
        method: "POST",
        headers: { authorization: "Bearer s" },
      }));
      expect(res.status).toBe(200);
      expect(order).toEqual(["checkout_pin_emails", "whatsapp_outbox"]);
    } finally {
      fx.close();
      vi.doUnmock("@/lib/whatsapp/promo-digest");
      vi.doUnmock("@/lib/whatsapp/promo-bot");
      vi.doUnmock("@/lib/payments/qris-expiry-notifications");
      vi.doUnmock("@/lib/telegram/order-notifications");
      vi.doUnmock("@/lib/orders/access-email");
      vi.doUnmock("@/lib/whatsapp/outbox");
    }
  });
});
