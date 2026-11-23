import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const api = vi.hoisted(() => ({
  send: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  edit: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answer: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  safeEditOrSend: api.edit,
  answerCallbackQuery: api.answer,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
}));

let fx: ReturnType<typeof createD1Fixture>;
const buyer = { id: 551, first_name: "Buyer" };

beforeEach(() => {
  vi.clearAllMocks();
  fx = createD1Fixture();
  fx.sql.exec("INSERT INTO telegram_users(user_id,chat_id,first_name,locale) VALUES('551','551','Buyer','id')");
});

afterEach(() => {
  fx.close();
  vi.unstubAllEnvs();
});

describe("Telegram cart schema retirement (keranjang hanya ada di web)", () => {
  it("drops telegram_carts table and removes all Telegram cart modules", () => {
    expect(fs.existsSync("src/lib/telegram/cart.ts")).toBe(false);
    expect(fs.existsSync("src/lib/telegram/handlers/cart.ts")).toBe(false);
    expect(fs.existsSync("src/lib/telegram/handlers/cart-invoice.ts")).toBe(false);
    const tables = fx.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_carts'").all();
    expect(tables).toEqual([]);
  });

  it("ignores retired cart callbacks and never creates orders or mutates pending_action", async () => {
    await insertTestProduct(fx.sql, "manual", 1);
    const { handleCallback } = await import("@/lib/telegram/handlers/callback");
    for (const data of ["cart", "cadd:1:1:2", "cinc:1", "cdec:1", "crm:1", "cclear", "ccheckout", "cconfirm:deadbeef", "ceedit"]) {
      await handleCallback(data, buyer.id, 10, buyer);
    }
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id='551'").get()).toEqual({ pending_action: null });
  });

  it("rejects legacy payq1 cart source fail-closed in parsePayq1State", async () => {
    const { parsePayq1State } = await import("@/lib/telegram/payment-quote");
    const legacyCartRaw = `payq1:${JSON.stringify({
      v: 1,
      nonce: "0123456789abcdef",
      exp: Math.floor(Date.now() / 1000) + 600,
      tag: "0123456789ab",
      locale: "id",
      idrSubtotal: 10000,
      source: { kind: "cart" },
      methods: [],
      sel: null,
      contact: { email: null, phone: null },
      st: "quoted",
    })}`;
    expect(parsePayq1State(legacyCartRaw)).toBeNull();
  });

  it("/cart and /keranjang no longer open any cart view", async () => {
    const { handleCommand } = await import("@/lib/telegram/handlers/command");
    for (const cmd of ["/cart", "/keranjang"]) {
      api.send.mockClear();
      await handleCommand(cmd, buyer.id, "private", buyer);
      const sentTexts = api.send.mock.calls.map((args) => String(((args as unknown[])[0] as { text?: string } | undefined)?.text ?? "")).join("\n");
      expect(sentTexts).not.toMatch(/keranjang kosong|🛒 keranjang/i);
    }
  });
});
