// Extras router (W-B) — ownership guard, unknown-returns-false, rst subscribe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send, safeEditOrSend: api.edit, sendPhoto: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: vi.fn() }));

let fx: ReturnType<typeof createD1Fixture>;
const buyer = 12345;

beforeEach(async () => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,'id')").run(String(buyer), String(buyer));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("handleExtraCallback", () => {
  it("returns false for unknown actions", async () => {
    const { handleExtraCallback } = await import("@/lib/telegram/handlers/extras");
    expect(await handleExtraCallback("nonsense", [], buyer, 1, { id: buyer, first_name: "B" })).toBe(false);
  });

  it("rejects group chats without touching state", async () => {
    const { handleExtraCallback } = await import("@/lib/telegram/handlers/extras");
    expect(await handleExtraCallback("mo", [], -999, 1, { id: buyer, first_name: "B" })).toBe(false);
    expect(api.edit).not.toHaveBeenCalled();
  });

  it("routes mo to the paged orders list", async () => {
    const { handleExtraCallback } = await import("@/lib/telegram/handlers/extras");
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,variant_id)
       VALUES('AXV-20261118-EXTR0001','B','6280','[]',10000,'qris','lunas','paid','telegram',?,?,1)`).run(String(buyer), String(buyer));
    expect(await handleExtraCallback("mo", ["s", "0"], buyer, 1, { id: buyer, first_name: "B" })).toBe(true);
    expect(api.edit).toHaveBeenCalled();
  });

  it("routes legacy rst callback gracefully without creating a subscription", async () => {
    const { handleExtraCallback } = await import("@/lib/telegram/handlers/extras");
    fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(9,'Prod 9','p9',10000,0,1,1)").run();
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(9,9,'SKU-9','1B',10000,0,'manual',1)").run();
    expect(await handleExtraCallback("rst", ["9"], buyer, 1, { id: buyer, first_name: "B" })).toBe(true);
    expect(api.send).toHaveBeenCalled();
    const text = String(api.send.mock.calls.at(-1)?.[0].text ?? "");
    expect(text).toContain("Pengingat restok sudah tidak tersedia");
    expect(fx.sql.prepare("SELECT status FROM telegram_restock_alerts WHERE user_id=? AND product_id=9").get(String(buyer))).toBeUndefined();
  });
});

describe("handleExtraStartPayload", () => {
  it("handles legacy restock_<id> deep link gracefully without subscribing and rejects other payloads", async () => {
    const { handleExtraStartPayload } = await import("@/lib/telegram/handlers/extras");
    fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled) VALUES(7,'Prod 7','p7',10000,0,1,1)").run();
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active) VALUES(7,7,'SKU-7','1B',10000,0,'manual',1)").run();
    expect(await handleExtraStartPayload("restock_7", buyer, { id: buyer, first_name: "B" })).toBe(true);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM telegram_restock_alerts").get()).toEqual({ n: 0 });
    expect(await handleExtraStartPayload("prd_7", buyer, { id: buyer, first_name: "B" })).toBe(false);
  });
});
