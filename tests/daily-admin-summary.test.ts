import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import {
  DAILY_ADMIN_SUMMARY_STATE_KEY,
  sendDueDailyAdminSummary,
} from "@/lib/telegram/daily-admin-summary";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubTelegram(enabled = "true", ok = true) {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", enabled);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100123");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-fixture-token");
  const messages: { chat_id: string; text: string; parse_mode?: string }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("api.telegram.org")) {
      if (!ok) {
        return Response.json({ ok: false, description: "telegram_unavailable" }, { status: 502 });
      }
      messages.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ ok: true, result: { message_id: messages.length } });
    }
    throw new Error(`Unexpected external fetch (must not call supplier API): ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { messages, fetchMock };
}

describe("sendDueDailyAdminSummary", () => {
  it("respects WIB window (not due <07:00 or >=12:00, due 07:00-11:59) with 0 D1 reads when not due", async () => {
    const fx = createD1Fixture();
    try {
      const { messages, fetchMock } = stubTelegram("true");

      // 06:59 WIB on 2026-11-18 = 2026-11-17T23:59:00Z
      const b0 = createBudgetedDatabase(12, 0, fx.db);
      const early = await sendDueDailyAdminSummary(b0.access, { now: new Date("2026-11-17T23:59:00Z") });
      expect(early).toEqual({ due: false, sent: false });
      expect(b0.used).toBe(0);

      // 12:00 WIB on 2026-11-18 = 2026-11-18T05:00:00Z
      const b1 = createBudgetedDatabase(12, 0, fx.db);
      const afternoon = await sendDueDailyAdminSummary(b1.access, { now: new Date("2026-11-18T05:00:00Z") });
      expect(afternoon).toEqual({ due: false, sent: false });
      expect(b1.used).toBe(0);

      // 11:59 WIB (late catch-up inside window) = 2026-11-18T04:59:00Z
      const b2 = createBudgetedDatabase(12, 0, fx.db);
      const lateWindow = await sendDueDailyAdminSummary(b2.access, { now: new Date("2026-11-18T04:59:00Z") });
      expect(lateWindow).toMatchObject({ due: true, sent: true, date: "2026-11-18" });
      expect(b2.used).toBeLessThanOrEqual(12);
      expect(messages).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fx.close();
    }
  });

  it("skips when TELEGRAM_BOT_ENABLED is not true or credentials are missing", async () => {
    const fx = createD1Fixture();
    try {
      const { messages } = stubTelegram("false");
      const b = createBudgetedDatabase(12, 0, fx.db);
      const res = await sendDueDailyAdminSummary(b.access, { now: new Date("2026-11-18T00:05:00Z") });
      expect(res).toEqual({ due: true, sent: false, skipped: "disabled", date: "2026-11-18" });
      expect(b.used).toBe(0);
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("sends at most once per WIB date (isolate memo + D1 state) and prevents parallel duplicates via CAS", async () => {
    const fx = createD1Fixture();
    try {
      const { messages } = stubTelegram("true");
      const at0700Wib = new Date("2026-11-18T00:00:00Z");

      // Race 4 parallel callers with separate DatabaseAccess wrappers on same D1
      const results = await Promise.all(
        Array.from({ length: 4 }, () => sendDueDailyAdminSummary(createDatabaseAccess(fx.db), { now: at0700Wib })),
      );
      expect(results.filter((r) => r.sent)).toHaveLength(1);
      expect(messages).toHaveLength(1);

      // Subsequent call in same isolate uses 0 D1 statements
      const bMemo = createBudgetedDatabase(12, 0, fx.db);
      const again = await sendDueDailyAdminSummary(bMemo.access, { now: new Date("2026-11-18T00:15:00Z") });
      expect(again).toEqual({ due: true, sent: false, skipped: "already_sent", date: "2026-11-18" });
      expect(bMemo.used).toBe(0);

      // Next WIB day at 07:00 WIB -> sends again
      const nextDay = await sendDueDailyAdminSummary(createDatabaseAccess(fx.db), {
        now: new Date("2026-11-19T00:00:00Z"),
      });
      expect(nextDay).toMatchObject({ due: true, sent: true, date: "2026-11-19" });
      expect(messages).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("releases CAS claim on Telegram send failure so next tick can retry, and yields on tight query budget", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegram("true", false);
      const t0 = new Date("2026-11-18T00:00:00Z");
      const failed = await sendDueDailyAdminSummary(createDatabaseAccess(fx.db), { now: t0 });
      expect(failed).toMatchObject({ due: true, sent: false, skipped: "send_failed", date: "2026-11-18" });

      // Next tick with Telegram recovered succeeds
      const { messages } = stubTelegram("true", true);
      const retried = await sendDueDailyAdminSummary(createDatabaseAccess(fx.db), {
        now: new Date("2026-11-18T00:01:00Z"),
      });
      expect(retried).toMatchObject({ due: true, sent: true, date: "2026-11-18" });
      expect(messages).toHaveLength(1);

      // Budget too tight on new day -> yields cleanly without marking sent
      const bTight = createBudgetedDatabase(3, 0, fx.db);
      const yielded = await sendDueDailyAdminSummary(bTight.access, { now: new Date("2026-11-19T00:00:00Z") });
      expect(yielded).toEqual({ due: true, sent: false, skipped: "query_budget", date: "2026-11-19" });
      expect(messages).toHaveLength(1);
    } finally {
      fx.close();
    }
  });

  it("renders all 5 sections accurately (yesterday WIB, stuck >30m, stored balances, sync 24h+active, top 5 low-stock <=2) within <=12 statements", async () => {
    const fx = createD1Fixture();
    try {
      const { messages } = stubTelegram("true");
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "k");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_API_KEY", "k");

      // Now = 2026-11-18 07:05 WIB = 2026-11-18T00:05:00Z
      // Yesterday WIB = 2026-11-17 (UTC range 2026-11-16T17:00:00Z .. 2026-11-17T16:59:59Z)
      const now = new Date("2026-11-18T00:05:00Z");
      const nowMs = now.getTime();

      // Products + variants + inventory + group loser
      fx.sql.exec(`
        INSERT INTO products (id, name, slug, price, stock, is_active, fulfillment_mode) VALUES
          (1, 'ChatGPT Plus', 'chatgpt-plus', 50000, 1, 1, 'manual'),
          (2, 'Canva Unique', 'canva-unique', 20000, 5, 1, 'unique'),
          (3, 'Netflix Unlimited', 'netflix-unlimited', 30000, -1, 1, 'manual'),
          (4, 'CapCut Pro', 'capcut-pro', 15000, 2, 1, 'manual'),
          (5, 'Spotify Duo', 'spotify-duo', 18000, 0, 1, 'manual'),
          (6, 'Viu Premium', 'viu-premium', 10000, 1, 1, 'manual'),
          (7, 'Disney+ Hotstar', 'disney', 25000, 2, 1, 'manual'),
          (8, 'Youtube Stock 3', 'yt-stock-3', 20000, 3, 1, 'manual'),
          (9, 'Archived Low', 'archived-low', 10000, 1, 0, 'manual'),
          (10, 'Group Loser', 'group-loser', 10000, 1, 1, 'manual'),
          (11, 'Inactive Low', 'inactive-low', 10000, 1, 0, 'manual');
        UPDATE products SET archived_at = '2026-11-01T00:00:00Z' WHERE id = 9;

        INSERT INTO product_variants (id, product_id, sku, label, price, stock, fulfillment_mode, is_active) VALUES
          (1, 1, 'SKU-1', '1B', 50000, 1, 'manual', 1),
          (2, 2, 'SKU-2', '1B', 20000, 5, 'unique', 1),
          (3, 3, 'SKU-3', '1B', 30000, -1, 'manual', 1),
          (4, 4, 'SKU-4', '1B', 15000, 2, 'manual', 1),
          (5, 5, 'SKU-5', '1B', 18000, 0, 'manual', 1),
          (6, 6, 'SKU-6', '1B', 10000, 1, 'manual', 1),
          (7, 7, 'SKU-7', '1B', 25000, 2, 'manual', 1),
          (8, 8, 'SKU-8', '1B', 20000, 3, 'manual', 1),
          (9, 9, 'SKU-9', '1B', 10000, 1, 'manual', 0),
          (10, 10, 'SKU-10', '1B', 10000, 1, 'manual', 1),
          (11, 11, 'SKU-11', '1B', 10000, 1, 'manual', 1);

        -- Unique product #2 has stock=5 but only 1 available inventory -> effective stock = 1
        INSERT INTO fulfillment_inventory (product_id, variant_id, secret_ciphertext, secret_iv, secret_fingerprint, status) VALUES
          (2, 2, 'enc', 'iv', 'fp-1', 'available');

        -- Group making product #10 a loser (winner = #1)
        INSERT INTO product_groups (id, name, winner_product_id) VALUES (1, 'Grp1', 1);
        INSERT INTO product_group_members (group_id, product_id, position) VALUES (1, 1, 0), (1, 10, 1);
      `);

      // Yesterday paid orders (2 web, 1 telegram) + today paid order (must be excluded from yesterday) + 2 days ago
      fx.sql.exec(`
        INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status, sales_channel, paid_at, created_at, updated_at) VALUES
          ('ORD-Y1', 'A', '6281', '[{"product_id":1,"variant_id":1,"qty":10}]', 50000, 'qris', 'lunas', 'paid', 'web', '2026-11-16 18:00:00', '2026-11-16 17:55:00', '2026-11-16 18:00:00'),
          ('ORD-Y2', 'B', '6282', '[{"product_id":2,"variant_id":2,"qty":8},{"product_id":3,"variant_id":3,"qty":20}]', 100000, 'qris', 'lunas', 'paid', 'telegram', '2026-11-17 16:30:00', '2026-11-17 16:25:00', '2026-11-17 16:30:00'),
          ('ORD-Y3', 'C', '6283', '[{"product_id":4,"variant_id":4,"qty":6},{"product_id":5,"variant_id":5,"qty":5},{"product_id":6,"variant_id":6,"qty":4},{"product_id":7,"variant_id":7,"qty":2},{"product_id":8,"variant_id":8,"qty":15},{"product_id":9,"variant_id":9,"qty":20},{"product_id":10,"variant_id":10,"qty":20},{"product_id":11,"variant_id":11,"qty":20}]', 75000, 'qris', 'lunas', 'paid', 'web', '2026-11-17 05:00:00', '2026-11-17 04:55:00', '2026-11-17 05:00:00'),
          ('ORD-TODAY', 'D', '6284', '[{"product_id":7,"variant_id":7,"qty":1}]', 25000, 'qris', 'lunas', 'paid', 'web', '2026-11-17 17:05:00', '2026-11-17 17:00:00', '2026-11-17 17:05:00'),
          ('ORD-EXP', 'E', '6285', '[]', 10000, 'qris', 'kadaluarsa', 'expired', 'web', NULL, '2026-11-17 02:00:00', '2026-11-17 02:15:00'),
          ('ORD-CAN', 'F', '6286', '[]', 10000, 'qris', 'dibatalkan', 'failed', 'telegram', NULL, '2026-11-17 03:00:00', '2026-11-17 03:05:00');
        -- ORD-Y2 has payable_amount 100123 in payment_transactions
        INSERT INTO payment_transactions (order_code, provider, provider_mode, provider_order_id, merchant_id, requested_amount, payable_amount, status, paid_at) VALUES
          ('ORD-Y2', 'gopay', 'qris', 'po-y2', 'm-1', 100000, 100123, 'paid', '2026-11-17 16:30:00');
      `);

      // Stuck orders (>30m before 2026-11-18T00:05:00Z = <= 2026-11-17 23:35:00, and ORD-Y1/ORD-Y3 are >30m while ORD-TODAY is 17:05 which is also >30m vs 00:05; add a fresh 5m order ORD-FRESH to test exclusion)
      fx.sql.exec(`
        INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status, sales_channel, paid_at, created_at, updated_at) VALUES
          ('ORD-FRESH', 'G', '6287', '[]', 10000, 'qris', 'lunas', 'paid', 'web', '2026-11-18 00:00:00', '2026-11-17 23:55:00', '2026-11-18 00:00:00');
        INSERT INTO fulfillment_items (order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status) VALUES
          ('ORD-Y1', 0, 1, 1, 1, 'manual', 'manual_required'),
          ('ORD-FRESH', 0, 1, 1, 1, 'manual', 'queued');
        INSERT INTO wr_order_links (order_code, wr_variant_id, quantity, wr_cost, status) VALUES
          ('ORD-Y2', 'wrv-1', 1, 10000, 'processing');
        INSERT INTO dana_webhook_events (event_key, payload_hash, amount, status) VALUES
          ('ev-1', 'h1', 10000, 'received');
      `);

      // Stored supplier balances
      fx.sql.exec(`
        INSERT INTO wr_saldo_log (balance, source) VALUES (150000, 'api_check');
        INSERT INTO sk_saldo_log (balance, source) VALUES (400000, 'api_check');
        INSERT INTO pedia_supplier_balance_log (supplier, balance) VALUES ('indosmm', 80000);
        INSERT INTO store_settings (key, value) VALUES
          ('tunvn_balance_last_value', '3.5'),
          ('aivault_balance_last_value', '12'),
          ('mirai_balance_last_value', '4.2'),
          ('mirai_balance_error', '{"error":"http_503","streak":2}'),
          ('tunvn_catalog_success_at', '${nowMs - 60_000}'),
          ('tunvn_buff_sync_at', '${nowMs - 45 * 60_000}'),
          ('tunvn_buff_last_error', '{"error":"upstream_<502>&bad"}'),
          ('sync_stale_state_sk', '{"last_stale_at":${nowMs - 4 * 3_600_000},"last_recovered_at":${nowMs - 3 * 3_600_000}}');
        INSERT INTO sk_sync_state (key, value) VALUES ('diff_last_at', '${new Date(nowMs - 2 * 60_000).toISOString()}');
      `);

      const budgeted = createBudgetedDatabase(12, 0, fx.db);
      const res = await sendDueDailyAdminSummary(budgeted.access, { now });
      expect(res.sent).toBe(true);
      expect(budgeted.used).toBeLessThanOrEqual(12);
      expect(messages).toHaveLength(1);

      const text = messages[0].text;
      // Section 1: yesterday WIB (3 paid, Rp225.123, web 2 Rp125.000, telegram 1 Rp100.123, 1 expired, 1 cancelled)
      expect(text).toContain("Order lunas: <b>3</b>");
      expect(text).toContain("Rp225.123");
      expect(text).toContain("Web 2 (Rp125.000)");
      expect(text).toContain("Telegram 1 (Rp100.123)");
      expect(text).toContain("Kadaluarsa: 1 · Dibatalkan: 1");

      // Section 2: stuck >30m (ORD-Y1, ORD-Y2 — NOT ORD-FRESH) + payment attention 1
      expect(text).toContain("<b>2</b> order: <code>ORD-Y1</code>, <code>ORD-Y2</code>");
      expect(text).not.toContain("ORD-FRESH");
      expect(text).toContain("Rekonsiliasi QRIS perlu cek: <b>1</b>");

      // Section 3: stored balances with low markers
      expect(text).toContain("WR: <b>Rp150.000</b> ⚠️");
      expect(text).toContain("SK: <b>Rp400.000</b>");
      expect(text).not.toContain("SK: <b>Rp400.000</b> ⚠️");
      expect(text).toContain("IndoSMM: <b>Rp80.000</b> ⚠️");
      expect(text).toContain("TUNVN: <b>3.50 USDT</b> ⚠️");
      expect(text).toContain("AIVault: <b>$12</b>");
      expect(text).toContain("Mirai: <b>4.20 USDT</b> ⚠️");
      expect(text).toContain("http_503 (2x)");

      // Section 4: stale Buff only (HTML-escaped error) + recovered in 24h (Sekalipay)
      expect(text).toContain("Basi saat ini: <b>TUNVN (Muse Buff)</b> (45 menit)");
      expect(text).not.toContain("<b>TUNVN</b> (");
      expect(text).toContain("upstream_&lt;502&gt;&amp;bad");
      expect(text).toContain("Sempat basi 24j terakhir (pulih): Sekalipay");

      // Section 5: top 5 low-stock <=2 active non-loser (order: ChatGPT Plus #1 sold 10, Canva Unique #2 sold 8 effective 1, CapCut #4 sold 6, Spotify #5 sold 5, Viu #6 sold 4; excludes Disney #7 (6th), Netflix (-1), Youtube (stock 3), Archived #9, Group Loser #10)
      expect(text).toContain("<b>ChatGPT Plus</b> — stok <b>1</b> (terjual 30h: 10)");
      expect(text).toContain("<b>Canva Unique</b> — stok <b>1</b> (terjual 30h: 8)");
      expect(text).toContain("<b>CapCut Pro</b> — stok <b>2</b> (terjual 30h: 6)");
      expect(text).toContain("<b>Spotify Duo</b> — stok <b>0</b> (terjual 30h: 5)");
      expect(text).toContain("<b>Viu Premium</b> — stok <b>1</b> (terjual 30h: 4)");
      expect(text).not.toContain("Disney+ Hotstar");
      expect(text).not.toContain("Netflix Unlimited");
      expect(text).not.toContain("Youtube Stock 3");
      expect(text).not.toContain("Archived Low");
      expect(text).not.toContain("Group Loser");
      expect(text).not.toContain("Inactive Low");

      const savedRow = fx.sql
        .prepare("SELECT value FROM store_settings WHERE key=?")
        .get(DAILY_ADMIN_SUMMARY_STATE_KEY) as { value: string };
      expect(JSON.parse(savedRow.value)).toMatchObject({ sent_date: "2026-11-18" });
    } finally {
      fx.close();
    }
  });

  it("integrates cleanly into POST /api/cron/lite?job=promo at 07:05 WIB", async () => {
    const fx = createD1Fixture();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-18T00:05:00Z")); // 07:05 WIB
      vi.stubEnv("CRON_SECRET", "s");
      const { messages } = stubTelegram("true");

      const { POST } = await import("@/app/api/cron/lite/route");
      const { NextRequest } = await import("next/server");
      const res = await POST(
        new NextRequest("http://localhost/api/cron/lite?job=promo", {
          method: "POST",
          headers: { authorization: "Bearer s" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: true,
        job: "promo",
        promo_due: false,
        daily_summary: { due: true, sent: true, date: "2026-11-18" },
      });
      expect(messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });

  it("excludes manually delivered tunvn/aivault/storebat/mirai links from stuck >30m alerts while keeping undelivered needs_admin", async () => {
    const fx = createD1Fixture();
    try {
      const { messages } = stubTelegram("true");
      const now = new Date("2026-11-19T00:05:00Z"); // 07:05 WIB
      fx.sql.exec(`
        INSERT INTO products (id, name, slug, price, stock, is_active, fulfillment_mode) VALUES (1, 'Buff', 'buff', 15000, 10, 1, 'manual');
        INSERT INTO product_variants (id, product_id, sku, label, price, stock, fulfillment_mode, is_active) VALUES (1, 1, 'SKU-1', '10B', 15000, 10, 'manual', 1);
        INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status, sales_channel, paid_at, created_at, updated_at) VALUES
          ('AXV-20261119-0FC3511A', 'A', '628', '[]', 15000, 'qris', 'lunas', 'paid', 'web', '2026-11-18 10:00:00', '2026-11-18 09:55:00', '2026-11-18 10:00:00'),
          ('AXV-20261119-STUCK001', 'B', '628', '[]', 15000, 'qris', 'lunas', 'paid', 'web', '2026-11-18 10:00:00', '2026-11-18 09:55:00', '2026-11-18 10:00:00');
        INSERT INTO fulfillment_items (order_code, item_index, product_id, variant_id, qty, fulfillment_mode, status) VALUES
          ('AXV-20261119-0FC3511A', 0, 1, 1, 10, 'manual', 'delivered'),
          ('AXV-20261119-0FC3511A', 1, 1, 1, 1, 'manual', 'delivered'),
          ('AXV-20261119-0FC3511A', 2, 1, 1, 1, 'manual', 'delivered'),
          ('AXV-20261119-0FC3511A', 3, 1, 1, 1, 'manual', 'delivered'),
          ('AXV-20261119-STUCK001', 0, 1, 1, 1, 'manual', 'manual_required');
        INSERT INTO tunvn_order_links (order_code, item_index, variant_id, product_id, kind, quantity, cost_usdt, status) VALUES
          ('AXV-20261119-0FC3511A', 0, 1, 1, 'buff', 10, 0.583, 'needs_admin'),
          ('AXV-20261119-STUCK001', 0, 1, 1, 'account', 1, 1, 'needs_admin');
        INSERT INTO aivault_order_links (order_code, item_index, variant_id, product_id, service_id, quantity, cost_usd, external_order_id, status)
          VALUES ('AXV-20261119-0FC3511A', 1, 1, 1, 'svc', 1, 0.5, 'av-1', 'needs_admin');
        INSERT INTO storebat_order_links (order_code, item_index, variant_id, product_id, storebat_product_id, kind, quantity, cost_usd, fx_idr_per_usd, idempotency_key, status)
          VALUES ('AXV-20261119-0FC3511A', 2, 1, 1, 55, 'product', 1, 0.5, 16000, 'sb-1', 'needs_admin');
        INSERT INTO mirai_order_links (order_code, item_index, variant_id, product_id, package_code, quantity, cost_usdt, external_order_id, idempotency_key, status)
          VALUES ('AXV-20261119-0FC3511A', 3, 1, 1, 'PKG', 1, 0.5, 'mr-1', 'mr-k1', 'needs_admin');
      `);
      const res = await sendDueDailyAdminSummary(createDatabaseAccess(fx.db), { now });
      expect(res).toMatchObject({ due: true, sent: true });
      expect(messages).toHaveLength(1);
      expect(messages[0].text).not.toContain("AXV-20261119-0FC3511A");
      expect(messages[0].text).toContain("AXV-20261119-STUCK001");
    } finally {
      fx.close();
    }
  });
});
