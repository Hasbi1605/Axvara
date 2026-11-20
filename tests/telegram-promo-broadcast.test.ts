import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { enqueueDueTelegramPromo, promoCampaignId, TELEGRAM_PROMO_SETTINGS_KEY } from "@/lib/telegram/promo-broadcast";
import { TELEGRAM_PROMO_FOOTER } from "@/lib/telegram/promo-digest";
import { listBroadcasts } from "@/lib/broadcasts/store";
import { processBroadcasts } from "@/lib/broadcasts/worker";
import { UUID } from "@/lib/broadcasts/model";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function seedCatalogAndUsers(fx: ReturnType<typeof createD1Fixture>) {
  fx.sql.exec(`
    INSERT INTO products(id, name, slug, price, stock, is_active) VALUES
      (1, 'Canva Pro', 'canva-pro', 15000, 5, 1),
      (2, 'ChatGPT Plus', 'chatgpt-plus', 95000, -1, 1),
      (3, 'Netflix UHD', 'netflix-uhd', 35000, 3, 1);
    INSERT INTO product_variants(product_id, sku, label, price, stock, is_active) VALUES
      (1, 'CNV-1', '1 Bulan', 15000, 5, 1),
      (2, 'GPT-1', '1 Bulan', 95000, -1, 1),
      (3, 'NFX-1', '1 Bulan', 35000, 3, 1);
    INSERT INTO telegram_users(user_id, chat_id, is_blocked, broadcast_opt_out) VALUES
      ('101', '101', 0, 0),
      ('102', '102', 0, 0),
      ('103', '103', 1, 0),
      ('104', '104', 0, 1),
      ('-100999', '-100999', 0, 0),
      ('bad_id', 'bad_id', 0, 0);
  `);
}

