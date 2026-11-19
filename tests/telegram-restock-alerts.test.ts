// Item 13 — per-product restock opt-in alerts (migration 0144).
// Fixture D1: real SQLite from drizzle/schema.sql (includes telegram_restock_alerts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { processDueRestockAlerts, subscribeRestockAlert, RESTOCK_ALERTS_MAX_PER_USER } from "@/lib/telegram/restock-alerts";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: send,
  sendPhoto: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

let fx: ReturnType<typeof createD1Fixture>;
const db = () => createDatabaseAccess(fx.db);
const USER = "12345";

function seedOutOfStockProduct(id = 1) {
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(?,?,?,10000,0,1,1)`)
    .run(id, `Product ${id}`, `product-${id}`);
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(?,?,?,?,10000,0,'manual',1)`)
    .run(id, id, `SKU-${id}`, "1 Bulan");
}
function restock(id = 1) {
  fx.sql.prepare("UPDATE product_variants SET stock=5 WHERE product_id=?").run(id);
}

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  fx = createD1Fixture();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,'id')").run(USER, USER);
  seedOutOfStockProduct();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("subscribeRestockAlert", () => {
  it("subscribes an out-of-stock product once (idempotent) and rejects in-stock", async () => {
    expect(await subscribeRestockAlert(USER, 1, db())).toEqual({ ok: true, status: "subscribed" });
    expect(await subscribeRestockAlert(USER, 1, db())).toEqual({ ok: true, status: "already_subscribed" });
    restock(1);
    expect(await subscribeRestockAlert(USER, 1, db())).toEqual({ ok: false, status: "in_stock" });
  });

  it("rejects unknown/invalid products and never throws", async () => {
    expect(await subscribeRestockAlert(USER, 999, db())).toEqual({ ok: false, status: "unavailable" });
    expect(await subscribeRestockAlert("", 1, db())).toEqual({ ok: false, status: "unavailable" });
    expect(await subscribeRestockAlert(USER, -5, db())).toEqual({ ok: false, status: "unavailable" });
  });

  it("enforces the 20 active-alert cap per user", async () => {
    for (let i = 2; i <= RESTOCK_ALERTS_MAX_PER_USER + 1; i++) seedOutOfStockProduct(i);
    for (let i = 1; i <= RESTOCK_ALERTS_MAX_PER_USER; i++) {
      expect((await subscribeRestockAlert(USER, i, db())).ok).toBe(true);
    }
    expect(await subscribeRestockAlert(USER, RESTOCK_ALERTS_MAX_PER_USER + 1, db())).toEqual({ ok: false, status: "limit_reached" });
  });
});

describe("processDueRestockAlerts", () => {
  it("sends one alert when the product becomes purchasable, then marks it sent", async () => {
    await subscribeRestockAlert(USER, 1, db());
    // Not yet purchasable → nothing due.
    expect(await processDueRestockAlerts(db(), 50)).toEqual({ sent: 0, cancelled: 0, deferred: 0 });
    restock(1);
    const out = await processDueRestockAlerts(db(), 50);
    expect(out.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.chat_id).toBe(USER);
    expect(call.text).toContain("Stok tersedia lagi");
    expect(JSON.stringify(call.reply_markup)).toContain("prd:1");
    // Idempotent: a second tick sends nothing.
    expect(await processDueRestockAlerts(db(), 50)).toEqual({ sent: 0, cancelled: 0, deferred: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancels alerts for buyers who blocked the bot (403)", async () => {
    await subscribeRestockAlert(USER, 1, db());
    restock(1);
    send.mockResolvedValue({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    const out = await processDueRestockAlerts(db(), 50);
    expect(out.cancelled).toBe(1);
    expect(fx.sql.prepare("SELECT status FROM telegram_restock_alerts WHERE user_id=?").get(USER)?.status).toBe("cancelled");
  });

  it("rolls back the claim and stops on 429 so the next tick resumes", async () => {
    await subscribeRestockAlert(USER, 1, db());
    restock(1);
    send.mockResolvedValue({ ok: false, error_code: 429, parameters: { retry_after: 5 } });
    const out = await processDueRestockAlerts(db(), 50);
    expect(out.sent).toBe(0);
    expect(out.deferred).toBe(1);
    expect(fx.sql.prepare("SELECT status FROM telegram_restock_alerts WHERE user_id=?").get(USER)?.status).toBe("pending");
  });
});
