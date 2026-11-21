// tests/characterization/orders-telegram-commerce.test.ts — T7 characterization
// for F1 (placeOrder extraction).
//
// Locks CURRENT behavior of createChannelOrderAtomic / reserveChannelOrder in
// src/lib/commerce.ts BEFORE the web route (post-3B) and commerce.ts converge
// into a channel-agnostic placeOrder service (roadmap §6 Fase 1 T7; MAP-4 §1).
// Test-only: never touches src/, drizzle/, scripts/, docs/. No real network:
// fetch stubbed to throw. Asserts observable behavior (return shape, DB rows).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChannelOrderAtomic, type AtomicChannelOrderInput } from "@/lib/commerce";
import { StockReservationError } from "@/lib/db";
import { createD1Fixture, insertTestProduct } from "../helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;

function telegramInput(overrides: Partial<AtomicChannelOrderInput> = {}): AtomicChannelOrderInput {
  return {
    orderCode: "AXV-20261121-TG00001",
    idempotencyKey: "tg-t7-fixture-key",
    lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 100 }],
    items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }],
    variantSnapshot: "{}",
    subtotal: 10000,
    primaryVariantId: 1,
    customerName: "Fixture",
    salesChannel: "telegram",
    telegramChatId: "t7-chat",
    telegramUserId: "t7-user",
    paymentMethod: "qris",
    paymentAccount: "Fixture",
    fulfillmentStatus: "not_required",
    ...overrides,
  };
}

const state = () => ({
  orders: fixture.sql.prepare("SELECT code,subtotal,sales_channel,telegram_chat_id FROM orders ORDER BY id").all(),
  stock: fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock,
  guards: fixture.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n,
});

beforeEach(async () => {
  fixture = createD1Fixture();
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "t7-telegram-fixture-secret");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No real network: T7 blocks external traffic"); }));
  await insertTestProduct(fixture.sql, "manual", 1);
  fixture.sql.prepare("UPDATE product_variants SET price=10000,stock=100 WHERE id=1").run();
  fixture.sql.prepare("UPDATE products SET is_active=1,telegram_enabled=1 WHERE id=1").run();
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("T7 — Telegram order creation via commerce.ts", () => {
  it("success creates one order, decrements stock once, and leaves no guards", async () => {
    const result = await createChannelOrderAtomic(telegramInput());
    expect(result).toMatchObject({ code: "AXV-20261121-TG00001", subtotal: 10000, isExisting: false });
    expect(state()).toMatchObject({
      orders: [{ code: "AXV-20261121-TG00001", subtotal: 10000, sales_channel: "telegram", telegram_chat_id: "t7-chat" }],
      stock: 99,
      guards: 0,
    });
  });

  it("idempotent re-entry with the same quote_id returns the same order and writes nothing new", async () => {
    const first = await createChannelOrderAtomic(telegramInput());
    expect(first.isExisting).toBe(false);
    const before = state();
    const second = await createChannelOrderAtomic(telegramInput({ orderCode: "AXV-20261121-TG00002" }));
    expect(second).toEqual({ ...first, isExisting: true });
    expect(state()).toEqual(before);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
  });

  it("pending-chat guard: a second chat order while one is pending returns the existing order", async () => {
    const first = await createChannelOrderAtomic(telegramInput());
    expect(first.isExisting).toBe(false);
    const before = state();
    const second = await createChannelOrderAtomic(telegramInput({
      orderCode: "AXV-20261121-TG00003",
      idempotencyKey: "tg-t7-other-key",
    }));
    expect(second).toMatchObject({ code: first.code, isExisting: true });
    expect(state()).toEqual(before);
  });

  it("stock race for the last unit: both runners overlap before either writes, exactly one wins", async () => {
    fixture.sql.prepare("UPDATE product_variants SET stock=1 WHERE id=1").run();
    const a = telegramInput({ orderCode: "AXV-20261121-TGRACE1", idempotencyKey: "tg-t7-race-a", telegramChatId: "t7-chat-a", telegramUserId: "t7-user-a" });
    const b = telegramInput({ orderCode: "AXV-20261121-TGRACE2", idempotencyKey: "tg-t7-race-b", telegramChatId: "t7-chat-b", telegramUserId: "t7-user-b" });
    // Both-arrive barrier: hold each atomic batch until BOTH runners have
    // finished their guard/stock reads. Without this the synchronous fixture
    // can serialize (winner writes before loser reads) and the test would
    // pass without proving atomicity.
    const realBatch = fixture.db.batch.bind(fixture.db);
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    fixture.db.batch = (async (statements: never[]) => {
      const isOrderBatch = (statements as { query?: string }[]).some((s) => typeof s?.query === "string" && s.query.includes("INSERT INTO orders"));
      if (isOrderBatch) {
        arrivals++;
        if (arrivals >= 2) release();
        else await bothArrived;
      }
      return realBatch(statements);
    }) as typeof fixture.db.batch;
    const results = await Promise.allSettled([createChannelOrderAtomic(a), createChannelOrderAtomic(b)]);
    expect(arrivals).toBe(2);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
  });

  it("unique-mode stock race: both runners overlap, one credential reserved", async () => {
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode='unique',stock=1 WHERE id=1").run();
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,'fixture','fixture','t7-only')").run();
    const line = { productId: 1, variantId: 1, qty: 1, fulfillmentMode: "unique", stock: 1 };
    const item = { product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" };
    const a = telegramInput({ orderCode: "AXV-20261121-TGUNQ1", idempotencyKey: "tg-t7-unq-a", telegramChatId: "t7-unq-a", telegramUserId: "t7-unq-a", lines: [line], items: [item] });
    const b = telegramInput({ orderCode: "AXV-20261121-TGUNQ2", idempotencyKey: "tg-t7-unq-b", telegramChatId: "t7-unq-b", telegramUserId: "t7-unq-b", lines: [line], items: [item] });
    const realBatch = fixture.db.batch.bind(fixture.db);
    let arrivals = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    fixture.db.batch = (async (statements: never[]) => {
      const isOrderBatch = (statements as { query?: string }[]).some((s) => typeof s?.query === "string" && s.query.includes("INSERT INTO orders"));
      if (isOrderBatch) {
        arrivals++;
        if (arrivals >= 2) release();
        else await bothArrived;
      }
      return realBatch(statements);
    }) as typeof fixture.db.batch;
    const results = await Promise.allSettled([createChannelOrderAtomic(a), createChannelOrderAtomic(b)]);
    expect(arrivals).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='reserved'").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(0);
  });

  it("price change between quote and reservation rejects and writes nothing", async () => {
    const before = state();
    // Live price moved after the caller's snapshot (item still claims 10000).
    fixture.sql.prepare("UPDATE product_variants SET price=12000 WHERE id=1").run();
    await expect(createChannelOrderAtomic(telegramInput())).rejects.toThrow(StockReservationError);
    // The fixture price mutation above is setup, not the call's doing: the
    // call itself must not have created an order or leaked guards.
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(before.orders.length);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n).toBe(0);
  });
});