describe("Telegram automatic promo broadcast", () => {
  it("enqueues once per (businessDate, slot), freezes snapshot, hides system template, and delivers one bubble (banner preview + HTML) with /stop footer", async () => {
    const fx = createD1Fixture();
    try {
      seedCatalogAndUsers(fx);
      vi.useFakeTimers({ toFake: ["Date"] });
      const morningTime = new Date("2026-11-19T02:05:00Z"); // 09:05 WIB
      vi.setSystemTime(morningTime);
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
      vi.stubEnv("SITE_URL", "https://axvara.tech");

      const db = createDatabaseAccess(fx.db);
      const first = await enqueueDueTelegramPromo(db, morningTime);
      expect(first).toMatchObject({
        due: true,
        enqueued: 2,
        campaignId: promoCampaignId("2026-11-19", "morning"),
      });
      expect(UUID.test(first.campaignId!)).toBe(true);

      // Repeated ticks in same slot are idempotent (no duplicate deliveries, no second campaign)
      const second = await enqueueDueTelegramPromo(db, new Date("2026-11-19T02:10:00Z"));
      expect(second).toMatchObject({ due: true, enqueued: 0, skipped: "already_enqueued" });
      expect((fx.sql.prepare("SELECT count(*) AS n FROM broadcast_campaigns").get() as { n: number }).n).toBe(1);
      expect((fx.sql.prepare("SELECT count(*) AS n FROM broadcast_deliveries").get() as { n: number }).n).toBe(2);

      // Snapshot is frozen at enqueue time: mutating product price does not alter queued deliveries
      fx.sql.exec("UPDATE product_variants SET price = 999999");

      // listBroadcasts hides the internal system template but shows the promo campaign
      const adminList = await listBroadcasts(db);
      expect(adminList.templates).toHaveLength(0);
      expect(adminList.campaigns).toHaveLength(1);
      expect(adminList.campaigns[0].content.title).toBe("Promo otomatis pagi 2026-11-19");

      // Mock Telegram API fetch for processBroadcasts
      const tgCalls: { method: string; body: Record<string, unknown> }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (!u.includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${u}`);
        const method = u.split("/").pop() || "";
        const body = JSON.parse(String(init?.body ?? "{}"));
        tgCalls.push({ method, body });
        return Response.json({ ok: true, result: { message_id: tgCalls.length } });
      }));

      const workerResult = await processBroadcasts(db, 8, 20000);
      expect(workerResult).toMatchObject({ sent: 2, skipped: 0, unknown: 0, failed: 0 });
      // One bubble per user: no sendPhoto, banner rides as a large link
      // preview above the text, and the slot header appears exactly once.
      expect(tgCalls).toHaveLength(2);
      expect(tgCalls.some((c) => c.method === "sendPhoto")).toBe(false);
      expect(tgCalls[0]).toMatchObject({
        method: "sendMessage",
        body: {
          chat_id: "101",
          parse_mode: "HTML",
          link_preview_options: {
            url: "https://axvara.tech/banners/ready-promo.jpg",
            prefer_large_media: true,
            show_above_text: true,
          },
        },
      });
      expect(tgCalls[0].body).not.toHaveProperty("disable_web_page_preview");
      const text = String(tgCalls[0].body.text);
      expect(text.split("PRODUK AXVARA READY PAGI INI")).toHaveLength(2);
      expect(text).toContain("Rp15.000");
      expect(text).not.toContain("999.999");
      expect(text).toContain(TELEGRAM_PROMO_FOOTER);
    } finally {
      fx.close();
    }
  });

  it("skips remaining unsent deliveries when slot ends (12:00 / 20:00 WIB) instead of sending late", async () => {
    const fx = createD1Fixture();
    try {
      seedCatalogAndUsers(fx);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-19T04:55:00Z")); // 11:55 WIB
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");

      const db = createDatabaseAccess(fx.db);
      const enq = await enqueueDueTelegramPromo(db);
      expect(enq.enqueued).toBe(2);

      // Advance past 12:00 WIB (05:00Z) before worker sends
      vi.setSystemTime(new Date("2026-11-19T05:00:00Z"));
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const res = await processBroadcasts(db, 8, 20000);
      expect(res.sent).toBe(0);
      expect(res.skipped).toBe(2);
      expect(fetchMock).not.toHaveBeenCalled();

      const rows = fx.sql.prepare("SELECT status, last_error FROM broadcast_deliveries").all() as { status: string; last_error: string }[];
      expect(rows).toEqual([
        { status: "skipped", last_error: "promo_slot_expired" },
        { status: "skipped", last_error: "promo_slot_expired" },
      ]);
      expect((fx.sql.prepare("SELECT status FROM broadcast_campaigns").get() as { status: string }).status).toBe("completed");
    } finally {
      fx.close();
    }
  });

  it("respects store_settings kill switch, env gates, and minimum 3 ready products", async () => {
    const fx = createD1Fixture();
    try {
      seedCatalogAndUsers(fx);
      const db = createDatabaseAccess(fx.db);
      const slotTime = new Date("2026-11-19T10:15:00Z"); // 17:15 WIB

      // Missing env -> disabled
      expect(await enqueueDueTelegramPromo(db, slotTime)).toMatchObject({ due: true, enqueued: 0, skipped: "disabled" });

      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");

      // Kill switch = 'false' -> disabled
      fx.sql.prepare("INSERT INTO store_settings(key, value) VALUES(?, 'false')").run(TELEGRAM_PROMO_SETTINGS_KEY);
      expect(await enqueueDueTelegramPromo(db, slotTime)).toMatchObject({ due: true, enqueued: 0, skipped: "disabled" });

      // Kill switch = 'true' -> enabled, but <3 products -> insufficient_products
      fx.sql.prepare("UPDATE store_settings SET value='true' WHERE key=?").run(TELEGRAM_PROMO_SETTINGS_KEY);
      fx.sql.exec("UPDATE products SET is_active=0 WHERE id > 2");
      expect(await enqueueDueTelegramPromo(db, slotTime)).toMatchObject({ due: true, enqueued: 0, skipped: "insufficient_products" });

      // Reactivate 3rd product -> enqueues evening slot
      fx.sql.exec("UPDATE products SET is_active=1");
      const enq = await enqueueDueTelegramPromo(db, slotTime);
      expect(enq).toMatchObject({ due: true, enqueued: 2 });
    } finally {
      fx.close();
    }
  });

  it("retries a rate-limited one-bubble promo once and quarantines ambiguous send via processBroadcasts", async () => {
    const fx = createD1Fixture();
    try {
      seedCatalogAndUsers(fx);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-19T02:05:00Z"));
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");

      const db = createDatabaseAccess(fx.db);
      await enqueueDueTelegramPromo(db);

      const calls: string[] = [];
      let callIndex = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const method = String(url).split("/").pop() || "";
        calls.push(method);
        callIndex++;
        // Pass 1 (user 101): message 429 (#1) -> global cooldown, deferring 102
        if (callIndex === 1) return Response.json({ ok: false, error_code: 429, parameters: { retry_after: 5 } });
        // Pass 2: user 101 message ok (#2); user 102 message timeout (#3) -> unknown
        if (callIndex === 2) return Response.json({ ok: true, result: { message_id: 600 } });
        return Response.json({ ok: false, description: "timeout" });
      }));

      const firstPass = await processBroadcasts(db, 8, 20000);
      expect(firstPass).toMatchObject({ deferred: 1, unknown: 0, sent: 0 });
      expect(calls).toEqual(["sendMessage"]);

      // Advance past retry_after (5s)
      vi.setSystemTime(new Date("2026-11-19T02:05:10Z"));
      calls.length = 0;
      const secondPass = await processBroadcasts(db, 8, 20000);
      // One sendMessage each; user 102 timeout -> unknown (never blindly resent)
      expect(secondPass).toMatchObject({ sent: 1, deferred: 0, unknown: 1 });
      expect(calls).toEqual(["sendMessage", "sendMessage"]);

      // Pass 3: user 102 stays unknown and is never retried blindly
      vi.setSystemTime(new Date("2026-11-19T02:06:00Z"));
      calls.length = 0;
      const thirdPass = await processBroadcasts(db, 8, 20000);
      expect(thirdPass).toMatchObject({ sent: 0, deferred: 0, unknown: 0 });
      expect(calls).toEqual([]);

      const statuses = fx.sql.prepare("SELECT recipient_id, status FROM broadcast_deliveries ORDER BY recipient_id").all();
      expect(statuses).toEqual([
        { recipient_id: "101", status: "sent" },
        { recipient_id: "102", status: "unknown" },
      ]);
    } finally {
      fx.close();
    }
  });

  it("cron/lite?job=promo stays within 40-statement budget and cron/operations never runs admin digest", async () => {
    const fx = createD1Fixture();
    try {
      seedCatalogAndUsers(fx);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-19T02:05:00Z")); // 09:05 WIB
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
      vi.stubEnv("TELEGRAM_PROMO_DIGEST_ENABLED", "true");
      vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1001");
      fx.sql.prepare("INSERT INTO store_settings (key, value) VALUES ('admin_daily_summary_state', ?)").run(
        JSON.stringify({ sent_date: "2026-11-19", sent_at: "2026-11-19T00:00:00.000Z" }),
      );

      const sentChatIds: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!String(url).includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${String(url)}`);
        const body = JSON.parse(String(init?.body ?? "{}"));
        sentChatIds.push(String(body.chat_id));
        return Response.json({ ok: true, result: { message_id: sentChatIds.length } });
      }));

      // Test budgeted DB directly for enqueue + dispatch <= 38 statements
      const budgeted = createBudgetedDatabase(40, 2, fx.db);
      const enq = await enqueueDueTelegramPromo(budgeted.access);
      expect(enq.enqueued).toBe(2);
      const disp = await processBroadcasts(budgeted.access, 8, 20000);
      expect(disp.sent).toBe(2);
      expect(budgeted.used).toBeLessThanOrEqual(38);
      // Never sent to admin chat -1001! Only to user 101 and 102
      expect(sentChatIds).toEqual(["101", "102"]);

      // Also verify POST /api/cron/operations?phase=notify does NOT send admin promo digest
      sentChatIds.length = 0;
      const { POST: opsPost } = await import("@/app/api/cron/operations/route");
      const { NextRequest } = await import("next/server");
      const opsRes = await opsPost(
        new NextRequest("http://localhost/api/cron/operations?phase=notify", {
          method: "POST",
          headers: { authorization: "Bearer s" },
        }),
      );
      expect(opsRes.status).toBe(200);
      const opsBody = (await opsRes.json()) as Record<string, unknown>;
      expect(opsBody).not.toHaveProperty("telegram_promo_full_sent");
      expect(opsBody).not.toHaveProperty("telegram_promo_short_sent");
      expect(sentChatIds).not.toContain("-1001");
    } finally {
      fx.close();
    }
  });
});
