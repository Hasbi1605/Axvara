import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { POST as webhookPost } from "@/app/api/telegram/webhook/route";
import { GET as channelApiGet, POST as channelApiPost } from "@/app/api/admin/telegram/channel/route";
import { GET as botHealthGet } from "@/app/api/admin/bot/health/route";
import {
  clearTelegramChannelConfigMemo,
  saveTelegramChannelConfig,
  TELEGRAM_CHANNEL_CONFIG_KEY,
} from "@/lib/telegram/force-sub";
import { enqueueDueTelegramPromo, TELEGRAM_PROMO_SETTINGS_KEY } from "@/lib/telegram/promo-broadcast";
import { TELEGRAM_PROMO_FOOTER } from "@/lib/telegram/promo-digest";
import { launchBroadcast, reviewBroadcast } from "@/lib/broadcasts/store";
import { processBroadcasts } from "@/lib/broadcasts/worker";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (file: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      all: (...p: unknown[]) => Record<string, unknown>[];
      run: (...p: unknown[]) => unknown;
    };
    close: () => void;
  };
};

type TgCall = { method: string; body: Record<string, unknown> };

function makeWebhookReq(update: Record<string, unknown>) {
  return new NextRequest("https://axvara.tech/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "test-webhook-secret",
    },
    body: JSON.stringify(update),
  });
}

