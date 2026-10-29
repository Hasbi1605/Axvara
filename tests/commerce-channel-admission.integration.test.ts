import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createChannelOrderAtomic, type AtomicChannelOrderInput } from "@/lib/commerce";
import { StockReservationError } from "@/lib/db";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

let fx: ReturnType<typeof createD1Fixture>;
let input: AtomicChannelOrderInput;

beforeEach(async () => {
  fx = createD1Fixture();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external calls"); }));
  await insertTestProduct(fx.sql, "unique", 1);
  fx.sql.exec(`
    INSERT INTO products(id,name,slug,price,stock) VALUES(2,'Other','other',10000,100);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode)
      VALUES(2,2,'OTHER','Other',10000,100,'unique');
    INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint)
      VALUES(1,1,'fixture','fixture','first'),(2,2,'fixture','fixture','second');
  `);
  input = {
    orderCode: "AXV-20261029-CHANNEL1",
    idempotencyKey: "fixture-channel-admission",
    lines: [1, 2].map(id => ({ productId: id, variantId: id, qty: 1, stock: 100, fulfillmentMode: "unique" })),
    items: [1, 2].map(id => ({ product_id: id, variant_id: id, price: 10000, qty: 1, name: "Fixture" })),
    variantSnapshot: "{}",
    subtotal: 20000,
    primaryVariantId: 1,
    customerName: "Fixture",
    salesChannel: "telegram",
    telegramChatId: "fixture-chat",
    paymentMethod: "qris",
    paymentAccount: "Fixture",
    fulfillmentStatus: "reserved",
  };
});

afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const state = () => ({
  variants: fx.sql.prepare("SELECT * FROM product_variants ORDER BY id").all(),
  inventory: fx.sql.prepare("SELECT * FROM fulfillment_inventory ORDER BY id").all(),
  orders: fx.sql.prepare("SELECT * FROM orders ORDER BY id").all(),
  guards: fx.sql.prepare("SELECT * FROM operation_guards ORDER BY operation_id").all(),
});

it.each([1, 2])("rejects Telegram when product %i is disabled without any stock, inventory or order mutations", async productId => {
  fx.sql.prepare("UPDATE products SET telegram_enabled=0 WHERE id=?").run(productId);
  const before = state();

  await expect(createChannelOrderAtomic(input)).rejects.toThrow(StockReservationError);

  expect(state()).toEqual(before);
});

it.each(["web", "whatsapp"] as const)("allows %s orders for Telegram-disabled products", async salesChannel => {
  fx.sql.exec("UPDATE products SET telegram_enabled=0");

  const result = await createChannelOrderAtomic({ ...input, salesChannel });

  expect(result).toMatchObject({ code: input.orderCode, subtotal: 20000, isExisting: false });
  expect(state().orders).toMatchObject([{ sales_channel: salesChannel }]);
  expect(state().variants.map(row => row.stock)).toEqual([99, 99]);
  expect(state().inventory).toMatchObject([
    { status: "reserved", order_code: input.orderCode },
    { status: "reserved", order_code: input.orderCode },
  ]);
  expect(state().guards).toEqual([]);
});

it.each(["same-key", "pending-chat"])("reuses the existing pending Telegram order after disabling sales (%s)", async retry => {
  const original = await createChannelOrderAtomic(input);
  expect(original.isExisting).toBe(false);
  fx.sql.exec("UPDATE products SET telegram_enabled=0");
  const before = state();
  const batch = vi.spyOn(fx.db, "batch");

  const result = await createChannelOrderAtomic({
    ...input,
    orderCode: "AXV-20261029-CHANNEL2",
    idempotencyKey: retry === "same-key" ? input.idempotencyKey : "fixture-channel-retry",
  });

  expect(result).toEqual({ ...original, isExisting: true });
  expect(state()).toEqual(before);
  if (retry === "same-key") expect(batch).not.toHaveBeenCalled();
});