describe("Migration 0169 — telegram channel & force-sub schema", () => {
  it("adds channel_joined_checked_at, widens broadcast_deliveries CHECK preserving rows/indexes, and seeds @axvaratech", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE store_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE telegram_users (
          user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, username TEXT, first_name TEXT, last_name TEXT,
          is_blocked INTEGER NOT NULL DEFAULT 0, broadcast_opt_out INTEGER NOT NULL DEFAULT 0,
          pending_action TEXT DEFAULT NULL, buyer_email TEXT DEFAULT NULL,
          locale TEXT CHECK (locale IN ('id','en')), display_currency TEXT CHECK (display_currency IN ('IDR','USD')),
          created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE broadcast_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, cta_label TEXT NOT NULL DEFAULT '', cta_url TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE broadcast_campaigns (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES broadcast_templates(id), template_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, channels_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('preparing','queued','completed','canceled')), created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE broadcast_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL REFERENCES broadcast_campaigns(id),
          channel TEXT NOT NULL CHECK(channel IN ('whatsapp','email','telegram')),
          recipient_id TEXT NOT NULL, destination TEXT NOT NULL, unsubscribe_token TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','unknown','skipped','canceled')),
          attempts INTEGER NOT NULL DEFAULT 0, first_attempt_at TEXT, next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
          lease_until TEXT, provider_id TEXT, last_error TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(campaign_id,channel,recipient_id)
        );
        CREATE INDEX idx_broadcast_delivery_due ON broadcast_deliveries(status,julianday(next_attempt_at),id);
        CREATE INDEX idx_broadcast_delivery_campaign ON broadcast_deliveries(campaign_id,channel,status);
        INSERT INTO broadcast_templates(id,name,title,body) VALUES ('t1','Promo','Judul','Isi');
        INSERT INTO broadcast_campaigns(id,fingerprint,template_id,template_revision,snapshot_json,channels_json,status,created_by)
          VALUES ('c1','fp1','t1',1,'{}','["telegram"]','completed','admin');
        INSERT INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination,status)
          VALUES ('c1','telegram','101','101','sent');
      `);

      const sql = fs.readFileSync(
        path.join(process.cwd(), "drizzle/migrations/0169_telegram_channel_and_force_sub.sql"),
        "utf8",
      );
      db.exec(sql);

      const tgCols = db.prepare("PRAGMA table_info(telegram_users)").all().map((r) => String(r.name));
      expect(tgCols).toContain("channel_joined_checked_at");

      // Existing row survived
      expect(db.prepare("SELECT channel, recipient_id, status FROM broadcast_deliveries").all()).toEqual([
        { channel: "telegram", recipient_id: "101", status: "sent" },
      ]);
      // New channel 'telegram_channel' is accepted
      db.prepare(
        "INSERT INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination,status) VALUES ('c1','telegram_channel','channel','@axvaratech','pending')",
      ).run();
      expect(db.prepare("SELECT count(*) AS n FROM broadcast_deliveries").get()?.n).toBe(2);

      // Both indexes preserved
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='broadcast_deliveries'").all().map((r) => String(r.name));
      expect(indexes).toContain("idx_broadcast_delivery_due");
      expect(indexes).toContain("idx_broadcast_delivery_campaign");

      // Default production config seeded
      const seeded = JSON.parse(String(db.prepare("SELECT value FROM store_settings WHERE key=?").get(TELEGRAM_CHANNEL_CONFIG_KEY)?.value));
      expect(seeded).toMatchObject({
        channelUsername: "axvaratech",
        channelTitle: "Axvara Official",
        forceSubEnabled: true,
        channelPromoEnabled: true,
      });
    } finally {
      db.close();
    }
  });
});

describe("Smart Force-Join & Telegram Channel broadcasts", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  let tgCalls: TgCall[];
  let memberStatus: "member" | "left" | "error";

  beforeEach(() => {
    fx = createD1Fixture();
    clearTelegramChannelConfigMemo();
    tgCalls = [];
    memberStatus = "left";
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token-fixture");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100999");
    vi.stubEnv("SITE_URL", "https://axvara.tech");
    vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
    vi.stubEnv("ADMIN_JWT_SECRET", "force-sub-test-jwt-secret-123456");

    fx.sql.exec(`
      INSERT OR REPLACE INTO categories(id, name, slug, sort_order) VALUES (1, 'AI & Chatbot', 'ai-chatbot', 1);
      INSERT INTO products(id, name, slug, category_id, price, stock, is_active, telegram_enabled) VALUES
        (42, 'ChatGPT Plus', 'chatgpt-plus', 1, 95000, 10, 1, 1),
        (43, 'Canva Pro', 'canva-pro', 1, 15000, 5, 1, 1),
        (44, 'Netflix UHD', 'netflix-uhd', 1, 35000, 5, 1, 1);
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, is_active) VALUES
        (420, 42, 'GPT-1M', '1 Bulan', 95000, 10, 1),
        (430, 43, 'CNV-1M', '1 Bulan', 15000, 5, 1),
        (440, 44, 'NFX-1M', '1 Bulan', 35000, 5, 1);
    `);

    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("api.telegram.org")) throw new Error(`Unexpected fetch: ${u}`);
      const method = u.split("/").pop() || "";
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      tgCalls.push({ method, body });
      if (method === "getMe") {
        return Response.json({ ok: true, result: { id: 999000, is_bot: true, first_name: "Axvara", username: "Axvara_bot" } });
      }
      if (method === "getChatMember") {
        if (memberStatus === "error") {
          return Response.json({ ok: false, error_code: 400, description: "Bad Request: member list is inaccessible" });
        }
        return Response.json({
          ok: true,
          result: {
            status: memberStatus,
            can_post_messages: memberStatus === "member" ? undefined : false,
          },
        });
      }
      return Response.json({ ok: true, result: { message_id: tgCalls.length } });
    }));
  });

  afterEach(() => {
    clearTelegramChannelConfigMemo();
    fx.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gates /start prd_42 for non-members, alerts on premature fsub:check, resumes product after join + caches subsequent catalog taps", async () => {
    await saveTelegramChannelConfig({
      channelUsername: "axvaratech",
      channelTitle: "Axvara Official",
      forceSubEnabled: true,
      channelPromoEnabled: false,
      cacheTtlSeconds: 21600,
    }, createDatabaseAccess(fx.db));

    // 1. Returning ID user who hasn't joined sends /start prd_42
    fx.sql.exec("INSERT INTO telegram_users(user_id, chat_id, first_name, locale) VALUES ('7001', '7001', 'Budi', 'id')");
    let res = await webhookPost(makeWebhookReq({
      update_id: 1001,
      message: {
        message_id: 10,
        from: { id: 7001, first_name: "Budi" },
        chat: { id: 7001, type: "private" },
        text: "/start prd_42",
        date: 1700000000,
      },
    }));
    expect(res.status).toBe(200);
    expect(tgCalls.some((c) => c.method === "getChatMember" && c.body.chat_id === "@axvaratech" && c.body.user_id === 7001)).toBe(true);
    const gateMsg = tgCalls.find((c) => c.method === "sendMessage" && String(c.body.text).includes("Gabung Channel Dulu"));
    expect(gateMsg).toBeTruthy();
    const kb = (gateMsg?.body.reply_markup as { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] }).inline_keyboard;
    expect(kb[0][0].url).toBe("https://t.me/axvaratech");
    expect(kb[1][0].callback_data).toBe("fsub:check");
    // Payload preserved in pending_action
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='7001'").get()?.pending_action).toBe("onboarding:prd_42");

    // 2. Premature fsub:check before actually joining -> popup alert, still blocked
    tgCalls.length = 0;
    res = await webhookPost(makeWebhookReq({
      update_id: 1002,
      callback_query: {
        id: "cb-not-joined",
        from: { id: 7001, first_name: "Budi" },
        message: { message_id: 11, chat: { id: 7001 } },
        data: "fsub:check",
      },
    }));
    expect(res.status).toBe(200);
    const alertAnswer = tgCalls.find((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === "cb-not-joined");
    expect(alertAnswer?.body.show_alert).toBe(true);
    expect(String(alertAnswer?.body.text)).toContain("@axvaratech");

    // 3. User joins channel -> taps fsub:check -> verified, cache stamped, resumes prd_42!
    memberStatus = "member";
    tgCalls.length = 0;
    res = await webhookPost(makeWebhookReq({
      update_id: 1003,
      callback_query: {
        id: "cb-joined",
        from: { id: 7001, first_name: "Budi" },
        message: { message_id: 11, chat: { id: 7001 } },
        data: "fsub:check",
      },
    }));
    expect(res.status).toBe(200);
    const okAnswer = tgCalls.find((c) => c.method === "answerCallbackQuery" && c.body.callback_query_id === "cb-joined");
    expect(okAnswer?.body.show_alert).toBe(false);
    expect(String(okAnswer?.body.text)).toContain("Terverifikasi");
    // Cache timestamp stamped
    expect(fx.sql.prepare("SELECT channel_joined_checked_at FROM telegram_users WHERE user_id='7001'").get()?.channel_joined_checked_at).toBeTruthy();
    // Resumed ChatGPT Plus product #42
    expect(tgCalls.some((c) => (c.method === "sendMessage" || c.method === "editMessageText") && String(c.body.text).includes("ChatGPT Plus"))).toBe(true);

    // 4. Subsequent /katalog uses 6h D1 cache -> 0 getChatMember API calls!
    tgCalls.length = 0;
    res = await webhookPost(makeWebhookReq({
      update_id: 1004,
      message: {
        message_id: 12,
        from: { id: 7001, first_name: "Budi" },
        chat: { id: 7001, type: "private" },
        text: "/katalog",
        date: 1700000010,
      },
    }));
    expect(res.status).toBe(200);
    expect(tgCalls.filter((c) => c.method === "getChatMember")).toHaveLength(0);
  });

  it("never blocks post-purchase / support commands (/orders, /bantuan, /stop) even when user left channel", async () => {
    await saveTelegramChannelConfig({
      channelUsername: "axvaratech",
      channelTitle: "Axvara Official",
      forceSubEnabled: true,
      channelPromoEnabled: false,
    }, createDatabaseAccess(fx.db));
    fx.sql.exec("INSERT INTO telegram_users(user_id, chat_id, first_name, locale) VALUES ('7002', '7002', 'Siti', 'id')");

    for (const [idx, text] of ["/orders", "/bantuan", "/stop"].entries()) {
      tgCalls.length = 0;
      const res = await webhookPost(makeWebhookReq({
        update_id: 2001 + idx,
        message: {
          message_id: 20 + idx,
          from: { id: 7002, first_name: "Siti" },
          chat: { id: 7002, type: "private" },
          text,
          date: 1700000000 + idx,
        },
      }));
      expect(res.status).toBe(200);
      expect(tgCalls.filter((c) => c.method === "getChatMember")).toHaveLength(0);
      expect(tgCalls.some((c) => String(c.body.text || "").includes("Gabung Channel Dulu"))).toBe(false);
    }
  });

  it("fails open and sends at most one throttled admin warning when getChatMember errors (e.g. bot not admin)", async () => {
    memberStatus = "error";
    await saveTelegramChannelConfig({
      channelUsername: "axvaratech",
      channelTitle: "Axvara Official",
      forceSubEnabled: true,
      channelPromoEnabled: false,
    }, createDatabaseAccess(fx.db));
    fx.sql.exec("INSERT INTO telegram_users(user_id, chat_id, first_name, locale) VALUES ('7003', '7003', 'Andi', 'id')");

    for (const upd of [3001, 3002]) {
      const res = await webhookPost(makeWebhookReq({
        update_id: upd,
        message: {
          message_id: upd,
          from: { id: 7003, first_name: "Andi" },
          chat: { id: 7003, type: "private" },
          text: "/start",
          date: 1700000000,
        },
      }));
      expect(res.status).toBe(200);
    }
    // Buyer was NOT blocked (received welcome card)
    expect(tgCalls.some((c) => c.body.chat_id === 7003 && String(c.body.caption || c.body.text || "").includes("Halo, Andi"))).toBe(true);
    // Admin group alerted ONCE (throttled for 6h)
    const adminAlerts = tgCalls.filter((c) => c.method === "sendMessage" && c.body.chat_id === "-100999");
    expect(adminAlerts).toHaveLength(1);
    expect(String(adminAlerts[0].body.text)).toContain("fail-open aktif");
  });

  it("supports manual broadcast, 403 not-admin handling, and morning/evening auto-promo to @axvaratech without /stop footer and with order buttons", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const morning = new Date("2026-11-27T02:05:00Z"); // 09:05 WIB
    vi.setSystemTime(morning);

    const db = createDatabaseAccess(fx.db);
    await saveTelegramChannelConfig({
      channelUsername: "axvaratech",
      channelTitle: "Axvara Official",
      forceSubEnabled: false,
      channelPromoEnabled: true,
    }, db);

    // 1. Manual broadcast to telegram_channel
    const templateId = "11111111-1111-4111-8111-111111111111";
    const campaignId = "22222222-2222-4222-8222-222222222222";
    fx.sql.prepare("INSERT INTO broadcast_templates(id,name,title,body,cta_label,cta_url) VALUES (?,?,?,?,?,?)")
      .run(templateId, "Flash Sale", "Flash Sale Malam", "Diskon spesial ready!", "Order Sekarang", "https://t.me/Axvara_bot?start=beli");

    const rev = await reviewBroadcast(templateId, 1, ["telegram_channel"], db);
    expect(rev.counts).toEqual({ telegram_channel: 1 });
    expect(rev.snapshot.tgChannel).toEqual({ destination: "@axvaratech", title: "Axvara Official" });

    await launchBroadcast({ id: campaignId, templateId, revision: 1, channels: ["telegram_channel"] }, "admin@axvara.tech", db);
    const manualRes = await processBroadcasts(db, 10, 10_000);
    expect(manualRes.sent).toBe(1);
    const manualMsg = tgCalls.find((c) => c.method === "sendMessage" && c.body.chat_id === "@axvaratech");
    expect(manualMsg).toBeTruthy();
    expect(String(manualMsg?.body.text)).toContain("Flash Sale Malam");
    expect(String(manualMsg?.body.text)).not.toContain("/stop");

    // 2. Auto-promo with DM disabled and Channel enabled -> posts ONLY to @axvaratech with inline buttons and NO /stop
    tgCalls.length = 0;
    fx.sql.exec(`
      INSERT INTO telegram_users(user_id, chat_id, is_blocked, broadcast_opt_out) VALUES ('801', '801', 0, 0);
      INSERT INTO store_settings(key, value) VALUES ('${TELEGRAM_PROMO_SETTINGS_KEY}', 'false');
    `);
    vi.setSystemTime(new Date("2026-11-27T02:06:00Z")); // past 100ms pace

    const enq = await enqueueDueTelegramPromo(db, new Date("2026-11-27T02:06:00Z"));
    expect(enq).toMatchObject({ due: true, enqueued: 1 });
    const promoRes = await processBroadcasts(db, 10, 10_000);
    expect(promoRes.sent).toBe(1);
    const promoMsg = tgCalls.find((c) => c.method === "sendMessage" && c.body.chat_id === "@axvaratech");
    expect(promoMsg).toBeTruthy();
    expect(tgCalls.some((c) => c.body.chat_id === "801")).toBe(false);
    expect(String(promoMsg?.body.text)).toContain("PRODUK AXVARA READY PAGI INI");
    expect(String(promoMsg?.body.text)).not.toContain(TELEGRAM_PROMO_FOOTER);
    expect(promoMsg?.body.link_preview_options).toMatchObject({
      url: "https://axvara.tech/banners/ready-promo.jpg",
      prefer_large_media: true,
      show_above_text: true,
    });
    const promoKb = (promoMsg?.body.reply_markup as { inline_keyboard: { text: string; url?: string }[][] }).inline_keyboard;
    expect(promoKb[0].map((b) => b.text)).toEqual(["🛒 Order di Bot", "🌐 Website"]);

    // 3. 403 on telegram_channel marks delivery failed with telegram_channel_not_admin, never flips telegram_users.is_blocked
    vi.setSystemTime(new Date("2026-11-27T02:07:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" })));
    const failCampaign = "33333333-3333-4333-8333-333333333333";
    await launchBroadcast({ id: failCampaign, templateId, revision: 1, channels: ["telegram_channel"] }, "admin@axvara.tech", db);
    const failRes = await processBroadcasts(db, 10, 10_000);
    expect(failRes.failed).toBe(1);
    expect(fx.sql.prepare("SELECT status, last_error FROM broadcast_deliveries WHERE campaign_id=?").get(failCampaign)).toEqual({
      status: "failed",
      last_error: "telegram_channel_not_admin",
    });
    expect(fx.sql.prepare("SELECT is_blocked FROM telegram_users WHERE user_id='801'").get()?.is_blocked).toBe(0);
  });

  it("preserves deep-link payload across Force-Join AND first-time language chooser for brand-new buyers", async () => {
    await saveTelegramChannelConfig({
      channelUsername: "axvaratech",
      channelTitle: "Axvara Official",
      forceSubEnabled: true,
      channelPromoEnabled: false,
    }, createDatabaseAccess(fx.db));

    // Brand-new user (no locale yet) clicks ad link /start prd_42
    await webhookPost(makeWebhookReq({
      update_id: 4001,
      message: {
        message_id: 41,
        from: { id: 7010, first_name: "Rina" },
        chat: { id: 7010, type: "private" },
        text: "/start prd_42",
        date: 1700000000,
      },
    }));
    expect(tgCalls.some((c) => String(c.body.text || "").includes("Gabung Channel Dulu"))).toBe(true);

    // Joins channel -> taps fsub:check -> shows language chooser while keeping onboarding:prd_42
    memberStatus = "member";
    tgCalls.length = 0;
    await webhookPost(makeWebhookReq({
      update_id: 4002,
      callback_query: {
        id: "cb-new-joined",
        from: { id: 7010, first_name: "Rina" },
        message: { message_id: 42, chat: { id: 7010 } },
        data: "fsub:check",
      },
    }));
    expect(tgCalls.some((c) => String(c.body.text || "").includes("Pilih bahasa"))).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='7010'").get()?.pending_action).toBe("onboarding:prd_42");

    // Picks lang:id -> resumes product #42!
    tgCalls.length = 0;
    await webhookPost(makeWebhookReq({
      update_id: 4003,
      callback_query: {
        id: "cb-lang-id",
        from: { id: 7010, first_name: "Rina" },
        message: { message_id: 42, chat: { id: 7010 } },
        data: "lang:id",
      },
    }));
    expect(tgCalls.some((c) => String(c.body.text || "").includes("ChatGPT Plus"))).toBe(true);
  });

  it("exposes authenticated Admin Telegram Channel API (GET/save/verify) and embeds config in /api/admin/bot/health", async () => {
    // Unauthenticated rejected
    expect((await channelApiGet(new NextRequest("https://axvara.tech/api/admin/telegram/channel"))).status).toBe(401);

    const { token, sid } = await createAdminToken("admin@axvara.tech");
    const cookie = `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(await createIdleToken(sid))}`;

    // Save valid settings
    const saveRes = await channelApiPost(new NextRequest("https://axvara.tech/api/admin/telegram/channel", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        action: "save",
        channelUsername: "@axvaratech",
        channelTitle: "Axvara Official",
        forceSubEnabled: true,
        channelPromoEnabled: true,
        dmPromoEnabled: false,
      }),
    }));
    expect(saveRes.status).toBe(200);
    const savedBody = await saveRes.json();
    expect(savedBody).toMatchObject({
      ok: true,
      dmPromoEnabled: false,
      config: {
        channelUsername: "axvaratech",
        channelTitle: "Axvara Official",
        forceSubEnabled: true,
        channelPromoEnabled: true,
      },
    });

    // Verify health endpoint includes telegram_channel without needing extra client request
    const healthRes = await botHealthGet(new NextRequest("https://axvara.tech/api/admin/bot/health", { headers: { cookie } }));
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.telegram_channel).toMatchObject({
      channelUsername: "axvaratech",
      forceSubEnabled: true,
      channelPromoEnabled: true,
      dmPromoEnabled: false,
    });

    // Verify bot admin check (mock administrator + can_post_messages=true)
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const method = String(url).split("/").pop();
      if (method === "getMe") return Response.json({ ok: true, result: { id: 999000, is_bot: true, first_name: "Axvara", username: "Axvara_bot" } });
      return Response.json({ ok: true, result: { status: "administrator", can_post_messages: true } });
    }));
    const verifyRes = await channelApiPost(new NextRequest("https://axvara.tech/api/admin/telegram/channel", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ action: "verify", channelUsername: "axvaratech" }),
    }));
    expect(verifyRes.status).toBe(200);
    expect(await verifyRes.json()).toMatchObject({
      ok: true,
      channelUsername: "axvaratech",
      botUsername: "@Axvara_bot",
      isAdmin: true,
      canPostMessages: true,
    });
  });
});
